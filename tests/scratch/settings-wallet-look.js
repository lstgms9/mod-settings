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
  await test.nav(SITE + '/settings');
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
  test.assert('⚠ …and receive mints a real invoice (' + JSON.stringify(minted) + ')',
    !!(minted && /^lnbc/.test(minted.bolt || '')), 'the panel must produce a payable invoice');
  const painted = await test.waitUntil('the invoice QR paints', () => {
    const img = document.querySelector('.stg-wallet-qr img');
    return img && img.complete && img.naturalWidth > 0 ? { w: img.naturalWidth } : null;
  }, { timeout: 15000 });
  test.assert('⚠ …with a QR that paints (' + painted.w + 'px)', painted.w > 100);
  test.assert('the send form is there',
    !!document.getElementById('stg-wallet-send') && !!document.getElementById('stg-wallet-send-dest'));
  await test.shot('settings-wallet');

  await test.finish({ pass: true });
})().catch(e => { console.error(e); process.exit(1); });
