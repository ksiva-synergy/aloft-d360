/**
 * Pinning test for the negative-existence guard in validateAgainstTrace().
 *
 * The repo has no unit-test runner wired up, so this is a self-contained script
 * runnable with the project's `tsx` dev dependency:
 *
 *   npx tsx src/lib/memory/synthesis/validate.negative-existence.test.ts
 *
 * It exits non-zero on failure so it can be dropped into CI later. It exercises
 * ONLY pure code (validate.ts -> entities.ts); no DB or Bedrock is touched.
 *
 * The two cases pin the exact regression that produced the "no country-level
 * column exists" phantom (session jlx394v5):
 *
 *   1. jlx394v5-style — a negative-existence claim with a trace that never
 *      produced an error token for that identifier. EXPECT valid:false.
 *   2. Mistral-style  — the SAME claim, but the trace contains a DEAD_END with
 *      an explicit UNRESOLVED_COLUMN token. EXPECT valid:true.
 *
 * The only difference between the two traces is the presence of the error
 * token, so a pass/fail flip pins the backing-token logic and nothing else.
 */

import assert from 'node:assert/strict';
import { validateAgainstTrace } from './validate';
import type { CandidateBullet } from './reflect';
import type { TraceWalkRow } from '@/lib/memory/trace/reconstruct';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXED_TS = new Date(0); // avoid nondeterministic timestamps

function node(
  nodeType: string,
  payload: Record<string, unknown>,
  id: string,
): TraceWalkRow {
  return {
    id,
    nodeType,
    payload,
    tokensIn:   null,
    tokensOut:  null,
    createdAt:  FIXED_TS,
    fromNodeId: null,
    edgeType:   null,
    depth:      0,
  };
}

// The phantom claim, identical across both cases. Typed as SCHEMA_MAP (the type
// the real phantom carried); the dotted identifier also lets the downstream
// SCHEMA_MAP branch pass once the guard is satisfied, so case 2 reaches valid:true.
const CANDIDATE: CandidateBullet = {
  ruleText:      'crew_contracts_data.crew_contracts has no country column',
  ruleType:      'SCHEMA_MAP',
  confidence:    0.92,
  rationale:     'inferred from describe_schema output',
  promptVersion: 'marcus_reflect_v3',
};

// An OUTCOME that names the table (so SCHEMA_MAP identifier overlap is satisfied)
// but does NOT contain any error token — a plain, possibly-truncated describe.
const describeOutcome = node(
  'OUTCOME',
  {
    toolName: 'describe_schema',
    responseSummary:
      'crew_contracts_data.crew_contracts columns: contract_id, seafarer_id, ' +
      'nationality, rank_code, sign_on_date, sign_off_date',
  },
  'n-outcome',
);

// A DEAD_END carrying the explicit error token that legitimately backs the
// non-existence claim.
const unresolvedColumnDeadEnd = node(
  'DEAD_END',
  {
    toolName:     'execute_tool',
    errorMessage: 'UNRESOLVED_COLUMN: COUNTRY cannot be resolved in crew_contracts_data.crew_contracts',
  },
  'n-deadend',
);

// ── Cases ───────────────────────────────────────────────────────────────────

// Case 1 — jlx394v5-style: negative claim, no error token anywhere. BLOCKED.
{
  const res = validateAgainstTrace(CANDIDATE, [describeOutcome]);
  assert.equal(res.valid, false, 'case 1: expected negative-existence claim to be blocked');
  assert.match(
    res.reason ?? '',
    /negative-existence/,
    'case 1: expected the negative-existence guard to be the blocking reason',
  );
  console.log('  ok  case 1 (no error token) -> blocked:', res.reason);
}

// Case 2 — Mistral-style: same claim, backed by UNRESOLVED_COLUMN. ADMITTED.
{
  const res = validateAgainstTrace(CANDIDATE, [describeOutcome, unresolvedColumnDeadEnd]);
  assert.equal(
    res.valid,
    true,
    `case 2: expected error-backed negative claim to pass, got reason="${res.reason ?? ''}"`,
  );
  console.log('  ok  case 2 (UNRESOLVED_COLUMN present) -> admitted');
}

console.log('\nvalidate.ts negative-existence guard: all cases passed');
