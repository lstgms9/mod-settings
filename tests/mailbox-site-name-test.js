#!/usr/bin/env node
// mailbox-site-name-test — SETTINGS → MAILBOXES SPEAKS AS THE SITE IT IS ON (hashoid audit 2026-10-20 #20: hashoid.io
// read 'Email addresses under your gamoid.io company domain. Assign mailboxes to Gamoid employees.').
//
//   node tests/mailbox-site-name-test.js
//
// Hermetic: initMailboxes lifted from public/app.js into the harness page, session + APIs stubbed.
//   · hashoid (companyMailDomain hashoid.io) → 'hashoid.io … Hashoid employees', hint marketing@hashoid.io
//   · gamoid (companyMailDomain gamoid.io) → the old sentence byte-for-byte
'use strict';
const path = require('path'), fs = require('fs');
const { harness } = require('/home/damon/platform/admin/test-lib/harness');

let H = null, fails = 0;
const t = (name, cond, d) => { if (!cond) fails++; H.assert(name, !!cond, d ? String(d).slice(0, 300) : undefined); return cond; };

(async () => {
  H = await harness({ test: 'mailbox-site-name', repo: 'mod-settings' });
  const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const a = APP.indexOf('  var _mbxSlug = null'), b = APP.indexOf('  function renderMailboxList() {');
  const src = APP.slice(a, b);
  const run = (slug, mail) => H.page.evaluate(([src, slug, mail]) => {
    document.body.innerHTML = '<nav id="stgMailboxesNav"></nav><div id="sec-mailboxes"><div class="stg-section-header"></div><div class="stg-section-desc"></div></div><div id="mbxDomainHint"></div>';
    window.INSTANCE_SLUG = slug; window.INSTANCE_MAIL = mail;
    window.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(u === '/api/auth/session' ? { slug, studio: 'owner1', role: 'admin', plan: 'free' } : []) });
    // eslint-disable-next-line no-new-func
    const init = new Function('renderMailboxList', 'populateTeamPicker', 'onMailboxCreate', src + '\nreturn initMailboxes;')(() => {}, () => {}, () => {});
    return init().then(() => ({ desc: document.querySelector('.stg-section-desc').textContent, hint: document.getElementById('mbxDomainHint').textContent }));
  }, [src, slug, mail]);

  let r = await run('hashoid', { companyMailDomain: 'hashoid.io', studioMailDomain: null, staffOnly: false });
  t('⚠ hashoid: the copy names hashoid.io and Hashoid — no gamoid anywhere',
    r.desc === 'Email addresses under your hashoid.io company domain. Assign mailboxes to Hashoid employees.' && !/gamoid/i.test(r.desc + r.hint), JSON.stringify(r));
  t('hashoid: the hint is marketing@hashoid.io', r.hint === 'e.g. marketing → marketing@hashoid.io', JSON.stringify(r));
  r = await run('gamoid', { companyMailDomain: 'gamoid.io', studioMailDomain: 'gamoids.com', staffOnly: true });
  t('⚠ gamoid: the sentence is byte-identical to before', r.desc === 'Email addresses under your gamoid.io company domain. Assign mailboxes to Gamoid employees.', JSON.stringify(r));
  const inst = JSON.parse(fs.readFileSync('/home/damon/platform/instances/hashoid/instance.json', 'utf8'));
  t('hashoid\'s instance sets companyMailDomain hashoid.io', inst.config.companyMailDomain === 'hashoid.io');

  await H.finish({ pass: fails === 0, extra: { tally: fails ? fails + ' failed' : 'all green' } });
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('mailbox-site-name-test: ' + (e && e.stack || e)); if (H) await H.finish({ pass: false }); process.exit(1); });
