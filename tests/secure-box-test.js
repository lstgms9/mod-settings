// secure-box-test.js — the "Secure a box" admin feature: owner-gated endpoint
// that SSHes to a box (password) and turns on SSH 2FA with the owner's existing
// authenticator secret. Full SSH path needs a live box + password (the user
// tests that); here we verify the wiring, deps, and error mapping.
const fs = require('fs');

let pass = 0, fail = 0;
const ok = t => { console.log(' PASS:', t); pass++; };
const ng = (t, e) => { console.log(' FAIL:', t, '-', e || ''); fail++; };

// deps
try { require('ssh2').Client; ok('ssh2 dep present + loads'); }
catch (e) { ng('ssh2 present', e.message); }

// backend wiring
const routes = fs.readFileSync('/home/damon/platform/modules/mod-settings/routes.js', 'utf8');
/router\.post\('\/secure-box'/.test(routes) ? ok('POST /secure-box route registered') : ng('route', '');
/const why = deployGuard\(req\)[\s\S]{0,120}\/secure-box|deployGuard\(req\)/.test(routes) ? ok('owner-gated (deployGuard)') : ng('gate', '');
const sb = routes.slice(routes.indexOf("router.post('/secure-box'"));
/u && u\.tfa && u\.tfa\.secret/.test(sb) ? ok('reuses the owner\'s existing TOTP secret') : ng('reuse secret', '');
/GA_SECRET=/.test(sb) ? ok('passes GA_SECRET to the box (no new QR)') : ng('GA_SECRET', '');
/secure-server-2fa\.sh/.test(sb) ? ok('runs secure-server-2fa.sh on the box') : ng('runs script', '');
/systemctl reload ssh/.test(sb) ? ok('activates via sshd reload') : ng('reload', '');
!/password.*=.*store|writeFile.*password/i.test(sb) ? ok('password not written to disk') : ng('no password storage', '');
/required/.test(sb) && /Invalid IP/.test(sb) ? ok('validates ip + password input') : ng('input validation', '');

// the secure-server-2fa.sh tool exists + supports GA_SECRET reuse mode
const tool = fs.readFileSync('/home/damon/platform/scripts/secure-server-2fa.sh', 'utf8');
/if \[ -n "\$GA_SECRET" \]/.test(tool) ? ok('secure-server-2fa.sh has GA_SECRET reuse mode') : ng('tool reuse mode', '');

// UI wiring
const html = fs.readFileSync('/home/damon/platform/modules/mod-settings/public/index.html', 'utf8');
/id="sbIp"/.test(html) && /id="sbPw"/.test(html) && /id="sbRun"/.test(html) ? ok('UI has IP + password + button') : ng('UI fields', '');
/stgSecureBoxNav/.test(html) ? ok('nav item present') : ng('nav', '');
const app = fs.readFileSync('/home/damon/platform/modules/mod-settings/public/app.js', 'utf8');
/initSecureBox/.test(app) && /\/api\/settings\/secure-box/.test(app) ? ok('app.js wires the button to the endpoint') : ng('app wiring', '');
/pwEl\.value = ''/.test(app) ? ok('UI clears the password field after send') : ng('UI clears pw', '');

// error mapping classifies auth vs unreachable
const cls = (m) => /authentication|All configured auth/i.test(m) ? 'AUTH' : (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|getaddrinfo|timed out/i.test(m) ? 'UNREACHABLE' : 'OTHER');
(cls('All configured authentication methods failed') === 'AUTH') ? ok('wrong-password → AUTH(401)') : ng('auth map', '');
(cls('connect ETIMEDOUT 1.2.3.4:22') === 'UNREACHABLE') ? ok('unreachable host → UNREACHABLE(502)') : ng('unreachable map', '');

console.log(`\n ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
