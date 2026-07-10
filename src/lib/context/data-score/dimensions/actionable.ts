// Ac — Actionable
// Question: Can this object drive decisions, feed agents, or power downstream workflows?
//
// Sub-scores:
//   usageSnapshot non-null (T3 ran)           (+0.25)
//   key_columns populated within snapshot     (+0.15)  — intentional T3 double-weight
//   mappings or link proposals exist          (+0.20)
//   semanticModel non-null (T4 entity)        (+0.25)
//   at least one confirmed objectLink         (+0.15)
//
// The first two signals (usageSnapshot + key_columns) are both gated by T3.
// This is intentional: T3-absence carries a 0.40 effective penalty because
// usage intelligence is the primary gateway to actionability. Without it, the
// object cannot surface key columns, access frequency, co-object patterns, or
// filter usage. The reason strings distinguish the two to avoid reading as
// double-counting: one flags the structural absence, one flags the consequence.

import type { DimensionFn, DimensionResult } from '../types';

function hasKeyColumns(snapshot: { key_columns?: unknown } | null): boolean {
  if (!snapshot) return false;
  const kc = snapshot.key_columns;
  if (kc === null || kc === undefined) return false;
  if (Array.isArray(kc)) return kc.length > 0;
  if (typeof kc === 'object') return Object.keys(kc as object).length > 0;
  return false;
}

export const scoreActionable: DimensionFn = (input): DimensionResult => {
  const { usageSnapshot, proposedMappings, objectLinks, semanticModel } = input;
  const reasons: string[] = [];
  let score = 0;

  // T3 usage analysis
  if (usageSnapshot !== null) {
    score += 0.25;
  } else {
    reasons.push('No usage analysis performed (T3)');
  }

  // Key columns from usage (nested T3 signal)
  if (hasKeyColumns(usageSnapshot)) {
    score += 0.15;
  } else {
    reasons.push('No key columns identified from usage');
  }

  // Column mappings or inter-object relationships proposed
  const hasConfirmedLink = objectLinks.some((l) => l.status === 'confirmed');
  if (proposedMappings.length > 0 || hasConfirmedLink) {
    score += 0.20;
  } else {
    reasons.push('No column mappings or inter-object relationships');
  }

  // T4 semantic entity model
  if (semanticModel !== null) {
    score += 0.25;
  } else {
    reasons.push('No semantic entity model (T4)');
  }

  // Confirmed object relationships
  if (hasConfirmedLink) {
    score += 0.15;
  } else {
    reasons.push('No confirmed object relationships');
  }

  return { score: Math.min(score, 1.0), reasons };
};
