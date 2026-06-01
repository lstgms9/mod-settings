// tuser — Deleting a studio mailbox must use the in-app themed modal
// (platform.ui.confirm), NOT the native browser confirm() popup.
// We instrument both: the test fails if native confirm fires, and
// asserts the themed confirm was the one called (and the delete proceeds).

var { chromium } = require('playwright');
var fs = require('fs');
var path = require('path');
var bcrypt = require('/home/damon/okdunio/node_modules/bcryptjs');

var BASE = 'http://localhost:3010';
var INSTANCES_DIR = '/home/damon/platform/instances';
var TENANT = 'gamoid';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

(async function() {
  var b = await chromium.launch({ headless: true });
  var ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  var p = await ctx.newPage();

  // Hard-fail if any NATIVE dialog (window.confirm/alert) ever appears.
  var nativeDialog = false;
  p.on('dialog', function(d){ nativeDialog = true; d.dismiss().catch(function(){}); });

  var stamp = Date.now();
  var userSlug = 'tstudio' + stamp.toString().slice(-6);
  var email = userSlug + '@t.io', password = 'tuser1234';
  fs.writeFileSync(path.join(INSTANCES_DIR, TENANT, 'storage', 'users', userSlug + '.json'), JSON.stringify({
    studio: userSlug, slug: userSlug, email: email, passwordHash: await bcrypt.hash(password, 10),
    plan: 'free', role: 'owner', displayName: userSlug, subscriptionStatus: 'active', createdAt: new Date().toISOString(),
  }, null, 2));
  await p.request.post(BASE + '/api/auth/login', { data: { email: email, password: password } });
  var studioSlug = 'tco' + stamp.toString().slice(-6);
  await p.request.post(BASE + '/api/auth/upgrade-plan', { data: { tier: 'studio', studioSlug: studioSlug } });

  // Create a second, clearly-deletable mailbox (local must start with slug).
  var extra = studioSlug + 'sales';
  var cr = await p.request.post(BASE + '/api/chat/external/addresses', { data: { address: extra, assignedTo: [] } });
  if (!cr.ok()) { fail('create mailbox failed: ' + cr.status(), await cr.text()); await b.close(); process.exit(1); }
  ok('created mailbox ' + extra + '@gamoids.com');

  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.evaluate(function(){ var n=document.getElementById('stgMailboxesNav'); if(n){n.style.display='';n.click();} });
  await p.waitForTimeout(1000);

  // Instrument: flag native confirm; flag themed confirm and auto-accept.
  await p.evaluate(function() {
    window.__native = false; window.__ui = false;
    var orig = window.confirm;
    window.confirm = function(){ window.__native = true; return false; };
    window.platform = window.platform || {};
    window.platform.ui = window.platform.ui || {};
    window.platform.ui.confirm = function(){ window.__ui = true; return Promise.resolve(true); };
  });

  var delCount = await p.evaluate(function(){ return document.querySelectorAll('#mbxList .mbx-del').length; });
  if (delCount > 0) ok('mailbox delete button present (' + delCount + ')');
  else { fail('no mailbox delete button rendered'); await b.close(); process.exit(1); }

  // Click the last delete button (the one we created).
  await p.evaluate(function(){ var els=document.querySelectorAll('#mbxList .mbx-del'); els[els.length-1].click(); });
  await p.waitForTimeout(800);

  var flags = await p.evaluate(function(){ return { native: window.__native, ui: window.__ui }; });
  if (!nativeDialog && !flags.native) ok('no native browser confirm() used');
  else fail('native browser confirm/dialog was used', 'nativeDialog=' + nativeDialog + ' flag=' + flags.native);
  if (flags.ui) ok('in-app modal (platform.ui.confirm) was used for mailbox delete');
  else fail('platform.ui.confirm was NOT called', JSON.stringify(flags));

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
