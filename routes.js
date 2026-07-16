const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { TOTP, Secret } = require('otpauth');
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
    // include 2fa status from user file
    const user = readUser(req.user.studio, req);
    if (user && user.tfa) {
      prefs.tfa = { method: user.tfa.method, enabled: true };
    } else {
      prefs.tfa = { enabled: false };
    }
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
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({
      issuer,
      label: req.user.studio,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    const uri = totp.toString();
    let qrDataUrl;
    try {
      qrDataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 2 });
    } catch {
      return res.error(500, 'QR generation failed');
    }
    // store pending secret on user (not active until verified)
    const user = readUser(req.user.studio, req);
    if (!user) return res.error(404, 'User not found');
    user.tfaPending = { method: 'totp', secret: secret.base32 };
    writeUser(req.user.studio, user, req);
    res.json({
      qr: qrDataUrl,
      secret: secret.base32,
      uri,
    });
  });

  // ── 2FA: verify TOTP code ───────────────────────────────────
  router.post('/2fa/verify-totp', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const { code } = req.body || {};
    if (!code) return res.error(400, 'Missing code');
    const user = readUser(req.user.studio, req);
    if (!user || !user.tfaPending || user.tfaPending.method !== 'totp') {
      return res.error(400, 'No pending TOTP setup');
    }
    const totp = new TOTP({
      issuer: 'OkDun',
      label: req.user.studio,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(user.tfaPending.secret),
    });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) return res.error(400, 'Invalid code');
    // activate 2FA + mint one-time recovery codes. Shown to the user ONCE
    // (returned cleartext here); only sha256 hashes are stored, so a leaked
    // user file can't be used to log in. Each code works once (consumed at
    // login). Lose your authenticator → use one of these to get back in.
    const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
    const recovery = recoveryCodes.map(c => crypto.createHash('sha256').update(c).digest('hex'));
    user.tfa = { method: 'totp', secret: user.tfaPending.secret, recovery };
    delete user.tfaPending;
    writeUser(req.user.studio, user, req);
    res.json({ ok: true, method: 'totp', recoveryCodes });
  });

  // ── 2FA: email setup — send test code ───────────────────────
  router.post('/2fa/setup-email', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const user = readUser(req.user.studio, req);
    if (!user) return res.error(404, 'User not found');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    user.tfaPending = { method: 'email', code, expires: Date.now() + 600000 }; // 10min
    writeUser(req.user.studio, user, req);
    // send via SES if available
    if (process.env.AWS_ACCESS_KEY_ID) {
      try {
        const ses = require(path.join(__dirname, '../../admin/platform-shell/lib/ses'));
        await ses.sendEmail({
          to: user.email,
          subject: 'OkDun — Your 2FA verification code',
          html: `<p>Your verification code is: <strong>${code}</strong></p><p>It expires in 10 minutes.</p>`,
        });
      } catch (e) {
        console.error('[settings] SES send failed:', e.message);
      }
    }
    res.json({ ok: true, sent: !!process.env.AWS_ACCESS_KEY_ID });
  });

  // ── 2FA: verify email code ──────────────────────────────────
  router.post('/2fa/verify-email', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const { code } = req.body || {};
    if (!code) return res.error(400, 'Missing code');
    const user = readUser(req.user.studio, req);
    if (!user || !user.tfaPending || user.tfaPending.method !== 'email') {
      return res.error(400, 'No pending email 2FA setup');
    }
    if (user.tfaPending.expires < Date.now()) {
      delete user.tfaPending;
      writeUser(req.user.studio, user, req);
      return res.error(400, 'Code expired');
    }
    if (user.tfaPending.code !== code) return res.error(400, 'Invalid code');
    user.tfa = { method: 'email' };
    delete user.tfaPending;
    writeUser(req.user.studio, user, req);
    res.json({ ok: true, method: 'email' });
  });

  // ── 2FA: disable ────────────────────────────────────────────
  router.delete('/2fa', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const user = readUser(req.user.studio, req);
    if (!user) return res.error(404, 'User not found');
    delete user.tfa;
    delete user.tfaPending;
    writeUser(req.user.studio, user, req);
    res.json({ ok: true });
  });

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
    if (process.env.AWS_ACCESS_KEY_ID) {
      const publicUrl = req.headers.origin || req.headers.referer || '';
      const link = `${publicUrl}?invite=${token}`;
      try {
        const ses = require(path.join(__dirname, '../../admin/platform-shell/lib/ses'));
        await ses.sendEmail({
          to: email,
          subject: `You've been invited to join ${req.user.studio} on OkDun`,
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

  // ── Release distribution + check-ins (pull-based fleet deploy) ──
  // Master builds pinned release artifacts (scripts/release-build.sh);
  // boxes poll the manifest here with a per-box token, download, apply
  // in their quiet window, and POST heartbeat check-ins. Owner panel
  // uses the same endpoints via session auth. WORKER_MODE boxes 404 —
  // a box never serves releases.
  const REL_DIR = '/home/damon/platform/.releases';
  const BOXES_FILE = '/home/damon/platform/.runtime/release-boxes.json';

  function releaseTokens() {
    // RELEASE_TOKENS='w1:<token>,fakebox:<token>' in master ~/.env
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
        const a = Buffer.from(tok), b = Buffer.from(t);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return name;
      } catch {}
    }
    return null;
  }
  // Release admins: explicit allowlist (RELEASE_ADMIN_EMAILS in master
  // ~/.env). The old deployGuard's flat-file role check breaks on
  // DB-backed tenants (user JSONs there are stale), and "any studio
  // owner" was never the right bar for cutting/promoting fleet releases.
  function releaseAdmin(req) {
    if (!req.user || !req.user.email) return false;
    const list = String(process.env.RELEASE_ADMIN_EMAILS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return list.includes(String(req.user.email).toLowerCase());
  }
  // Box token OR allowlisted admin session; workers 404 like the deploy panel.
  function releaseGuard(req) {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return 'worker-mode';
    if (boxFromToken(req)) return null;
    if (releaseAdmin(req)) return null;
    return 'admin-only';
  }
  function readManifest() {
    try { return JSON.parse(fs.readFileSync(path.join(REL_DIR, 'manifest.json'), 'utf8')); }
    catch { return null; }
  }
  function writeManifest(m) {
    const p = path.join(REL_DIR, 'manifest.json');
    fs.writeFileSync(p + '.tmp', JSON.stringify(m, null, 2));
    fs.renameSync(p + '.tmp', p);
  }
  function readBoxes() {
    try { return JSON.parse(fs.readFileSync(BOXES_FILE, 'utf8')); } catch { return { boxes: {} }; }
  }

  // GET /release/manifest — what should I be running?
  router.get('/release/manifest', async (req, res) => {
    const why = releaseGuard(req);
    if (why === 'worker-mode') return res.error(404, 'Not available on workers');
    if (why) return res.error(403, 'Release admin or box token required');
    res.json(readManifest() || { version: 0, channels: { canary: 0, stable: 0 } });
  });

  // GET /release/download/:version — stream the artifact
  router.get('/release/download/:version', async (req, res) => {
    const why = releaseGuard(req);
    if (why === 'worker-mode') return res.error(404, 'Not available on workers');
    if (why) return res.error(403, 'Release admin or box token required');
    const v = parseInt(req.params.version, 10);
    if (!v || v < 1) return res.error(400, 'Bad version');
    const file = path.join(REL_DIR, 'release-' + v + '.tar.gz');
    let st;
    try { st = fs.statSync(file); } catch { return res.error(404, 'No such release'); }
    const rawRes = res._res || res;
    rawRes.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Length': st.size,
      'Content-Disposition': 'attachment; filename="release-' + v + '.tar.gz"',
    });
    fs.createReadStream(file).pipe(rawRes);
  });

  // POST /release/checkin — box heartbeat (box token ONLY; stamps identity
  // from the token so a box can't impersonate another).
  router.post('/release/checkin', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    const box = boxFromToken(req);
    if (!box) return res.error(403, 'Box token required');
    const b = req.body || {};
    const all = readBoxes();
    all.boxes = all.boxes || {};
    all.boxes[box] = {
      version: parseInt(b.version, 10) || 0,
      legacySha: String(b.legacySha || '').slice(0, 16),
      channel: String(b.channel || 'stable').slice(0, 16),
      health: String(b.health || 'unknown').slice(0, 32),
      uptime: parseInt(b.uptime, 10) || 0,
      rolledBack: !!b.rolledBack,
      holding: !!b.holding,
      lastSeen: new Date().toISOString(),
    };
    all.updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(BOXES_FILE), { recursive: true });
    const tmp = BOXES_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, BOXES_FILE);
    res.json({ ok: true, box });
  });

  // GET /release/status — owner panel feed: manifest + check-ins + artifacts
  router.get('/release/status', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    const manifest = readManifest();
    const boxes = readBoxes().boxes || {};
    let artifacts = [];
    try {
      artifacts = fs.readdirSync(REL_DIR)
        .map(f => f.match(/^release-(\d+)\.tar\.gz$/))
        .filter(Boolean)
        .map(m => {
          const st = fs.statSync(path.join(REL_DIR, m[0]));
          return { version: parseInt(m[1], 10), size: st.size, created: st.mtime.toISOString() };
        })
        .sort((a, b) => b.version - a.version);
    } catch {}
    let buildLog = '';
    try {
      const lines = fs.readFileSync('/home/damon/platform/.runtime/release-build.log', 'utf8').split('\n').filter(Boolean);
      buildLog = lines.slice(-20).join('\n');
    } catch {}
    res.json({ manifest, boxes, artifacts, buildLog });
  });

  // POST /release/build — cut a new release (detached; watch via /release/status)
  router.post('/release/build', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    const { spawn } = require('child_process');
    const child = spawn('/home/damon/platform/scripts/release-build.sh', [], { detached: true, stdio: 'ignore' });
    child.unref();
    res.json({ ok: true, pid: child.pid });
  });

  // POST /release/promote — point the stable channel at a built version
  router.post('/release/promote', async (req, res) => {
    if (process.env.WORKER_MODE === '1' || process.env.WORKER_MODE === 'true') return res.error(404, 'Not available on workers');
    if (!releaseAdmin(req)) return res.error(403, 'Release admin only');
    const v = parseInt((req.body || {}).version, 10);
    if (!v || v < 1) return res.error(400, 'Bad version');
    const m = readManifest();
    if (!m) return res.error(404, 'No manifest — build a release first');
    if (!fs.existsSync(path.join(REL_DIR, 'release-' + v + '.tar.gz'))) return res.error(404, 'No artifact for v' + v);
    m.channels = m.channels || {};
    m.channels.stable = v;
    m.urgent = !!(req.body || {}).urgent;
    writeManifest(m);
    res.json({ ok: true, stable: v, urgent: m.urgent });
  });

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

    // Reuse the owner's existing TOTP secret so one code works everywhere.
    const u = readUser(req.user.studio || req.user.slug, req);
    const secret = u && u.tfa && u.tfa.secret;
    if (!secret) return res.error(400, 'Enable 2FA on your own account first (Settings → 2FA) so there is a code to reuse on the box.');

    let scriptText;
    try { scriptText = fs.readFileSync('/home/damon/platform/scripts/secure-server-2fa.sh', 'utf8'); }
    catch (e) { return res.error(500, 'secure-server-2fa.sh missing on this box'); }

    const { Client } = require('ssh2');
    function run(cmd, stdin) {
      return new Promise((resolve, reject) => {
        const conn = new Client();
        let out = '';
        conn.on('ready', () => {
          conn.exec(cmd, (err, stream) => {
            if (err) { conn.end(); return reject(err); }
            stream.on('data', d => { out += d.toString(); });
            stream.stderr.on('data', d => { out += d.toString(); });
            stream.on('close', (code) => { conn.end(); resolve({ code, out }); });
            if (stdin) stream.end(stdin); else stream.end();
          });
        });
        conn.on('error', reject);
        conn.connect({ host: ip, port: 22, username: loginUser, password, readyTimeout: 20000 });
      });
    }

    try {
      // Run the setup over one SSH connection. The script installs PAM, seeds
      // the owner's secret, validates, AND reloads sshd to activate — all in this
      // one run (reload = SIGHUP, doesn't drop this connection). One shot, no
      // half-state. We connect via password here, which still works because the
      // reload only takes effect for NEW logins after this returns.
      const stage = await run('GA_SECRET=' + JSON.stringify(secret) + ' bash -s', scriptText);
      const ok = /passwordauthentication no/i.test(stage.out)
        && /kbdinteractiveauthentication yes/i.test(stage.out)
        && /2FA is LIVE|reloaded/i.test(stage.out);
      if (!ok) {
        return res.json({ ok: false, message: 'Setup did not validate/activate — check the log.', output: stage.out.slice(-3500) });
      }
      return res.json({ ok: true, output: stage.out.slice(-3500) });
    } catch (e) {
      const m = (e && e.message) || String(e);
      if (/authentication|All configured auth/i.test(m)) return res.error(401, 'SSH login failed — wrong root password?');
      if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|getaddrinfo|timed out/i.test(m)) return res.error(502, 'Could not reach the box at ' + ip + ' (port 22).');
      return res.error(502, 'SSH error: ' + m);
    }
  });
};
