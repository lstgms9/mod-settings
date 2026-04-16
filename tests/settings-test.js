const { chromium } = require('playwright');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001';
const LIVE = 'https://okdun.ai/platform/settings';
const USERS_DIR = path.join(__dirname, '../../../instances/inst-dev/storage/users');

let passed = 0, failed = 0;
function ok(name) { passed++; console.log(`  PASS  ${name}`); }
function fail(name, reason) { failed++; console.log(`  FAIL  ${name} — ${reason}`); }

function httpReq(method, url, data, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = data ? JSON.stringify(data) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers: { 'Content-Type': 'application/json', 'X-Internal': 'platform', ...(headers || {}), ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), cookies, headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: raw, cookies, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// create a test user for 2FA tests
const testStudio = 'stgtest' + Date.now();
const testPass = 'testpass123';

async function createTestUser() {
  const bcrypt = require(path.join(__dirname, '../../../admin/platform-shell/node_modules/bcryptjs'));
  const hash = await bcrypt.hash(testPass, 10);
  const user = { studio: testStudio, email: testStudio + '@test.com', passwordHash: hash, avatar: 'ST', plan: 'free', displayName: testStudio, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(USERS_DIR, testStudio + '.json'), JSON.stringify(user, null, 2));
}

function cleanupTestUser() {
  try { fs.unlinkSync(path.join(USERS_DIR, testStudio + '.json')); } catch {}
  // clean setting records
  const indexFile = path.join(__dirname, '../../../instances/inst-dev/storage/_indexes/setting.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    const filtered = index.filter(r => r.studio !== testStudio && r.studio !== 'system');
    fs.writeFileSync(indexFile, JSON.stringify(filtered, null, 2));
  } catch {}
}

async function loginTestUser() {
  const r = await httpReq('POST', BASE + '/api/auth/login', { email: testStudio, password: testPass });
  const c = r.cookies.find(c => c.startsWith('ps_session='));
  return c ? c.split('=')[1] : null;
}

(async () => {
  console.log('\n=== mod-settings tests ===\n');

  // ── API tests ─────────────────────────────────────────────
  console.log('-- API tests --');

  // GET /prefs — internal user
  var r = await httpReq('GET', BASE + '/api/settings/prefs');
  r.body.tfa !== undefined ? ok('GET /prefs returns tfa field') : fail('GET /prefs', 'missing tfa');

  // PUT /prefs
  r = await httpReq('PUT', BASE + '/api/settings/prefs', { theme: 'dark', testKey: 'testVal' });
  r.body.ok ? ok('PUT /prefs saves') : fail('PUT /prefs', JSON.stringify(r.body));

  // GET /prefs round-trip
  r = await httpReq('GET', BASE + '/api/settings/prefs');
  r.body.testKey === 'testVal' ? ok('GET /prefs round-trip') : fail('GET /prefs round-trip', JSON.stringify(r.body));

  // PUT /ai-key
  r = await httpReq('PUT', BASE + '/api/settings/ai-key/openai', { key: 'sk-test-1234567890abcdef1234' });
  r.body.ok && r.body.masked.includes('cdef1234') ? ok('PUT /ai-key stores and masks') : fail('PUT /ai-key', JSON.stringify(r.body));

  // GET /prefs shows masked key
  r = await httpReq('GET', BASE + '/api/settings/prefs');
  var masked = r.body.aiKeys && r.body.aiKeys.openai;
  masked && masked.includes('cdef1234') && !masked.includes('sk-test') ? ok('GET /prefs masks AI key') : fail('GET masks key', masked);

  // DELETE /ai-key
  r = await httpReq('DELETE', BASE + '/api/settings/ai-key/openai');
  r.body.ok ? ok('DELETE /ai-key removes') : fail('DELETE /ai-key', JSON.stringify(r.body));
  r = await httpReq('GET', BASE + '/api/settings/prefs');
  (!r.body.aiKeys || !r.body.aiKeys.openai) ? ok('AI key gone after delete') : fail('AI key delete verify', JSON.stringify(r.body.aiKeys));

  // Export endpoint
  r = await httpReq('GET', BASE + '/api/settings/export');
  r.headers['content-type'] === 'application/zip' ? ok('Export returns zip') : fail('Export content-type', r.headers['content-type']);
  r.headers['content-disposition'] && r.headers['content-disposition'].includes('.zip') ? ok('Export filename') : fail('Export filename', r.headers['content-disposition']);

  // Email addresses endpoint
  r = await httpReq('GET', BASE + '/api/settings/email-addresses');
  r.body.domains && r.body.emails ? ok('GET /email-addresses returns domains+emails') : fail('GET /email-addresses', JSON.stringify(r.body));
  Array.isArray(r.body.domains) && Array.isArray(r.body.emails) ? ok('Email arrays are arrays') : fail('Email arrays', typeof r.body.domains);

  // ── 2FA tests (need real user) ────────────────────────────
  console.log('\n-- 2FA tests --');
  await createTestUser();
  var cookie = await loginTestUser();
  cookie ? ok('Test user login') : fail('Test user login', 'no cookie');

  if (cookie) {
    var authHeaders = { Cookie: 'ps_session=' + cookie };
    // no X-Internal for these — use cookie auth
    function authReq(method, url, data) {
      return new Promise((resolve, reject) => {
        const u = new URL(url);
        const body = data ? JSON.stringify(data) : null;
        const req = http.request({
          hostname: u.hostname, port: u.port, path: u.pathname + u.search,
          method, headers: { 'Content-Type': 'application/json', Cookie: 'ps_session=' + cookie, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }
        }, res => {
          let raw = '';
          res.on('data', d => raw += d);
          res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    }

    // TOTP setup
    var setup = await authReq('POST', BASE + '/api/settings/2fa/setup-totp');
    setup.qr && setup.secret ? ok('2FA TOTP setup returns QR + secret') : fail('2FA TOTP setup', JSON.stringify(setup));

    // Verify with wrong code
    var bad = await authReq('POST', BASE + '/api/settings/2fa/verify-totp', { code: '000000' });
    bad.error ? ok('2FA TOTP rejects bad code') : fail('2FA TOTP bad code', JSON.stringify(bad));

    // Verify with correct code using otpauth
    if (setup.secret) {
      const { TOTP, Secret } = require('otpauth');
      var totp = new TOTP({ issuer: 'OkDun', label: testStudio, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(setup.secret) });
      var code = totp.generate();
      var verify = await authReq('POST', BASE + '/api/settings/2fa/verify-totp', { code: code });
      verify.ok && verify.method === 'totp' ? ok('2FA TOTP verify with valid code') : fail('2FA TOTP verify', JSON.stringify(verify));

      // Check prefs show 2FA enabled
      var p = await authReq('GET', BASE + '/api/settings/prefs');
      p.tfa && p.tfa.enabled && p.tfa.method === 'totp' ? ok('2FA enabled in prefs') : fail('2FA in prefs', JSON.stringify(p.tfa));

      // Test login with 2FA
      var loginR = await httpReq('POST', BASE + '/api/auth/login', { email: testStudio, password: testPass });
      loginR.body.requires2fa && loginR.body.method === 'totp' ? ok('Login requires 2FA') : fail('Login 2FA gate', JSON.stringify(loginR.body));

      // Login with 2FA code
      code = totp.generate();
      loginR = await httpReq('POST', BASE + '/api/auth/login', { email: testStudio, password: testPass, tfaCode: code });
      loginR.body.ok ? ok('Login with 2FA code succeeds') : fail('Login 2FA code', JSON.stringify(loginR.body));

      // Login with bad 2FA code
      loginR = await httpReq('POST', BASE + '/api/auth/login', { email: testStudio, password: testPass, tfaCode: '999999' });
      loginR.body.error ? ok('Login rejects bad 2FA code') : fail('Login bad 2FA', JSON.stringify(loginR.body));

      // Disable 2FA
      var dis = await authReq('DELETE', BASE + '/api/settings/2fa');
      dis.ok ? ok('2FA disable') : fail('2FA disable', JSON.stringify(dis));
    }

    // Email 2FA setup
    var emailSetup = await authReq('POST', BASE + '/api/settings/2fa/setup-email');
    emailSetup.ok ? ok('2FA email setup sends code') : fail('2FA email setup', JSON.stringify(emailSetup));

    // Read code from user file
    var userFile = path.join(USERS_DIR, testStudio + '.json');
    var userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    if (userData.tfaPending && userData.tfaPending.code) {
      var emailCode = userData.tfaPending.code;
      // Verify wrong code
      var bad2 = await authReq('POST', BASE + '/api/settings/2fa/verify-email', { code: '000000' });
      bad2.error ? ok('2FA email rejects bad code') : fail('2FA email bad code', JSON.stringify(bad2));

      // Verify correct code
      var good = await authReq('POST', BASE + '/api/settings/2fa/verify-email', { code: emailCode });
      good.ok && good.method === 'email' ? ok('2FA email verify with correct code') : fail('2FA email verify', JSON.stringify(good));

      // Disable
      await authReq('DELETE', BASE + '/api/settings/2fa');
    }
  }

  // ── Browser tests ─────────────────────────────────────────
  console.log('\n-- Browser tests --');

  // Login as test user for browser
  var browser, context, page;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    if (cookie) {
      await context.addCookies([{ name: 'ps_session', value: cookie, domain: 'localhost', path: '/', secure: false }]);
    }
    page = await context.newPage();
    var pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Wait for shell to check session and show wrapper
    await page.waitForTimeout(1000);
    var shellState = await page.evaluate(() => {
      var sw = document.getElementById('shellWrapper');
      var as = document.getElementById('authScreen');
      return {
        shellDisplay: sw ? sw.style.display : 'N/A',
        authDisplay: as ? as.style.display : 'N/A',
        cookies: document.cookie,
      };
    });
    // debug: console.log('  shell:', shellState.shellDisplay, 'auth:', shellState.authDisplay);
    var shellVisible = shellState.shellDisplay === 'flex' || shellState.shellDisplay === '';
    shellVisible ? ok('Shell loaded (logged in)') : fail('Shell loaded', 'shell=' + shellState.shellDisplay + ' auth=' + shellState.authDisplay);

    // Navigate to settings
    await page.evaluate(() => { if (window.shellNav) shellNav('/settings', 'settings'); });
    await page.waitForTimeout(2000);

    // Verify settings loaded
    var settingsApp = await page.$('#settings-app');
    settingsApp ? ok('Settings app rendered') : fail('Settings app', 'not found');

    // Check sidebar loaded
    var sidebar = await page.$('.stg-sidebar');
    sidebar ? ok('Settings sidebar rendered') : fail('Settings sidebar', 'not found');

    // Check sections exist
    var sections = await page.$$('.stg-section');
    sections.length === 10 ? ok('All 10 sections present') : fail('Section count', sections.length);

    // Click AI nav item
    var aiNav = await page.$('.stg-nav-item[data-section="ai"]');
    if (aiNav) {
      await aiNav.click();
      await page.waitForTimeout(500);
      var aiActive = await page.$('#sec-ai.active');
      aiActive ? ok('AI section activates') : fail('AI section', 'not active after click');
    }

    // Click Privacy nav item
    var privNav = await page.$('.stg-nav-item[data-section="privacy"]');
    if (privNav) {
      await privNav.click();
      await page.waitForTimeout(500);
      var privActive = await page.$('#sec-privacy.active');
      privActive ? ok('Privacy section activates') : fail('Privacy section', 'not active');
    }

    // Back to appearance
    var appNav = await page.$('.stg-nav-item[data-section="appearance"]');
    if (appNav) {
      await appNav.click();
      await page.waitForTimeout(500);
    }

    // Toggle a switch
    var toggle = await page.$('.stg-toggle[data-key="scanlines"]');
    if (toggle) {
      var wasBefore = await toggle.evaluate(el => el.classList.contains('on'));
      await toggle.click();
      await page.waitForTimeout(300);
      var isAfter = await toggle.evaluate(el => el.classList.contains('on'));
      wasBefore !== isAfter ? ok('Toggle switch works') : fail('Toggle switch', 'class did not change');
    }

    // Click a seg button
    var segBtn = await page.$('.stg-seg[data-key="theme"] .stg-seg-btn[data-val="grey"]');
    if (segBtn) {
      await segBtn.click();
      await page.waitForTimeout(300);
      var isActive = await segBtn.evaluate(el => el.classList.contains('active'));
      isActive ? ok('Seg control switches') : fail('Seg control', 'not active');
    }

    // Font grid rendered
    var fontCards = await page.$$('.stg-font-card');
    fontCards.length > 0 ? ok('Font grid rendered (' + fontCards.length + ' fonts)') : fail('Font grid', 'empty');

    // Navigate to shortcuts
    var shortNav = await page.$('.stg-nav-item[data-section="shortcuts"]');
    if (shortNav) {
      await shortNav.click();
      await page.waitForTimeout(500);
      var shortcutRows = await page.$$('.stg-shortcut-row');
      shortcutRows.length > 0 ? ok('Shortcuts section has rows') : fail('Shortcuts', 'no rows');
    }

    // Navigate to storage
    var storNav = await page.$('.stg-nav-item[data-section="storage"]');
    if (storNav) {
      await storNav.click();
      await page.waitForTimeout(500);
      var exportBtn = await page.$('#exportBtn');
      exportBtn ? ok('Export button present') : fail('Export button', 'not found');
    }

    // Navigate to Account and check email group
    var dangerNav = await page.$('.stg-nav-item[data-section="danger"]');
    if (dangerNav) {
      await dangerNav.click();
      await page.waitForTimeout(1000);
      var emailGroup = await page.$('#emailGroup');
      emailGroup ? ok('Email addresses group present') : fail('Email group', 'not found');
      var emailContent = await page.$('#emailContent');
      var emailHTML = emailContent ? await emailContent.innerHTML() : '';
      emailHTML.length > 0 ? ok('Email content rendered') : fail('Email content', 'empty');
    }

    // CSS containment check — module root should NOT use position:fixed or inset:0
    var rootStyle = await page.$eval('#settings-app', el => {
      var cs = getComputedStyle(el);
      return { position: cs.position, inset: cs.inset, width: cs.width };
    });
    rootStyle.position !== 'fixed' ? ok('No position:fixed on root') : fail('CSS containment', 'position:fixed');

  } catch(e) {
    fail('Browser tests', e.message);
  } finally {
    if (browser) await browser.close();
  }

  // Cleanup
  cleanupTestUser();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
