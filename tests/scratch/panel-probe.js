// scratch probe — why does the rollback click not settle the panel?
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
  const h = await harness({ test: 'panel-probe', repo: 'mod-settings', longRun: true });
  h.page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  h.page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
  const jar = [];
  const add = (n, v) => { if (v) jar.push({ name: n, value: v, domain: HOST, path: '/', secure: true }); };
  add('site_gate', (/site_gate=([^;]+)/.exec(gc) || [])[1]);
  add('okdun_session', (/okdun_session=([^;]+)/.exec(sc) || [])[1]);
  await h.ctx.clearCookies(); await h.ctx.addCookies(jar);
  const cdp = await h.ctx.newCDPSession(h.page); await cdp.send('Network.clearBrowserCache');
  await h.nav(SITE + '/');
  await h.page.click('#pubUserBtn');
  await h.page.click('#pubDeployItem');
  await h.waitUntil('panel up', () => !!document.getElementById('relDeploy'));
  const FD = { version: 99, stable: 99 };
  await h.page.route('**/api/settings/release/status', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ version: FD.version, stable: FD.stable, createdAt: new Date().toISOString(),
      versions: [{ version: 99, createdAt: new Date().toISOString(), sites: ['hashoid'] }, { version: 98, createdAt: new Date().toISOString(), sites: ['hashoid'] }],
      boxes: {}, buildLog: '' }) }));
  await h.page.route('**/api/settings/release/promote', (r) => { console.log('POST promote body=', r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stable":98}' }); });
  await h.page.click('#relRefresh');
  await h.page.waitForTimeout(500);
  console.log('HISTORY:', await h.page.evaluate(() => document.getElementById('relHistory').innerHTML.replace(/\s+/g, ' ').slice(0, 400)));
  console.log('HINT before:', await h.page.evaluate(() => document.getElementById('relDeployHint').innerText));
  await h.page.evaluate(() => { window.confirm = () => true; if (window.platform) window.platform.ui = Object.assign({}, window.platform.ui, { confirm: () => Promise.resolve(true) }); });
  console.log('platform.ui?', await h.page.evaluate(() => !!(window.platform && window.platform.ui && window.platform.ui.confirm)));
  await h.page.click('.rel-promote[data-v="98"]');
  await h.page.waitForTimeout(2500);
  console.log('HINT after:', await h.page.evaluate(() => document.getElementById('relDeployHint').innerText));
  console.log('BTN after:', await h.page.evaluate(() => { const b = document.querySelector('.rel-promote[data-v="98"]'); return b ? b.textContent + ' disabled=' + b.disabled : 'gone'; }));
  await h.finish({ pass: true });
  process.exit(0);
})().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
