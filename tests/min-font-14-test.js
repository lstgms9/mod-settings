// min-font-14-test.js — Damon 2026-07-20: NO text under 14px anywhere on the
// settings pages ("no one can read the tiny text"). Walks every visible nav
// section as a studio-tier user and fails on any visible element whose direct
// text renders below 14px.
//   timeout 120 node /home/damon/platform/modules/mod-settings/tests/min-font-14-test.js
const { chromium } = require('/home/damon/platform/node_modules/playwright');
const http = require('http');
const BASE = 'http://localhost:3010', HOST = 'dev.gamoid.io';

function login() {
  return new Promise((res, rej) => {
    const b = JSON.stringify({ email: 'gametest@gamoid.test', password: 'gtest1234' });
    const r = http.request({ host: '127.0.0.1', port: 3010, path: '/api/auth/login', method: 'POST',
      headers: { Host: HOST, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      s => { let d = ''; s.on('data', c => d += c); s.on('end', () => { const m = (s.headers['set-cookie'] || []).join(';').match(/okdun_session=([^;]+)/); m ? res(m[1]) : rej(new Error('login')); }); });
    r.write(b); r.end();
  });
}
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  const t = await login();
  const br = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await br.newContext({ viewport: { width: 1372, height: 900 } });
    await ctx.addCookies([{ name: 'okdun_session', value: t, domain: 'localhost', path: '/' }]);
    const page = await ctx.newPage();
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const sections = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.stg-nav-item'))
        .filter(n => n.offsetParent !== null)
        .map(n => n.dataset.section));
    ok(sections.length >= 4, 'visible sections found (' + sections.join(', ') + ')');

    for (const sec of sections) {
      await page.click('.stg-nav-item[data-section="' + sec + '"]');
      await page.waitForTimeout(600);
      const tiny = await page.evaluate(() => {
        const out = [];
        const root = document.querySelector('.stg-section.active') || document.getElementById('settings-app');
        for (const el of root.querySelectorAll('*')) {
          if (!el.offsetParent) continue;                       // hidden
          const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
          if (!hasText) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 14) out.push((el.className || el.tagName) + ' @' + Math.round(fs) + 'px "' + el.textContent.trim().slice(0, 30) + '"');
        }
        return out.slice(0, 5);
      });
      ok(tiny.length === 0, 'section "' + sec + '": no text under 14px' + (tiny.length ? ' — ' + tiny.join(' | ') : ''));
    }
    // The sidebar itself too.
    const sideTiny = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.stg-sidebar *')) {
        if (!el.offsetParent) continue;
        const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 14) out.push((el.className || el.tagName) + ' @' + Math.round(fs) + 'px');
      }
      return out.slice(0, 5);
    });
    ok(sideTiny.length === 0, 'sidebar: no text under 14px' + (sideTiny.length ? ' — ' + sideTiny.join(' | ') : ''));
    await page.click('.stg-nav-item[data-section="ai"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: __dirname + '/shots-ai-accounts/min-font-ai.png' });
  } finally { await br.close(); }
  console.log(fail ? ('\n' + fail + ' FAILED') : '\nALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
