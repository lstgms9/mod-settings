// deploy-log-order-test.js — the Settings deploy log must read newest-run-first
// and carry dates (not bare times), so a multi-day log isn't a scrambled wall
// of timestamps and you can tell at a glance whether the latest run completed.
const fs = require('fs');
const assert = require('assert');

let pass = 0, fail = 0;
const ok = t => { console.log(' PASS:', t); pass++; };
const ng = (t, e) => { console.log(' FAIL:', t, '-', e || ''); fail++; };

// Mirror of the grouping in modules/mod-settings/routes.js /deploy/status.
function groupNewestFirst(raw) {
  const lines = raw.split('\n').filter(Boolean);
  const blocks = [];
  for (const l of lines) {
    if (l.includes('deploy started') || blocks.length === 0) blocks.push([l]);
    else blocks[blocks.length - 1].push(l);
  }
  return blocks.reverse().slice(0, 8).map(b => b.join('\n')).join('\n\n');
}

// --- synthetic multi-run log: run B is appended after run A ---
const sample = [
  '[2026-06-03 21:04:20] ── deploy started (platform=AAA) ──',
  '[2026-06-03 21:04:43] [w1] OK — health: 200',
  '[2026-06-03 21:04:43] ── deploy complete ──',
  '[2026-06-04 19:51:46] ── deploy started (platform=BBB) ──',
  '[2026-06-04 19:52:30] [w1] OK — health: 200',
  '[2026-06-04 19:52:30] ── deploy complete ──',
].join('\n');
const out = groupNewestFirst(sample);
const firstLine = out.split('\n')[0];
firstLine.includes('platform=BBB') ? ok('newest run (BBB, appended last) is shown FIRST') : ng('newest first', 'top line: ' + firstLine);
out.indexOf('BBB') < out.indexOf('AAA') ? ok('newer run appears above the older run') : ng('order', 'AAA above BBB');
// within a run, lines stay chronological (started above complete)
const firstBlock = out.split('\n\n')[0];
firstBlock.indexOf('deploy started') < firstBlock.indexOf('deploy complete') ? ok('within a run, started→complete stays in order') : ng('intra-run order', '');

// --- date format wired into the deploy script ---
const sh = fs.readFileSync('/home/damon/platform/scripts/deploy-gamoid.sh', 'utf8');
/date '\+%Y-%m-%d %H:%M:%S'/.test(sh) ? ok('deploy-gamoid.sh logs full date+time (YYYY-MM-DD HH:MM:SS)') : ng('dated log', 'still time-only');
!/date \+%H:%M:%S/.test(sh) ? ok('no bare time-only timestamp left') : ng('no bare time', 'time-only format still present');

// --- route actually uses the grouping (not the old slice(-40)) ---
const routes = fs.readFileSync('/home/damon/platform/modules/mod-settings/routes.js', 'utf8');
/blocks\.reverse\(\)/.test(routes) ? ok('route reverses into newest-first blocks') : ng('route grouping', '');
!/slice\(-40\)\.join/.test(routes) ? ok('old slice(-40) append-order read is gone') : ng('old read removed', 'slice(-40) still there');

console.log('\n ' + pass + ' PASSED, ' + fail + ' FAILED');
process.exit(fail ? 1 : 0);
