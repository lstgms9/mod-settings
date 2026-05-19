// tuser — Settings sidebar reorg:
//   Visible order for an owner/studio: Account, Appearance,
//   Privacy & Security, Notifications, AI Accounts (then Mailboxes
//   + Team if applicable). Hidden: Data&Storage, Shortcuts,
//   Language & Region, Revenue, AI Autopilot.
//
// For a tier-0 player: Privacy/Notifications/AI hidden too (those
// are tier-gated via data-min-tier).
//
// Notifications section: no Planner reminders, Billing alerts, or
// Quiet hours.

var { chromium } = require('playwright');
var BASE = 'http://localhost:3010';

var passed = 0, failed = 0;
function ok(t){ console.log('  PASS:', t); passed++; }
function fail(t, e){ console.log('  FAIL:', t, '-', e || ''); failed++; }

async function navTitles(p) {
  return p.evaluate(function() {
    return Array.from(document.querySelectorAll('.stg-nav-item')).filter(function(el) {
      return getComputedStyle(el).display !== 'none';
    }).map(function(el) {
      return (el.textContent || '').trim().replace(/^[\u{1F000}-\u{1FAFF}\u{2300}-\u{27FF}]\s*/u, '');
    });
  });
}

(async function() {
  var b = await chromium.launch({ headless: true });

  // --- Studio-tier viewer: sees all main entries.
  var stamp = Date.now();
  var ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  var p = await ctx.newPage();
  await p.request.post(BASE + '/api/auth/signup', { data: { email: 'sb-stu-' + stamp + '@x.io', password: 'pwtest1234', tier: 'studio', username: 'sbs' + stamp.toString().slice(-4) } });
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  var stuTitles = await navTitles(p);
  ok('studio sidebar: ' + stuTitles.join(' | '));
  // Hidden-for-now items should NOT appear.
  ['Data & Storage', 'Shortcuts', 'Language & Region', 'Revenue', 'AI Autopilot'].forEach(function(label) {
    if (stuTitles.indexOf(label) === -1) ok('hidden: ' + label);
    else fail(label + ' still visible');
  });
  // Visible items in correct relative order.
  var expectedOrder = ['Account', 'Appearance', 'Privacy & Security', 'Notifications', 'AI Accounts'];
  var positions = expectedOrder.map(function(n){ return stuTitles.indexOf(n); });
  var monotonic = positions.every(function(p, i){ return p !== -1 && (i === 0 || p > positions[i-1]); });
  if (monotonic) ok('order is correct: ' + expectedOrder.join(' → '));
  else fail('order broken', JSON.stringify(positions));

  // --- Player-tier (tier 0) viewer: tier-gated entries hidden.
  var stamp2 = Date.now() + 1;
  var ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  var p2 = await ctx2.newPage();
  await p2.request.post(BASE + '/api/auth/signup', { data: { email: 'sb-pla-' + stamp2 + '@x.io', password: 'pwtest1234', tier: 'player', username: 'sbp' + stamp2.toString().slice(-4) } });
  await p2.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2500);

  var plaTitles = await navTitles(p2);
  ok('player sidebar: ' + plaTitles.join(' | '));
  // Tier-1+ items hidden for tier-0.
  ['Privacy & Security', 'Notifications', 'AI Accounts'].forEach(function(label) {
    if (plaTitles.indexOf(label) === -1) ok('tier-gated for player: ' + label);
    else fail('player sees tier-gated item: ' + label);
  });
  // Player still sees Account + Appearance.
  ['Account', 'Appearance'].forEach(function(label) {
    if (plaTitles.indexOf(label) !== -1) ok('player still sees: ' + label);
    else fail('player missing baseline item: ' + label);
  });

  // --- Notifications section content checks (use studio viewer).
  await p.evaluate(function() {
    var nav = Array.from(document.querySelectorAll('.stg-nav-item')).find(function(el){ return el.dataset.section === 'notifications'; });
    if (nav) nav.click();
  });
  await p.waitForTimeout(600);
  var notif = await p.evaluate(function() {
    var sec = document.getElementById('sec-notifications');
    if (!sec) return null;
    var txt = sec.textContent;
    return {
      hasPlanner: /Planner reminders/i.test(txt),
      hasBilling: /Billing alerts/i.test(txt),
      hasQuiet: /Quiet hours/i.test(txt) || /Do not disturb/i.test(txt),
      hasEmailNotif: /Email notifications/i.test(txt),
    };
  });
  if (!notif.hasPlanner) ok('Planner reminders removed');
  else fail('Planner reminders still present');
  if (!notif.hasBilling) ok('Billing alerts removed');
  else fail('Billing alerts still present');
  if (!notif.hasQuiet) ok('Quiet hours removed');
  else fail('Quiet hours still present');
  if (notif.hasEmailNotif) ok('Email notifications row retained (sanity)');
  else fail('email notifications missing — over-deleted');

  await b.close();
  console.log('\n  ' + passed + ' PASSED, ' + failed + ' FAILED');
  process.exit(failed ? 1 : 0);
})();
