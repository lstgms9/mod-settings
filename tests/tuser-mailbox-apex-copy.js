// tuser — Settings must reflect the APEX mail model (no subdomain email):
//   - Account email shows <slug>@gamoids.com, NOT <user>@<slug>.gamoids.com
//   - Mailboxes section copy/hint reference the apex domain, not a subdomain
// (The website subdomain — <slug>.gamoids.com — is unrelated and stays.)

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

  var stamp = Date.now();
  var userSlug = 'tstudio' + stamp.toString().slice(-6);
  var email = userSlug + '@t.io';
  var password = 'tuser1234';
  fs.writeFileSync(path.join(INSTANCES_DIR, TENANT, 'storage', 'users', userSlug + '.json'), JSON.stringify({
    studio: userSlug, slug: userSlug, email: email, passwordHash: await bcrypt.hash(password, 10),
    plan: 'free', role: 'owner', displayName: userSlug, subscriptionStatus: 'active', createdAt: new Date().toISOString(),
  }, null, 2));

  await p.request.post(BASE + '/api/auth/login', { data: { email: email, password: password } });
  var studioSlug = 'tco' + stamp.toString().slice(-6);
  var up = await p.request.post(BASE + '/api/auth/upgrade-plan', { data: { tier: 'studio', studioSlug: studioSlug } });
  if (!up.ok()) { fail('upgrade-plan failed: ' + up.status(), await up.text()); await b.close(); process.exit(1); }
  ok('studio provisioned: ' + studioSlug);

  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // ── Account email = <slug>@gamoids.com (apex), never a subdomain ──
  var em = (await p.evaluate(function(){ var e=document.getElementById('accountEmail'); return e && e.textContent.trim(); })) || '';
  console.log('  accountEmail =', em);
  if (em === studioSlug + '@gamoids.com') ok('account email is apex: ' + em);
  else fail('account email not apex', 'got "' + em + '"');
  if (/@[a-z0-9-]+\.gamoids\.com$/i.test(em)) fail('account email is a SUBDOMAIN address', em);
  else ok('account email is not a subdomain address');

  // ── Mailboxes section copy + hint reference apex, not subdomain ──
  await p.evaluate(function(){ var n=document.getElementById('stgMailboxesNav'); if(n){n.style.display='';n.click();} });
  await p.waitForTimeout(900);
  var mbx = await p.evaluate(function(){
    var d=document.querySelector('#sec-mailboxes .stg-section-desc');
    var h=document.getElementById('mbxDomainHint');
    return { desc: d && d.textContent.trim(), hint: h && h.textContent.trim() };
  });
  console.log('  desc =', JSON.stringify(mbx.desc));
  console.log('  hint =', JSON.stringify(mbx.hint));
  if (mbx.desc && !/subdomain/i.test(mbx.desc)) ok('mailboxes desc has no "subdomain"');
  else fail('mailboxes desc still says subdomain', mbx.desc);
  if (mbx.hint && mbx.hint.indexOf('@gamoids.com') !== -1 && !/@[a-z0-9-]+\.gamoids\.com/i.test(mbx.hint))
    ok('mailbox create hint uses apex @gamoids.com: ' + mbx.hint);
  else fail('mailbox hint not apex', mbx.hint);

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
