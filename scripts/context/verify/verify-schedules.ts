/**
 * Verification for CHANGE 3 (WS2): honest schedule display.
 * Run: npx tsx scripts/context/verify/verify-schedules.ts
 *
 * Confirms the two undeployed entries still appear but are labelled
 * manual / not-scheduled, and the 3 live rules are unchanged.
 */
import { HARVEST_SCHEDULES, relativeNextRun, getNextRuns } from '../../../src/lib/context/schedules';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('CHANGE 3 — schedule display honesty');

const LIVE = ['change_detect_daily', 't1_profile_weekly', 'estate_inventory_weekly'];
const MANUAL = ['t3_usage_weekly', 't4_semantic_weekly'];

const byId = new Map(HARVEST_SCHEDULES.map(s => [s.id, s]));

// All 5 entries remain visible.
check(
  'all 5 schedule entries still listed (nothing removed)',
  [...LIVE, ...MANUAL].every(id => byId.has(id)),
  `ids=${HARVEST_SCHEDULES.map(s => s.id).join(', ')}`,
);

// 3 live rules unchanged: deployment 'live', real cadence, upcoming runs.
for (const id of LIVE) {
  const s = byId.get(id)!;
  const rel = relativeNextRun(s);
  const runs = getNextRuns(s);
  check(
    `live: ${id} is deployment='live' with a real cadence`,
    s.deployment === 'live' && rel !== 'not scheduled' && runs.length === 3,
    `deployment=${s.deployment}, next="${rel}", upcoming=${runs.length}`,
  );
}

// 2 undeployed rules: visible, deployment 'manual', no asserted cadence.
for (const id of MANUAL) {
  const s = byId.get(id)!;
  const rel = relativeNextRun(s);
  const runs = getNextRuns(s);
  check(
    `manual: ${id} is visible, deployment='manual', not scheduled`,
    s.deployment === 'manual' && rel === 'not scheduled' && runs.length === 0,
    `deployment=${s.deployment}, next="${rel}", upcoming=${runs.length}`,
  );
}

console.log(failures === 0 ? '\n✅ verify-schedules: all checks passed' : `\n❌ verify-schedules: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
