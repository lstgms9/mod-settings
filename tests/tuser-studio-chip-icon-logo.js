const { chromium } = require('/home/damon/platform/node_modules/playwright');
const { authContext, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');
(async () => {
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (c,m) => { c ? (pass++, console.log(' ✓', m)) : (fail++, console.log(' ✗', m)); };

  // REAL case: lost studio (has icon + logo uploaded) via its real owner account
  const ctx = await authContext(browser, { user: { email:'damon@lostgames.co', password:'lostg192' } });
  const p = await ctx.newPage();
  await p.goto(TENANT + '/settings', { waitUntil:'networkidle' });
  await p.waitForTimeout(2500);
  const chip = await p.evaluate(() => {
    const c = document.getElementById('accountStudioChip');
    if (!c || c.style.display === 'none') return null;
    const imgs = [...c.querySelectorAll('img')].map(i => ({ cls: i.className||'square', w: i.clientWidth, h: i.clientHeight, loaded: i.complete && i.naturalWidth>0, file: i.src.split('/').pop() }));
    return { imgs, text: (c.querySelector('.stg-acct-studio-chip-name')||{}).textContent || null };
  });
  console.log('lost studio chip:', JSON.stringify(chip));
  ok(!!chip, 'chip visible for studio-tier owner');
  ok(chip && chip.imgs.length===2, 'chip has 2 images (icon square + logo wordmark)');
  ok(chip && chip.imgs[0].cls==='square' && chip.imgs[0].w===24 && chip.imgs[0].h===24 && chip.imgs[0].loaded, 'left = 24x24 icon square, loaded');
  ok(chip && chip.imgs[0].file==='cd6aacf2-243b-4a50-9f21-5dc53380ca03', 'square is the ICON fileId (not logo)');
  ok(chip && /chip-logo/.test((chip.imgs[1]||{}).cls) && chip.imgs[1].w>24 && chip.imgs[1].loaded, 'right = wide logo wordmark, loaded');
  ok(chip && chip.imgs[1] && chip.imgs[1].file==='84b42b47-4ca2-4468-bf0b-a3ae0426afeb', 'wordmark is the LOGO fileId');
  ok(chip && chip.text===null, 'no "LOST GAMES" text when logo exists');
  const box = await p.locator('#accountStudioChip').boundingBox();
  if (box) await p.screenshot({ path:'chip-after.png', clip:{ x:box.x-40, y:box.y-25, width:box.width+220, height:box.height+50 } });
  await ctx.close();

  // Fallback case: gametest has no studioSlug → chip hidden (unchanged behavior)
  const ctx2 = await authContext(browser);
  const p2 = await ctx2.newPage();
  await p2.goto(TENANT + '/settings', { waitUntil:'networkidle' });
  await p2.waitForTimeout(1500);
  const hidden = await p2.evaluate(() => {
    const c = document.getElementById('accountStudioChip');
    return !c || c.style.display === 'none';
  });
  ok(hidden, 'no-studioSlug account: chip stays hidden');
  await ctx2.close();

  await browser.close();
  console.log(`\n${pass}/${pass+fail} pass`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e);process.exit(1)});
