/**
 * src/lib/semantic/intent-match.ts
 *
 * Phase 3.5D — read side of NL-intent activation.
 *
 * `matchIntents` embeds a query string and cosine-ranks it against the stored
 * intent embeddings (platform_nl_intent_embeddings), returning the top-K with
 * the linked definition/chart resolved LIVE (label + current status). Because
 * status is resolved by joining to the source row rather than denormalised on
 * the embedding, a promote/demote is reflected instantly.
 *
 * `listGovernedIntents` returns the org's governed intents (no query — used by
 * the empty-state starter prompts) most-recent first.
 *
 * VISIBILITY (mirrors the 3.5A/B draft-invisibility discipline):
 *   - governed intents  → visible org-wide (default).
 *   - candidate intents → visible org-wide, but only when minStatus is lowered
 *     to 'candidate'/'draft' (authoring contexts).
 *   - draft intents     → visible ONLY to their owner (createdBy === caller),
 *     and only when minStatus === 'draft'. A private draft never leaks.
 *   - raw-SQL chart intents → org-visible (saved charts are org-visible) but
 *     ungoverned, so they surface only when minStatus is below 'governed'.
 */

import 'server-only';
import prisma from '@/lib/db';
import { embedQuery } from '@/lib/context/embed';
import type { IntentSourceType } from '@/lib/semantic/intent-embed';

export type MinStatus = 'governed' | 'candidate' | 'draft';

export interface IntentMatch {
  sourceType: IntentSourceType;
  sourceId: string;
  intentText: string;
  similarity: number; // 0..1 cosine similarity (0 for list, no query)
  status: string; // live: 'governed' | 'candidate' | 'draft' | 'raw'
  label: string; // live label of the linked definition / chart
  entityId: string | null;
  createdBy: string | null;
}

export interface MatchIntentsOptions {
  topK?: number;
  minStatus?: MinStatus;
  /** Owner id — required for draft intents to be visible. */
  callerUserId?: string | null;
  /** Restrict to a single semantic model (empty-state scoping). */
  modelId?: string | null;
}

interface RawIntentRow {
  source_type: IntentSourceType;
  source_id: string;
  intent_text: string;
  created_by: string | null;
  similarity: number;
}

const STATUS_RANK: Record<string, number> = { raw: 0, draft: 1, candidate: 2, governed: 3 };

function minStatusRank(min: MinStatus): number {
  return STATUS_RANK[min] ?? 3;
}

/** Visibility rule — see the module header. */
function isVisible(
  status: string,
  createdBy: string | null,
  minStatus: MinStatus,
  callerUserId: string | null | undefined,
): boolean {
  const floor = minStatusRank(minStatus);
  if (status === 'governed') return true; // org-wide, always
  if (status === 'candidate') return floor <= 2; // org-wide when candidates allowed
  if (status === 'raw') return floor <= 2; // org-visible saved chart, ungoverned
  if (status === 'draft') return floor <= 1 && !!callerUserId && createdBy === callerUserId;
  return false;
}

// ── Live resolution of source rows ──────────────────────────────────────────

interface ResolvedSource {
  status: string;
  label: string;
  entityId: string | null;
}

/**
 * Batch-resolve the live label + status for a set of intent rows. Returns a map
 * keyed `${sourceType}:${sourceId}`. Rows whose source no longer exists (the
 * definition/chart was deleted) are omitted, so a dangling intent embedding
 * silently drops out of results.
 */
async function resolveSources(rows: RawIntentRow[]): Promise<Map<string, ResolvedSource>> {
  const measureIds = rows.filter((r) => r.source_type === 'measure').map((r) => r.source_id);
  const dimensionIds = rows.filter((r) => r.source_type === 'dimension').map((r) => r.source_id);
  const chartIds = rows.filter((r) => r.source_type === 'raw_chart').map((r) => r.source_id);

  const [measures, dimensions, charts] = await Promise.all([
    measureIds.length
      ? prisma.platform_sem_measures.findMany({
          where: { id: { in: measureIds } },
          select: { id: true, measure_label: true, status: true, entity_id: true },
        })
      : Promise.resolve([]),
    dimensionIds.length
      ? prisma.platform_sem_dimensions.findMany({
          where: { id: { in: dimensionIds } },
          select: { id: true, dimension_label: true, status: true, entity_id: true },
        })
      : Promise.resolve([]),
    chartIds.length
      ? prisma.platform_charts.findMany({
          where: { id: { in: chartIds }, deleted_at: null },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const map = new Map<string, ResolvedSource>();
  for (const m of measures) {
    map.set(`measure:${m.id}`, { status: m.status, label: m.measure_label, entityId: m.entity_id });
  }
  for (const d of dimensions) {
    map.set(`dimension:${d.id}`, { status: d.status, label: d.dimension_label, entityId: d.entity_id });
  }
  for (const c of charts) {
    // Raw-SQL charts have no governance status — they are ungoverned by design.
    map.set(`raw_chart:${c.id}`, { status: 'raw', label: c.name, entityId: null });
  }
  return map;
}

function toMatch(row: RawIntentRow, resolved: ResolvedSource): IntentMatch {
  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    intentText: row.intent_text,
    similarity: row.similarity,
    status: resolved.status,
    label: resolved.label,
    entityId: resolved.entityId,
    createdBy: row.created_by,
  };
}

// ── matchIntents — cosine-ranked ─────────────────────────────────────────────

export async function matchIntents(
  queryText: string,
  orgId: string,
  opts: MatchIntentsOptions = {},
): Promise<IntentMatch[]> {
  const topK = opts.topK ?? 5;
  const minStatus = opts.minStatus ?? 'governed';
  const q = queryText?.trim();
  if (!q) return [];

  const vec = await embedQuery(q);
  if (!vec) return []; // embedding unavailable — caller falls back gracefully
  const vecStr = `[${vec.join(',')}]`;

  // Over-fetch by cosine, then filter by live status/visibility in app code.
  const overfetch = Math.max(topK * 4, 25);
  const modelId = opts.modelId ?? null;
  const rows = await prisma.$queryRaw<RawIntentRow[]>`
    SELECT
      ie.source_type,
      ie.source_id,
      ie.intent_text,
      ie.created_by,
      (1 - (ie.embedding <=> ${vecStr}::text::vector))::float AS similarity
    FROM platform_nl_intent_embeddings ie
    WHERE ie.org_id = ${orgId}
      AND ie.embedding IS NOT NULL
      AND (${modelId}::text IS NULL OR ie.model_id = ${modelId})
    ORDER BY ie.embedding <=> ${vecStr}::text::vector ASC
    LIMIT ${overfetch}
  `;
  if (rows.length === 0) return [];

  const resolved = await resolveSources(rows);
  const out: IntentMatch[] = [];
  for (const row of rows) {
    const src = resolved.get(`${row.source_type}:${row.source_id}`);
    if (!src) continue;
    if (!isVisible(src.status, row.created_by, minStatus, opts.callerUserId)) continue;
    out.push(toMatch(row, src));
    if (out.length >= topK) break;
  }
  return out;
}

// ── listGovernedIntents — no query, for empty-state starter prompts ──────────

export async function listGovernedIntents(
  orgId: string,
  opts: { limit?: number; modelId?: string | null } = {},
): Promise<IntentMatch[]> {
  const limit = opts.limit ?? 5;
  const modelId = opts.modelId ?? null;
  const overfetch = Math.max(limit * 4, 25);

  const rows = await prisma.$queryRaw<RawIntentRow[]>`
    SELECT
      ie.source_type,
      ie.source_id,
      ie.intent_text,
      ie.created_by,
      0::float AS similarity
    FROM platform_nl_intent_embeddings ie
    WHERE ie.org_id = ${orgId}
      AND (${modelId}::text IS NULL OR ie.model_id = ${modelId})
    ORDER BY ie.updated_at DESC
    LIMIT ${overfetch}
  `;
  if (rows.length === 0) return [];

  const resolved = await resolveSources(rows);
  const out: IntentMatch[] = [];
  const seenText = new Set<string>();
  for (const row of rows) {
    const src = resolved.get(`${row.source_type}:${row.source_id}`);
    if (!src) continue;
    if (src.status !== 'governed') continue; // org-wide demonstrated usage only
    const key = row.intent_text.trim().toLowerCase();
    if (seenText.has(key)) continue;
    seenText.add(key);
    out.push(toMatch(row, src));
    if (out.length >= limit) break;
  }
  return out;
}
