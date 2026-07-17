/**
 * Verification for CHANGE 2 (WS4): coverage / degrade instrumentation.
 * Run: npx tsx scripts/context/verify/verify-coverage.ts
 *
 * Exercises the pure degrade counter used by the T1 runner (harvest.ts) to emit
 * objects_degraded / columns_skipped. The estate rollup (getCoverageSummary in
 * reads.ts) is DB-backed and verified against the live DB / summary endpoint.
 */
import { countT1Degrade } from '../../../src/lib/context/coverage';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('CHANGE 2 — coverage / degrade counting');

// Profile stats blobs mirroring the three DatabricksAdapter.harvestProfile shapes.
const healthy = {
  partial: false,
  columns: {
    id: { data_type: 'bigint', null_rate: 0 },
    name: { data_type: 'string', null_rate: 0.1 },
  },
};
const partialWithHeavyCol = {
  partial: true,
  skipped_columns: { blob: { data_type: 'binary', reason: 'heavy_column_type' } },
  columns: {
    id: { data_type: 'bigint', null_rate: 0 },
    blob: { data_type: 'binary', skipped: true, skip_reason: 'heavy_column_type' },
  },
};
const unqueryableView = {
  partial: true,
  view_unqueryable: true,
  columns: {
    a: { data_type: 'string', skipped: true, skip_reason: 'view_query_failed' },
    b: { data_type: 'string', skipped: true, skip_reason: 'view_query_failed' },
  },
};
const deferredOnly = {
  partial: false,
  columns: {
    huge: { data_type: 'string', null_rate: 0.2, stats_deferred: true, defer_reason: 'wide_row_string' },
  },
};

const result = countT1Degrade([healthy, partialWithHeavyCol, unqueryableView, deferredOnly, null]);

// 3 of 4 objects are degraded (partial or view_unqueryable); healthy + deferred-only are not.
check(
  'objects_degraded counts partial + view_unqueryable objects only',
  result.objects_degraded === 2,
  `got ${result.objects_degraded} (expected 2)`,
);
// Skipped columns: 1 (heavy) + 2 (view) = 3; stats_deferred is NOT a skip.
check(
  'columns_skipped counts skipped:true columns, excludes stats_deferred',
  result.columns_skipped === 3,
  `got ${result.columns_skipped} (expected 3)`,
);

// A fully healthy run reports zero degrade (the "green T1 hides nothing" baseline).
const clean = countT1Degrade([healthy, healthy]);
check(
  'healthy-only run reports zero degrade',
  clean.objects_degraded === 0 && clean.columns_skipped === 0,
  `degraded=${clean.objects_degraded}, skipped=${clean.columns_skipped}`,
);

// Empty input is safe.
const empty = countT1Degrade([]);
check('empty input → zeros', empty.objects_degraded === 0 && empty.columns_skipped === 0);

console.log(failures === 0 ? '\n✅ verify-coverage: all checks passed' : `\n❌ verify-coverage: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
