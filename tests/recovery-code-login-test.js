// recovery-code-login-test.js — a 2FA recovery code must (1) log you in when
// your authenticator is unavailable and (2) work exactly ONCE (consumed).
// Tests the live okdunio login path against damon@gamoid.io on :3010.
//
// It injects a known recovery hash into the record, exercises login, and
// restores the record's recovery list afterward (non-destructive).
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const F = '/home/damon/platform/instances/gamoid/storage/users/damon.json';
let pass = 0, fail = 0;
const ok = t => { console.log(' PASS:', t); pass++; };
const ng = (t, e) => { console.log(' FAIL:', t, '-', e || ''); fail++; };

function login(tfaCode) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ email: 'damon@gamoid.io', password: 'gamoid192', tfaCode });
    const req = http.request({ host: '127.0.0.1', port: 3010, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.write(body); req.end();
  });
}

(async () => {
  const before = fs.readFileSync(F, 'utf8');
  const rec = JSON.parse(before);
  if (!rec.tfa || rec.tfa.method !== 'totp') { ng('damon has TOTP 2FA', 'no tfa'); console.log(`\n ${pass} PASSED, ${fail} FAILED`); process.exit(1); }
  ok('damon has TOTP 2FA active');

  // inject a known one-time recovery code
  const TEST_CODE = 'testrecov99';
  const hash = crypto.createHash('sha256').update(TEST_CODE).digest('hex');
  const savedRecovery = Array.isArray(rec.tfa.recovery) ? rec.tfa.recovery.slice() : [];
  rec.tfa.recovery = savedRecovery.concat([hash]);
  fs.writeFileSync(F, JSON.stringify(rec, null, 2));

  try {
    const wrong = await login('not-a-real-code');
    (wrong.status === 401) ? ok('a bogus 2FA/recovery code is rejected (401)') : ng('reject bogus', 'status ' + wrong.status);

    const first = await login(TEST_CODE);
    (first.status === 200 && /"ok":true/.test(first.body)) ? ok('recovery code logs in (200)') : ng('recovery login', 'status ' + first.status + ' ' + first.body.slice(0, 80));

    // it must be consumed — second use fails
    const second = await login(TEST_CODE);
    (second.status === 401) ? ok('the SAME recovery code is one-time (2nd use → 401)') : ng('one-time consume', 'status ' + second.status);

    // verify the hash was actually removed from disk
    const after = JSON.parse(fs.readFileSync(F, 'utf8'));
    (!(after.tfa.recovery || []).includes(hash)) ? ok('used code removed from the stored list') : ng('hash removed', 'still present');
  } finally {
    // restore original recovery list (drop our injected/consumed test code)
    const cur = JSON.parse(fs.readFileSync(F, 'utf8'));
    cur.tfa.recovery = savedRecovery;
    fs.writeFileSync(F, JSON.stringify(cur, null, 2));
  }

  // static: enrollment now mints + returns recovery codes
  const routes = fs.readFileSync('/home/damon/platform/modules/mod-settings/routes.js', 'utf8');
  /recoveryCodes = Array\.from\(\{ length: 8 \}/.test(routes) && /res\.json\(\{ ok: true, method: 'totp', recoveryCodes \}\)/.test(routes)
    ? ok('verify-totp mints 8 codes and returns them once') : ng('enroll generates codes', '');

  console.log(`\n ${pass} PASSED, ${fail} FAILED`);
  process.exit(fail ? 1 : 0);
})();
