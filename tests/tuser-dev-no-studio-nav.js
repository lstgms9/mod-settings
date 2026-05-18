// tuser — Studio section should be hidden from dev-tier viewers.
// "Studio" implies studio+ — devs (tier 1) shouldn't see it in the
// top nav. Build section stays for now (tier 1) but Phase 2 will
// gate it on game-team membership.

var { chromium } = require('playwright');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

async function readNavLabels(p) {
  return p.evaluate(function() {
    // Top-bar nav links — gamoid shell renders one anchor per section.
    var links = Array.from(document.querySelectorAll('.tabs a, .topnav a, nav a, .nav-tabs a, [data-section]'));
    var labels = [];
    links.forEach(function(l){
      var t = (l.textContent || '').trim();
      if (t) labels.push(t);
    });
    return labels;
  });
}

(async function() {
  var b = await chromium.launch({ headless: true });

  // ── Case 1: dev-tier client should NOT see Studio.
  var stamp = Date.now();
  var devEmail = 'tuser-dev-' + stamp + '@example.com';
  var pw = 'tuser1234';

  var devCtx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  var dp = await devCtx.newPage();
  var sup = await dp.request.post(BASE + '/api/auth/signup', {
    data: { email: devEmail, password: pw, tier: 'dev' },
  });
  if (!sup.ok()) { fail('signup failed: ' + sup.status()); await b.close(); process.exit(1); }
  await dp.request.post(BASE + '/api/auth/client-login', { data: { email: devEmail, password: pw } });
  await dp.goto(BASE + '/', { waitUntil: 'networkidle' });
  await dp.waitForTimeout(800);

  var devLabels = await readNavLabels(dp);
  ok('dev-tier nav: ' + JSON.stringify(devLabels));
  var sawStudio = devLabels.some(function(l){ return /\bStudio\b/i.test(l); });
  if (!sawStudio) ok('dev does NOT see Studio in nav');
  else fail('dev still sees Studio in nav', JSON.stringify(devLabels));

  // ── Case 2: studio-tier client (after upgrade) SHOULD see Studio.
  var slug = 'studnav' + stamp.toString().slice(-6);
  var up = await dp.request.post(BASE + '/api/auth/upgrade-plan', {
    data: { tier: 'studio', studioSlug: slug },
  });
  if (!up.ok()) { fail('upgrade failed: ' + up.status()); await b.close(); process.exit(1); }
  // Wait until session.tier flips AND nav refreshes via reload.
  await dp.goto(BASE + '/', { waitUntil: 'networkidle' });
  await dp.waitForTimeout(1000);
  var studioLabels = await readNavLabels(dp);
  ok('studio-tier nav: ' + JSON.stringify(studioLabels));
  var sawStudioNow = studioLabels.some(function(l){ return /\bStudio\b/i.test(l); });
  if (sawStudioNow) ok('studio DOES see Studio in nav');
  else fail('studio missing Studio in nav', JSON.stringify(studioLabels));

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
