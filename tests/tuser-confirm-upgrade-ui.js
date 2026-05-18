// tuser — End-to-end UI test for Settings → Manage Plan → STUDIO →
// slug picker → Confirm & Upgrade. Previously API-only tests passed
// while the UI Confirm button silently failed (clients couldn't be
// upgraded because /api/auth/upgrade-plan only read user-level files,
// not client records).
//
// Flow exercised:
//   1) Fresh client signup at dev tier.
//   2) Open /settings → click Manage Plan.
//   3) In the plan modal, click STUDIO's UPGRADE button.
//   4) Slug-picker modal appears; type a slug, wait for ✓ available.
//   5) Click Confirm & Upgrade.
//   6) Verify the upgrade actually happened — session.tier === 'studio'
//      and 5 mailboxes provisioned via /api/chat/my-addresses.

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
  var email = 'tuser-ui-' + stamp + '@example.com';
  var password = 'tuser1234';
  var wantSlug = 'uico' + stamp.toString().slice(-6);

  // 1) Sign up client at dev tier + log in (client-login).
  var sup = await p.request.post(BASE + '/api/auth/signup', {
    data: { email: email, password: password, tier: 'dev' },
  });
  if (!sup.ok()) { fail('signup failed: ' + sup.status(), await sup.text()); await b.close(); process.exit(1); }
  var li = await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: password } });
  if (!li.ok()) { fail('client-login failed: ' + li.status()); await b.close(); process.exit(1); }
  ok('client signed up + logged in: ' + email);

  // 2) Open /settings → Account section.
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.evaluate(function() {
    var hc = document.getElementById('hoverComm');
    if (hc) hc.style.display = 'none';
    var nav = document.querySelector('.stg-nav-item[data-section="account"]');
    if (nav) nav.click();
  });
  await p.waitForTimeout(500);

  // 3) Click Manage Plan.
  await p.evaluate(function() {
    var btn = document.getElementById('planManageBtn');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1000);
  var modalUp = await p.evaluate(function(){ return !!document.getElementById('stgPlanModal'); });
  if (modalUp) ok('Plan modal opened');
  else { fail('Plan modal did not open'); await b.close(); process.exit(1); }

  // 4) Click STUDIO's UPGRADE button.
  var studioClicked = await p.evaluate(function() {
    var btn = document.querySelector('#stgPlanModal button[data-tier="studio"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (studioClicked) ok('clicked STUDIO upgrade');
  else { fail('no studio upgrade button found in modal'); await b.close(); process.exit(1); }

  // 5) Slug-picker should appear. Type slug + wait for ✓ available.
  await p.waitForTimeout(800);
  var slugModalUp = await p.evaluate(function(){ return !!document.getElementById('stgSlugModal'); });
  if (slugModalUp) ok('slug-picker modal opened');
  else { fail('slug-picker modal did not open'); await b.close(); process.exit(1); }

  await p.evaluate(function(v) {
    var inp = document.getElementById('stgSlugIn');
    if (inp) {
      inp.value = v;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, wantSlug);

  // Debounced check runs at 300ms; wait for the Confirm button to enable.
  var enabled = false;
  for (var i = 0; i < 30; i++) {
    await p.waitForTimeout(200);
    enabled = await p.evaluate(function(){
      var c = document.getElementById('stgSlugConfirm');
      return c && !c.disabled;
    });
    if (enabled) break;
  }
  if (enabled) ok('Confirm & Upgrade enabled after slug check');
  else { fail('Confirm button stayed disabled — slug check never returned ok'); await b.close(); process.exit(1); }

  // 6) Click Confirm & Upgrade.
  await p.evaluate(function() {
    var c = document.getElementById('stgSlugConfirm');
    if (c) c.click();
  });

  // Wait for the FULL upgrade to settle — tier flipped AND all 5
  // mailboxes provisioned. The server flips tier to studio early in
  // upgrade-plan and then provisions mailboxes serially, so polling
  // only on session.tier races and catches mid-provision state.
  var newTier = null, mailboxes = 0;
  for (var j = 0; j < 40; j++) {
    await p.waitForTimeout(300);
    try {
      var sr = await p.request.get(BASE + '/api/auth/session');
      var sj = await sr.json();
      var tier = sj && (sj.tier || sj.plan);
      var mr = await p.request.get(BASE + '/api/chat/my-addresses');
      var ml = await mr.json();
      if (tier === 'studio' && Array.isArray(ml) && ml.length >= 5) {
        newTier = tier; mailboxes = ml.length; break;
      }
      newTier = tier; mailboxes = (Array.isArray(ml) ? ml.length : 0);
    } catch (_) {}
  }
  if (newTier === 'studio') ok('session.tier became studio after Confirm click');
  else fail('session.tier never flipped to studio', 'last seen=' + JSON.stringify(newTier));

  // 5 mailboxes provisioned. Use the PAGE's fetch (not page.request)
  // since reload may have rotated cookies in subtle ways.
  // Final read — by now both tier flip + 5 provisions are settled.
  var mr2 = await p.request.get(BASE + '/api/chat/my-addresses');
  var mlist = await mr2.json();
  if (Array.isArray(mlist) && mlist.length === 5) ok('5 mailboxes provisioned for ' + wantSlug);
  else fail('expected 5 mailboxes, got ' + (mlist && mlist.length) + ' — raw=' + JSON.stringify(mlist).slice(0, 200));

  if (Array.isArray(mlist) && mlist.length) {
    var domain = (mlist[0].address || '').split('@')[1] || '';
    if (domain.indexOf(wantSlug + '.') === 0) ok('mailboxes scoped to chosen slug: ' + domain);
    else fail('mailbox domain mismatch', domain);
  }

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
