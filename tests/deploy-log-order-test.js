// deploy-log-order-test.js — the Settings deploy log must be READABLE and
// newest-first: one line per run (icon · when · outcome · what shipped), most
// recent at the top, with dates from the deploy script. No more cryptic
// append-order stream where the latest run is buried at the bottom.
const fs = require('fs');

let pass = 0, fail = 0;
const ok = t => { console.log(' PASS:', t); pass++; };
const ng = (t, e) => { console.log(' FAIL:', t, '-', e || ''); fail++; };

// Mirror of the summarizer in modules/mod-settings/routes.js /deploy/status.
function summarizeLog(raw) {
  const lines = raw.split('\n').filter(Boolean);
  const runs = [];
  for (const l of lines) {
    if (/── (deploy started|status)/.test(l) || runs.length === 0) runs.push([]);
    runs[runs.length - 1].push(l);
  }
  const tsOf = l => (l.match(/^\[([^\]]+)\]/) || [, ''])[1];
  const summarize = (run) => {
    const head = run.find(l => /── (deploy started|status)/.test(l)) || run[0] || '';
    const when = tsOf(head);
    const plat = (head.match(/platform=([0-9a-f]+)/) || [, '?'])[1];
    if (head.includes('── status')) return 'ℹ️  ' + when + '   status check   ·   platform ' + plat;
    const okl = run.find(l => l.includes('OK —'));
    const failed = run.find(l => /FAIL|halt|rsync error|\bERROR\b/i.test(l));
    const done = run.some(l => l.includes('deploy complete'));
    if (okl) {
      const m = okl.match(/okdunio:\s*([0-9a-f]+)\s*→\s*([0-9a-f]+).*health:\s*(\d+)/);
      const from = m ? m[1] : '?', to = m ? m[2] : '?', health = m ? m[3] : '?';
      const okd = (from === to) ? ('okdunio ' + to + ' (no change)') : ('okdunio ' + from + '→' + to);
      return (health === '200' ? '✅' : '⚠️') + '  ' + when + '   deployed   ·   platform ' + plat + '   ·   ' + okd + '   ·   w1 health ' + health;
    }
    if (failed) return '❌  ' + when + '   FAILED   ·   platform ' + plat;
    if (done)   return '✅  ' + when + '   complete   ·   platform ' + plat;
    return '⏳  ' + when + '   in progress…   ·   platform ' + plat;
  };
  return runs.reverse().slice(0, 12).map(summarize).join('\n');
}

// --- synthetic: run B appended after run A; B changed okdunio, A did not ---
const sample = [
  '[2026-06-03 21:04:20] ── deploy started (master okdunio=8afc7ca platform=aaa111) ──',
  '[2026-06-03 21:04:43] [w1] OK — okdunio: 8afc7ca → 8afc7ca  health: 200',
  '[2026-06-03 21:04:43] ── deploy complete ──',
  '[2026-06-04 19:51:46] ── deploy started (master okdunio=0851a51 platform=bbb222) ──',
  '[2026-06-04 19:52:30] [w1] OK — okdunio: 8afc7ca → 0851a51  health: 200',
  '[2026-06-04 19:52:30] ── deploy complete ──',
  '[2026-06-04 19:54:49] ── status (master okdunio=0851a51 platform=bbb222) ──',
].join('\n');
const out = summarizeLog(sample);
const top = out.split('\n');

// the status line (appended last) is newest → first
top[0].includes('status check') ? ok('newest entry (status) is first') : ng('newest first', top[0]);
// run B above run A
out.indexOf('platform bbb222') < out.indexOf('platform aaa111') ? ok('newer run shown above older run') : ng('order', '');
// one line per run (3 runs + status header counts as its own = 3 lines here: status, B, A)
(top.length === 3) ? ok('collapsed to one line per run (' + top.length + ' lines)') : ng('one line per run', top.length + ' lines');
// readable success line with health + sha change
/✅.*deployed.*okdunio 8afc7ca→0851a51.*health 200/.test(out) ? ok('run B is a readable success line (sha change + health)') : ng('readable success', out);
// no-change run reads "(no change)"
/okdunio 8afc7ca \(no change\)/.test(out) ? ok('no-okdunio-change run reads "(no change)"') : ng('no change label', '');
// cryptic raw step lines are gone (no "before:" / "starting —")
(!/before:|starting —/.test(out)) ? ok('cryptic per-step lines removed from the view') : ng('no raw steps', '');

// --- against the REAL log: top line is the most recent run, and it parsed ---
try {
  const real = summarizeLog(fs.readFileSync('/home/damon/platform/.runtime/deploy-gamoid.log', 'utf8'));
  const first = real.split('\n')[0] || '';
  /[✅⚠️❌⏳ℹ️]/.test(first) ? ok('real log: top line is a formatted summary: ' + first.slice(0, 80)) : ng('real log formatted', first);
} catch (e) { ng('real log readable', e.message); }

// --- date format wired into the deploy script (future runs get dates) ---
const sh = fs.readFileSync('/home/damon/platform/scripts/deploy-gamoid.sh', 'utf8');
/date '\+%Y-%m-%d %H:%M:%S'/.test(sh) ? ok('deploy-gamoid.sh logs full date+time') : ng('dated log', 'still time-only');

// --- route uses the summarizer ---
const routes = fs.readFileSync('/home/damon/platform/modules/mod-settings/routes.js', 'utf8');
/runs\.reverse\(\)\.slice\(0, 12\)\.map\(summarize\)/.test(routes) ? ok('route renders newest-first summarized runs') : ng('route summarizer', '');

console.log('\n ' + pass + ' PASSED, ' + fail + ' FAILED');
process.exit(fail ? 1 : 0);
