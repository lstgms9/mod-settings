// Settings → Account: the studio identity chip (studio logo/name, top-right)
// must open THIS studio's profile. The bug: it linked to /explore/thingi with no
// id, so it opened whatever thing was last selected (usually a game) instead of
// the studio. Now it targets the studio thing explicitly.
const { chromium } = require('/home/damon/platform/node_modules/playwright');
const { loginToken, TENANT } = require('/home/damon/platform/admin/test-lib/gamoid-auth');
const STUDIO_USER = { email: 'oliverbranch27@gmail.com', password: 'blu12345' }; // "Blu" studio account
let pass = 0, fail = 0;
const ok = t => { console.log('  PASS:', t); pass++; };
const ng = (t, e) => { console.log('  FAIL:', t, e || ''); fail++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([{ name: 'okdun_session', value: await loginToken(STUDIO_USER), domain: 'localhost', path: '/' }]);
  const p = await ctx.newPage();
  // Pre-seed a GAME as the "last selected thing" — the bug would send the chip here.
  await p.addInitScript(() => { try { localStorage.setItem('platform-selected-thing', '507474e1-3758-44d4-978f-a89b8e06f173'); } catch (e) {} });
  await p.goto(TENANT + '/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => { const c = document.getElementById('accountStudioChip'); return c && c.style.display !== 'none' && c.getAttribute('href') && c.getAttribute('href') !== '#'; }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);

  const r = await p.evaluate(async () => {
    const c = document.getElementById('accountStudioChip');
    const href = c ? c.getAttribute('href') : null;
    const m = href && href.match(/_highlight=([^&]+)/);
    const targetId = m ? decodeURIComponent(m[1]) : null;
    // Simulate the click side-effect (sets the selected thing) and read it back.
    if (c && c.onclick) try { c.onclick(); } catch (e) {}
    const selected = (() => { try { return localStorage.getItem('platform-selected-thing'); } catch (e) { return null; } })();
    // Resolve the kind of whatever the chip points at.
    let kind = null;
    if (targetId) {
      const things = await fetch('/_api/storage/list?type=thing').then(r => r.json()).catch(() => []);
      const t = Array.isArray(things) ? things.find(x => x.id === targetId) : null;
      kind = t ? t.kind : null;
    }
    return { href, targetId, selected, kind };
  });

  (r.href && /\/thingi\?_highlight=/.test(r.href)) ? ok(`chip links to a thing profile (${r.href})`) : ng('chip href has no thing id', r.href);
  (r.kind === 'studio') ? ok(`chip points at a STUDIO thing (kind=${r.kind})`) : ng('chip does not point at a studio', `kind=${r.kind}, id=${r.targetId}`);
  (r.selected === r.targetId && r.selected !== '507474e1-3758-44d4-978f-a89b8e06f173') ? ok('clicking selects the studio (not the pre-seeded game)') : ng('click selected the wrong thing', r.selected);

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('test error:', e.message); process.exit(1); });
