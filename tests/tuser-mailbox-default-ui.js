// tuser — Settings → Mailboxes must NOT offer a Delete button for the
// default studio mailbox (<slug>@gamoids.com) — it shows a "Default" tag.
// Only owner-created mailboxes get a Delete button.

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
  var p = await (await b.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } })).newPage();

  var stamp = Date.now();
  var userSlug = 'tstudio' + stamp.toString().slice(-6);
  var email = userSlug + '@t.io', password = 'tuser1234';
  fs.writeFileSync(path.join(INSTANCES_DIR, TENANT, 'storage', 'users', userSlug + '.json'), JSON.stringify({
    studio: userSlug, slug: userSlug, email: email, passwordHash: await bcrypt.hash(password, 10),
    plan: 'free', role: 'owner', displayName: userSlug, subscriptionStatus: 'active', createdAt: new Date().toISOString(),
  }, null, 2));
  await p.request.post(BASE + '/api/auth/login', { data: { email: email, password: password } });
  var slug = 'tco' + stamp.toString().slice(-6);
  await p.request.post(BASE + '/api/auth/upgrade-plan', { data: { tier: 'studio', studioSlug: slug } });
  await p.request.post(BASE + '/api/chat/external/addresses', { data: { address: slug + 'sales', assignedTo: [] } });

  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.evaluate(function(){ var n=document.getElementById('stgMailboxesNav'); if(n){n.style.display='';n.click();} });
  await p.waitForTimeout(1000);

  var view = await p.evaluate(function(sl) {
    var rows = Array.from(document.querySelectorAll('#mbxList .stg-mbx-row'));
    return rows.map(function(r) {
      var addr = (r.querySelector('div') || {}).textContent || '';
      return { addr: addr.trim(), hasDelete: !!r.querySelector('.mbx-del'), hasDefaultTag: /Default/.test(r.textContent) };
    });
  }, slug);
  console.log('  rows:', JSON.stringify(view));

  var primary = view.find(function(r){ return r.addr === slug + '@gamoids.com'; });
  var created = view.find(function(r){ return r.addr === slug + 'sales@gamoids.com'; });

  if (primary && !primary.hasDelete) ok('default mailbox has NO delete button'); else fail('default mailbox still has delete button', JSON.stringify(primary));
  if (primary && primary.hasDefaultTag) ok('default mailbox shows a "Default" tag'); else fail('default mailbox missing Default tag', JSON.stringify(primary));
  if (created && created.hasDelete) ok('created mailbox HAS a delete button'); else fail('created mailbox missing delete button', JSON.stringify(created));

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
