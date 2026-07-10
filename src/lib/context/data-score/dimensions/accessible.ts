// A — Accessible
// Question: Can the platform reliably reach and harvest this object?
//
// Primary signal: tier timestamps as proof of successful access.
// Bulk T0 sweep jobs use scope:null (source-level) so lastJobs is empty for
// most estate objects — this formula does NOT rely on lastJobs as the primary
// signal. Instead, lastJobs is a bonus/penalty overlay.
//
// Base accumulation:
//   last_t0_at present             (+0.50)  — platform ever reached the object
//   last_t1_at OR last_t2_at       (+0.20)  — deeper SELECT-level access proven
//   source_altered_at present      (+0.15)  — upstream still signals changes
// Overlay (order of operations — applied AFTER base):
//   lastJobs non-empty AND recent succeeded  (+0.15 bonus)
//   lastJobs non-empty AND recent auth error (hard cap at 0.20)
// Final: Math.min(result, 1.0)

import type { DimensionFn, DimensionResult } from '../types';

const AUTH_ERROR_PATTERN = /auth|permission|unauthorized|forbidden|access.?denied/i;

export const scoreAccessible: DimensionFn = (input): DimensionResult => {
  const { object, lastJobs } = input;
  const reasons: string[] = [];
  let score = 0;

  // Step 1 — base from tier timestamps
  if (object.last_t0_at) {
    score += 0.50;
  } else {
    reasons.push('Never successfully inventoried — reachability unconfirmed');
  }

  if (object.last_t1_at || object.last_t2_at) {
    score += 0.20;
  } else {
    reasons.push('Only T0 inventory — SELECT-level access unconfirmed');
  }

  if (object.source_altered_at) {
    score += 0.15;
  } else {
    reasons.push('No upstream change signal detected');
  }

  // Step 2 — recency bonus from per-object targeted job (rare but informative)
  if (lastJobs.length > 0) {
    const recent = lastJobs[0];
    if (recent.status === 'done') {
      score += 0.15;
    } else if (recent.status !== 'done' && !recent.error) {
      reasons.push('Most recent targeted harvest did not succeed');
    }

    // Step 3 — auth-error hard cap (applied after bonus accumulation)
    if (recent.error && AUTH_ERROR_PATTERN.test(recent.error)) {
      const snippet = recent.error.slice(0, 80);
      reasons.push(`Active access failure: ${snippet}`);
      score = Math.min(score, 0.20);
    }
  }

  return { score: Math.min(score, 1.0), reasons };
};
