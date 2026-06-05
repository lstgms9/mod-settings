// totp-issuer-brand-test.js — the Authenticator entry must show the VERTICAL's
// brand (Gamoid, Appoid…), not "OkDun", which end users won't recognise. The
// issuer is derived from the tenant slug (req.instanceSlug). Issuer/label are
// display-only in the otpauth URI and don't affect codes.
const fs = require('fs');
const { TOTP, Secret } = require('/home/damon/platform/node_modules/otpauth');

let pass = 0, fail = 0;
const ok = t => { console.log(' PASS:', t); pass++; };
const ng = (t, e) => { console.log(' FAIL:', t, '-', e || ''); fail++; };

// Mirror of the issuer derivation in routes.js setup-totp.
const brand = (slug) => (slug && slug !== 'inst-dev') ? (slug.charAt(0).toUpperCase() + slug.slice(1)) : 'OkDun';

(brand('gamoid') === 'Gamoid') ? ok('gamoid → "Gamoid"') : ng('gamoid brand', brand('gamoid'));
(brand('appoid') === 'Appoid') ? ok('appoid → "Appoid"') : ng('appoid brand', brand('appoid'));
(brand('farmoid') === 'Farmoid') ? ok('farmoid → "Farmoid" (future verticals work)') : ng('farmoid brand', brand('farmoid'));
(brand('inst-dev') === 'OkDun') ? ok('inst-dev (platform) → "OkDun" fallback') : ng('inst-dev fallback', brand('inst-dev'));
(brand(undefined) === 'OkDun') ? ok('no slug → "OkDun" fallback') : ng('no-slug fallback', brand(undefined));

// the otpauth URI actually carries the vertical brand, not OkDun
const uri = new TOTP({ issuer: brand('gamoid'), label: 'damon', algorithm: 'SHA1', digits: 6, period: 30, secret: new Secret({ size: 20 }) }).toString();
/^otpauth:\/\/totp\/Gamoid:damon\?/.test(uri) ? ok('URI label reads "Gamoid:damon"') : ng('URI label', uri.slice(0, 60));
/issuer=Gamoid(&|$)/.test(uri) ? ok('URI issuer param = Gamoid') : ng('URI issuer param', uri);
!/OkDun/.test(uri) ? ok('no "OkDun" in a gamoid enrollment URI') : ng('no OkDun leak', uri);

// the endpoint derives issuer from req.instanceSlug (not hardcoded)
const routes = fs.readFileSync('/home/damon/platform/modules/mod-settings/routes.js', 'utf8');
const block = routes.slice(routes.indexOf("router.post('/2fa/setup-totp'"), routes.indexOf('const uri = totp.toString()'));
/const slug = req\.instanceSlug/.test(block) && /issuer,/.test(block) ? ok('setup-totp derives issuer from req.instanceSlug') : ng('endpoint uses slug', '');
!/issuer: 'OkDun'/.test(block) ? ok('hardcoded issuer:\'OkDun\' removed from setup-totp') : ng('hardcode removed', '');

console.log(`\n ${pass} PASSED, ${fail} FAILED`);
process.exit(fail ? 1 : 0);
