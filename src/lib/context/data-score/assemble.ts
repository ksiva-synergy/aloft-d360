// Single source of truth for raw-data → DimensionInput mapping.
// Both getObjectAggregate (per-object) and computeSourceDistribution (batch) MUST use this function.
// Do not duplicate this logic.
//
// The function accepts the same field set that getObjectAggregate assembles from its DB queries
// and maps it into the DataScoreInput shape that computeDataScore (and every dimension function)
// expects. This is intentionally identity-mapping today — the value is the single callsite:
// any future schema evolution only needs to be fixed here, not in two separate paths.

import type { PlatformContextJob, PlatformContextObject } from '@prisma/client';
import type { DataScoreInput } from './compute';

export interface RawObjectData {
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

export function assembleDimensionInput(raw: RawObjectData): DataScoreInput {
  return {
    object: raw.object,
    columns: raw.columns,
    latestSemanticCard: raw.latestSemanticCard,
    latestSemanticStatus: raw.latestSemanticStatus,
    profileHistory: raw.profileHistory,
    freshness: raw.freshness,
    proposedMappings: raw.proposedMappings,
    objectLinks: raw.objectLinks,
    lastJobs: raw.lastJobs,
    usageSnapshot: raw.usageSnapshot,
    semanticModel: raw.semanticModel,
  };
}
