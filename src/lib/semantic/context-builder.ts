/**
 * src/lib/semantic/context-builder.ts
 *
 * Builds a SemanticContext object from governed semantic model entities for
 * injection into the Inspector system prompt.
 *
 * The context is fetched once at session init (not per tool call).
 * pgvector ranking is applied when a connectionId is provided, to surface the
 * most relevant entities first. Ranking is best-effort — if embed fails or no
 * embeddings exist, entities are returned in DB order.
 */

import 'server-only';
import prisma from '@/lib/db';
import { embedQuery } from '@/lib/context/embed';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GovernedDimensionSummary {
  id: string;
  label: string;
  type: string;
  columnName: string;
  synonyms: string[];
}

export interface GovernedMeasureSummary {
  id: string;
  label: string;
  aggregate: string;
  metricType: string;
  synonyms: string[];
}

export interface GovernedEntitySummary {
  entityId: string;
  entityLabel: string;
  fullPath: string;
  description: string;
  synonyms: string[];
  dimensions: GovernedDimensionSummary[];
  measures: GovernedMeasureSummary[];
}

export interface SemanticContext {
  modelId: string;
  entities: GovernedEntitySummary[];
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Build a SemanticContext from the org's governed semantic model.
 *
 * Steps:
 *   1. Find the first governed semantic model for the org
 *   2. Load all governed entities
 *   3. Optionally rank by pgvector similarity to the connection name
 *   4. Cap at topK entities
 *   5. Load dims + measures for each and assemble GovernedEntitySummary[]
 *
 * Returns { modelId: '', entities: [] } when no governed model exists.
 */
export async function buildSemanticContext(
  orgId: string,
  connectionId?: string | null,
  topK = 10,
): Promise<SemanticContext> {
  // Step 1 — find governed model
  const modelRow = await prisma.platform_semantic_models.findFirst({
    where: { org_id: orgId, status: 'governed' },
  });
  if (!modelRow) {
    return { modelId: '', entities: [] };
  }

  // Step 2 — load governed entities
  const entityRows = await prisma.platform_sem_entities.findMany({
    where: { model_id: modelRow.id, org_id: orgId, status: 'governed' },
  });
  if (entityRows.length === 0) {
    return { modelId: modelRow.id, entities: [] };
  }

  // Step 3 — optional pgvector ranking by connection name similarity
  let orderedEntities = entityRows;

  if (connectionId) {
    try {
      const conn = await prisma.platformDatabricksConnection.findUnique({
        where: { id: connectionId },
        select: { name: true },
      });
      if (conn?.name) {
        const vec = await embedQuery(conn.name);
        if (vec !== null) {
          const vecLiteral = `[${vec.join(',')}]`;

          // Collect context_object IDs for the entity full_paths
          type EmbedRow = { subject_id: string; similarity: number };
          const embedRows = await prisma.$queryRaw<EmbedRow[]>`
            SELECT
              e.subject_id::text AS subject_id,
              (1 - (e.embedding <=> ${vecLiteral}::text::vector))::float AS similarity
            FROM platform_context_embeddings e
            WHERE e.org_id = ${orgId}
              AND e.subject_kind = 'object'
              AND e.embedding IS NOT NULL
            ORDER BY e.embedding <=> ${vecLiteral}::text::vector ASC
            LIMIT ${Math.max(topK * 3, 30)}
          `;

          // Map subject_id back to governed entities via full_path
          // platform_context_embeddings.subject_id = platform_context_objects.id (UUID)
          // We need to cross-reference via full_path
          if (embedRows.length > 0) {
            const subjectIds = embedRows.map((r) => r.subject_id);
            const contextObjects = await prisma.platformContextObject.findMany({
              where: { id: { in: subjectIds }, org_id: orgId },
              select: { id: true, full_path: true },
            });
            const pathBySubjectId = new Map(contextObjects.map((o) => [o.id, o.full_path]));
            const simByPath = new Map<string, number>();
            for (const r of embedRows) {
              const fp = pathBySubjectId.get(r.subject_id);
              if (fp) simByPath.set(fp, Math.max(0, r.similarity));
            }

            // Sort governed entities by similarity (higher first); unranked last
            orderedEntities = [...entityRows].sort((a, b) => {
              const simA = simByPath.get(a.full_path) ?? -1;
              const simB = simByPath.get(b.full_path) ?? -1;
              return simB - simA;
            });
          }
        }
      }
    } catch {
      // Ranking is best-effort; fall back to DB order
    }
  }

  // Step 4 — cap at topK
  const cappedEntities = orderedEntities.slice(0, topK);
  const entityIds = cappedEntities.map((e) => e.id);

  // Step 5 — load dims + measures for the selected entities
  const [dimensionRows, measureRows] = await Promise.all([
    prisma.platform_sem_dimensions.findMany({
      where: { entity_id: { in: entityIds }, org_id: orgId },
    }),
    prisma.platform_sem_measures.findMany({
      where: { entity_id: { in: entityIds }, org_id: orgId },
    }),
  ]);

  const dimsByEntity = new Map<string, typeof dimensionRows>();
  const measuresByEntity = new Map<string, typeof measureRows>();
  for (const d of dimensionRows) {
    if (!dimsByEntity.has(d.entity_id)) dimsByEntity.set(d.entity_id, []);
    dimsByEntity.get(d.entity_id)!.push(d);
  }
  for (const m of measureRows) {
    if (!measuresByEntity.has(m.entity_id)) measuresByEntity.set(m.entity_id, []);
    measuresByEntity.get(m.entity_id)!.push(m);
  }

  const entities: GovernedEntitySummary[] = cappedEntities.map((e) => {
    const dims = (dimsByEntity.get(e.id) ?? []).map((d) => ({
      id: d.id,
      label: d.dimension_label,
      type: d.dimension_type,
      columnName: d.column_name,
      synonyms: Array.isArray(d.synonyms) ? (d.synonyms as string[]) : [],
    }));
    const measures = (measuresByEntity.get(e.id) ?? []).map((m) => ({
      id: m.id,
      label: m.measure_label,
      aggregate: m.aggregate,
      metricType: m.metric_type,
      synonyms: Array.isArray(m.synonyms) ? (m.synonyms as string[]) : [],
    }));
    return {
      entityId: e.id,
      entityLabel: e.entity_label,
      fullPath: e.full_path,
      description: e.description ?? '',
      synonyms: Array.isArray(e.synonyms) ? (e.synonyms as string[]) : [],
      dimensions: dims,
      measures,
    };
  });

  return { modelId: modelRow.id, entities };
}
