// tuser — Mailbox assigned via Settings → Team is visible to the MEMBER'S
// OWN session in the /chat mail picker.
//
// Bug: PUT /team/:userId/emails wrote the team_member RECORD id into
// email_address.assignedTo. mod-chat's viewerMatches authorizes against
// the SESSION identity (userId / slug / username / studio) — and prod
// (okdunio gecko) sessions present the member's ACCOUNT id (the client
// record id, stamped on team_member as `user_id` by mod-chat's
// invite-accept), never the team_member record id. So assignments made in
// the Settings UI were invisible to the member on prod. The old file-store
// tests masked this because record ids happened to equal user ids.
//
// Fix under test:
//   1. PUT writes BOTH tokens (record id + user_id) — visible in both
//      session universes (shell logins present the record id as userId).
//   2. GET /team/emails heals legacy record-id-only assignments by
//      mirroring in the member's user_id (back-compat, idempotent).
//   3. Unassign removes BOTH tokens.
//
// The member session here is minted with the shell's real session codec,
// presenting ONLY the account id (userId + slug = user_id, like a prod
// gecko session maps in) — the team_member record id appears nowhere in
// it, so a pass proves visibility does not depend on the record id.

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001';
const USERS_DIR = path.join(__dirname, '../../../instances/inst-dev/storage/users');
const studio = 'emtest' + Date.now();
const pass = 'testpass123';
const ACCT = 'acct-' + Date.now(); // the member's account (client) id
const memberEmail = 'member-' + Date.now() + '@t.io';

let passed = 0, failed = 0;
function ok(t) { passed++; console.log('  PASS  ' + t); }
function fail(t, e) { failed++; console.log('  FAIL  ' + t + ' — ' + (e || '')); }

function httpReq(method, url, data, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = data ? JSON.stringify(data) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    if (cookie) headers['Cookie'] = 'ps_session=' + cookie;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, res => {
      let raw = ''; res.on('data', d => raw += d);
      res.on('end', () => { const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), cookies }); } catch { resolve({ status: res.statusCode, body: raw, cookies }); } });
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

// Sign a session with the same codec + secret the shell uses, so we can
// mint a prod-shaped member session (identity = account id only).
function mintSession(payload) {
  const env = fs.readFileSync('/home/damon/.env', 'utf8');
  const m = env.match(/^PLATFORM_SESSION_SECRET=['"]?([^'"\n]+)['"]?/m);
  const secret = m ? m[1] : 'dev-secret-change-me';
  const { createTokenCodec } = require('/home/damon/shell-core/session');
  return createTokenCodec(() => secret).sign(payload);
}

(async () => {
  const bcrypt = require(path.join(__dirname, '../../../admin/platform-shell/node_modules/bcryptjs'));
  const hash = await bcrypt.hash(pass, 10);
  fs.writeFileSync(path.join(USERS_DIR, studio + '.json'), JSON.stringify({ studio, email: studio + '@test.com', passwordHash: hash, avatar: 'EM', plan: 'free', displayName: studio, role: 'owner', createdAt: new Date().toISOString() }, null, 2));

  const login = await httpReq('POST', BASE + '/api/auth/login', { email: studio, password: pass });
  const ownerCookie = (login.cookies.find(c => c.startsWith('ps_session=')) || '').split('=')[1];
  if (!ownerCookie) { fail('owner login'); process.exit(1); }

  const created = []; // [type, id] for cleanup
  const create = async (type, data) => {
    const r = await httpReq('POST', BASE + '/_api/storage/create', { type, data }, ownerCookie);
    if (!r.body || !r.body.id) throw new Error('storage create ' + type + ' failed: ' + JSON.stringify(r.body));
    created.push([type, r.body.id]);
    return r.body;
  };
  const getRec = async (type, id) => (await httpReq('GET', BASE + '/_api/storage/get?type=' + type + '&id=' + id, null, ownerCookie)).body;

  let browser;
  try {
    // Seed: a member whose team_member carries a real account id (user_id),
    // as mod-chat's invite-accept writes it; two mailboxes — B pre-assigned
    // the legacy way (record id only).
    const tm = await create('team_member', { studio, email: memberEmail, displayName: 'Mem', role: 'member', user_id: ACCT, modVisibility: {}, createdAt: new Date().toISOString() });
    // isCompanyMailbox: the prod failure case (damon@gamoid.io) — company
    // mailboxes are gated by assignedTo ALONE in viewerMatches (no
    // owner===studio bulk shortcut), so visibility here proves the tokens,
    // not the shortcut.
    const mkAddr = (local) => ({ address: local, domain: studio + '.test', fullAddress: local + '@' + studio + '.test', owner: studio, isCompanyMailbox: true, verified: true });
    const emA = await create('email_address', mkAddr('dev'));
    const emB = await create('email_address', { ...mkAddr('sales'), assignedTo: [tm.id] });

    // 1. Back-compat heal: admin GET /team/emails mirrors user_id into
    // legacy record-id-only assignments.
    const listR = await httpReq('GET', BASE + '/api/settings/team/emails', null, ownerCookie);
    const bRow = Array.isArray(listR.body) && listR.body.find(e => e.id === emB.id);
    bRow && bRow.assignedTo.includes(ACCT) && bRow.assignedTo.includes(tm.id)
      ? ok('legacy assignment healed on read (record id + account id)')
      : fail('legacy assignment healed on read', JSON.stringify(bRow && bRow.assignedTo));
    const bRec = await getRec('email_address', emB.id);
    (bRec.data.assignedTo || []).includes(ACCT)
      ? ok('heal persisted to storage')
      : fail('heal persisted to storage', JSON.stringify(bRec.data.assignedTo));

    // 2. Assign both mailboxes via the Settings API — must write BOTH tokens.
    const putR = await httpReq('PUT', BASE + '/api/settings/team/' + tm.id + '/emails', { emailIds: [emA.id, emB.id] }, ownerCookie);
    putR.status === 200 ? ok('PUT /team/:id/emails ok') : fail('PUT /team/:id/emails', putR.status);
    const aRec = await getRec('email_address', emA.id);
    const aTokens = aRec.data.assignedTo || [];
    aTokens.includes(ACCT) && aTokens.includes(tm.id)
      ? ok('assignment stores account id + record id')
      : fail('assignment stores account id + record id', JSON.stringify(aTokens));

    // 3. THE regression: the member's own session — presenting ONLY the
    // account id, like prod — sees the mailboxes in the /chat mail picker.
    const memberCookie = mintSession({ studio, email: memberEmail, role: 'member', userId: ACCT, slug: ACCT, ts: Date.now() });
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    await ctx.addCookies([{ name: 'ps_session', value: memberCookie, domain: 'localhost', path: '/', secure: false }]);
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);

    // API-level: what the picker is fed from, under the member session.
    const myAddrs = await p.evaluate(async () => {
      const r = await fetch('/api/chat/my-addresses', { credentials: 'include' });
      return r.ok ? r.json() : { error: r.status };
    });
    const addrList = Array.isArray(myAddrs) ? myAddrs.map(a => String(a.address || '').toLowerCase()) : [];
    addrList.includes('dev@' + studio + '.test')
      ? ok('member session sees assigned mailbox via my-addresses')
      : fail('member session sees assigned mailbox via my-addresses', JSON.stringify(myAddrs));
    addrList.includes('sales@' + studio + '.test')
      ? ok('member session sees healed legacy mailbox via my-addresses')
      : fail('member session sees healed legacy mailbox via my-addresses', JSON.stringify(addrList));

    // UI-level: the /chat mail picker (#accMenu) lists the mailbox.
    await p.evaluate(() => { if (window.shellNav) shellNav('/chat', 'chat'); });
    await p.waitForTimeout(3500);
    const menuText = await p.evaluate(() => {
      const m = document.getElementById('accMenu');
      return m ? m.textContent : null;
    });
    menuText !== null
      ? ok('chat mail picker rendered for member')
      : fail('chat mail picker rendered for member', 'no #accMenu');
    menuText && menuText.includes('dev@' + studio + '.test')
      ? ok('mail picker shows the assigned mailbox to the member')
      : fail('mail picker shows the assigned mailbox to the member', JSON.stringify(menuText && menuText.slice(0, 200)));

    // 4. Unassign removes BOTH tokens.
    await httpReq('PUT', BASE + '/api/settings/team/' + tm.id + '/emails', { emailIds: [emB.id] }, ownerCookie);
    const aRec2 = await getRec('email_address', emA.id);
    const aTok2 = aRec2.data.assignedTo || [];
    !aTok2.includes(ACCT) && !aTok2.includes(tm.id)
      ? ok('unassign removes both tokens')
      : fail('unassign removes both tokens', JSON.stringify(aTok2));
  } catch (e) {
    fail('exception', e.message);
  } finally {
    if (browser) await browser.close();
    for (const [type, id] of created) {
      try { await httpReq('DELETE', BASE + '/_api/storage/delete', { type, id }, ownerCookie); } catch {}
    }
    try { fs.unlinkSync(path.join(USERS_DIR, studio + '.json')); } catch {}
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
