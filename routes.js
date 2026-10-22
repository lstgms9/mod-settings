const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const QRCode = require('qrcode');
const archiver = require('archiver');

module.exports = function(router, ctx) {
  const { storage } = ctx;
  // Default to inst-dev (okdun.ai platform shell). When the module is
  // running inside a tenant (gamoid etc.), req.instanceSlug is set and
  // resolveUsersDir(req) routes the read/write to that tenant's store.
  const fallbackUsersDir = path.join(__dirname, '../../instances/inst-dev/storage/users');
  const storageDir = path.join(__dirname, '../../instances/inst-dev/storage');
  const INSTANCES_DIR = ctx.instancesDir || path.join(__dirname, '../../instances');
  // bring your own AI — the 3x3 grid's server side (lib/ai-links.js); its flags live in the site config (config.byoAi)
  const _cfgCache = {};
  const siteCfg = (req) => { const slug = (req && req.instanceSlug) || 'inst-dev', c = _cfgCache[slug];
    if (c && Date.now() - c.at < 60000) return c.v;
    let v = {}; try { v = JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, slug, 'instance.json'), 'utf8')).config || {}; } catch (e) {}
    _cfgCache[slug] = { at: Date.now(), v }; return v; };
  require('./lib/ai-links')(router, { config: siteCfg });
  // the brand in a mail's subject: the site's own name (business.name), or config.signup.mailBrand when set (hashoid keeps 'OkDun')
  const mailBrand = (req) => { const b = (siteCfg(req).signup || {}).mailBrand; if (b) return b;
    try { return (JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, (req && req.instanceSlug) || 'inst-dev', 'instance.json'), 'utf8')).business || {}).name || ''; } catch (e) { return ''; } };

  function resolveUsersDir(req) {
    if (req && req.instanceSlug) return path.join(INSTANCES_DIR, req.instanceSlug, 'storage', 'users');
    return fallbackUsersDir;
  }

  // ── helpers ──────────────────────────────────────────────────
  function readUser(studio, req) {
    const dir = resolveUsersDir(req);
    const f = path.join(dir, studio + '.json');
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  }
  function writeUser(studio, data, req) {
    const dir = resolveUsersDir(req);
    fs.writeFileSync(path.join(dir, studio + '.json'), JSON.stringify(data, null, 2));
  }

  // ── 2FA lives on the account record sign-in checks (Damon 2026-10-18) ──
  // Sign-in (okdunio auth.js tfaCheck) reads the Gecko 'client' record's data.tfa; 2FA setup here wrote the old
  // per-user file, so enrolling did nothing. tfaHolder finds that record (session slug, else the studio's), and an
  // older account whose 2FA is only in the old file has it carried over — the same secret, so its authenticator keeps
  // working. No Gecko record (the okdun.io platform itself): the old file as before.
  async function tfaClient(req) {
    for (const id of [req.user.slug, req.user.studio]) {
      if (!id) continue;
      try { const c = await storage.get('client', id); if (c && c.data) return c; } catch (e) {}
    }
    try {
      const all = await storage.list('client');
      const hit = all.find(u => ((u.data || u).studio) === req.user.studio);
      if (hit) return await storage.get('client', hit.id);
    } catch (e) {}
    return null;
  }
  // the server's own auth (okdunio auth.js): THE code check and THE 2FA email — the same ones sign-in uses
  let _okAuth;
  function okAuth() {
    if (_okAuth !== undefined) return _okAuth;
    try { _okAuth = require.main.require('./auth'); if (!_okAuth.tfaCheck) throw 0; }
    catch (e) { try { _okAuth = require(path.join(__dirname, '../../okdunio/auth')); } catch (e2) { _okAuth = null; } }
    return _okAuth;
  }
  // 2FA ON THE VAULT (Damon GO 2026-10-22): tfa.secret, tfa.recovery[] and tfaPending.secret are stored SEALED by the
  // vault and checked there (okdunio lib/authkeys.js: tfaEnrol / tfaVerify / tfaRecover / tfaRecoveryCodes) — this
  // server never opens them and holds no key. The holder hands out the stored (sealed) copies and saves them as they are.
  function keys() { const a = okAuth(); return a && a.authkeys; }
  async function tfaHolder(req) {
    const c = await tfaClient(req), user = readUser(req.user.studio, req);
    if (c) {
      if (!c.data.tfa && user && user.tfa && user.tfa.method === 'totp') { await storage.update('client', c.id, { tfa: user.tfa }); c.data.tfa = user.tfa; }
      return { client: c, email: c.data.email || (user && user.email) || null, tfa: c.data.tfa || null, pending: c.data.tfaPending || null, account: c.id,
        save: async (patch) => storage.update('client', c.id, patch) };
    }
    if (!user) return null;
    return { email: user.email || null, tfa: user.tfa || null, pending: user.tfaPending || null, account: req.user.studio,
      save: async (patch) => { for (const k in patch) { if (patch[k] == null) delete user[k]; else user[k] = patch[k]; } writeUser(req.user.studio, user, req); } };
  }
  // the holder, or a 503 sent (the vault is down) — a thrown error here would take the whole server down
  async function holderOr503(req, res) {
    try { return { th: await tfaHolder(req) }; } catch (e) { res.error(e.status || 503, e.message || 'Unavailable'); return null; }
  }
  // a code against a TOTP 2FA (or one of its recovery codes) — on the vault; a used recovery code is taken off the list
  async function tfaCodeOk(th, tfa, code) {
    const K = keys(); if (!K || !tfa || tfa.method !== 'totp' || !code) return false;
    if (await K.tfaVerify(tfa.secret, code, th.account)) return true;
    const rest = await K.tfaRecover(tfa.recovery, code, th.account);
    if (rest && th.tfa === tfa) await th.save({ tfa: Object.assign({}, tfa, { recovery: rest }) });
    return !!rest;
  }

  async function getSettingsRecord(studio) {
    const list = await storage.list('setting', { studio });
    if (list.length) return await storage.get('setting', list[0].id);
    return null;
  }

  // mask key to last 8 chars
  function maskKey(key) {
    if (!key || key.length <= 8) return '••••••••';
    return '••••••••' + key.slice(-8);
  }

  // ── GET /prefs — load user settings ──────────────────────────
  router.get('/prefs', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const rec = await getSettingsRecord(req.user.studio);
    const prefs = rec ? { ...rec.data } : {};
    // mask AI keys
    if (prefs.aiKeys) {
      const masked = {};
      for (const [k, v] of Object.entries(prefs.aiKeys)) {
        masked[k] = maskKey(v);
      }
      prefs.aiKeys = masked;
    }
    // 2fa status from the account record sign-in checks (never the secret)
    const user = readUser(req.user.studio, req);
    const th = await tfaHolder(req).catch(() => null);
    prefs.tfa = th && th.tfa ? { method: th.tfa.method, enabled: true } : { enabled: false };
    // include plan info — user-level record first, then fall back to
    // the client record (gamoid public signups create only a client,
    // not a user-level file, so prefs.plan would otherwise stay
    // undefined and the UI would show the HTML default "Free").
    if (user) {
      prefs.plan = user.plan || 'free';
      prefs.displayName = user.displayName || user.studio;
      prefs.email = user.email;
    } else if (req.user.role === 'client') {
      try {
        const c = await storage.get('client', req.user.slug);
        if (c && c.data) {
          prefs.plan = c.data.tier || c.data.plan || 'free';
          prefs.displayName = c.data.displayName || c.data.username || c.data.handle || req.user.email;
          prefs.email = c.data.email || req.user.email;
        }
      } catch (_) {}
    }
    res.json(prefs);
  });

  // ── PUT /prefs — save user settings ──────────────────────────
  router.put('/prefs', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const data = req.body;
    if (!data || typeof data !== 'object') return res.error(400, 'Invalid body');
    // strip protected fields
    delete data.aiKeys;
    delete data.tfa;
    data.studio = req.user.studio;
    const existing = await getSettingsRecord(req.user.studio);
    if (existing) {
      await storage.update('setting', existing.id, data);
    } else {
      await storage.create('setting', data, { module: 'settings', user: req.user.studio });
    }
    res.json({ ok: true });
  });

  // ── PUT /ai-key/:provider — store API key ───────────────────
  router.put('/ai-key/:provider', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const { provider } = req.params;
    const { key } = req.body || {};
    if (!key) return res.error(400, 'Missing key');
    const existing = await getSettingsRecord(req.user.studio);
    let rec;
    if (existing) {
      const aiKeys = existing.data.aiKeys || {};
      aiKeys[provider] = key;
      rec = await storage.update('setting', existing.id, { aiKeys });
    } else {
      rec = await storage.create('setting', {
        studio: req.user.studio, aiKeys: { [provider]: key }
      }, { module: 'settings', user: req.user.studio });
    }
    res.json({ ok: true, masked: maskKey(key) });
  });

  // ── DELETE /ai-key/:provider — remove API key ───────────────
  router.delete('/ai-key/:provider', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const { provider } = req.params;
    const existing = await getSettingsRecord(req.user.studio);
    if (existing && existing.data.aiKeys) {
      const aiKeys = { ...existing.data.aiKeys };
      delete aiKeys[provider];
      await storage.update('setting', existing.id, { aiKeys });
    }
    res.json({ ok: true });
  });

  // ── AI ACCOUNTS (phase A) — per-STUDIO subscription connections ───────
  // The studio brings its own AI: `claude setup-token` runs server-side in a
  // pty (shell-core/ai-auth), we relay the OAuth URL to the browser, the user
  // approves it wherever they're signed in and pastes the code back, and the
  // long-lived token lands AES-GCM-encrypted under this instance's
  // storage/ai-auth/<studio>/claude/. Build pickers (mod-game /ai-options)
  // read the same store. Client only ever sees status + masked identity.
  const aiAuth = require((process.env.SHELL_CORE_DIR || '/home/damon/shell-core') + '/ai-auth');
  function aiBase(req) {
    return path.join(INSTANCES_DIR, req.instanceSlug || 'inst-dev', 'storage');
  }
  // Connections attach to the STUDIO — team members ride them but only the
  // studio account itself (owner/admin/client) may connect or disconnect.
  function canManageAI(req) {
    return req.user && ['owner', 'admin', 'client'].indexOf(req.user.role) >= 0;
  }
  function maskIdentity(id) {
    if (!id) return null;
    const at = id.indexOf('@');
    if (at < 1) return id.slice(0, 2) + '•••';
    return id[0] + '•••@' + id.slice(at + 1);
  }

  router.get('/ai-accounts', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const conns = aiAuth.listConnections(aiBase(req), req.user.studio)
      .map(c => ({ ...c, identity: maskIdentity(c.identity) }));
    res.json({ ready: aiAuth.hasKey(), canManage: canManageAI(req), connections: conns });
  });

  router.post('/ai-accounts/:provider/connect', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    if (!canManageAI(req)) return res.error(403, 'Only the studio owner/admin can connect AI accounts');
    try {
      const { sid } = aiAuth.startConnect({ base: aiBase(req), studio: req.user.studio, provider: req.params.provider });
      res.json({ ok: true, sid });
    } catch (e) { res.error(400, e.message); }
  });

  router.get('/ai-accounts/connect/:sid', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const s = aiAuth.connectStatus(req.params.sid, req.user.studio);
    if (!s) return res.error(404, 'No such connect session');
    res.json(s);
  });

  // Grok = xAI API key (no subscription CLI): validate with a live ping
  // against api.x.ai's Anthropic-native endpoint — the same path builds use —
  // then store it encrypted like any other connection.
  router.post('/ai-accounts/grok/key', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    if (!canManageAI(req)) return res.error(403, 'Only the studio owner/admin can connect AI accounts');
    const key = String((req.body || {}).key || '').trim();
    const v = await aiAuth.validateGrokKey(key);
    if (!v.ok) return res.error(400, v.error || 'key rejected');
    try {
      aiAuth.saveConnection(aiBase(req), req.user.studio, 'grok', {
        kind: 'apikey', secret: { apiKey: key }, identity: 'xAI key ••••' + key.slice(-4),
      });
    } catch (e) { return res.error(400, e.message); }
    res.json({ ok: true });
  });

  router.post('/ai-accounts/connect/:sid/code', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    if (!canManageAI(req)) return res.error(403, 'Forbidden');
    const r = aiAuth.submitCode(req.params.sid, req.user.studio, (req.body || {}).code);
    if (!r.ok) return res.error(400, r.error);
    res.json({ ok: true });
  });

  router.post('/ai-accounts/connect/:sid/cancel', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const s = aiAuth.connectStatus(req.params.sid, req.user.studio);
    if (s) aiAuth.cancelConnect(req.params.sid);
    res.json({ ok: true });
  });

  router.delete('/ai-accounts/:provider', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    if (!canManageAI(req)) return res.error(403, 'Only the studio owner/admin can disconnect AI accounts');
    aiAuth.removeConnection(aiBase(req), req.user.studio, req.params.provider);
    res.json({ ok: true });
  });

  // Settings tabs this tenant opens to EVERY account whatever the tier (config.settings.openToAll, e.g. gamoid
  // ['privacy']: 2FA for free accounts too — Damon 2026-10-19, free accounts can earn money). No value = the tier gate as is.
  router.get('/open-tabs', async (req, res) => {
    const c = (req.instance && req.instance.config && req.instance.config.settings) || {};
    res.json({ open: Array.isArray(c.openToAll) ? c.openToAll : [] });
  });

  // ── 2FA: TOTP setup ─────────────────────────────────────────
  router.post('/2fa/setup-totp', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    // Issuer = the vertical's brand (what the user sees in their Authenticator
    // app, e.g. "Gamoid: damon"), derived from the tenant slug. End users have
    // no idea what "OkDun" is. Falls back to OkDun for the platform itself.
    // Issuer/label are display-only in the otpauth URI — they don't affect the
    // generated codes — so changing this only matters for new enrollments.
    const slug = req.instanceSlug;
    const issuer = (slug && slug !== 'inst-dev') ? (slug.charAt(0).toUpperCase() + slug.slice(1)) : 'OkDun';
    // the secret is made and sealed on the vault; its otpauth URI is only for this one QR (never stored here)
    const _h = await holderOr503(req, res); if (!_h) return; const th = _h.th;
    if (!th) return res.error(404, 'User not found');
    if (th.tfa) return res.error(400, '2FA is already on');
    const K = keys(); if (!K) return res.error(503, '2FA is unavailable right now');
    let en; try { en = await K.tfaEnrol(issuer, req.user.studio); } catch (e) { return res.error(e.status || 503, e.message); }
    let qrDataUrl;
    try { qrDataUrl = await QRCode.toDataURL(en.otpauthUri, { width: 200, margin: 2 }); }
    catch { return res.error(500, 'QR generation failed'); }
    // the pending secret on the account (sealed; not active until a code from it is verified)
    await th.save({ tfaPending: { method: 'totp', secret: en.sealedSecret } });
    res.json({ qr: qrDataUrl, secret: (/[?&]secret=([A-Z2-7]+)/.exec(en.otpauthUri) || [])[1] || '', uri: en.otpauthUri });
  });

  // ── 2FA: verify TOTP code ───────────────────────────────────
  router.post('/2fa/verify-totp', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const { code } = req.body || {};
    if (!code) return res.error(400, 'Missing code');
    const _h = await holderOr503(req, res); if (!_h) return; const th = _h.th;
    if (!th || !th.pending || th.pending.method !== 'totp') {
      return res.error(400, 'No pending TOTP setup');
    }
    const K = keys(); if (!K) return res.error(503, '2FA is unavailable right now');
    let good, rc;
    try { good = await K.tfaVerify(th.pending.secret, code, th.account); if (good) rc = await K.tfaRecoveryCodes(); } catch (e) { return res.error(e.status || 503, e.message); }
    if (!good) return res.error(400, 'Invalid code');
    // activate 2FA + mint one-time recovery codes. Shown to the user ONCE
    // (returned cleartext here); only sha256 hashes are stored, so a leaked
    // user file can't be used to log in. Each code works once (consumed at
    // login). Lose your authenticator → use one of these to get back in.
    // (minted on the vault: the codes come back once, only their sealed hashes are stored)
    await th.save({ tfa: { method: 'totp', secret: th.pending.secret, recovery: rc.sealedList }, tfaPending: null });
    res.json({ ok: true, method: 'totp', recoveryCodes: rc.codes });
  });

  // ── 2FA: email setup — a code to the account's address (Damon 2026-10-18: email 2FA works — same record as
  // sign-in, the code single use, 10 minutes, 5 tries, stored hashed) ──
  const hash6 = (c) => crypto.createHash('sha256').update(String(c)).digest('hex');
  router.post('/2fa/setup-email', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const _h = await holderOr503(req, res); if (!_h) return; const th = _h.th;
    if (!th) return res.error(404, 'User not found');
    if (th.tfa) return res.error(400, '2FA is already on');
    if (!th.email) return res.error(400, 'Your account has no email address to send a code to');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await th.save({ tfaPending: { method: 'email', hash: hash6(code), expires: Date.now() + 600000, tries: 0 } });
    const a = okAuth(), sent = a && a.tfaMailCode ? await a.tfaMailCode(req.instanceSlug, th.email, code, 'Your 2FA set-up code') : false;
    res.json({ ok: true, sent: !!sent });
  });

  // ── 2FA: verify email code ──────────────────────────────────
  router.post('/2fa/verify-email', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const { code } = req.body || {};
    if (!code) return res.error(400, 'Missing code');
    const _h = await holderOr503(req, res); if (!_h) return; const th = _h.th;
    const pd = th && th.pending;
    if (!pd || pd.method !== 'email') return res.error(400, 'No pending email 2FA setup');
    if (pd.expires < Date.now() || (pd.tries || 0) >= 5) { await th.save({ tfaPending: null }); return res.error(400, 'Code expired — send a new one'); }
    if (pd.hash !== hash6(String(code).trim())) { await th.save({ tfaPending: Object.assign({}, pd, { tries: (pd.tries || 0) + 1 }) }); return res.error(400, 'Invalid code'); }
    await th.save({ tfa: { method: 'email' }, tfaPending: null });   // the inbox is the way back in: no recovery codes
    res.json({ ok: true, method: 'email' });
  });

  // ── 2FA: a code to turn email 2FA off (the same sign-in code, emailed) ──
  router.post('/2fa/send-code', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const _h = await holderOr503(req, res); if (!_h) return; const th = _h.th, a = okAuth();
    if (!th || !th.tfa || th.tfa.method !== 'email' || !th.client || !a) return res.error(400, 'No emailed code for this account');
    const sent = await a.tfaSendEmailCode(storage, th.client, req.instanceSlug);
    res.json({ ok: true, sent: !!sent });
  });

  // ── 2FA: disable ────────────────────────────────────────────
  // turning 2FA off takes a valid code from the authenticator (or a recovery code) — Damon 2026-10-18
  const tfaOff = async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const _h = await holderOr503(req, res); if (!_h) return; const th = _h.th;
    if (!th) return res.error(404, 'User not found');
    const code = (req.body || {}).code, a = okAuth();
    let good;
    try { good = !th.tfa ? true : (th.client && a) ? (await a.tfaCheck(storage, th.client, code)) === 'ok' : await tfaCodeOk(th, th.tfa, code); }
    catch (e) { return res.error(e.status || 503, e.message); }
    if (!good) return res.error(400, 'Enter a valid 2FA code to turn it off');
    await th.save({ tfa: null, tfaPending: null });
    const user = readUser(req.user.studio, req);
    if (user && (user.tfa || user.tfaPending)) { delete user.tfa; delete user.tfaPending; writeUser(req.user.studio, user, req); }   // the old copy too, or it would come back
    res.json({ ok: true });
  };
  router.post('/2fa/disable', tfaOff);   // a POST carries the code (a DELETE's body never reaches here)
  router.delete('/2fa', tfaOff);

  // ── Email addresses (reads from domain module's storage types) ──
  router.get('/email-addresses', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const studio = req.user.studio;
    // get domains with email configured
    const allDomains = await storage.list('domain_record');
    const domains = allDomains.filter(d => d.userId === studio && d.emailConfigured);
    // get email addresses
    const allEmails = await storage.list('email_address');
    const emails = allEmails.filter(a => a.owner === studio);
    res.json({ domains, emails });
  });

  // ── Server info ──────────────────────────────────────────────
  router.get('/server-info', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const load1 = os.loadavg()[0];
    const cpus = os.cpus().length;
    const loadPct = Math.round((load1 / cpus) * 100);
    let status = 'not busy';
    if (loadPct > 60) status = 'busy';
    else if (loadPct > 25) status = 'bit busy';
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ifaces = os.networkInterfaces();
    let ip = null;
    for (const name in ifaces) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; break; }
      }
      if (ip) break;
    }
    // storage size
    let storageBytes = 0;
    function dirSize(dir) {
      try {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f);
          const st = fs.statSync(fp);
          if (st.isDirectory()) dirSize(fp);
          else storageBytes += st.size;
        }
      } catch {}
    }
    dirSize(storageDir);
    res.json({
      ip: ip || 'unknown',
      status,
      loadPct,
      cpus,
      uptime: Math.floor(os.uptime()),
      memTotal: totalMem,
      memUsed: usedMem,
      storageBytes,
    });
  });

  // ── Export: zip download of all user data ────────────────────
  router.get('/export', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const studio = req.user.studio;
    const rawRes = res._res || res;

    // collect user profile
    const user = readUser(studio);
    const profile = user ? { studio: user.studio, email: user.email, displayName: user.displayName, plan: user.plan, createdAt: user.createdAt } : {};

    // collect settings
    const settingsRec = await getSettingsRecord(studio);
    const settings = settingsRec ? settingsRec.data : {};
    // strip raw AI keys from export
    if (settings.aiKeys) {
      const masked = {};
      for (const [k, v] of Object.entries(settings.aiKeys)) masked[k] = maskKey(v);
      settings.aiKeys = masked;
    }

    // collect all records by this user across all types
    const dataDir = path.join(storageDir, 'data');
    const userRecords = {};
    let typeDirs;
    try { typeDirs = fs.readdirSync(dataDir).filter(d => !d.startsWith('_')); } catch { typeDirs = []; }
    for (const type of typeDirs) {
      const typeDir = path.join(dataDir, type);
      let files;
      try { files = fs.readdirSync(typeDir).filter(f => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(typeDir, f), 'utf8'));
          if (rec.created_by_user === studio) {
            if (!userRecords[type]) userRecords[type] = [];
            userRecords[type].push(rec);
          }
        } catch {}
      }
    }

    // build zip
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `okdun-backup-${studio}-${dateStr}.zip`;

    rawRes.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(rawRes);
    archive.append(JSON.stringify(profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(settings, null, 2), { name: 'settings.json' });
    for (const [type, records] of Object.entries(userRecords)) {
      for (const rec of records) {
        archive.append(JSON.stringify(rec, null, 2), { name: `data/${type}/${rec.id}.json` });
      }
    }
    archive.finalize();
  });

  // ── Team management routes ──────────────────────────────────
  function requireAdmin(req, res) {
    if (!req.user) { res.error(401, 'Not logged in'); return false; }
    const role = req.user.role || 'owner';
    if (role !== 'owner' && role !== 'admin') { res.error(403, 'Admin access required'); return false; }
    return true;
  }

  // GET /team — list team members
  router.get('/team', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const all = await storage.list('team_member', { studio: req.user.studio });
    const members = [];
    for (const m of all) {
      const full = await storage.get('team_member', m.id);
      if (full) members.push({ id: full.id, email: full.data.email, displayName: full.data.displayName, avatar: full.data.avatar, role: full.data.role || 'member', modVisibility: full.data.modVisibility || {}, lastLoginAt: full.data.lastLoginAt, createdAt: full.data.createdAt });
    }
    res.json(members);
  });

  // POST /team/invite — create invitation
  router.post('/team/invite', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { email, displayName } = req.body || {};
    if (!email) return res.error(400, 'Missing email');
    // Check if already a member
    const existing = await storage.list('team_member', { email });
    if (existing.length) return res.error(409, 'User already on team');
    // Check for existing pending invite
    const pendingInvites = await storage.list('team_invite', { email, status: 'pending' });
    if (pendingInvites.length) return res.error(409, 'Invite already pending for this email');
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const invite = await storage.create('team_invite', {
      studio: req.user.studio,
      email,
      displayName: displayName || email.split('@')[0],
      token,
      invitedBy: req.user.userId || null,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
    }, { module: 'settings', user: req.user.studio });
    // Send invite email if SES available
    if ((process.env.AWS_ACCESS_KEY_ID || process.env.KEYOP_URL)) {
      const publicUrl = req.headers.origin || req.headers.referer || '';
      const link = `${publicUrl}?invite=${token}`;
      try {
        // config.signup.siteMail (gamoid, 2026-10-19): okdunio's mailer (vault/relay aware, like the sign-up
        // code), from the site's own sender (config.signup.emailFrom). Every other site keeps the shell's mailer, no from.
        const su = siteCfg(req).signup || {}, viaSite = su.siteMail === true;
        let ses = null; if (viaSite) { try { ses = require.main.require('./lib/ses'); } catch (e) {} }
        if (!ses) ses = require(path.join(__dirname, '../../admin/platform-shell/lib/ses'));
        await ses.sendEmail({
          from: (viaSite && su.emailFrom) || undefined,
          to: email,
          subject: `You've been invited to join ${req.user.studio} on ${mailBrand(req) || 'OkDun'}`,
          html: `<p>Hi ${displayName || email},</p><p>You've been invited to join <strong>${req.user.studio}</strong>.</p><p><a href="${link}">Accept invitation</a></p><p>This link expires in 7 days.</p>`,
        });
      } catch {}
    }
    res.json({ ok: true, id: invite.id });
  });

  // PUT /team/:userId/role — change role
  router.put('/team/:userId/role', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    if (req.user.role !== 'owner') return res.error(403, 'Only owner can change roles');
    const { role } = req.body || {};
    if (!role || !['admin', 'member'].includes(role)) return res.error(400, 'Invalid role');
    const tm = await storage.get('team_member', req.params.userId);
    if (!tm || tm.data.studio !== req.user.studio) return res.error(404, 'Member not found');
    if (tm.data.role === 'owner') return res.error(403, 'Cannot change owner role');
    await storage.update('team_member', tm.id, { role });
    res.json({ ok: true });
  });

  // PUT /team/:userId/visibility — update mod visibility
  router.put('/team/:userId/visibility', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { modVisibility } = req.body || {};
    if (!modVisibility || typeof modVisibility !== 'object') return res.error(400, 'Invalid body');
    const tm = await storage.get('team_member', req.params.userId);
    if (!tm || tm.data.studio !== req.user.studio) return res.error(404, 'Member not found');
    if (tm.data.role === 'owner') return res.error(403, 'Cannot restrict owner');
    await storage.update('team_member', tm.id, { modVisibility });
    res.json({ ok: true });
  });

  // DELETE /team/:userId — remove member
  router.delete('/team/:userId', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tm = await storage.get('team_member', req.params.userId);
    if (!tm || tm.data.studio !== req.user.studio) return res.error(404, 'Member not found');
    if (tm.data.role === 'owner') return res.error(403, 'Cannot remove owner');
    await storage.delete('team_member', tm.id);
    res.json({ ok: true });
  });

  // GET /team/invites — list pending invites
  router.get('/team/invites', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const all = await storage.list('team_invite', { studio: req.user.studio });
    const invites = [];
    for (const inv of all) {
      const full = await storage.get('team_invite', inv.id);
      if (full && full.data.status === 'pending') {
        invites.push({ id: full.id, email: full.data.email, displayName: full.data.displayName, createdAt: full.data.createdAt, expiresAt: full.data.expiresAt });
      }
    }
    res.json(invites);
  });

  // DELETE /team/invites/:id — cancel invite
  router.delete('/team/invites/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const inv = await storage.get('team_invite', req.params.id);
    if (!inv || inv.data.studio !== req.user.studio) return res.error(404, 'Invite not found');
    await storage.delete('team_invite', inv.id);
    res.json({ ok: true });
  });

  // assignedTo must hold tokens the member's SESSION presents — mod-chat's
  // viewerMatches checks session identity (userId/slug/username/studio),
  // never team_member record ids. Two session universes exist:
  //   - platform-shell logins present userId = the team_member record id
  //   - prod okdunio (gecko) logins present slug = the client/account id,
  //     which mod-chat's invite-accept stamps on team_member as `user_id`
  // So a member's assignment tokens are BOTH ids. Writing only the record
  // id made assignments invisible on prod (no session ever carries it).
  function memberTokens(tmId, tmData) {
    const t = [tmId];
    const acct = tmData && tmData.user_id;
    if (acct && acct !== tmId) t.push(acct);
    return t;
  }

  // GET /team/emails — list all domain email addresses (for assignment UI)
  router.get('/team/emails', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // Back-compat heal: old assignments stored ONLY the team_member record
    // id. Where the member carries an account id (user_id), mirror it into
    // assignedTo so existing assignments become visible to prod sessions.
    // Idempotent; runs on the admin's Team-panel load.
    const members = await storage.list('team_member', { studio: req.user.studio });
    const acctByTmId = {};
    for (const m of members) {
      if (m.user_id && m.user_id !== m.id) acctByTmId[m.id] = m.user_id;
    }
    const all = await storage.list('email_address');
    const emails = [];
    for (const a of all) {
      let assigned = a.assignedTo || (a.data && a.data.assignedTo) || [];
      const missing = assigned
        .filter(t => acctByTmId[t] && !assigned.includes(acctByTmId[t]))
        .map(t => acctByTmId[t]);
      if (missing.length) {
        assigned = assigned.concat(missing);
        try { await storage.update('email_address', a.id, { assignedTo: assigned }); } catch {}
      }
      emails.push({
        id: a.id,
        address: a.address || (a.data && a.data.address) || '',
        domain: a.domain || (a.data && a.data.domain) || '',
        assignedTo: assigned,
      });
    }
    res.json(emails);
  });

  // PUT /team/:userId/emails — assign email addresses to a team member
  router.put('/team/:userId/emails', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { emailIds } = req.body || {};
    if (!Array.isArray(emailIds)) return res.error(400, 'emailIds array required');
    const tm = await storage.get('team_member', req.params.userId);
    if (!tm || tm.data.studio !== req.user.studio) return res.error(404, 'Member not found');
    const tokens = memberTokens(tm.id, tm.data);

    const all = await storage.list('email_address');
    for (const addr of all) {
      const full = await storage.get('email_address', addr.id);
      if (!full) continue;
      const assigned = full.data.assignedTo || [];
      const next = emailIds.includes(addr.id)
        ? assigned.concat(tokens.filter(t => !assigned.includes(t)))
        : assigned.filter(t => !tokens.includes(t));
      if (next.length !== assigned.length) {
        await storage.update('email_address', addr.id, { assignedTo: next });
      }
    }
    res.json({ ok: true });
  });

  // ── Deploy gamoid (owner-only, master-only) ─────────────────────
  // Gate for box-admin surfaces (Secure-box panel, and the /deploy/status
  // probe it feature-detects on). Disabled on worker boxes (WORKER_MODE=1).
  function deployGuard(req) {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return 'worker-mode';
    // Owner = explicit allowlist (DEPLOY_ADMIN_EMAILS in master ~/.env).
    // The old flat-file role check was wrong twice: user JSONs are
    // stale/absent on DB-backed tenants (403 for everyone, including the
    // real owner), and every flat-file studio signup carries role:'owner'
    // (any studio could fire a deploy). Deliberately NOT reusing
    // RELEASE_ADMIN_EMAILS — that list includes the dev Playwright
    // account, which must never reach rsync deploys or SSH box setup.
    var list = String(process.env.DEPLOY_ADMIN_EMAILS || '')
      .split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
    if (req.user && req.user.email && list.indexOf(String(req.user.email).toLowerCase()) >= 0) return null;
    return 'owner-only';
  }
  // The old SSH status scan and panel-triggered rsync push are retired —
  // fleet deploys are pull-based via /release/* now, and boxes' okdunio is
  // a symlink into releases/current (an rsync through it would corrupt the
  // pinned release). deploy-gamoid.sh stays on disk as CLI break-glass.
  // This endpoint remains ONLY as the guard probe the Secure-box panel
  // feature-detects on (200 = allowlisted owner, reveal the tab).
  router.get('/deploy/status', async (req, res) => {
    const why = deployGuard(req);
    if (why === 'worker-mode') return res.error(404, 'Not available on workers');
    if (why) return res.error(403, 'Owner only');
    res.json({ ok: true });
  });
  // GET /admin-surfaces — which admin-only Settings panels this account may open, always a 200 (Damon 2026-10-19: no console
  // errors for everyone else). The panels ask their own status endpoint only when this says yes; the same guards decide.
  router.get('/admin-surfaces', async (req, res) => {
    const worker = process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true';
    let publish = false;
    if (!worker && req.user) {
      try {
        const me = (req.user.slug ? await storage.get('client', req.user.slug) : null) || (await storage.get('client', req.user.studio));
        publish = !!(me && me.data && me.data.canPublishProd === true);
      } catch (e) {}
    }
    // social: the auto-post switch (mod-social share.js) — an admin, or an official account (config.social.official)
    const u = req.user || {}, official = ((((req.instance || {}).config || {}).social || {}).official || []).map(e => String(e).toLowerCase());
    const social = !!(req.user && (u.superOwner || ['admin', 'owner', 'super_owner'].includes(u.role) || official.includes(String(u.email || '').toLowerCase())));
    res.json({ deploy: deployGuard(req) === null, release: !worker && releaseAdmin(req), publish, social });
  });

  const REL_DIR = '/home/damon/platform/.releases';
  const BOXES_FILE = '/home/damon/platform/.runtime/release-boxes.json';

  // Box identity comes from the per-box token (RELEASE_TOKENS='w1:<hex>,…' in
  // ~/.env) — a box can only ever claim to be itself.
  function releaseTokens() {
    const out = {};
    for (const pair of String(process.env.RELEASE_TOKENS || '').split(',')) {
      const i = pair.indexOf(':');
      if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    return out;
  }
  function boxFromToken(req) {
    const tok = String((req.headers && req.headers['x-release-token']) || (req.query && req.query.token) || '');
    if (!tok) return null;
    for (const [name, t] of Object.entries(releaseTokens())) {
      try {
        // an entry may hold the token's sha256 instead of the token (dev keeps only hashes — PROD-PRIVACY-PLAN)
        const hashed = /^sha256=[0-9a-f]{64}$/.test(t);
        const a = Buffer.from(hashed ? 'sha256=' + crypto.createHash('sha256').update(tok).digest('hex') : tok), b = Buffer.from(t);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return name;
      } catch {}
    }
    return null;
  }
  // Release admins: TWO doors, one bar — the platform ADMIN role (admin is a
  // DATA flag, records.data.role='admin', which auth.js builds the session
  // from) or the RELEASE_ADMIN_EMAILS allowlist. The role door is what makes
  // the panel open on a tenant whose admin logs in by username (hashoid's
  // damondo had no door at all until 2026-09-26).
  function releaseAdmin(req) {
    if (!req.user) return false;
    if (req.user.role === 'admin') return true;
    if (!req.user.email) return false;
    const list = String(process.env.RELEASE_ADMIN_EMAILS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return list.includes(String(req.user.email).toLowerCase());
  }
  // Box token OR allowlisted admin session; workers 404 (a box never deploys).
  function releaseGuard(req) {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return 'worker-mode';
    if (boxFromToken(req)) return null;
    if (releaseAdmin(req)) return null;
    return 'admin-only';
  }
  function readBoxes() {
    try { return JSON.parse(fs.readFileSync(BOXES_FILE, 'utf8')); } catch { return { boxes: {} }; }
  }

  // ── THE DEPLOYER — one for every site (Damon's ruling 2026-09-27) ──────
  // The release fleet's full-tarball transport is GONE (not disabled): no
  // release-N.tar.gz, no artifacts bookkeeping, no canary/urgent channels. A
  // version is a NUMBER over a commit set, a box receives a DELTA over git
  // (scripts/deploy-lib.js — the same transfer dev has used since
  // admin/DEV_DEPLOY_DELTA_PLAN.md), and PROMOTE is the only thing that moves
  // a prod box. Rollback is promoting an older number: deltas are
  // direction-free, so a box asks for the diff from ITS version and applies it.
  // required on first use: release copies on the prods have no scripts/, and a top-level require killed every settings route there
  const deployLib = new Proxy({}, { get: (_, k) => require('/home/damon/platform/scripts/deploy-lib.js')[k] });
  const DELTA_DIR = path.join(REL_DIR, 'deltas');
  const CUT_LOG = '/home/damon/platform/.runtime/deploy-cut.log';

  // GET /release/manifest — what a box should be running, and what each
  // version's scope is. Numbers only: a box never needs another site's shas.
  router.get('/release/manifest', async (req, res) => {
    const why = releaseGuard(req);
    if (why === 'worker-mode') return res.error(404, 'Not available on workers');
    if (why) return res.error(403, 'Release admin or box token required');
    const m = deployLib.readManifest();
    const versions = {};
    for (const [v, rec] of Object.entries(m.versions || {})) {
      versions[v] = {
        createdAt: rec.createdAt,
        sites: Object.fromEntries(Object.entries(rec.sites || {}).map(([slug, s]) => [slug, { mods: (s.mods || []).length, depsHash: s.depsHash }])),
      };
    }
    res.json({ version: m.version || 0, stable: m.stable || 0, versions });
  });

  // GET /release/delta?from=<v>&to=<v> — the changed bytes between two
  // versions, for the box's site, built from git on demand and cached.
  router.get('/release/delta', async (req, res) => {
    const why = releaseGuard(req);
    if (why === 'worker-mode') return res.error(404, 'Not available on workers');
    if (why) return res.error(403, 'Release admin or box token required');
    const box = boxFromToken(req);
    const to = parseInt(req.query.to, 10);
    const from = parseInt(req.query.from, 10) || 0;
    if (!to || to < 1) return res.error(400, 'Bad to');
    // A box's site comes from the registry (its token names it); an admin can
    // ask for any site explicitly.
    const registry = readBoxes().boxes || {};
    const site = (box && registry[box] && registry[box].site) || String(req.query.site || '');
    if (!site) return res.error(400, 'No site for this box — check in once, or pass ?site=');
    const file = path.join(DELTA_DIR, 'delta-' + from + '-' + to + '-' + site + '.tar.zst');
    let ready = false;
    try { ready = fs.statSync(file).size > 0; } catch {}
    if (!ready) {
      // A scoped-full first hop is ~260 MB to archive and compress — longer
      // than a proxy's read timeout, which is how prod's first fetch died on
      // a 504 (2026-09-27). So the build runs DETACHED and the box is told to
      // come back: a long build is a state, not a failed request, and every
      // later box asking for the same pair finds the finished file.
      const lock = file + '.lock';
      let building = false;
      try { building = Date.now() - fs.statSync(lock).mtimeMs < 10 * 60 * 1000; } catch {}
      if (!building) {
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, ['/home/damon/platform/scripts/deploy-delta-build.js', site, String(from || 0), String(to), file], { detached: true, stdio: 'ignore' });
        child.unref();
      }
      return res.status(202).json({ building: true, from, to, site, retryInMs: building ? 5000 : 15000 });
    }
    const st = fs.statSync(file);
    const buf = fs.readFileSync(file);
    const rawRes = res._res || res;
    rawRes.writeHead(200, {
      'Content-Type': 'application/zstd',
      'Content-Length': st.size,
      'X-Delta-Sha256': crypto.createHash('sha256').update(buf).digest('hex'),
      'X-Delta-From': String(from),
      'X-Delta-To': String(to),
      'X-Delta-Site': site,
    });
    fs.createReadStream(file).pipe(rawRes);
  });

  // POST /release/checkin — box heartbeat (box token ONLY; the token stamps
  // identity, so a box can never impersonate another). `site` is how the
  // registry learns which scope this box receives.
  router.post('/release/checkin', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    const box = boxFromToken(req);
    if (!box) return res.error(403, 'Box token required');
    const b = req.body || {};
    const all = readBoxes();
    all.boxes = all.boxes || {};
    const prev = all.boxes[box] || {};
    all.boxes[box] = {
      version: parseInt(b.version, 10) || 0,
      site: String(b.site || prev.site || '').slice(0, 40),
      health: String(b.health || 'unknown').slice(0, 32),
      uptime: parseInt(b.uptime, 10) || 0,
      rolledBack: !!b.rolledBack,
      phase: String(b.phase || '').slice(0, 24),   // idle / fetching / restarting / rolled-back … — ship's notice waits for idle
      lastSeen: new Date().toISOString(),
    };
    all.updated = all.boxes[box].lastSeen;
    writeBoxes(all);
    res.json({ ok: true, box, stable: deployLib.readManifest().stable || 0 });
  });

  // POST /keyop — the brokered keyed call (admin/PROD-KEYS-REMOVAL.md, Damon GO
  // 2026-10-13). A prod holds no third-party keys; it asks here with its box
  // token, this walled process runs the fixed op (lib/keyop-ops.js) with the
  // pocket's keys and answers with the result only. A keyop CLIENT never serves
  // (no relaying a relay), and workers 404 like every release route.
  router.post('/keyop', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (process.env.KEYOP_URL) return res.error(404, 'Not a keyop server');
    const box = boxFromToken(req);
    if (!box) return res.error(403, 'Box token required');
    const op = String((req.body || {}).op || '');
    try {
      const result = await require('./lib/keyop-ops.js').run(box, op, (req.body || {}).args);
      console.log('[keyop] ' + box + ' ' + op + ' ok');
      res.json({ ok: true, result: result === undefined ? null : result });
    } catch (e) {
      console.log('[keyop] ' + box + ' ' + op + ' FAIL ' + String(e.message || e).slice(0, 160));
      res.json({ error: { message: String(e.message || e).slice(0, 300), type: e.type, code: e.code, statusCode: e.statusCode || e.status } });
    }
  });

  // POST /release/stats — a box's live metrics payload for the server
  // dashboard's box tabs (Damon 2026-09-06). Restored 2026-10-14: the 09-27
  // console rewrite dropped it, prod's collector kept posting into a 404 and
  // the Prod tab sat at 'last seen 17 days ago'. The box pushes with its own
  // token (master never reaches in); w1's file keeps its old name, prod.json.
  router.post('/release/stats', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    const box = boxFromToken(req);
    if (!box) return res.error(403, 'Box token required');
    const b = req.body || {};
    if (!b || typeof b !== 'object' || !b.cpu) return res.error(400, 'Not a metrics payload');
    b.box = box;
    b.receivedAt = Date.now();
    const file = '/home/damon/b1-stats/' + (box === 'w1' ? 'prod' : box.replace(/[^\w-]/g, '')) + '.json';
    try {
      const tmp = file + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(b));
      fs.renameSync(tmp, file);
      res.json({ ok: true, box });
    } catch (e) {
      res.error(500, 'stats write failed: ' + (e.message || e));
    }
  });

  // POST /release/cut — a number over the current commit set. No bundling, no
  // 11-minute build: it records what GitHub already holds. (Deltas are built
  // when a box asks for one.)
  router.post('/release/cut', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    try {
      cutLog('── cut started ──');
      const m = deployLib.recordVersion();
      const sites = Object.keys((m.versions[m.version] || {}).sites || {});
      cutLog('── v' + m.version + ' recorded over ' + sites.join(', ') + ' (stable stays v' + m.stable + ') ──');
      res.json({ ok: true, version: m.version, stable: m.stable, sites });
    } catch (e) {
      cutLog('── CUT FAILED: ' + e.message + ' ──');
      res.error(500, 'cut failed: ' + e.message);
    }
  });

  // POST /release/deploy — ONE CLICK (Damon 2026-09-27): number the current
  // commits and point stable at that number, in one motion. Deploy is the only
  // forward action on the panel; promoting an older number is the rollback.
  router.post('/release/deploy', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    try {
      cutLog('── deploy started ──');
      const m = deployLib.recordVersion();
      const v = m.version;
      const sites = Object.keys((m.versions[v] || {}).sites || []);
      m.stable = v;
      deployLib.writeManifest(m);
      cutLog('── deploy v' + v + ' over ' + sites.join(', ') + ' — stable → v' + v + ' (every box applies it now) ──');
      res.json({ ok: true, version: v, stable: v, sites, direction: 'forward' });
    } catch (e) {
      cutLog('── DEPLOY FAILED: ' + e.message + ' ──');
      res.error(500, 'deploy failed: ' + e.message);
    }
  });

  // POST /release/promote — point stable at a number. THE ONLY THING THAT
  // MOVES A PROD BOX (Damon 2026-09-27: promote means NOW, always — no quiet
  // window, no canary channel, no urgent flag). Promoting an older number is
  // the rollback, and nothing here treats it differently.
  router.post('/release/promote', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    const v = parseInt((req.body || {}).version, 10);
    if (!v || v < 1) return res.error(400, 'Bad version');
    const m = deployLib.readManifest();
    if (!(m.versions || {})[v]) return res.error(404, 'No such version v' + v);
    m.stable = v;
    deployLib.writeManifest(m);
    res.json({ ok: true, stable: v, direction: v < (m.version || 0) ? 'rollback' : 'forward' });
  });

  // GET /release/status — the panel's feed: versions, the boxes, and the
  // deploy log (cut + delta lines).
  router.get('/release/status', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    const m = deployLib.readManifest();
    const versions = Object.keys(m.versions || {}).map(Number).sort((a, b) => b - a).map(v => ({
      version: v,
      createdAt: m.versions[v].createdAt,
      sites: Object.keys(m.versions[v].sites || {}),
    }));
    res.json({
      version: m.version || 0,
      stable: m.stable || 0,
      createdAt: m.createdAt || null,
      versions,
      boxes: readBoxes().boxes || {},
      buildLog: readCutLog(),
    });
  });

  function cutLog(line) {
    try {
      fs.mkdirSync(path.dirname(CUT_LOG), { recursive: true });
      fs.appendFileSync(CUT_LOG, '[' + new Date().toISOString() + '] ' + line + '\n');
    } catch {}
  }
  function readCutLog() {
    try { return fs.readFileSync(CUT_LOG, 'utf8').split('\n').filter(Boolean).slice(-20).join('\n'); } catch { return ''; }
  }
  function writeBoxes(all) {
    try {
      fs.mkdirSync(path.dirname(BOXES_FILE), { recursive: true });
      fs.writeFileSync(BOXES_FILE + '.tmp', JSON.stringify(all, null, 2));
      fs.renameSync(BOXES_FILE + '.tmp', BOXES_FILE);
    } catch {}
  }


  // Secure-a-box: owner enters a box's IP + root password; we SSH in (password
  // auth), install + configure SSH 2FA seeded with the OWNER's EXISTING
  // authenticator secret (so the same 6-digit code works on every box — no new
  // QR), then reload sshd. The password is used once for the connection and
  // NEVER stored. Lockout-safe: key logins are untouched, /root/2fa-revert.sh is
  // written, and the user keeps their own session open to test.
  router.post('/secure-box', async (req, res) => {
    const why = deployGuard(req);
    if (why === 'worker-mode') return res.error(404, 'Not available on workers');
    if (why) return res.error(403, 'Owner only');
    const b = req.body || {};
    const ip = String(b.ip || '').trim();
    const password = String(b.password || '');
    const loginUser = (String(b.user || 'root').trim()) || 'root';
    if (!ip || !password) return res.error(400, 'Box IP/host and root password are required');
    if (!/^[a-zA-Z0-9.:_-]+$/.test(ip)) return res.error(400, 'Invalid IP/host');

    // It reused the owner's TOTP secret in plain text — which no longer exists anywhere but the vault (Damon GO
    // 2026-10-22: 2FA is checked on the vault), so it would install a sealed blob and lock the box. Refused.
    return res.error(410, 'Secure-a-box is off: your 2FA secret now stays in the vault and can\u2019t be copied to a box.');
  });
};
