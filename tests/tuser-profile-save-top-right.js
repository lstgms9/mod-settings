// tuser — Profile section's Save button moved from bottom-right to
// top-right (sits in the section header bar next to "Profile" label).
// Verifies the button is positioned ABOVE the first form input
// (display-name field) so it's reachable without scrolling past
// every field.

var { chromium } = require('playwright');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

(async function() {
  var b = await chromium.launch({ headless: true });
  var p = await (await b.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } })).newPage();

  await p.request.post(BASE + '/api/auth/login', { data: { email: 'damon@gamoid.io', password: 'gamoid1234' } });
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // Activate the Profile section via the sidebar nav.
  await p.evaluate(function() {
    var hc = document.getElementById('hoverComm');
    if (hc) hc.style.display = 'none';
    var nav = document.querySelector('.stg-nav-item[data-section="profile"]');
    if (nav) nav.click();
  });
  await p.waitForTimeout(600);

  // Exactly one Save button — the old bottom-right one was removed.
  var saveCount = await p.evaluate(function() {
    return document.querySelectorAll('#profileSaveBtn').length;
  });
  if (saveCount === 1) ok('exactly one #profileSaveBtn exists');
  else fail('expected 1 save button, got ' + saveCount);

  // The button should be inside the section header bar (above the
  // form rows). Compare its Y position to the display-name input.
  var dims = await p.evaluate(function() {
    var btn = document.getElementById('profileSaveBtn');
    var dn = document.getElementById('profileDisplayName');
    var hdr = document.querySelector('#sec-profile .stg-section-header');
    if (!btn || !dn || !hdr) return null;
    var bR = btn.getBoundingClientRect();
    var dR = dn.getBoundingClientRect();
    var hR = hdr.getBoundingClientRect();
    return {
      btnTop: Math.round(bR.top), btnLeft: Math.round(bR.left), btnRight: Math.round(bR.right),
      inputTop: Math.round(dR.top),
      hdrTop: Math.round(hR.top), hdrLeft: Math.round(hR.left),
      windowWidth: window.innerWidth,
    };
  });
  if (!dims) { fail('missing element for dim check'); await b.close(); process.exit(1); }
  ok('measured: btn.top=' + dims.btnTop + ' input.top=' + dims.inputTop + ' hdr.top=' + dims.hdrTop);

  // Button must sit ABOVE the first form field.
  if (dims.btnTop < dims.inputTop) ok('save button is above the first form field (top-bar position)');
  else fail('save button is below the first field', 'btn.top=' + dims.btnTop + ' >= input.top=' + dims.inputTop);

  // Button must align vertically with the section header.
  if (Math.abs(dims.btnTop - dims.hdrTop) < 30) ok('save button shares the section-header row');
  else fail('save button not next to header', 'btn.top=' + dims.btnTop + ' hdr.top=' + dims.hdrTop);

  // Button must sit on the right half of the section container.
  if (dims.btnLeft > dims.hdrLeft + 100) ok('save button is to the RIGHT of the header label');
  else fail('save button not right-aligned', 'btn.left=' + dims.btnLeft + ' hdr.left=' + dims.hdrLeft);

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
