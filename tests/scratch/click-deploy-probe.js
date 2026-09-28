// scratch probe — Damon clicked Deploy and NOTHING happened. Click it the way
// he does: real admin session, real confirm (NOT stubbed), and watch what the
// page does. Rule Zero: his path, his account's door, live dev.
'use strict';
const { harness } = require('/home/damon/platform/admin/test-lib/harness');
const SITE = 'https://dev.hashoid.io', GATE = 'bt192';
const ADMIN = { email: 'relpanel-admin@hashoid.test', password: 'RelPanel9!Admin' };
const HOST = new URL(SITE).hostname;
const ck = (r) => (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']).filter(Boolean).map(c => c.split(';')[0]).join('; ');
(async () => {
  const gate = await fetch(SITE + '/_gate/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass: GATE }) });
  const gc = ck(gate);
  const login = await fetch(SITE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', cookie: gc }, body: JSON.stringify(ADMIN) });
  const sc = ck(login);
  const h = await harness({ test: 'click-deploy-probe', repo: 'mod-settings', longRun: true });
  h.page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  h.page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 160)); });
  const jar = [];
  const add = (n, v) => { if (v) jar.push({ name: n, value: v, domain: HOST, path: '/', secure: true }); };
  add('site_gate', (/site_gate=([^;]+)/.exec(gc) || [])[1]);
  add('okdun_session', (/okdun_session=([^;]+)/.exec(sc) || [])[1]);
  await h.ctx.clearCookies(); await h.ctx.addCookies(jar);
  // ⚠ NO cache clear this time: the point of the fix is that a plain visit —
  // a warm browser, the shell's cache-first service worker — gets the CURRENT
  // panel. Clearing the cache is what hid the staleness from the earlier gate.
  const assetUrls = [];
  h.page.on('request', r => { if (/\/_m\/.*\.(js|css|html)/.test(r.url())) assetUrls.push(r.url().replace('https://dev.hashoid.io', '')); });
  // Watch every release call the page makes.
  const calls = [];
  h.page.on('request', r => { if (/release\/(deploy|promote|cut|status)/.test(r.url())) calls.push(r.method() + ' ' + r.url().split('/api/settings')[1]); });
  h.page.on('response', async r => { if (/release\/(deploy|promote|cut)/.test(r.url())) calls.push('  → ' + r.status() + ' ' + (await r.text().catch(() => '')).slice(0, 80)); });

  await h.nav(SITE + '/');
  await h.page.click('#pubUserBtn');
  await h.page.click('#pubDeployItem');
  await h.waitUntil('the panel is up', () => { const b = document.getElementById('relDeploy'); return !!b && b.offsetParent !== null; });
  console.log('ASSET URLS:', JSON.stringify(assetUrls.slice(0, 3)));
  console.log('BUTTON:', await h.page.evaluate(() => document.getElementById('relDeploy').textContent.trim()));
  console.log('HINT:', await h.page.evaluate(() => document.getElementById('relDeployHint').innerText));
  console.log('platform.ui:', await h.page.evaluate(() => Object.keys((window.platform && window.platform.ui) || {}).join(',')));

  await h.page.click('#relDeploy');
  await h.page.waitForTimeout(1500);
  console.log('AFTER CLICK — button:', await h.page.evaluate(() => document.getElementById('relDeploy').textContent.trim()));
  console.log('AFTER CLICK — hint:', await h.page.evaluate(() => document.getElementById('relDeployHint').innerText));
  console.log('AFTER CLICK — overlays:', await h.page.evaluate(() => Array.from(document.querySelectorAll('[class*=pui-]')).map(e => e.className + '|' + (e.offsetParent ? 'visible' : 'hidden') + '|' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60)).join(' || ') || 'none'));
  console.log('CALLS:', JSON.stringify(calls));
  // The real thing: press Confirm the way Damon would.
  await h.page.click('.pui-confirm-actions .pui-btn-primary');
  await h.page.waitForTimeout(6000);
  return h.page.click('.pui-confirm-actions .pui-btn:not(.pui-btn-primary)').then(() => console.log('CANCELLED confirm (no version burned)'));
  console.log('CONFIRMED — button:', await h.page.evaluate(() => document.getElementById('relDeploy').textContent.trim()));
  console.log('CONFIRMED — hint:', await h.page.evaluate(() => document.getElementById('relDeployHint').innerText));
  console.log('CONFIRMED — manifest:', await h.page.evaluate(() => document.getElementById('relManifest').innerText.replace(/\s+/g, ' ').slice(0, 120)));
  console.log('CONFIRMED — boxes:', await h.page.evaluate(() => document.getElementById('relBoxes').innerText.replace(/\s+/g, ' ').slice(0, 200)));
  console.log('CALLS2:', JSON.stringify(calls));
  await h.page.screenshot({ path: '/tmp/click-deploy-confirmed.png' });
  await h.finish({ pass: true });
  process.exit(0);
})().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
