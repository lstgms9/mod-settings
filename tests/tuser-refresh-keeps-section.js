// tuser — Refresh (F5) keeps you on the same settings section.
//
// Bug: opening Settings, selecting a non-default section (e.g. Privacy
// or Deploy), then pressing F5 reopened Settings on the default Account
// tab — losing your place. The open section is now persisted to
// localStorage and restored on init (including the async-revealed,
// owner-only Deploy tab).
//
// Covers:
//   1. The Settings module survives a reload (regression guard).
//   2. A normal section (Privacy & Security) is restored after reload.
//   3. If the owner-only Deploy tab is available, it too is restored.

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001';
const USERS_DIR = path.join(__dirname, '../../../instances/inst-dev/storage/users');
const studio = 'reftest' + Date.now();
const pass = 'testpass123';

let passed = 0, failed = 0;
function ok(t) { passed++; console.log('  PASS  ' + t); }
function fail(t, e) { failed++; console.log('  FAIL  ' + t + ' — ' + (e || '')); }

function httpReq(method, url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = data ? JSON.stringify(data) : null;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      let raw = ''; res.on('data', d => raw += d);
      res.on('end', () => { const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), cookies }); } catch { resolve({ status: res.statusCode, body: raw, cookies }); } });
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

const activeText = p => p.evaluate(() => {
  const a = document.querySelector('.stg-nav-item.active');
  return (a && a.textContent || '').trim();
});

(async () => {
  const bcrypt = require(path.join(__dirname, '../../../admin/platform-shell/node_modules/bcryptjs'));
  const hash = await bcrypt.hash(pass, 10);
  fs.writeFileSync(path.join(USERS_DIR, studio + '.json'), JSON.stringify({ studio, email: studio + '@test.com', passwordHash: hash, avatar: 'RT', plan: 'free', displayName: studio, role: 'owner', createdAt: new Date().toISOString() }, null, 2));

  const login = await httpReq('POST', BASE + '/api/auth/login', { email: studio, password: pass });
  const cookie = (login.cookies.find(c => c.startsWith('ps_session=')) || '').split('=')[1];
  if (!cookie) { fail('login'); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  await ctx.addCookies([{ name: 'ps_session', value: cookie, domain: 'localhost', path: '/', secure: false }]);
  const p = await ctx.newPage();

  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    await p.evaluate(() => { if (window.shellNav) shellNav('/settings', 'settings'); });
    await p.waitForTimeout(2500);

    // 1. Select Privacy & Security and reload — section is preserved.
    const sel = await p.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.stg-nav-item[data-section="privacy"]')).filter(e => getComputedStyle(e).display !== 'none');
      if (!els[0]) return null;
      els[0].click();
      return (els[0].textContent || '').trim();
    });
    if (!sel) { fail('select Privacy', 'nav item not visible'); }
    await p.waitForTimeout(600);
    const before = await activeText(p);
    before === sel ? ok('Privacy selected: ' + before) : fail('Privacy selected', before);

    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);

    const hasSettings = await p.evaluate(() => !!document.getElementById('settings-app'));
    hasSettings ? ok('Settings module survived reload') : fail('Settings module survived reload', 'settings-app missing');

    const after = await activeText(p);
    after === before ? ok('Section restored after reload: ' + after) : fail('Section restored after reload', 'got "' + after + '" expected "' + before + '"');

    // 2. Owner-only Deploy tab — only assert if it's available in this env.
    const deployAvail = await p.evaluate(() => {
      const n = document.getElementById('stgDeployNav');
      return !!n && getComputedStyle(n).display !== 'none';
    });
    if (deployAvail) {
      const depText = await p.evaluate(() => {
        const n = document.getElementById('stgDeployNav'); n.click();
        return (n.textContent || '').trim();
      });
      await p.waitForTimeout(600);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(3000);
      const afterDep = await activeText(p);
      afterDep === depText ? ok('Deploy tab restored after reload: ' + afterDep) : fail('Deploy tab restored after reload', 'got "' + afterDep + '"');
    } else {
      console.log('  SKIP  Deploy tab not available in this environment');
    }
  } catch (e) {
    fail('exception', e.message);
  } finally {
    await browser.close();
    try { fs.unlinkSync(path.join(USERS_DIR, studio + '.json')); } catch {}
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
