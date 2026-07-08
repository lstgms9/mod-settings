// mobile-r2-test.js — R2-1: settings text lifted to 16/20 on phone, and the
// account tier badge no longer shows its teal "—" placeholder.
//   cd /home/damon/okdunio && timeout 90 node /home/damon/platform/modules/mod-settings/tests/mobile-r2-test.js
const { chromium, devices } = require('/home/damon/platform/node_modules/playwright');
const http = require('http');
const HOST = 'dev.gamoid.io';
function post(p, body) { return new Promise((res, rej) => { const b = JSON.stringify(body); const r = http.request({ host: '127.0.0.1', port: 3010, path: p, method: 'POST', headers: { Host: HOST, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ json: (() => { try { return JSON.parse(d); } catch { return null; } })(), cookie: ((s.headers['set-cookie'] || []).join(';').match(/okdun_session=([^;]+)/) || [])[1], gate: ((s.headers['set-cookie'] || []).join(';').match(/gamoid_gate=([^;]+)/) || [])[1] })); }); r.on('error', rej); r.write(b); r.end(); }); }
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
async function ctxFor() { const gc = (await post('/_gate/login', { pass: 'bt92' })).gate; const sess = (await post('/api/auth/login', { email: 'damon@lostgames.co', password: 'lostg192' })).cookie; const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await ctx.addCookies([{ name: 'gamoid_gate', value: gc, domain: '127.0.0.1', path: '/' }, { name: 'okdun_session', value: sess, domain: '127.0.0.1', path: '/' }]); return { browser, page: await ctx.newPage() }; }
(async () => {
  const { browser, page } = await ctxFor();
  await page.goto('http://127.0.0.1:3010/settings', { waitUntil: 'networkidle', headers: { Host: HOST } });
  await page.waitForTimeout(1800);
  const m = await page.evaluate(() => { const fs = s => { const e = document.querySelector(s); return e ? Math.round(parseFloat(getComputedStyle(e).fontSize)) : 0; }; const b = document.getElementById('accountTierBadge'); return { nav: fs('.stg-nav-item'), label: fs('.stg-acct-pair > label'), hdr: fs('.stg-section-header'), badgeShown: b && b.offsetParent !== null, badgeText: b && b.textContent.trim() }; });
  ok(m.nav >= 16, 'settings nav items >=16px (' + m.nav + ')');
  ok(m.label >= 16, 'account field labels >=16px (' + m.label + ')');
  ok(m.hdr >= 20, 'section header >=20px (' + m.hdr + ')');
  ok(!(m.badgeShown && m.badgeText === '—'), 'tier badge is not the teal "—" placeholder (text="' + m.badgeText + '")');
  await browser.close(); console.log(fail ? ('\n'+fail+' FAILED') : '\nALL PASSED'); process.exit(fail?1:0);
})();
