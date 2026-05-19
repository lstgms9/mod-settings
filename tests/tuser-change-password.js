// tuser — POST /api/auth/change-password. Endpoint was missing entirely
// (frontend silently 404'd with "connection error"). Verifies:
//   - wrong current password → 401
//   - correct current + short new (<8) → 400
//   - correct + valid new → 200, then re-login with NEW password works
//   - works for client-level signups (gamoid public path)

var { chromium } = require('playwright');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

(async function() {
  var b = await chromium.launch({ headless: true });
  var p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();

  var stamp = Date.now();
  var email = 'tuser-cp-' + stamp + '@x.io';
  var oldPw = 'oldpass1234';
  var newPw = 'newpass1234';

  // Sign up + login as a client-level (gamoid public signup) account.
  var sup = await p.request.post(BASE + '/api/auth/signup', {
    data: { email: email, password: oldPw, tier: 'dev', username: 'cpw' + stamp.toString().slice(-4) },
  });
  if (!sup.ok()) { fail('signup failed: ' + sup.status(), await sup.text()); await b.close(); process.exit(1); }
  await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: oldPw } });
  ok('client signed up + logged in: ' + email);

  // Wrong current password → 401.
  var bad = await p.request.post(BASE + '/api/auth/change-password', {
    data: { currentPassword: 'wrong-pwd-xxx', newPassword: newPw },
  });
  if (bad.status() === 401) ok('wrong current password rejected (401)');
  else fail('expected 401 for wrong current pwd, got ' + bad.status());

  // Valid current + short new → 400.
  var short = await p.request.post(BASE + '/api/auth/change-password', {
    data: { currentPassword: oldPw, newPassword: 'short' },
  });
  if (short.status() === 400) ok('short new password rejected (400)');
  else fail('expected 400 for short new pwd, got ' + short.status());

  // Valid change.
  var ok1 = await p.request.post(BASE + '/api/auth/change-password', {
    data: { currentPassword: oldPw, newPassword: newPw },
  });
  if (ok1.ok()) ok('password changed (200)');
  else fail('valid change rejected: ' + ok1.status(), await ok1.text());

  // Old password must NO LONGER work.
  var oldLogin = await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: oldPw } });
  if (oldLogin.status() === 401) ok('old password rejected after change');
  else fail('old password still works post-change: ' + oldLogin.status());

  // New password MUST work.
  var newLogin = await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: newPw } });
  if (newLogin.ok()) ok('new password accepted on re-login');
  else fail('new password does not work: ' + newLogin.status(), await newLogin.text());

  // Unauthenticated request → 401.
  var fresh = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
  var anon = await fresh.request.post(BASE + '/api/auth/change-password', {
    data: { currentPassword: 'x', newPassword: 'yyyy1234' },
  });
  if (anon.status() === 401) ok('unauthenticated request rejected (401)');
  else fail('anonymous request not 401: ' + anon.status());

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
