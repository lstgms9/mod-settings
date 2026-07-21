// media-backup-panel-test.js — Settings ▸ Backups gets the MEDIA BACKUP row
// (STORAGE_BYTES_MIGRATION_PLAN Phase 4): On/Off toggle for the default-on
// media auto-download + a Download-now button, wired to
// /api/files/backup/settings {mediaAuto} and /api/files/export?mine=1.
const { chromium } = require('/home/damon/platform/node_modules/playwright');
const { authContext, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');
let pass = 0, fail = 0;
const ok = t => { console.log('  PASS:', t); pass++; };
const ng = (t, e) => { console.log('  FAIL:', t, e || ''); fail++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await authContext(b);
  ctx.setDefaultTimeout(25000);
  const p = await ctx.newPage();
  await p.goto(TENANT + '/settings', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#stgBackupsNav', { state: 'visible', timeout: 20000 });
  await p.click('#stgBackupsNav');
  await p.waitForSelector('#bkMediaOn', { state: 'visible', timeout: 20000 }).catch(() => {});

  const els = await p.evaluate(() => ({
    on: !!document.getElementById('bkMediaOn'),
    off: !!document.getElementById('bkMediaOff'),
    now: !!document.getElementById('bkMediaNow'),
    info: (document.getElementById('bkMediaInfo') || {}).textContent || '',
  }));
  els.on && els.off && els.now ? ok('Media Backup row renders (On/Off/Download now)') : ng('row missing', JSON.stringify(els));

  // default paints ON (mediaAuto true unless switched off)
  await p.waitForTimeout(1200);
  const painted = await p.evaluate(() => document.getElementById('bkMediaOn').classList.contains('stg-ai-connect'));
  painted ? ok('On is painted active by default') : ng('default paint', '');

  // toggle Off → server round-trip → paint flips
  await p.click('#bkMediaOff');
  await p.waitForTimeout(800);
  const flipped = await p.evaluate(async () => {
    const st = await (await fetch('/api/files/backup/settings')).json();
    return { paint: document.getElementById('bkMediaOff').classList.contains('stg-ai-connect'), mediaAuto: st.mediaAuto };
  });
  flipped.paint && flipped.mediaAuto === false ? ok('Off toggles paint + persists mediaAuto=false') : ng('toggle off', JSON.stringify(flipped));

  // back On (leave default state behind us)
  await p.click('#bkMediaOn');
  await p.waitForTimeout(800);
  const back = await p.evaluate(async () => (await (await fetch('/api/files/backup/settings')).json()).mediaAuto);
  back === true ? ok('On restores mediaAuto=true') : ng('restore', String(back));

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
