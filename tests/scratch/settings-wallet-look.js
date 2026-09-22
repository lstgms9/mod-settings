// admin-sats-look (scratch) — WHAT DAMON SEES as the hashoid admin when he asks
// "where do I see the sats?" (2026-09-22): the storefront's Store Orders button →
// the seller's Orders list, whose rows now read the sats the invoice charged
// (amountSats) instead of the dollar value of the product.
//
//   node tests/scratch/admin-sats-look.js
'use strict';
const { harness } = require('/home/damon/platform/admin/test-lib/harness');

const SITE = process.env.STORE_SITE || 'https://hashoid.io';
const GATE = process.env.BETA || 'bt192';
const OWNER = { email: process.env.HASHOID_EMAIL || 'lstgms9@gmail.com', password: process.env.HASHOID_PW || 'Hashjakka9!' };

(async () => {
  const test = await harness({ test: 'admin-sats-look', repo: 'mod-store',
    allowErrors: [/wss:\/\/[^ ]*\/ws\/video/] });

  await test.nav(SITE + '/');
  await test.page.evaluate(async (pass) => {
    await fetch('/_gate/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pass: pass }) });
  }, GATE);
  const who = await test.page.evaluate(async (o) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(o) });
    return r.json();
  }, OWNER);
  console.log('   logged in as owner:', JSON.stringify(who).slice(0, 80));

  await test.nav(SITE + '/store/store');
  await test.waitUntil('the seller\'s Store Orders button is on the storefront', () =>
    document.getElementById('st-sf-adminorders') ? true : null, { timeout: 40000 });
  await test.page.evaluate(() => document.getElementById('st-sf-adminorders').click());

  const orders = await test.waitUntil('the Orders list lists orders with their money', () => {
    const rows = [...document.querySelectorAll('[data-admin-row]')];
    if (!rows.length) return null;
    const head = [...document.querySelectorAll('.st-orders-totals span')].map((s) => s.textContent.trim());
    const money = rows.map((r) => (r.querySelector('.st-order-money') || {}).textContent || '').filter(Boolean);
    if (!money.length) return null;
    return { head: head, count: rows.length, money: money.slice(0, 4),
      paid: money.filter((m) => /sats/.test(m)).length };
  }, { timeout: 40000 });

  console.log('   header: ' + JSON.stringify(orders.head));
  console.log('   rows:   ' + JSON.stringify(orders.money));
  test.assert('the Orders list shows money in sats (' + orders.paid + '/' + orders.count + ' rows)',
    orders.paid === orders.count && orders.paid > 0);
  test.assert('the revenue figure is sats too (' + JSON.stringify(orders.head) + ')',
    orders.head.some((h) => /sats/i.test(h)));
  await test.shot('admin-orders-sats');

  // ⚠ THE WALLET LIVES IN SETTINGS, NOT THE STORE (Damon 2026-09-22: "the money
  // comes from the store but the wallet is really the company's input … it had
  // just be in settings — wallet"). It is admin-only (the Settings nav item is
  // tier-gated; billpay refuses anyone who is not the wallet's owner), so this
  // look signs in as the owner and opens /settings → Wallet.
  // ⚠ THE WAY HE ACTUALLY GETS THERE (Damon 2026-09-22: "I do not see settings
  // when I go to top right and click on my icon"): the avatar menu must carry
  // the Settings entry for the wallet's owner, and the entry must land on the
  // page that holds the Wallet. Straight to the URL would test neither.
  await test.nav(SITE + '/');
  const door = await test.waitUntil('the avatar menu offers Settings to the owner', () => {
    const btn = document.getElementById('pubUserBtn');
    if (!btn) return null;
    btn.click();
    const menu = document.getElementById('pubUserMenu');
    const link = menu && menu.querySelector('a[href="/settings"]');
    return link ? { href: link.getAttribute('href'), text: link.textContent.trim() } : null;
  }, { timeout: 30000 });
  test.assert('⚠ the avatar menu has Settings for the owner (' + door.text + ' → ' + door.href + ')',
    door.href === '/settings' && /settings/i.test(door.text), 'this is the door Damon could not find');
  await test.page.evaluate(() => document.querySelector('#pubUserMenu a[href="/settings"]').click());
  await test.waitUntil('the shell lands on /settings', () =>
    location.pathname === '/settings' ? true : null, { timeout: 30000 });
  await test.settle(3000, 'the settings mod mounts after the shell');
  const probe = await test.page.evaluate(() => ({
    navItems: [...document.querySelectorAll('.stg-nav-item')].map((n) => (n.dataset.section || '') + (getComputedStyle(n).display === 'none' ? '(hidden)' : '')),
    sidebar: !!document.getElementById('stgSidebar'),
    settingsApp: !!document.getElementById('settings-app'),
    walletSec: !!document.getElementById('sec-wallet'),
    path: location.pathname,
    mods: [...document.querySelectorAll('[id^="view-"]')].map((e) => e.id).slice(0, 6),
  }));
  console.log('   settings probe: ' + JSON.stringify(probe));
  const wallet = await test.waitUntil('Settings shows the Wallet section for the owner', () => {
    const nav = document.querySelector('.stg-nav-item[data-section="wallet"]');
    if (!nav || getComputedStyle(nav).display === 'none') return null;
    nav.click();
    const card = document.querySelector('.stg-wallet-sats');
    if (!card) return null;
    const addr = document.querySelector('.stg-wallet-addr');
    const rows = [...document.querySelectorAll('.stg-wallet-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    return { received: card.textContent.trim(), addr: addr ? addr.textContent.trim() : '', rows: rows.slice(0, 4), n: rows.length };
  }, { timeout: 40000 });
  console.log('   wallet: ' + JSON.stringify(wallet));
  test.assert('⚠ Settings carries the wallet, in sats (' + wallet.received + ' → ' + wallet.addr + ')',
    /[\d,]+\s*sats/.test(wallet.received) && /@|ln/i.test(wallet.addr));

  // receive mints a real invoice into the wallet through the panel
  const minted = await test.waitUntil('the receive form mints an invoice', () => {
    const amt = document.getElementById('stg-wallet-recv-amt');
    if (!amt) return null;
    if (!amt.dataset.fired) {
      amt.dataset.fired = '1';
      amt.value = '500';
      document.getElementById('stg-wallet-recv').click();
      return null;
    }
    const bolt = document.querySelector('.stg-wallet-bolt');
    const err = document.querySelector('.stg-wallet-err');
    if (err) return { err: err.textContent.trim() };
    return bolt ? { bolt: bolt.textContent.trim().slice(0, 24) } : null;
  }, { timeout: 30000 });
  console.log('   minted: ' + JSON.stringify(minted));
  const dz = await test.page.evaluate(() => (document.getElementById('stg-wallet-recv-out') || {}).innerHTML || '');
  console.log('   recv-out: ' + String(dz).replace(/\s+/g, ' ').slice(0, 300));
  test.assert('⚠ …and receive mints a real invoice (' + JSON.stringify(minted) + ')',
    !!(minted && /^lnbc/.test(minted.bolt || '')), 'the panel must produce a payable invoice');
  const qrProbe = await test.page.evaluate(async () => {
    const img = document.querySelector('.stg-wallet-qr img');
    if (!img) return { none: true };
    try {
      const r = await fetch(img.getAttribute('src'), { credentials: 'include' });
      return { status: r.status, type: r.headers.get('content-type'), complete: img.complete, nw: img.naturalWidth };
    } catch (e) { return { err: String(e && e.message) }; }
  });
  console.log('   qr probe: ' + JSON.stringify(qrProbe));
  const painted = await test.waitUntil('the invoice QR paints', () => {
    const img = document.querySelector('.stg-wallet-qr img');
    return img && img.complete && img.naturalWidth > 0 ? { w: img.naturalWidth } : null;
  }, { timeout: 15000 });
  test.assert('⚠ …with a QR that paints (' + painted.w + 'px)', painted.w > 100);
  const forms = await test.page.evaluate(() => ({
    send: !!document.getElementById('stg-wallet-send'),
    amount: !!document.getElementById('stg-wallet-send-amt'),
    dest: !!document.getElementById('stg-wallet-send-dest'),
  }));
  test.assert('the send form is there (' + JSON.stringify(forms) + ')',
    forms.send && forms.amount && forms.dest);
  await test.shot('settings-wallet');

  await test.finish({ pass: true });
})().catch(e => { console.error(e); process.exit(1); });
