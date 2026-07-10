// D — Discoverable
// Question: Can the platform find, identify, and describe this object?
//
// Weights: T0 present (+0.35) + T2 present (+0.30) + columns exist (+0.15)
//          + semantic description present (+0.20) = 1.00 max

import type { DimensionFn, DimensionResult } from '../types';

export const scoreDiscoverable: DimensionFn = (input): DimensionResult => {
  const { object, columns, latestSemanticCard } = input;
  const reasons: string[] = [];
  let score = 0;

  // T0 inventory — the object has been structurally harvested
  if (object.last_t0_at) {
    score += 0.35;
  } else {
    reasons.push('Not yet inventoried (T0)');
  }

  // T2 semantic enrichment — the object has been annotated
  if (object.last_t2_at) {
    score += 0.30;
  } else {
    reasons.push('No semantic enrichment (T2)');
  }

  // Structural columns discovered
  if (columns.length > 0) {
    score += 0.15;
  } else {
    reasons.push('No structural columns discovered');
  }

  // Semantic description available: either a semantic card was generated or
  // domain keywords were assigned during T2 annotation
  const domainKeywords = Array.isArray((object as { domain_keywords?: unknown }).domain_keywords)
    ? (object as { domain_keywords: unknown[] }).domain_keywords
    : [];
  if (latestSemanticCard !== null || domainKeywords.length > 0) {
    score += 0.20;
  } else {
    reasons.push('No semantic description or domain keywords');
  }

  return { score: Math.min(score, 1.0), reasons };
};
