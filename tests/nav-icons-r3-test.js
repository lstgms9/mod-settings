// nav-icons-r3-test.js — R3-2: settings nav icons are inline SVGs, no emoji.
//   cd /home/damon/okdunio && timeout 90 node /home/damon/platform/modules/mod-settings/tests/nav-icons-r3-test.js
const { chromium, devices } = require('/home/damon/platform/node_modules/playwright');
const http = require('http');
const HOST = 'dev.gamoid.io';
function post(p, body) { return new Promise((res, rej) => { const b = JSON.stringify(body); const r = http.request({ host: '127.0.0.1', port: 3010, path: p, method: 'POST', headers: { Host: HOST, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ json: (() => { try { return JSON.parse(d); } catch { return null; } })(), cookie: ((s.headers['set-cookie'] || []).join(';').match(/okdun_session=([^;]+)/) || [])[1], gate: ((s.headers['set-cookie'] || []).join(';').match(/gamoid_gate=([^;]+)/) || [])[1] })); }); r.on('error', rej); r.write(b); r.end(); }); }
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
async function ctxFor() { const gc = (await post('/_gate/login', { pass: 'bt92' })).gate; const sess = (await post('/api/auth/login', { email: 'damon@lostgames.co', password: 'lostg192' })).cookie; const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await ctx.addCookies([{ name: 'gamoid_gate', value: gc, domain: '127.0.0.1', path: '/' }, { name: 'okdun_session', value: sess, domain: '127.0.0.1', path: '/' }]); return { browser, page: await ctx.newPage() }; }
(async () => {
  const { browser, page } = await ctxFor();
  await page.goto('http://127.0.0.1:3010/settings', { waitUntil: 'networkidle', headers: { Host: HOST } });
  await page.waitForTimeout(1600);
  const m = await page.evaluate(() => { const it = [...document.querySelectorAll('.stg-nav-icon')]; const svg = it.filter(i => i.querySelector('svg')).length; const emoji = it.filter(i => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(i.textContent||'')).length; const g = document.querySelector('.stg-nav-svg'); return { total: it.length, svg, emoji, sized: g && g.getBoundingClientRect().width >= 12 }; });
  ok(m.total > 0 && m.svg === m.total, 'all nav icons are SVG (' + m.svg + '/' + m.total + ')');
  ok(m.emoji === 0, 'no emoji glyphs in nav icons');
  ok(m.sized, 'nav SVG sized ~16px');
  await browser.close(); console.log(fail ? ('\n'+fail+' FAILED') : '\nALL PASSED'); process.exit(fail?1:0);
})();
