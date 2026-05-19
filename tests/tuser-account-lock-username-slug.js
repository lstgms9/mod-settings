// tuser — Settings → Account must show Username (and Studio Slug for
// studio viewers) as LOCKED static displays, not editable inputs.
// Identity rename is a manual ops job; the UI must not offer the
// affordance of "click to edit".

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
  var username = 'tulock' + stamp;
  var studioSlug = 'tustd-' + stamp;
  var email = 'tu-' + stamp + '@example.com';
  var pw = 'tuser1234';

  // Studio signup so both Username and Studio Slug locks are exercised.
  var sup = await p.request.post(BASE + '/api/auth/signup', {
    data: {
      email: email, password: pw, tier: 'studio',
      username: username, displayName: 'TU Display',
      studioName: 'TU Studio ' + stamp, studioSlug: studioSlug,
    },
  });
  if (!sup.ok()) { fail('signup failed: ' + sup.status(), await sup.text()); await b.close(); process.exit(1); }
  await p.request.post(BASE + '/api/auth/client-login', { data: { email: email, password: pw } });

  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  var probe = await p.evaluate(function() {
    var unEl = document.getElementById('accountUsername');
    var slugEl = document.getElementById('accountStudioSlug');
    var studioRow = document.getElementById('accountStudioRow');
    function info(el) {
      if (!el) return null;
      var cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.textContent || '').trim(),
        value: el.value,
        readOnly: el.readOnly === true,
        cursor: cs.cursor,
        borderStyle: cs.borderStyle,
        hasLockedClass: el.classList.contains('stg-acct-locked'),
      };
    }
    return {
      username: info(unEl),
      studioSlug: info(slugEl),
      studioRowDisplay: studioRow ? getComputedStyle(studioRow).display : null,
    };
  });

  // Username: must not be an editable input.
  if (probe.username && probe.username.tag !== 'INPUT') ok('username is a static element, not an input');
  else fail('username is still an INPUT', JSON.stringify(probe.username));
  if (probe.username && probe.username.hasLockedClass) ok('username has .stg-acct-locked styling');
  else fail('username missing locked class', JSON.stringify(probe.username));
  if (probe.username && probe.username.text === username) ok('username displays the actual value (' + username + ')');
  else fail('username text wrong', JSON.stringify(probe.username));
  if (probe.username && probe.username.cursor === 'not-allowed') ok('username cursor:not-allowed (no edit affordance)');
  else fail('cursor should be not-allowed', probe.username && probe.username.cursor);

  // Studio slug — visible + locked for studio viewer.
  if (probe.studioRowDisplay && probe.studioRowDisplay !== 'none') ok('studio row visible for studio-tier viewer');
  else fail('studio row hidden for studio viewer', probe.studioRowDisplay);
  if (probe.studioSlug && probe.studioSlug.tag !== 'INPUT') ok('studio slug is a static element');
  else fail('studio slug is an INPUT', JSON.stringify(probe.studioSlug));
  if (probe.studioSlug && probe.studioSlug.text === studioSlug) ok('studio slug displays "' + studioSlug + '"');
  else fail('studio slug text wrong', JSON.stringify(probe.studioSlug));
  if (probe.studioSlug && probe.studioSlug.hasLockedClass) ok('studio slug has .stg-acct-locked');
  else fail('studio slug missing locked class', JSON.stringify(probe.studioSlug));

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
