import type { PlatformContextJob, PlatformContextObject } from '@prisma/client';

// ── Dimension identity ──────────────────────────────────────────────────────

export type DataDimension = 'discoverable' | 'accessible' | 'trusted' | 'actionable';

// Deterministic tie-breaking order for argmin: first dimension in this list
// that shares the minimum score becomes the gating_dimension.
// Reflects logical dependency chain: discover → access → trust → act.
export const DIMENSION_PRIORITY: readonly DataDimension[] = [
  'discoverable',
  'accessible',
  'trusted',
  'actionable',
] as const;

// ── Per-dimension result ────────────────────────────────────────────────────

export interface DimensionResult {
  score: number;      // 0..1 inclusive
  reasons: string[];  // human-readable explanation strings (non-empty when < 1.0)
}

// ── Inputs passed to every dimension function ───────────────────────────────
// Mirrors the shape already returned by getObjectAggregate, extended with
// latestSemanticStatus (exposed from the same already-fetched row — no new query).

export interface DimensionInput {
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

// ── Dimension function type ─────────────────────────────────────────────────

export type DimensionFn = (input: DimensionInput) => DimensionResult;

// ── Level bands (single source of truth) ────────────────────────────────────

export type LevelBand = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

// Ordered from lowest to highest. Each entry defines the inclusive lower bound
// for that level. Upper bound = next entry's lower bound (or 1.0 for L5).
// L1: [0, 0.20)   Inventoried   — object exists but is barely known
// L2: [0.20, 0.45) Profiled     — basic structure and reachability confirmed
// L3: [0.45, 0.65) Understood   — semantic meaning and stability established
// L4: [0.65, 0.85) Curated      — human-validated, mapped, usage-analyzed
// L5: [0.85, 1.0]  Operationalized — fully production-ready data asset
export const LEVEL_BANDS: ReadonlyArray<{ level: LevelBand; min: number }> = [
  { level: 'L5', min: 0.85 },
  { level: 'L4', min: 0.65 },
  { level: 'L3', min: 0.45 },
  { level: 'L2', min: 0.20 },
  { level: 'L1', min: 0 },
] as const;

// ── Final composite result ───────────────────────────────────────────────────

export interface DataScoreResult {
  discoverable: DimensionResult;
  accessible: DimensionResult;
  trusted: DimensionResult;
  actionable: DimensionResult;
  composite: number;                  // Math.min of all four scores, 0..1
  level: LevelBand;                   // L1–L5 derived from composite
  gating_dimension: DataDimension;    // argmin with deterministic tie-breaking
}
