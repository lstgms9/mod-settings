const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { TOTP, Secret } = require('otpauth');
const QRCode = require('qrcode');
const archiver = require('archiver');

module.exports = function(router, ctx) {
  const { storage } = ctx;
  const usersDir = path.join(__dirname, '../../instances/inst-dev/storage/users');
  const storageDir = path.join(__dirname, '../../instances/inst-dev/storage');

  // ── helpers ──────────────────────────────────────────────────
  function readUser(studio) {
    const f = path.join(usersDir, studio + '.json');
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  }
  function writeUser(studio, data) {
    fs.writeFileSync(path.join(usersDir, studio + '.json'), JSON.stringify(data, null, 2));
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
    const user = readUser(req.user.studio);
    if (user && user.tfa) {
      prefs.tfa = { method: user.tfa.method, enabled: true };
    } else {
      prefs.tfa = { enabled: false };
    }
    // include plan info
    if (user) {
      prefs.plan = user.plan || 'free';
      prefs.displayName = user.displayName || user.studio;
      prefs.email = user.email;
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
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({
      issuer: 'OkDun',
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
    const user = readUser(req.user.studio);
    if (!user) return res.error(404, 'User not found');
    user.tfaPending = { method: 'totp', secret: secret.base32 };
    writeUser(req.user.studio, user);
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
    const user = readUser(req.user.studio);
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
    // activate 2FA
    user.tfa = { method: 'totp', secret: user.tfaPending.secret };
    delete user.tfaPending;
    writeUser(req.user.studio, user);
    res.json({ ok: true, method: 'totp' });
  });

  // ── 2FA: email setup — send test code ───────────────────────
  router.post('/2fa/setup-email', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const user = readUser(req.user.studio);
    if (!user) return res.error(404, 'User not found');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    user.tfaPending = { method: 'email', code, expires: Date.now() + 600000 }; // 10min
    writeUser(req.user.studio, user);
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
    const user = readUser(req.user.studio);
    if (!user || !user.tfaPending || user.tfaPending.method !== 'email') {
      return res.error(400, 'No pending email 2FA setup');
    }
    if (user.tfaPending.expires < Date.now()) {
      delete user.tfaPending;
      writeUser(req.user.studio, user);
      return res.error(400, 'Code expired');
    }
    if (user.tfaPending.code !== code) return res.error(400, 'Invalid code');
    user.tfa = { method: 'email' };
    delete user.tfaPending;
    writeUser(req.user.studio, user);
    res.json({ ok: true, method: 'email' });
  });

  // ── 2FA: disable ────────────────────────────────────────────
  router.delete('/2fa', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const user = readUser(req.user.studio);
    if (!user) return res.error(404, 'User not found');
    delete user.tfa;
    delete user.tfaPending;
    writeUser(req.user.studio, user);
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

  // GET /team/emails — list all domain email addresses (for assignment UI)
  router.get('/team/emails', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const all = await storage.list('email_address');
    const emails = all.map(a => ({
      id: a.id,
      address: a.address || (a.data && a.data.address) || '',
      domain: a.domain || (a.data && a.data.domain) || '',
      assignedTo: a.assignedTo || (a.data && a.data.assignedTo) || [],
    }));
    res.json(emails);
  });

  // PUT /team/:userId/emails — assign email addresses to a team member
  router.put('/team/:userId/emails', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { emailIds } = req.body || {};
    if (!Array.isArray(emailIds)) return res.error(400, 'emailIds array required');
    const tm = await storage.get('team_member', req.params.userId);
    if (!tm || tm.data.studio !== req.user.studio) return res.error(404, 'Member not found');

    // Get all email_address records
    const all = await storage.list('email_address');
    for (const addr of all) {
      const full = await storage.get('email_address', addr.id);
      if (!full) continue;
      let assigned = full.data.assignedTo || [];
      const shouldAssign = emailIds.includes(addr.id);
      const isAssigned = assigned.includes(req.params.userId);
      if (shouldAssign && !isAssigned) {
        assigned = assigned.concat(req.params.userId);
        await storage.update('email_address', addr.id, { assignedTo: assigned });
      } else if (!shouldAssign && isAssigned) {
        assigned = assigned.filter(id => id !== req.params.userId);
        await storage.update('email_address', addr.id, { assignedTo: assigned });
      }
    }
    res.json({ ok: true });
  });
};
