// tuser — Account section redesign:
//   * Profile section merged into Account (no separate sidebar entry)
//   * Header has title + subtitle + colored tier badge (top-right)
//   * Avatar | Details duet — equal height, side-by-side
//   * Details has Username→Display name, Email→Recovery, Plan+button,
//     Country→Region — each on one line
//   * Info section: bio, social networks, press outlets
//   * Email Addresses (one merged box)
//   * Password + Danger Zone
// Also screenshots the page for visual inspection.

var { chromium } = require('playwright');
var fs = require('fs');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

(async function() {
  var b = await chromium.launch({ headless: true });
  var p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })).newPage();

  var stamp = Date.now();
  var username = 'lost' + stamp.toString().slice(-4);
  var displayName = 'Lost Games';
  var email = 'acct-' + stamp + '@x.io';
  var pw = 'pwtest1234';
  await p.request.post(BASE + '/api/auth/signup', {
    data: { email: email, password: pw, tier: 'studio', username: username, displayName: displayName },
  });

  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3500);

  // 1. Sidebar: NO Profile entry (merged into Account).
  var navItems = await p.evaluate(function() {
    return Array.from(document.querySelectorAll('.stg-nav-item')).map(function(e){ return e.textContent.trim(); });
  });
  ok('sidebar nav: ' + navItems.join(' | '));
  if (navItems.some(function(t){ return /Profile/i.test(t); })) fail('Profile still in sidebar');
  else ok('Profile entry removed from sidebar');
  if (navItems.some(function(t){ return /Account/i.test(t); })) ok('Account entry present');
  else fail('Account entry missing');

  // 2. Header row: title + subtitle + tier badge with colored class.
  var head = await p.evaluate(function() {
    var title = document.querySelector('#sec-danger .stg-section-header');
    var desc = document.querySelector('#sec-danger .stg-section-desc');
    var badge = document.getElementById('accountTierBadge');
    var bs = badge ? getComputedStyle(badge) : null;
    return {
      title: title && title.textContent.trim(),
      desc: desc && desc.textContent.trim(),
      badgeText: badge && badge.textContent.trim(),
      badgeTier: badge && badge.getAttribute('data-tier'),
      badgeBg: bs && bs.backgroundColor,
      badgeTop: badge && Math.round(badge.getBoundingClientRect().top),
    };
  });
  if (head.title === 'Account') ok('header title = Account');
  else fail('header title wrong', head.title);
  if (/Manage your account/.test(head.desc || '')) ok('subtitle correct');
  else fail('subtitle wrong', head.desc);
  if (head.badgeTier === 'studio' && /STUDIO/i.test(head.badgeText)) ok('tier badge shows STUDIO');
  else fail('tier badge wrong', JSON.stringify(head));
  // Tier color must be the studio yellow (#ffe03d), not the generic primary.
  if (/255,\s*224,\s*61/.test(head.badgeBg || '')) ok('tier badge color = yellow (studio)');
  else fail('tier badge color wrong', head.badgeBg);

  // 3. Duet boxes — same height, side-by-side.
  var duet = await p.evaluate(function() {
    var av = document.querySelector('.stg-acct-avatar');
    var de = document.querySelector('.stg-acct-details');
    if (!av || !de) return null;
    var ar = av.getBoundingClientRect();
    var dr = de.getBoundingClientRect();
    return {
      avBox: { top: Math.round(ar.top), bottom: Math.round(ar.bottom), w: Math.round(ar.width) },
      deBox: { top: Math.round(dr.top), bottom: Math.round(dr.bottom), w: Math.round(dr.width) },
    };
  });
  if (!duet) { fail('duet boxes missing'); await b.close(); process.exit(1); }
  ok('duet: avatar ' + duet.avBox.w + 'px, details ' + duet.deBox.w + 'px');
  if (Math.abs(duet.avBox.bottom - duet.deBox.bottom) <= 2) ok('avatar + details boxes same height (bottom aligned)');
  else fail('boxes mismatched height', JSON.stringify(duet));
  if (duet.deBox.top === duet.avBox.top) ok('avatar + details boxes top-aligned (side-by-side)');
  else fail('boxes not on same row', JSON.stringify(duet));

  // 4. Details box has the four required one-liners with all expected fields.
  var details = await p.evaluate(function() {
    return {
      hasUsername: !!document.getElementById('accountUsername'),
      usernameVal: (document.getElementById('accountUsername') || {}).value,
      hasDisplay: !!document.getElementById('profileDisplayName'),
      displayVal: (document.getElementById('profileDisplayName') || {}).value,
      hasEmail: !!document.getElementById('accountEmail'),
      emailVal: (document.getElementById('accountEmail') || {}).value,
      hasRecovery: !!document.getElementById('accountRecoveryEmail'),
      hasPlanInfo: !!document.getElementById('planInfo'),
      planText: (document.getElementById('planInfo') || {}).textContent,
      hasManageBtn: !!document.getElementById('planManageBtn'),
      hasCountry: !!document.getElementById('profileCountry'),
      hasRegion: !!document.getElementById('profileTimezone'),
    };
  });
  if (details.hasUsername && details.hasDisplay) ok('username + display name fields present');
  else fail('username/display fields missing', JSON.stringify(details));
  if (details.usernameVal === username) ok('username pre-filled: ' + details.usernameVal);
  else fail('username not prefilled', details.usernameVal);
  if (details.displayVal === displayName) ok('display name pre-filled: ' + details.displayVal);
  else fail('display name not prefilled', details.displayVal);
  if (details.hasEmail && details.emailVal === email) ok('email pre-filled (readonly): ' + email);
  else fail('email field broken', JSON.stringify(details));
  if (details.hasRecovery) ok('recovery email field present');
  else fail('recovery email missing');
  if (details.planText && /Studio plan/i.test(details.planText)) ok('plan shown: ' + details.planText);
  else fail('plan label wrong', details.planText);
  if (details.hasManageBtn) ok('Manage Plan button present');
  else fail('Manage Plan missing');
  if (details.hasCountry && details.hasRegion) ok('country + region selects present');
  else fail('country/region missing', JSON.stringify(details));

  // 5. Info box (bio + social + press) exists below the duet.
  var info = await p.evaluate(function() {
    var infoBox = document.querySelector('.stg-acct-info');
    var bio = document.getElementById('profileBio');
    var plist = document.getElementById('profilePlatformsList');
    var press = document.getElementById('profilePressList');
    var save = document.getElementById('profileSaveBtn');
    var de = document.querySelector('.stg-acct-details');
    return {
      hasInfoBox: !!infoBox,
      infoTop: infoBox && Math.round(infoBox.getBoundingClientRect().top),
      duetBottom: de && Math.round(de.getBoundingClientRect().bottom),
      hasBio: !!bio,
      hasPlatforms: !!plist,
      hasPress: !!press,
      hasSave: !!save,
    };
  });
  if (info.hasInfoBox && info.infoTop > info.duetBottom) ok('info box sits below duet (top=' + info.infoTop + ' > duet bottom=' + info.duetBottom + ')');
  else fail('info box not positioned below duet', JSON.stringify(info));
  if (info.hasBio && info.hasPlatforms && info.hasPress) ok('info has bio + social + press');
  else fail('info missing fields', JSON.stringify(info));
  if (info.hasSave) ok('Save profile button present (top-right of info)');
  else fail('Save profile button missing');

  // 6. Bottom-section order — Email > Password > Danger Zone, each present once.
  var order = await p.evaluate(function() {
    var groups = Array.from(document.querySelectorAll('#sec-danger .stg-group, #sec-danger .stg-danger-group'));
    return groups.map(function(g) {
      var lbl = g.querySelector('.stg-group-label');
      return lbl && lbl.textContent.trim();
    });
  });
  ok('group order: ' + order.join(' / '));
  var hasEmail = order.some(function(g){ return /EMAIL ADDRESSES/i.test(g || ''); });
  var hasPwd = order.some(function(g){ return /PASSWORD/i.test(g || ''); });
  var hasDanger = order.some(function(g){ return /DANGER/i.test(g || ''); });
  if (hasEmail) fail('EMAIL ADDRESSES still in Account section — should be removed (Mailboxes covers it)');
  else ok('EMAIL ADDRESSES correctly absent (covered by sidebar Mailboxes entry)');
  if (hasPwd && hasDanger) ok('password + danger present');
  else fail('bottom-section groups incomplete', JSON.stringify(order));

  // 7. Tier badge click → opens Manage Plan modal.
  await p.evaluate(function() { document.getElementById('accountTierBadge').click(); });
  await p.waitForTimeout(600);
  var modalUp = await p.evaluate(function() { return !!document.getElementById('stgPlanModal'); });
  if (modalUp) ok('tier badge opens Plan modal');
  else fail('Plan modal did not open from tier badge');

  // 8. Take a proof screenshot.
  var shotDir = '/home/damon/platform/.runtime';
  fs.mkdirSync(shotDir, { recursive: true });
  var shot = shotDir + '/account-redesign-final-' + stamp + '.png';
  await p.evaluate(function() {
    var m = document.getElementById('stgPlanModal'); if (m) m.remove();
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: shot, fullPage: true });
  console.log('  shot →', shot);

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
