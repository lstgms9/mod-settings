// Settings → Account: the country flag preview next to the dropdown must be a
// real FLAG IMAGE (flagcdn), not the bare code letters. Emoji flags render as
// "DE"/"JP" on Linux/Chromium/Windows.
const { chromium } = require('/home/damon/platform/node_modules/playwright');
const { loginToken, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');
const STUDIO_USER = { email: 'oliverbranch27@gmail.com', password: 'blu12345' };
let pass = 0, fail = 0;
const ok = t => { console.log('  PASS:', t); pass++; };
const ng = (t, e) => { console.log('  FAIL:', t, e || ''); fail++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: 'okdun_session', value: await loginToken(STUDIO_USER), domain: 'localhost', path: '/' }]);
  const p = await ctx.newPage();
  await p.goto(TENANT + '/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  // Wait until the country <select> is populated (means renderProfile ran and
  // the change listener is attached).
  await p.waitForFunction(() => {
    const s = document.getElementById('profileCountry');
    return s && s.querySelector('option[value="DE"]');
  }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(300);

  // Pick Germany and fire change → flag preview should become a DE flag image.
  const r = await p.evaluate(() => {
    const sel = document.getElementById('profileCountry');
    const flag = document.getElementById('profileCountryFlag');
    if (sel) { sel.value = 'DE'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const img = flag ? flag.querySelector('img.stg-flag-img') : null;
    return {
      hasFlagBox: !!flag,
      imgSrc: img ? img.getAttribute('src') : null,
      text: flag ? (flag.textContent || '').trim() : null,
    };
  });

  r.hasFlagBox ? ok('country flag preview exists') : ng('no #profileCountryFlag');
  (r.imgSrc && /flagcdn\.com\/de\.svg/.test(r.imgSrc)) ? ok(`flag is an IMAGE on change (${r.imgSrc})`) : ng('flag not a flagcdn image', r.imgSrc);
  (!/^[A-Z]{2}$/.test(r.text || '')) ? ok(`flag preview is not bare code letters (text="${r.text}")`) : ng('flag shows code as text', r.text);

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('test error:', e.message); process.exit(1); });
