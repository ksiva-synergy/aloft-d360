/**
 * Pure helpers for "has anything really changed?" decisions across the harvest
 * pipeline (T0 → T1 → T2 → embed). No DB / server-only imports so they can be
 * unit-tested and shared by the API and the worker.
 */
import { selectDroppedPaths } from './scope-match';
import type { JobKind } from './queue';

// ── T0: structure signature ─────────────────────────────────────────────────

export interface StructureColumnLike {
  name: string;
  ordinal?: number | null;
  data_type?: string | null;
  is_nullable?: boolean | null;
  native_comment?: string | null;
}

export interface StructureLike {
  object_kind?: string | null;
  native_comment?: string | null;
  columns: StructureColumnLike[];
}

export function structureSignature(s: StructureLike): string {
  const cols = [...s.columns]
    .map(c => [
      c.name.toLowerCase(),
      c.ordinal ?? null,
      (c.data_type ?? '').toLowerCase(),
      c.is_nullable ?? null,
      c.native_comment ?? null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([s.object_kind ?? null, s.native_comment ?? null, cols]);
}

export interface StoredObjectForT0 extends StructureLike {
  lifecycle: string;
  last_t0_at: Date | null;
  source_altered_at: Date | null;
}

export interface IncomingObjectForT0 extends StructureLike {
  source_altered_at: Date | null;
}

/**
 * True when a T0 rescan should advance `last_t0_at` (and so make T1+ stale).
 * A rescan that sees identical structure and the same source alter time is a
 * "checked, nothing new" — downstream tiers stay current.
 */
export function isT0Changed(stored: StoredObjectForT0 | null, incoming: IncomingObjectForT0): boolean {
  if (!stored) return true;
  if (stored.lifecycle !== 'active') return true;
  if (!stored.last_t0_at) return true;
  const prevAlt = stored.source_altered_at?.getTime() ?? null;
  const nextAlt = incoming.source_altered_at?.getTime() ?? null;
  // Source alter time moved forward (DDL or data write) → downstream must refresh.
  if (nextAlt !== null && (prevAlt === null || nextAlt > prevAlt)) return true;
  // T0 never retires columns, so stored may hold columns the source removed; those
  // are caught by the alter time above. Compare only the columns the source reports.
  const incomingNames = new Set(incoming.columns.map(c => c.name.toLowerCase()));
  const storedComparable = {
    ...stored,
    columns: stored.columns.filter(c => incomingNames.has(c.name.toLowerCase())),
  };
  return structureSignature(storedComparable) !== structureSignature(incoming);
}

// ── T1: profile fingerprint ─────────────────────────────────────────────────

/** Keys that vary run-to-run without the data changing. */
const VOLATILE_PROFILE_KEYS = new Set([
  'query_count',
  'query_error',
  'captured_at',
  'profiled_at',
  'duration_ms',
]);

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => !VOLATILE_PROFILE_KEYS.has(k) && obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function profileFingerprint(stats: unknown): string {
  return stableStringify(stats);
}

export function isProfileUnchanged(prevStats: unknown, nextStats: unknown): boolean {
  if (prevStats === null || prevStats === undefined) return false;
  return profileFingerprint(prevStats) === profileFingerprint(nextStats);
}

// ── Continue: scoped change classification ──────────────────────────────────

export interface ListedTable {
  full_path: string;
  source_altered_at: Date | null;
}

export interface StoredScannedTable {
  full_path: string;
  source_altered_at: Date | null;
  last_t0_at: Date | null;
}

export interface ScopeChangeReport {
  checkedAt: string;
  listed: number;
  unchanged: number;
  changed: string[];
  added: string[];
  dropped: string[];
  /** Tables whose alter time is unavailable (non-Unity) — T0 decides by structure. */
  unknown: string[];
}

export function classifyScopeChanges(args: {
  listed: ListedTable[];
  stored: StoredScannedTable[];
  includes: string[];
  excludes: string[];
  now?: Date;
}): ScopeChangeReport {
  const storedMap = new Map(args.stored.map(s => [s.full_path, s]));
  const changed: string[] = [];
  const added: string[] = [];
  const unknown: string[] = [];
  let unchanged = 0;

  for (const t of args.listed) {
    const s = storedMap.get(t.full_path);
    if (!s || !s.last_t0_at) {
      added.push(t.full_path);
      continue;
    }
    const live = t.source_altered_at?.getTime() ?? null;
    if (live === null) {
      unknown.push(t.full_path);
      continue;
    }
    const prev = s.source_altered_at?.getTime() ?? null;
    if (prev === null || live > prev) changed.push(t.full_path);
    else unchanged++;
  }

  const dropped = selectDroppedPaths({
    activePaths: args.stored.map(s => s.full_path),
    resolvedPaths: args.listed.map(t => t.full_path),
    includes: args.includes,
    excludes: args.excludes,
  });

  return {
    checkedAt: (args.now ?? new Date()).toISOString(),
    listed: args.listed.length,
    unchanged,
    changed,
    added,
    dropped,
    unknown,
  };
}

export function scopeNeedsRescan(r: Pick<ScopeChangeReport, 'changed' | 'added' | 'dropped' | 'unknown'>): boolean {
  return r.changed.length + r.added.length + r.dropped.length + r.unknown.length > 0;
}

// ── Continue: cascade chain ─────────────────────────────────────────────────

export type ContinueStage = 't0_structural' | 't1_profile' | 't2_semantic' | 'embed';
export type ContinueThrough = 't1_profile' | 't2_semantic' | 'embed';

/** UI / API tier ids for Continue pipeline (maps to JobKind). */
export type ContinueTierId = 't0' | 't1' | 't2' | 'embed' | 't3' | 't4';

export const CONTINUE_TIER_ORDER: readonly ContinueTierId[] = ['t0', 't1', 't2', 'embed', 't3', 't4'];

const TIER_TO_KIND: Record<ContinueTierId, JobKind> = {
  t0: 't0_structural',
  t1: 't1_profile',
  t2: 't2_semantic',
  embed: 'embed',
  t3: 't3_usage',
  t4: 't4_scan',
};

export function continueTierToKind(tier: ContinueTierId): JobKind {
  return TIER_TO_KIND[tier];
}

/** Parse and normalize tier ids from a launch request (stable pipeline order). */
export function parseContinueTierIds(raw: unknown): ContinueTierId[] | null {
  if (!Array.isArray(raw)) return null;
  const picked = new Set<ContinueTierId>();
  for (const x of raw) {
    if (typeof x === 'string' && (CONTINUE_TIER_ORDER as readonly string[]).includes(x)) {
      picked.add(x as ContinueTierId);
    }
  }
  if (picked.size === 0) return null;
  return CONTINUE_TIER_ORDER.filter(t => picked.has(t));
}

export interface ContinueStageNeeds {
  rescan: boolean;
  needsProfile: number;
  needsEnrich: number;
  needsEmbed: number;
}

/**
 * Earliest stage with work wins, then every downstream stage up to `through`
 * is included — each worker re-selects its own stale objects at run time, so a
 * downstream stage that turns out to have nothing to do is a cheap no-op. This
 * avoids the click-time snapshot dropping T2 when only T1 looked stale.
 */
export function buildContinueChain(needs: ContinueStageNeeds, through: ContinueThrough): ContinueStage[] {
  const order: ContinueStage[] = ['t0_structural', 't1_profile', 't2_semantic', 'embed'];
  const lastIdx = order.indexOf(through);
  const dirty: boolean[] = [needs.rescan, needs.needsProfile > 0, needs.needsEnrich > 0, needs.needsEmbed > 0];
  const first = dirty.findIndex((d, i) => d && i <= lastIdx);
  if (first < 0) return [];
  return order.slice(first, lastIdx + 1);
}

/**
 * Build a sequential job list from operator-selected tiers.
 * T0–Embed: cascade from earliest stale work through the highest selected embed tier.
 * T3/T3: appended when selected (scoped at launch via includePatterns).
 */
export function buildContinueKindsFromTierSelection(args: {
  selectedTiers: ContinueTierId[];
  needs: ContinueStageNeeds;
  scannedObjects: number;
  notInModel: number;
}): JobKind[] {
  const selected = new Set(args.selectedTiers);
  const embedTiers: ContinueTierId[] = ['t0', 't1', 't2', 'embed'];
  const selectedEmbed = embedTiers.filter(t => selected.has(t));
  const kinds: JobKind[] = [];

  if (selectedEmbed.length > 0) {
    const maxIdx = Math.max(...selectedEmbed.map(t => embedTiers.indexOf(t)));
    const through: ContinueThrough =
      maxIdx <= 1 ? 't1_profile' : maxIdx === 2 ? 't2_semantic' : 'embed';
    kinds.push(...(buildContinueChain(args.needs, through) as JobKind[]));
  }

  if (selected.has('t3') && args.scannedObjects > 0) {
    kinds.push('t3_usage');
  }
  if (selected.has('t4') && args.scannedObjects > 0) {
    kinds.push('t4_scan');
  }

  const seen = new Set<JobKind>();
  return kinds.filter(k => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
