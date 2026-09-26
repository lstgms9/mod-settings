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
// This runs against the LIVE hashoid tenant with a client whose email is NOT
// on the allowlist, so a green run can only come from the ROLE door:
//   /settings → Deploy nav revealed → Cut release + Promote on screen, and the
//   panel feed answers 200 (403 before the fix, and the nav stays hidden).
// The account (relpanel-admin@hashoid.test, role=admin) is the hashoid twin of
// the gamoid Rule Zero studio account in admin/test-lib/harness-login.js.
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

  await h.nav(SITE + '/settings');

  const nav = await h.waitUntil('the Deploy nav is revealed for an admin-role client', () => {
    const el = document.getElementById('stgDeployNav');
    return el ? getComputedStyle(el).display !== 'none' : false;
  });
  h.assert('the Deploy nav renders for a hashoid admin (role door, email not allowlisted)', nav === true);

  await h.page.click('#stgDeployNav');
  const cut = await h.waitUntil('the Cut release button is on screen', () => {
    const b = document.getElementById('relCut');
    return b ? b.offsetParent !== null : false;
  });
  h.assert('Cut release is rendered', cut === true);

  const promote = await h.waitUntil('the Promote button is on screen', () => {
    const b = document.getElementById('relPromote');
    return b ? b.offsetParent !== null : false;
  });
  h.assert('Promote is rendered', promote === true);

  // The panel feed itself: 403 (or "loading…" forever) is the old failure.
  const feed = await h.page.evaluate(() => (document.getElementById('relManifest') || {}).innerText || '');
  h.assert('the release feed answered (manifest or "no releases", not "loading…")',
    /Latest build/.test(feed) || /No releases/.test(feed));

  const pass = nav === true && cut === true && promote === true && /Latest build|No releases/.test(feed);
  await h.finish({ pass, extra: { site: HOST, feed: feed.slice(0, 60) } });
  console.log(pass ? '\nALL PASS' : '\nFAILED');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e && e.message); process.exit(1); });
