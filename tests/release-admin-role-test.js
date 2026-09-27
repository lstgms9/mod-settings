#!/usr/bin/env node
// release-admin-role-test.js — the Deploy (release) panel's door is the ADMIN
// ROLE, not an email allowlist (Damon 2026-09-26, live on dev.hashoid.io).
//
// The bug: releaseAdmin() tested RELEASE_ADMIN_EMAILS only, so the panel was
// gamoid-shaped setup — a tenant whose admin logs in by username has no email
// on the record and got NO door. Admin is a DATA flag on the client record
// (records.data.role='admin') and auth.js builds the session from it, so the
// role is the general door on ANY tenant; the allowlist stays as the second.
//
// ⚠ THIS GATE WALKS DAMON'S PATH, NOT A TEST'S PATH (Rule Zero, 2026-09-26).
// hashoid points its Settings entry at the WALLET (shell.settingsMod), so
// loading /settings by hand — which is what the first version of this gate did
// — proved nothing: his page has no Deploy item at all. The gate now goes
// home → avatar menu → Deploy (the shell's user-menu entry) and asserts the
// panel is on screen there.
//
// It runs against the LIVE hashoid tenant with a client whose email is NOT on
// the allowlist, so a green run can only come from the ROLE door. The account
// (relpanel-admin@hashoid.test, role=admin) is the hashoid twin of the gamoid
// Rule Zero studio account in admin/test-lib/harness-login.js.
//
// Run: node modules/mod-settings/tests/release-admin-role-test.js
'use strict';
const { harness } = require('/home/damon/platform/admin/test-lib/harness');

const SITE = process.env.HSITE || 'https://dev.hashoid.io';
const GATE = process.env.HGATE || 'bt192';
const ADMIN = { email: 'relpanel-admin@hashoid.test', password: 'RelPanel9!Admin' };
const HOST = new URL(SITE).hostname;

function setCookies(res) {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  return all.filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

(async () => {
  // 1. The doors the browser needs: the site gate, and a session for a client
  //    whose role is admin and whose email is NOT on RELEASE_ADMIN_EMAILS.
  const gate = await fetch(SITE + '/_gate/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pass: GATE }),
  });
  const gateCookie = setCookies(gate);
  const login = await fetch(SITE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: gateCookie },
    body: JSON.stringify(ADMIN),
  });
  const sessionCookie = setCookies(login);
  if (!login.ok || !/okdun_session=/.test(sessionCookie)) {
    console.error('TEST ERROR: hashoid admin login failed — ' + login.status + ' ' + (await login.text()).slice(0, 120));
    process.exit(1);
  }

  const h = await harness({ test: 'release-admin-role', repo: 'mod-settings', longRun: true });
  const jar = [];
  const add = (name, value) => { if (value) jar.push({ name, value, domain: HOST, path: '/', secure: true }); };
  add('site_gate', (/site_gate=([^;]+)/.exec(gateCookie) || [])[1]);
  add('okdun_session', (/okdun_session=([^;]+)/.exec(sessionCookie) || [])[1]);
  // The profile is reused across runs and can hold an older hashoid session on
  // the PARENT domain (.hashoid.io) — getSession() tries every okdun_session
  // and takes the first that validates, so a leftover cookie silently answers
  // as the wrong account. Clear the jar, then seed ours.
  await h.ctx.clearCookies();
  await h.ctx.addCookies(jar);
  // Static module assets (index.html, app.js) live in a REUSED profile, so a
  // run can measure yesterday's panel — the first one-click run did exactly
  // that and failed on a button that was already on the server (2026-09-27).
  const cdp = await h.ctx.newCDPSession(h.page);
  await cdp.send('Network.clearBrowserCache');

  // ⚠ HERE IS THE RULE ZERO PART (Damon, 2026-09-26). Loading /settings by
  // hand proved nothing about HIS view: hashoid points its Settings entry at
  // the wallet (shell.settingsMod, 2026-09-22), so the page he opens has no
  // Deploy item at all. The gate walks the menu he actually clicks — home →
  // avatar → Deploy — so a green run means the door exists on the tenant he
  // is looking at, not on a URL only a test knows.
  await h.nav(SITE + '/');

  await h.page.click('#pubUserBtn');
  const entry = await h.waitUntil('the user menu carries a Deploy entry', () => {
    const a = document.getElementById('pubDeployItem');
    return !!a && a.offsetParent !== null ? a.getAttribute('href') : false;
  });
  h.assert('the avatar menu offers Deploy on hashoid', entry === '/settings#deploy');

  await h.page.click('#pubDeployItem');

  // ── ONE CLICK (Damon 2026-09-27): exactly one forward action, and its word
  // is Deploy. The old pair (Cut / Promote) must be GONE from the page — a
  // gate that only checks the new button exists would pass with the old ones
  // still sitting there.
  const one = await h.waitUntil('the Deploy button is on screen', () => {
    const b = document.getElementById('relDeploy');
    if (!b || b.offsetParent === null) return false;
    return { text: b.textContent.trim(), hasCut: !!document.getElementById('relCut'),
             hasPromote: !!document.getElementById('relPromote'),
             cutWords: /\bCut (version|a version)\b/.test(document.getElementById('sec-deploy').innerText) };
  });
  h.assert('one button, and its word is Deploy', one && one.text === 'Deploy', one);
  h.assert('no Cut button and no separate Promote button remain',
    one && !one.hasCut && !one.hasPromote && !one.cutWords, one);

  // The panel feed itself: 403 (or "loading…" forever) is the old failure.
  const feed = await h.page.evaluate(() => (document.getElementById('relManifest') || {}).innerText || '');
  h.assert('the release feed answered with the ONE-DEPLOYER shape (a number, not a bundle)',
    /Latest cut: v\d+/.test(feed) && /stable → v\d+/.test(feed) && !/dirty:|okdunio [0-9a-f]{6}/.test(feed));

  // ── PROGRESS (Damon, twice: no bare states). Cutting is now a number over
  // commits, so the work a person watches is the BOX's — the feed carries a
  // phase per box and the table says what it is doing. Asserted against a
  // stubbed payload so a box mid-apply is seen, not assumed.
  const statusBody = () => ({
    version: FD.version, stable: FD.stable, createdAt: new Date().toISOString(),
    versions: [{ version: FD.version, createdAt: new Date().toISOString(), sites: ['hashoid'] },
               { version: FD.version - 1, createdAt: new Date(Date.now() - 3600000).toISOString(), sites: ['hashoid'] }],
    boxes: { w1: { version: FD.version, site: 'hashoid', health: '200', phase: 'applying', uptime: 10, rolledBack: false, lastSeen: new Date().toISOString() } },
    buildLog: '',
  });
  const FD = { version: 99, stable: 99 };
  await h.page.route('**/api/settings/release/status', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(statusBody()),
  }));
  await h.page.click('#relRefresh');
  const doing = await h.waitUntil('a box mid-apply is visible in the table', () => {
    const el = document.getElementById('relBoxes');
    return el && /applying/.test(el.innerText) ? el.innerText : false;
  });
  h.assert('a box mid-apply shows what it is doing', /applying/.test(doing) && /hashoid/.test(doing) && /v99/.test(doing));
  // The numbered list IS the rollback surface: an older number carries its own
  // gesture, the stable one carries none.
  const rows = await h.waitUntil('the version list is the rollback surface', () => {
    const list = document.getElementById('relHistory');
    const old = list.querySelector('.rel-promote[data-v="98"]');
    const stable = list.querySelector('.rel-promote[data-v="99"]');
    if (!old || !stable) return false;
    return { oldText: old.textContent.trim(), oldDisabled: old.disabled, stableDisabled: stable.disabled };
  });
  h.assert('an older version offers its own rollback gesture, stable offers none',
    rows && rows.oldText === 'Roll back' && rows.oldDisabled === false && rows.stableDisabled === true, rows);

  // Confirms alone would be a dialog test — the gesture must POST the number.
  let promoted = null, deployed = false;
  await h.page.evaluate(() => {
    window.confirm = () => true;
    if (window.platform) window.platform.ui = Object.assign({}, window.platform.ui, { confirm: () => Promise.resolve(true) });
  });
  await h.page.route('**/api/settings/release/promote', (route) => {
    promoted = route.request().postDataJSON();
    FD.stable = 98;                            // what a real promote does
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stable: 98 }) });
  });
  await h.page.route('**/api/settings/release/deploy', (route) => {
    deployed = route.request().method();
    FD.version = 100; FD.stable = 100;        // what a real deploy does, so the panel settles
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: 100, stable: 100 }) });
  });

  // ⚠ waitUntil's condition runs INSIDE the page — it can see the DOM, never
  // a node-side capture. So each click waits on what the PANEL says, and the
  // request body is asserted from node afterwards.
  await h.page.click('.rel-promote[data-v="98"]');
  const rolledHint = await h.waitUntil('the rollback click settles the panel', () =>
    (/stable is v98/.test(document.getElementById('relDeployHint').innerText) ? document.getElementById('relDeployHint').innerText : false));
  h.assert('the rollback gesture promotes the OLD number', promoted && promoted.version === 98, promoted);
  h.assert('the panel reports the stable number after the rollback', /stable is v98/.test(String(rolledHint)), String(rolledHint).slice(0, 60));

  FD.version = 99; FD.stable = 99;
  await h.page.click('#relRefresh');
  await h.page.click('#relDeploy');
  const said = await h.waitUntil('the panel says what is happening, not a bare state', () =>
    (/stable is v100/.test(document.getElementById('relDeployHint').innerText) ? document.getElementById('relDeployHint').innerText : false));
  h.assert('Deploy cuts AND moves in one action (POST /release/deploy)', deployed === 'POST', deployed);
  h.assert('the hint reports the live version after the click', /v100/.test(String(said)), String(said).slice(0, 80));

  await h.page.unroute('**/api/settings/release/status');
  await h.page.unroute('**/api/settings/release/promote');
  await h.page.unroute('**/api/settings/release/deploy');

  const pass = entry === '/settings#deploy' && one && one.text === 'Deploy' && !one.hasCut && !one.hasPromote
    && /Latest cut: v\d+/.test(feed) && /stable → v\d+/.test(feed) && /applying/.test(String(doing))
    && rows && rows.oldText === 'Roll back' && rows.stableDisabled === true
    && promoted && promoted.version === 98 && deployed === 'POST' && /v100/.test(String(said));
  await h.finish({ pass, extra: { site: HOST, feed: feed.slice(0, 60) } });
  console.log(pass ? '\nALL PASS' : '\nFAILED');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e && e.message); process.exit(1); });
