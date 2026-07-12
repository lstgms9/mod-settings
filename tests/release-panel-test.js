// release-panel-test.js — REAL browser drives the release-based Deploy panel
// on the gamoid dev tenant (:3010, Host dev.gamoid.io) end-to-end:
//
//   1. the VERTICAL OWNER (real role, no forged session) sees the Deploy tab
//      revealed, with manifest + canary check-in rendered
//   2. Cut release → the panel's build log shows the new build completing
//   3. the fakebox canary applies it (updater invoked directly here so the
//      test doesn't idle out waiting for the */5 cron — the cron loop itself
//      is verified separately) → box row shows the new version, health 200
//   4. Promote vN → confirm modal → stable pointer moves in the manifest line
//
// Auth: gametest@gamoid.test — allowlisted in RELEASE_ADMIN_EMAILS on the
// dev box (the release guard is an explicit email allowlist, not the old
// flat-file role check, which is dead on DB-backed tenants). The account
// really carries the tested privilege — nothing is forged.
// Requires: :3010 + :3005 up, fakebox rig.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { authContext, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');
const SHOTS = __dirname + '/shots-release-panel';
require('fs').mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const ok = t => { passed++; console.log('  PASS  ' + t); };
const fail = (t, e) => { failed++; console.log('  FAIL  ' + t + ' — ' + (e || '')); };

async function confirmModal(page) {
  // platform.ui.confirm renders a DOM modal; fall back to native dialog.
  try {
    await page.click('.pui-confirm-actions .pui-btn-primary', { timeout: 3000 });
  } catch { /* native confirm was auto-accepted by the dialog handler */ }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await authContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));

  try {
    // ── 1. Panel renders for the owner ─────────────────────────────
    await page.goto(TENANT + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#stgDeployNav:not([style*="display: none"])', { timeout: 20000 });
    ok('Deploy tab revealed for owner');
    await page.click('#stgDeployNav');
    await page.waitForSelector('#relManifest', { timeout: 5000 });
    const man0 = await page.textContent('#relManifest');
    /Latest build: v\d+/.test(man0) ? ok('manifest rendered: ' + man0.split('·')[0].trim())
                                    : fail('manifest rendered', man0.slice(0, 80));
    const boxes0 = await page.textContent('#relBoxes');
    /fakebox/.test(boxes0) ? ok('fakebox check-in row visible') : fail('fakebox row', boxes0.slice(0, 80));
    await page.screenshot({ path: SHOTS + '/1-panel.png', fullPage: false });

    const beforeV = parseInt((man0.match(/Latest build: v(\d+)/) || [])[1] || '0', 10);

    // ── 2. Cut release ─────────────────────────────────────────────
    // Wait for THIS build's completion line ("build v<want> complete") —
    // matching a bare "BUILD FAILED" would trip on older log tail lines.
    await page.click('#relCut');
    await confirmModal(page);
    const wantV = beforeV + 1;
    await page.waitForFunction(
      v => ((document.getElementById('relLog') || {}).textContent || '').includes('build v' + v + ' complete'),
      wantV, { timeout: 240000, polling: 2000 },
    );
    ok('Cut release → build v' + wantV + ' complete (panel log)');
    await page.screenshot({ path: SHOTS + '/2-built.png' });

    // ── 3. Canary applies it ───────────────────────────────────────
    execSync('RELEASE_UPDATER_CONF=/home/damon/fakebox/.release-updater.conf /home/damon/bin/release-updater', { timeout: 300000 });
    let boxes1 = '';
    for (let i = 0; i < 15; i++) {
      await page.click('#relRefresh');
      await page.waitForTimeout(2000);
      boxes1 = await page.textContent('#relBoxes');
      if (new RegExp('fakebox[\\s\\S]*v' + wantV).test(boxes1)) break;
    }
    new RegExp('fakebox[\\s\\S]*v' + wantV).test(boxes1) && /200/.test(boxes1)
      ? ok('canary applied v' + wantV + ', health 200 in panel')
      : fail('canary applied + healthy', boxes1.slice(0, 150));
    await page.screenshot({ path: SHOTS + '/3-canary.png' });

    // ── 4. Promote ─────────────────────────────────────────────────
    await page.waitForFunction(() => !document.getElementById('relPromote').disabled, { timeout: 15000 });
    const pText = await page.textContent('#relPromote');
    pText.includes('Promote v' + wantV) ? ok('Promote button armed: ' + pText) : fail('promote armed', pText);
    await page.click('#relPromote');
    await confirmModal(page);
    await page.waitForFunction(
      v => new RegExp('stable → v' + v).test((document.getElementById('relManifest') || {}).textContent || ''),
      wantV, { timeout: 20000, polling: 1000 },
    );
    ok('stable channel now → v' + wantV);
    await page.screenshot({ path: SHOTS + '/4-promoted.png' });

    // canary (also polling both channels) must treat promote as a no-op
    execSync('RELEASE_UPDATER_CONF=/home/damon/fakebox/.release-updater.conf /home/damon/bin/release-updater', { timeout: 60000 });
    const cur = execSync('readlink /home/damon/fakebox/releases/current').toString().trim();
    cur.endsWith('/' + wantV) ? ok('promote is a no-op for the already-current canary') : fail('promote no-op', cur);
  } catch (e) {
    fail('unexpected', e.message.slice(0, 200));
    try { await page.screenshot({ path: SHOTS + '/error.png' }); } catch {}
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
