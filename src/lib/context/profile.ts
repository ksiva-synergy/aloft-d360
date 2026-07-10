import 'server-only';
import prisma from '@/lib/db';
import type { ObjectProfile } from './types';

// ── Drift types ───────────────────────────────────────────────────────────────

export interface DriftTypeChange {
  column: string;
  from: string;
  to: string;
}

export interface DriftNullRateShift {
  column: string;
  from: number;
  to: number;
  delta: number;
}

export interface DriftTopKChange {
  column: string;
  prev_top_values: unknown[];
  curr_top_values: unknown[];
}

export interface DriftResult {
  row_delta_pct: number | null;
  new_columns: string[];
  dropped_columns: string[];
  type_changes: DriftTypeChange[];
  null_rate_shifts: DriftNullRateShift[];
  top_k_changes: DriftTopKChange[];
}

export interface SaveProfileResult {
  profileId: string;
  version: number;
  drift: DriftResult | null;
}

// ── computeDrift ──────────────────────────────────────────────────────────────

/**
 * Compare two profile stats snapshots and return a structured drift record.
 * null_rate_shifts: columns where null rate changed by more than 10 percentage points.
 * top_k_changes: columns where the set of top-k values changed between versions.
 */
export function computeDrift(
  prevStats: Record<string, unknown>,
  currStats: Record<string, unknown>,
): DriftResult {
  const prevRows = Number(prevStats.row_count ?? 0);
  const currRows = Number(currStats.row_count ?? 0);
  const row_delta_pct = prevRows > 0 ? (currRows - prevRows) / prevRows : null;

  const prevCols = (prevStats.columns ?? {}) as Record<string, Record<string, unknown>>;
  const currCols = (currStats.columns ?? {}) as Record<string, Record<string, unknown>>;

  const prevColNames = Object.keys(prevCols);
  const currColNames = Object.keys(currCols);

  const new_columns = currColNames.filter(n => !prevColNames.includes(n));
  const dropped_columns = prevColNames.filter(n => !currColNames.includes(n));

  const type_changes: DriftTypeChange[] = [];
  const null_rate_shifts: DriftNullRateShift[] = [];
  const top_k_changes: DriftTopKChange[] = [];

  for (const name of currColNames) {
    const prev = prevCols[name];
    const curr = currCols[name];
    if (!prev || !curr) continue;

    if (prev.data_type && curr.data_type && prev.data_type !== curr.data_type) {
      type_changes.push({ column: name, from: String(prev.data_type), to: String(curr.data_type) });
    }

    // Null rate shift > 10 percentage points (spec §4.4)
    const prevNullRate = Number(prev.null_rate ?? 0);
    const currNullRate = Number(curr.null_rate ?? 0);
    const delta = Math.abs(currNullRate - prevNullRate);
    if (delta > 0.10) {
      null_rate_shifts.push({ column: name, from: prevNullRate, to: currNullRate, delta });
    }

    // Top-k value set change
    type TopKEntry = { value: unknown; count: number };
    const prevTopK = (prev.top_k ?? []) as TopKEntry[];
    const currTopK = (curr.top_k ?? []) as TopKEntry[];
    if (prevTopK.length > 0 || currTopK.length > 0) {
      const prevValues = new Set(prevTopK.map((x) => String(x.value)));
      const currValues = new Set(currTopK.map((x) => String(x.value)));
      const added = [...currValues].filter(v => !prevValues.has(v));
      const removed = [...prevValues].filter(v => !currValues.has(v));
      if (added.length > 0 || removed.length > 0) {
        top_k_changes.push({
          column: name,
          prev_top_values: prevTopK.map((x) => x.value),
          curr_top_values: currTopK.map((x) => x.value),
        });
      }
    }
  }

  return { row_delta_pct, new_columns, dropped_columns, type_changes, null_rate_shifts, top_k_changes };
}

// ── Postgres-safe JSON sanitizer ─────────────────────────────────────────────
// Postgres text/jsonb columns reject \u0000 (null byte). Strip it from any
// JSON-serialisable object before writing to the DB.
function stripNullBytes<T>(value: T): T {
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    return value.replace(/\u0000/g, '') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(stripNullBytes) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripNullBytes(v)])
    ) as unknown as T;
  }
  return value;
}

// ── saveProfile ───────────────────────────────────────────────────────────────

/**
 * Persist a completed profile snapshot:
 * 1. Look up the previous max version for drift computation.
 * 2. Compute drift against that version (null for v1).
 * 3. Append a new platform_context_profiles row (version = prev + 1).
 * 4. Upsert per-column profile JSONB onto platform_context_columns.
 */
export async function saveProfile(
  objectId: string,
  orgId: string,
  profile: ObjectProfile,
  trigger: string,
): Promise<SaveProfileResult> {
  const stats = stripNullBytes(profile.stats as Record<string, unknown>);

  const lastProfile = await prisma.platformContextProfile.findFirst({
    where: { object_id: objectId },
    orderBy: { version: 'desc' },
    select: { version: true, stats: true },
  });

  const nextVersion = lastProfile ? lastProfile.version + 1 : 1;
  const prevStats = lastProfile?.stats as Record<string, unknown> | null ?? null;
  const drift: DriftResult | null = prevStats ? computeDrift(prevStats, stats) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newProfile = await prisma.platformContextProfile.create({
    data: {
      object_id: objectId,
      org_id: orgId,
      version: nextVersion,
      trigger,
      stats: stats as any,
      drift: drift !== null ? (stripNullBytes(drift) as any) : undefined,
    },
    select: { id: true, version: true },
  });

  const colStats = (stats.columns ?? {}) as Record<string, Record<string, unknown>>;
  for (const [colName, colProfile] of Object.entries(colStats)) {
    await prisma.platformContextColumn.updateMany({
      where: { object_id: objectId, name: colName, lifecycle: 'active' },
      data: { profile: stripNullBytes(colProfile) as any },
    });
  }

  return { profileId: newProfile.id, version: newProfile.version, drift };
}
