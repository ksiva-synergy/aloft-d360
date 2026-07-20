/**
 * Verification for CHANGE 1 (WS1): T2 per-object cost model.
 * Run: npx tsx scripts/context/verify/verify-cost-model.ts
 *
 * Exercises the pure rolling-average helper. The DB wrapper
 * (estimateT2CostPerObject in queue.ts) is a thin findMany() over this helper.
 */
import {
  deriveT2CostPerObject,
  T2_COST_PER_OBJECT_FALLBACK_USD,
} from '../../../src/lib/context/cost-model';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// The known past job the task cites: 227 objects logged cost_usd = $15.88.
const KNOWN_OBJECTS = 227;
const KNOWN_COST = 15.88;
const KNOWN_JOB = { cost_usd: KNOWN_COST, objects_enriched: KNOWN_OBJECTS };

console.log('CHANGE 1 — T2 cost model');

// 1. Fallback is the corrected constant, NOT the old 0.003.
check(
  'fallback constant is ~0.07 (corrected), not 0.003',
  Math.abs(T2_COST_PER_OBJECT_FALLBACK_USD - 0.07) < 1e-9 && T2_COST_PER_OBJECT_FALLBACK_USD !== 0.003,
  `fallback=$${T2_COST_PER_OBJECT_FALLBACK_USD}/obj`,
);

// 2. Fewer than 3 usable samples → fallback used.
{
  const perObj = deriveT2CostPerObject([KNOWN_JOB, null, { cost_usd: 0, objects_enriched: 0 }]);
  const estimate = KNOWN_OBJECTS * perObj;
  const pctErr = Math.abs(estimate - KNOWN_COST) / KNOWN_COST;
  check(
    'sparse samples fall back, estimate within ±20% of the known $15.88 job',
    pctErr <= 0.2,
    `estimate=$${estimate.toFixed(2)} (${(pctErr * 100).toFixed(1)}% err)`,
  );
}

// 3. ≥3 usable samples → rolling avg(cost/obj), still within ±20%.
{
  const samples = [
    { cost_usd: 15.88, objects_enriched: 227 },
    { cost_usd: 7.1, objects_enriched: 100 },
    { cost_usd: 3.5, objects_enriched: 50 },
  ];
  const perObj = deriveT2CostPerObject(samples);
  const estimate = KNOWN_OBJECTS * perObj;
  const pctErr = Math.abs(estimate - KNOWN_COST) / KNOWN_COST;
  check(
    'rolling average from ≥3 samples is within ±20% of the known job',
    pctErr <= 0.2,
    `perObj=$${perObj.toFixed(4)}, estimate=$${estimate.toFixed(2)} (${(pctErr * 100).toFixed(1)}% err)`,
  );
}

// 4. The old constant would be ~23× too low — confirm we are nowhere near it.
{
  const oldEstimate = KNOWN_OBJECTS * 0.003;
  const newEstimate = KNOWN_OBJECTS * deriveT2CostPerObject([]);
  check(
    'new estimate is >10× the old $0.003/object model',
    newEstimate > oldEstimate * 10,
    `old=$${oldEstimate.toFixed(2)} vs new=$${newEstimate.toFixed(2)}`,
  );
}

// 5. Unusable-only samples (missing/zero fields) → fallback, not NaN/0.
{
  const perObj = deriveT2CostPerObject([
    { objects_enriched: 100 },
    { cost_usd: 5 },
    { cost_usd: 5, objects_enriched: 0 },
    {},
  ]);
  check(
    'all-unusable samples fall back cleanly (no NaN/0)',
    Number.isFinite(perObj) && Math.abs(perObj - T2_COST_PER_OBJECT_FALLBACK_USD) < 1e-9,
    `perObj=$${perObj}`,
  );
}

console.log(failures === 0 ? '\n✅ verify-cost-model: all checks passed' : `\n❌ verify-cost-model: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
