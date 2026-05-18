// tuser — Settings → Account → "Current plan" sublabel must show the
// actual tier name, not the HTML default "Free". Tests two cases:
//   1) Client-level signup with tier=dev → "Dev plan"
//   2) User-level account with plan=free → "Free plan"

var { chromium } = require('playwright');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

async function readPlanLabel(p) {
  await p.evaluate(function() {
    var hc = document.getElementById('hoverComm');
    if (hc) hc.style.display = 'none';
    var nav = document.querySelector('.stg-nav-item[data-section="account"]');
    if (nav) nav.click();
  });
  await p.waitForTimeout(800);
  return p.evaluate(function() {
    var el = document.getElementById('planInfo');
    return el ? el.textContent.trim() : null;
  });
}

(async function() {
  var b = await chromium.launch({ headless: true });

  // ── Case 1: client-level signup at dev tier.
  var stamp = Date.now();
  var devEmail = 'tuser-plan-' + stamp + '@example.com';
  var devPassword = 'tuser1234';

  var cliCtx = await b.newContext({ serviceWorkers: 'block' });
  var cp = await cliCtx.newPage();
  var sup = await cp.request.post(BASE + '/api/auth/signup', {
    data: { email: devEmail, password: devPassword, tier: 'dev' },
  });
  if (!sup.ok()) { fail('signup failed: ' + sup.status(), await sup.text()); await b.close(); process.exit(1); }
  var ok1 = await cp.request.post(BASE + '/api/auth/client-login', { data: { email: devEmail, password: devPassword } });
  if (!ok1.ok()) { fail('client-login failed: ' + ok1.status()); await b.close(); process.exit(1); }

  await cp.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await cp.waitForTimeout(1500);
  var devLabel = await readPlanLabel(cp);
  ok('dev-client plan label: "' + devLabel + '"');
  if (devLabel === 'Dev plan') ok('dev-tier client sees "Dev plan"');
  else fail('expected "Dev plan", got "' + devLabel + '"');

  // ── Case 2: user-level account (damon@gamoid.io, plan=free).
  var damCtx = await b.newContext({ serviceWorkers: 'block' });
  var dp = await damCtx.newPage();
  var dli = await dp.request.post(BASE + '/api/auth/login', { data: { email: 'damon@gamoid.io', password: 'gamoid1234' } });
  if (!dli.ok()) { fail('damon login failed: ' + dli.status()); await b.close(); process.exit(1); }
  await dp.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await dp.waitForTimeout(1500);
  var damonLabel = await readPlanLabel(dp);
  ok('damon plan label: "' + damonLabel + '"');
  if (damonLabel && damonLabel.indexOf(' plan') !== -1) ok('damon label uses "<Tier> plan" format');
  else fail('damon label not in "<Tier> plan" format', damonLabel);

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
