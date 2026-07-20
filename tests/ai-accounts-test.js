// ai-accounts-test.js — AI-Accounts phase A, Settings side (playwright):
// a studio-tier user sees the GAME BUILD AI card, Connect starts the REAL
// `claude setup-token` relay (live OAuth URL appears in the UI), a garbage
// code surfaces the retry hint instead of hanging, Cancel restores the card,
// and nothing gets stored. Runs as gametest (NON-house studio) on dev :3010.
//   timeout 180 node /home/damon/platform/modules/mod-settings/tests/ai-accounts-test.js
const { chromium } = require('/home/damon/platform/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const BASE = 'http://localhost:3010', HOST = 'dev.gamoid.io';
const SHOTS = __dirname + '/shots-ai-accounts';

function req(method, p, body, token) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 3010, path: p, method,
      headers: { Host: HOST, Cookie: 'okdun_session=' + token, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      s => { let d = ''; s.on('data', c => d += c); s.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(d); } }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
function login(email, password) {
  return new Promise((res, rej) => {
    const b = JSON.stringify({ email, password });
    const r = http.request({ host: '127.0.0.1', port: 3010, path: '/api/auth/login', method: 'POST',
      headers: { Host: HOST, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      s => { let d = ''; s.on('data', c => d += c); s.on('end', () => { const m = (s.headers['set-cookie'] || []).join(';').match(/okdun_session=([^;]+)/); m ? res(m[1]) : rej(new Error('login failed: ' + d.slice(0, 80))); }); });
    r.write(b); r.end();
  });
}
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };
const card = () => document.querySelector('#aiSubGrid .stg-ai-card[data-sub="claude"]');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = await login('gametest@gamoid.test', 'gtest1234');
  const br = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await br.newContext({ viewport: { width: 1372, height: 900 } });
    await ctx.addCookies([{ name: 'okdun_session', value: t, domain: 'localhost', path: '/' }]);
    const page = await ctx.newPage();
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Tier-2 studio sees the AI Accounts section + the subscription card.
    const navShown = await page.evaluate(() => {
      const n = document.querySelector('.stg-nav-item[data-section="ai"]');
      return n && n.offsetParent !== null;
    });
    ok(navShown, 'AI Accounts nav visible for tier-2 studio');
    await page.click('.stg-nav-item[data-section="ai"]');
    await page.waitForTimeout(800);
    const cardState = await page.evaluate(c => {
      const el = document.querySelector('#aiSubGrid .stg-ai-card[data-sub="claude"]');
      if (!el) return null;
      return { text: el.textContent, hasConnect: !!el.querySelector('[data-subact="connect"]') };
    });
    ok(!!cardState, 'Claude subscription card rendered');
    ok(cardState && /Not connected/.test(cardState.text) && cardState.hasConnect, 'card shows Not connected + Connect');
    // Phase B cards: ChatGPT (device flow) + Grok (API key input).
    const b = await page.evaluate(() => {
      const gpt = document.querySelector('#aiSubGrid .stg-ai-card[data-sub="gpt"]');
      const grok = document.querySelector('#aiSubGrid .stg-ai-card[data-sub="grok"]');
      return {
        gpt: gpt && { text: gpt.textContent, hasConnect: !!gpt.querySelector('[data-subact="connect"]') },
        grok: grok && { hasInput: !!grok.querySelector('#aiSubKey-grok'), hasKeyBtn: !!grok.querySelector('[data-subact="key"]') },
      };
    });
    ok(b.gpt && /ChatGPT/.test(b.gpt.text) && b.gpt.hasConnect, 'ChatGPT card rendered with Connect');
    ok(b.grok && b.grok.hasInput && b.grok.hasKeyBtn, 'Grok card rendered with key input + Connect');
    // Grok bad key → live rejection, nothing stored.
    const badKey = await req('POST', '/api/settings/ai-accounts/grok/key', { key: 'xai-' + 'bogus'.repeat(10) }, t);
    ok(badKey && badKey.error, 'bogus grok key rejected by the live ping (' + String(badKey.error).slice(0, 40) + '…)');
    await page.screenshot({ path: SHOTS + '/1-not-connected.png' });

    // Connect → REAL setup-token spawns server-side → live OAuth URL relayed.
    await page.click('#aiSubGrid [data-subact="connect"]');
    let url = null;
    for (let i = 0; i < 25 && !url; i++) {
      await page.waitForTimeout(1000);
      url = await page.evaluate(() => {
        const a = document.querySelector('#aiSubGrid .stg-ai-card[data-sub="claude"] a[href*="oauth"]');
        return a ? a.href : null;
      });
    }
    ok(!!url && /^https:\/\/claude\./.test(url), 'live OAuth sign-in URL relayed into the UI (' + String(url).slice(0, 60) + '…)');
    await page.screenshot({ path: SHOTS + '/2-awaiting-code.png' });

    // Garbage code → retry hint (not a hang, not a stored connection).
    await page.fill('#aiSubCode-claude', 'garbage-code-xyz');
    await page.click('#aiSubGrid [data-subact="code"]');
    let hint = null;
    for (let i = 0; i < 30 && !hint; i++) {
      await page.waitForTimeout(1000);
      hint = await page.evaluate(() => {
        const el = document.querySelector('#aiSubGrid .stg-ai-card[data-sub="claude"]');
        const m = el && el.textContent.match(/code not accepted[^<]*/);
        return m ? m[0] : null;
      });
    }
    ok(!!hint, 'rejected code surfaces the retry hint (' + String(hint).slice(0, 50) + ')');
    await page.screenshot({ path: SHOTS + '/3-code-rejected.png' });

    // Cancel → back to Connect; nothing stored.
    await page.click('#aiSubGrid [data-subact="cancel"]');
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => {
      const el = document.querySelector('#aiSubGrid .stg-ai-card[data-sub="claude"]');
      return el ? { hasConnect: !!el.querySelector('[data-subact="connect"]') } : null;
    });
    ok(after && after.hasConnect, 'Cancel restores the Connect state');
    const acct = await req('GET', '/api/settings/ai-accounts', null, t);
    ok(acct && acct.connections && acct.connections.length === 0, 'no connection stored after the aborted flow');
    await page.screenshot({ path: SHOTS + '/4-cancelled.png' });
  } finally {
    await br.close();
  }
  console.log(fail ? ('\n' + fail + ' FAILED') : '\nALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
