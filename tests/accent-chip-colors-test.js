// accent-chip-colors-test.js — Appearance > Accent color: every chip is written
// in ITS OWN color, hardcoded — never theme vars. Regression: the Cyan chip used
// color:var(--primary), which tracks the CURRENT accent, so with accent=orange
// "● Cyan" rendered orange (Damon screenshot 2026-07-14).
//   timeout 90 node tests/accent-chip-colors-test.js
const { chromium } = require('playwright');
const { authContext, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');

let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
const WANT = { cyan: 'rgb(0, 230, 210)', pink: 'rgb(255, 57, 151)', green: 'rgb(57, 255, 127)', yellow: 'rgb(255, 215, 0)', orange: 'rgb(255, 107, 53)' };

async function chipColors(page) {
  return page.$$eval('.stg-seg[data-key="accent"] .stg-seg-btn', els =>
    Object.fromEntries(els.map(el => [el.dataset.val, getComputedStyle(el).color])));
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await authContext(browser);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerr]', String(e.message).slice(0, 160)));

  await page.goto(TENANT + '/settings', { waitUntil: 'domcontentloaded' });
  const nav = await page.waitForSelector('.stg-nav-item[data-section="appearance"]', { timeout: 20000 });
  await nav.click();
  await page.waitForSelector('.stg-seg[data-key="accent"] .stg-seg-btn', { timeout: 10000 });

  // switch the LIVE accent to orange — the failure condition from the report
  await page.click('.stg-seg[data-key="accent"] .stg-seg-btn[data-val="orange"]');
  await page.waitForTimeout(400);
  const withOrange = await chipColors(page);
  for (const [val, want] of Object.entries(WANT)) {
    ok(withOrange[val] === want, `accent=orange: ${val} chip is its own color (${withOrange[val]})`);
  }
  ok(withOrange.cyan !== withOrange.orange, 'Cyan chip no longer matches the orange accent');

  // and with accent=cyan the others must not turn cyan either
  await page.click('.stg-seg[data-key="accent"] .stg-seg-btn[data-val="cyan"]');
  await page.waitForTimeout(400);
  const withCyan = await chipColors(page);
  ok(withCyan.orange === WANT.orange && withCyan.pink === WANT.pink, 'accent=cyan: other chips keep their own colors');

  await page.screenshot({ path: '/home/damon/platform/.runtime/accent-chips-after.jpg', clip: { x: 900, y: 280, width: 470, height: 90 } });
  console.log('  shot: .runtime/accent-chips-after.jpg');

  await browser.close();
  console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
