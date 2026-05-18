// tuser — Settings → Profile avatar iframe (signup-player?embed=settings)
// should pre-fill the username input from the user's handle. Previously
// session.username was null for client logins because the cookie didn't
// carry it; now the session re-reads handle from the client record.

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
  var email = 'tuser-avu-' + stamp + '@example.com';
  var pw = 'tuser1234';
  var username = 'tunm' + stamp.toString().slice(-6);  // unique username
  var displayName = 'TUser Display ' + stamp;

  await p.request.post(BASE + '/api/auth/signup', {
    data: { email: email, password: pw, tier: 'dev', displayName: displayName, username: username },
  });
  await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: pw } });

  // First: confirm session surfaces username.
  var sj = await (await p.request.get(BASE + '/api/auth/session')).json();
  if (sj.username === username) ok('session.username = ' + username);
  else fail('session.username missing/wrong', sj.username);

  // Now load the avatar iframe page directly and check the name input.
  await p.goto(BASE + '/signup-player?embed=settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  var inputVal = await p.evaluate(function() {
    var i = document.querySelector('input.form-input, #nameInput, input[placeholder*="name" i]');
    return i ? i.value : null;
  });
  ok('avatar nameInput value: "' + inputVal + '"');
  if (inputVal === username) ok('avatar nameInput pre-filled with username');
  else fail('avatar nameInput not pre-filled', 'wanted=' + username + ' got=' + inputVal);

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
