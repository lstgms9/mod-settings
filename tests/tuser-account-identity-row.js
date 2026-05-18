// tuser — Settings → Account section should show display name + email
// at the top (identity row). Previously Account had no name display at
// all — users had to navigate to Profile to find it in an input.

var { chromium } = require('playwright');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

(async function() {
  var b = await chromium.launch({ headless: true });
  var ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  var p = await ctx.newPage();

  var stamp = Date.now();
  var email = 'tuser-id-' + stamp + '@example.com';
  var pw = 'tuser1234';
  var displayName = 'tuser display ' + stamp;

  // Sign up + log in as a dev with the chosen displayName.
  var sup = await p.request.post(BASE + '/api/auth/signup', {
    data: { email: email, password: pw, tier: 'dev', displayName: displayName },
  });
  if (!sup.ok()) { fail('signup failed: ' + sup.status(), await sup.text()); await b.close(); process.exit(1); }
  await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: pw } });

  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // Default section is Account — read the identity row.
  var dims = await p.evaluate(function() {
    var dn = document.getElementById('accountDisplayName');
    var em = document.getElementById('accountEmail');
    return { dn: dn && dn.textContent.trim(), em: em && em.textContent.trim() };
  });
  ok('account identity row: name="' + dims.dn + '" email="' + dims.em + '"');
  if (dims.dn === displayName) ok('display name shown matches the value chosen at signup');
  else fail('display name wrong', 'expected="' + displayName + '" got="' + dims.dn + '"');
  if (dims.em === email) ok('email matches');
  else fail('email wrong', 'expected=' + email + ' got=' + dims.em);

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
