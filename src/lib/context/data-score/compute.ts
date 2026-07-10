// Orchestrator — builds a DimensionInput from ObjectAggregateResult fields,
// dispatches each dimension function via the registry, and assembles the final
// DataScoreResult via level.ts.
//
// The function accepts a superset type that includes latestSemanticStatus
// (exposed from the already-fetched PlatformContextSemantic row — no new query).

import type { PlatformContextJob, PlatformContextObject } from '@prisma/client';
import type { DataDimension, DimensionInput, DataScoreResult } from './types';
import { dimensionRegistry } from './registry';
import { assembleDataScoreResult } from './level';

// Minimal shape of ObjectAggregateResult fields consumed here.
// Matches the extended ObjectAggregateResult after the reads.ts integration.
export interface DataScoreInput {
  object: PlatformContextObject;
  columns: unknown[];
  latestSemanticCard: unknown | null;
  latestSemanticStatus: string | null;
  profileHistory: Array<{ drift?: unknown }>;
  freshness: { stale: boolean; guidance: string };
  proposedMappings: unknown[];
  objectLinks: Array<{ status: string }>;
  lastJobs: PlatformContextJob[];
  usageSnapshot: { key_columns?: unknown } | null;
  semanticModel: unknown | null;
}

export function computeDataScore(aggregate: DataScoreInput): DataScoreResult {
  const input: DimensionInput = {
    object: aggregate.object,
    columns: aggregate.columns,
    latestSemanticCard: aggregate.latestSemanticCard,
    latestSemanticStatus: aggregate.latestSemanticStatus,
    profileHistory: aggregate.profileHistory,
    freshness: aggregate.freshness,
    proposedMappings: aggregate.proposedMappings,
    objectLinks: aggregate.objectLinks,
    lastJobs: aggregate.lastJobs,
    usageSnapshot: aggregate.usageSnapshot,
    semanticModel: aggregate.semanticModel,
  };

  const results = {} as Record<DataDimension, { score: number; reasons: string[] }>;

  for (const [dim, fn] of dimensionRegistry) {
    results[dim] = fn(input);
  }

  return assembleDataScoreResult(results);
}
