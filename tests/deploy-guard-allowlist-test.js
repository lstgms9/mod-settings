// deploy-guard-allowlist-test.js — deployGuard is now DEPLOY_ADMIN_EMAILS
// (owners only), replacing the flat-file role check that was dead on
// DB-backed tenants and passed any flat-file studio owner. The old
// panel rsync push (POST /deploy/run) is RETIRED — 404 for everyone,
// deploys are pull-based via /release/*.
//
// Asserts, with REAL accounts (nothing forged):
//   API: gametest (release admin but NOT deploy admin) → 403 on /deploy/status
//        master@gamoid.test (plain studio)             → 403 on /deploy/status
//        lstgms9 (allowlisted, :3005 master)           → 200 on /deploy/status
//        POST /deploy/run → 404 even for the allowlisted owner
//   Browser (:3010, gametest): Deploy tab visible (release panel),
//        Secure-a-box tab stays hidden (deploy-guard gated)
//   Browser (:3005, lstgms9): Secure-a-box tab reveals
const { chromium } = require('playwright');
const http = require('http');
const { authContext, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');

let passed = 0, failed = 0;
const ok = t => { passed++; console.log('  PASS  ' + t); };
const fail = (t, e) => { failed++; console.log('  FAIL  ' + t + ' — ' + (e || '')); };

function login(port, host, email, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email, password });
    const r = http.request({ host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Host: host } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const m = /okdun_session=([^;]+)/.exec((res.headers['set-cookie'] || []).join(';'));
        m ? resolve(m[1]) : reject(new Error('no cookie for ' + email + ': ' + d.slice(0, 80)));
      });
    });
    r.on('error', reject); r.write(body); r.end();
  });
}
function get(port, host, path, token, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method,
      headers: { Host: host, Cookie: 'okdun_session=' + token } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    r.on('error', reject); r.end();
  });
}

(async () => {
  // ── API: non-deploy-admins are 403 ─────────────────────────────
  const gt = await login(3010, 'dev.gamoid.io', 'gametest@gamoid.test', 'gtest1234');
  const s1 = await get(3010, 'dev.gamoid.io', '/api/settings/deploy/status', gt);
  s1 === 403 ? ok('gametest (release admin) still 403 on /deploy/status') : fail('gametest deploy 403', s1);
  // /deploy/run is deleted. The tenant shell answers ANY unmatched API path
  // the same way for an authed user (SPA fallback), so assert parity with a
  // definitely-nonexistent route rather than a hardcoded status.
  const s2 = await get(3010, 'dev.gamoid.io', '/api/settings/deploy/run', gt, 'POST');
  const sGone = await get(3010, 'dev.gamoid.io', '/api/settings/definitely-not-a-route', gt, 'POST');
  s2 === sGone ? ok('POST /deploy/run retired — behaves as nonexistent (' + s2 + ')') : fail('run retired', s2 + ' vs nonexistent ' + sGone);
  const s3 = await get(3010, 'dev.gamoid.io', '/api/settings/secure-box', gt, 'POST');
  s3 === 403 ? ok('gametest 403 on POST /secure-box') : fail('gametest secure-box 403', s3);

  const mt = await login(3010, 'dev.gamoid.io', 'master@gamoid.test', 'master1234');
  const s4 = await get(3010, 'dev.gamoid.io', '/api/settings/deploy/status', mt);
  s4 === 403 ? ok('plain studio 403 on /deploy/status') : fail('plain studio 403', s4);

  // ── API: allowlisted owner is 200 (lstgms9 on the :3005 master) ─
  const so = await login(3005, 'okdun.io', 'lstgms9@gmail.com', 'l1234');
  const s5 = await get(3005, 'okdun.io', '/api/settings/deploy/status', so);
  s5 === 200 ? ok('allowlisted owner 200 on /deploy/status (:3005)') : fail('owner 200', s5);
  const s6 = await get(3005, 'okdun.io', '/api/settings/deploy/run', so, 'POST');
  s6 === 404 ? ok('POST /deploy/run retired — 404 even for allowlisted owner') : fail('run retired for owner', s6);

  // ── Browser: gametest on :3010 — Deploy tab yes, Secure-a-box no ─
  const browser = await chromium.launch();
  const ctx = await authContext(browser);
  const page = await ctx.newPage();
  await page.goto(TENANT + '/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stgDeployNav:not([style*="display: none"])', { timeout: 20000 });
  ok('gametest still sees Deploy tab (release panel)');
  await page.waitForTimeout(3000); // give initSecureBox time to (not) reveal
  const sbHidden = await page.$eval('#stgSecureBoxNav', el => el.style.display === 'none');
  sbHidden ? ok('Secure-a-box tab stays hidden for gametest') : fail('secure-box hidden', 'visible!');

  // ── Browser: lstgms9 on :3005 — Secure-a-box reveals ────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addCookies([{ name: 'okdun_session', value: so, domain: 'localhost', path: '/' }]);
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:3005/settings', { waitUntil: 'domcontentloaded' });
  try {
    await p2.waitForSelector('#stgSecureBoxNav:not([style*="display: none"])', { timeout: 20000 });
    ok('Secure-a-box tab reveals for allowlisted owner (:3005)');
  } catch (e) {
    fail('secure-box reveals for owner', 'still hidden after 20s');
  }
  await p2.screenshot({ path: __dirname + '/shots-release-panel/6-securebox-owner.png' });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
