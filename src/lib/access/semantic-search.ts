/**
 * Search by meaning for the access screens: columns (Protections → Add columns) and tables
 * (Data → Find a table, My data access). Uses the harvest's embeddings (pgvector).
 *
 * These screens are for Data access admins, who may see sample values (user decision 2026-11-08); the
 * ⓘ column info shows them. The search response itself carries names, types and descriptions.
 *
 * Scores vary a lot by query (measured on dev: best match 0.19 for "salary", 0.47 for "bank
 * account"), so results are cut relative to the best score, not by a fixed threshold.
 */
import { prisma } from '@/lib/db';
import { CURRENT_EMBEDDING_MODEL, embedQuery } from '@/lib/context/embed';

export const RELATIVE_CUTOFF = 0.75;
const TECHNICAL = /^(id|_fivetran_.*|_rescued_data|etl_.*|dw_.*|__.*)$/i;

export interface MeaningColumn {
  tablePath: string;
  column: string;
  type: string | null;
  kind: string;
  description: string | null;
  score: number;
}

export interface MeaningTable {
  path: string;
  kind: string;
  description: string | null;
  score: number;
}

/** Keep results within RELATIVE_CUTOFF of the best score; drop technical names. */
export function relativeCut<T extends { score: number }>(rows: T[], name: (r: T) => string, limit: number): T[] {
  const kept = rows.filter((r) => !TECHNICAL.test(name(r)));
  const best = kept[0]?.score ?? 0;
  if (best <= 0) return [];
  return kept.filter((r) => r.score >= best * RELATIVE_CUTOFF).slice(0, limit);
}

async function vector(q: string): Promise<string | null> {
  const v = await embedQuery(q).catch(() => null);
  return v ? `[${v.join(',')}]` : null;
}

export async function searchColumnsByMeaning(orgId: string, q: string, limit = 25): Promise<MeaningColumn[]> {
  const lit = await vector(q);
  if (!lit) return [];
  const rows = await prisma.$queryRaw<
    { name: string; data_type: string | null; full_path: string; object_kind: string; semantic: unknown; profile: unknown; score: number }[]
  >`
    SELECT c.name, c.data_type, o.full_path, o.object_kind, c.semantic, c.profile,
           (1 - (e.embedding <=> ${lit}::text::vector))::float AS score
    FROM platform_context_embeddings e
    JOIN platform_context_columns c ON c.id = e.subject_id
    JOIN platform_context_objects o ON o.id = c.object_id AND o.lifecycle = 'active'
    WHERE e.org_id = ${orgId} AND e.subject_kind = 'column' AND e.embedding IS NOT NULL
      AND e.model_id = ${CURRENT_EMBEDDING_MODEL}
    ORDER BY e.embedding <=> ${lit}::text::vector ASC
    LIMIT 80`;
  const mapped = rows
    .filter((r) => r.full_path.split('.').length === 3)
    .map((r) => ({
      tablePath: r.full_path.toLowerCase(),
      column: r.name.toLowerCase(),
      type: r.data_type,
      kind: r.object_kind,
      description: ((r.semantic ?? {}) as { description?: string }).description ?? null,
      score: Math.max(0, r.score),
    }));
  return relativeCut(mapped, (r) => r.column, limit);
}

export async function searchTablesByMeaning(orgId: string, q: string, limit = 20): Promise<MeaningTable[]> {
  const lit = await vector(q);
  if (!lit) return [];
  // Table summaries come from the latest semantic card (no values in it).
  const rows = await prisma.$queryRaw<{ full_path: string; object_kind: string; summary: string | null; score: number }[]>`
    SELECT o.full_path, o.object_kind,
           (SELECT s.card->>'summary' FROM platform_context_semantics s
             WHERE s.subject_kind = 'object' AND s.subject_id = o.id
             ORDER BY s.version DESC LIMIT 1) AS summary,
           (1 - (e.embedding <=> ${lit}::text::vector))::float AS score
    FROM platform_context_embeddings e
    JOIN platform_context_objects o ON o.id = e.subject_id AND o.lifecycle = 'active'
    WHERE e.org_id = ${orgId} AND e.subject_kind = 'object' AND e.embedding IS NOT NULL
      AND e.model_id = ${CURRENT_EMBEDDING_MODEL}
    ORDER BY e.embedding <=> ${lit}::text::vector ASC
    LIMIT 60`;
  const mapped = rows
    .filter((r) => r.full_path.split('.').length === 3)
    .map((r) => ({
      path: r.full_path.toLowerCase(),
      kind: r.object_kind,
      description: r.summary,
      score: Math.max(0, r.score),
    }));
  return relativeCut(mapped, (r) => r.path.split('.')[2]!, limit);
}
