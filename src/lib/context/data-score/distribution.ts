// Source-level DATA readiness distribution.
//
// Rolls up per-object DataScoreResult values to a level-band distribution
// and average dimension scores for a given source. This is a shape —
// % of objects at each L1–L5 level — never a single min() across objects.
//
// The batch path fetches all 10 data types that getObjectAggregate fetches,
// but in bulk (one query per type, not N queries per object). Each object's
// DataScoreInput is assembled via assembleDimensionInput — the SAME function
// used by the per-object hero path — guaranteeing identical scoring.

import 'server-only';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import type { PlatformContextJob, PlatformContextObject } from '@prisma/client';
import { buildFreshness } from '@/lib/context/describe';
import { computeDataScore } from './compute';
import { assembleDimensionInput } from './assemble';
import { levelFromComposite } from './level';
import { LEVEL_BANDS } from './types';
import type { LevelBand, DataDimension } from './types';

export interface SourceDistribution {
  /** Count of active objects at each L1–L5 level. */
  distribution: Record<LevelBand, number>;
  /** Total number of active objects scored (sum of distribution values). */
  total: number;
  /** Mean dimension score (0..1) across all objects. */
  avg: Record<DataDimension, number>;
}

// ── Empty distribution helper ─────────────────────────────────────────────────

function emptyDistribution(): SourceDistribution {
  return {
    distribution: { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 },
    total: 0,
    avg: { discoverable: 0, accessible: 0, trusted: 0, actionable: 0 },
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function computeSourceDistribution(
  orgId: string,
  sourceId: string,
): Promise<SourceDistribution> {
  // ── Step 1: Fetch all active objects for the source ──────────────────────────
  // Mirrors getObjectAggregate query #0 (the object fetch), but for all objects.
  const objects = await prisma.platformContextObject.findMany({
    where: { source_id: sourceId, org_id: orgId, lifecycle: 'active' },
  });

  if (objects.length === 0) return emptyDistribution();

  const ids = objects.map((o) => o.id);
  const fullPaths = objects.map((o) => o.full_path);
  const t3ObjectIds = objects.filter((o) => o.last_t3_at !== null).map((o) => o.id);
  const t4ObjectPaths = objects.filter((o) => o.last_t4_at !== null).map((o) => o.full_path);

  // ── Step 2: Bulk-fetch all related data ──────────────────────────────────────
  //
  // Each entry below corresponds to one of getObjectAggregate's ~10 per-object
  // queries, replaced by a single bulk query. None are dropped or defaulted.
  //
  // 1. Columns — mirrors: platformContextColumn.findMany({ object_id, lifecycle: 'active' })
  const allColumns = await prisma.platformContextColumn.findMany({
    where: { object_id: { in: ids }, lifecycle: 'active' },
    orderBy: { ordinal: 'asc' },
  });
  const columnsByObjectId = new Map<string, typeof allColumns>();
  for (const col of allColumns) {
    const list = columnsByObjectId.get(col.object_id) ?? [];
    list.push(col);
    columnsByObjectId.set(col.object_id, list);
  }

  // 2. Latest semantic card — mirrors: platformContextSemantic.findFirst({ subject_id }, orderBy version desc)
  const allSemantics = await prisma.platformContextSemantic.findMany({
    where: { subject_kind: 'object', subject_id: { in: ids }, org_id: orgId },
    orderBy: [{ subject_id: 'asc' }, { version: 'desc' }],
  });
  const semanticByObjectId = new Map<string, typeof allSemantics[0]>();
  for (const s of allSemantics) {
    if (!semanticByObjectId.has(s.subject_id)) {
      semanticByObjectId.set(s.subject_id, s);
    }
  }

  // 3. Profile history (last 10 per object) — mirrors: platformContextProfile.findMany({ object_id }, take 10)
  const allProfiles = await prisma.platformContextProfile.findMany({
    where: { object_id: { in: ids } },
    orderBy: [{ object_id: 'asc' }, { version: 'desc' }],
  });
  const profilesByObjectId = new Map<string, typeof allProfiles>();
  for (const p of allProfiles) {
    const list = profilesByObjectId.get(p.object_id) ?? [];
    if (list.length < 10) list.push(p);
    profilesByObjectId.set(p.object_id, list);
  }

  // 4. Freshness — mirrors: buildFreshness(obj.last_t0_at, obj.last_t1_at, obj.source_altered_at)
  // Pure function derived from object fields already fetched in Step 1 — no DB query.

  // 5. Proposed mappings — mirrors: platformContextMapping.findMany({ status: 'proposed', left/right column.object_id })
  const allMappings = await prisma.platformContextMapping.findMany({
    where: {
      org_id: orgId,
      status: 'proposed',
      OR: [
        { left_column: { object_id: { in: ids } } },
        { right_column: { object_id: { in: ids } } },
      ],
    },
    include: { left_column: true, right_column: true },
  });
  const mappingsByObjectId = new Map<string, typeof allMappings>();
  for (const m of allMappings) {
    const leftId = m.left_column?.object_id;
    const rightId = m.right_column?.object_id;
    if (leftId && ids.includes(leftId)) {
      const list = mappingsByObjectId.get(leftId) ?? [];
      list.push(m);
      mappingsByObjectId.set(leftId, list);
    }
    if (rightId && ids.includes(rightId) && rightId !== leftId) {
      const list = mappingsByObjectId.get(rightId) ?? [];
      list.push(m);
      mappingsByObjectId.set(rightId, list);
    }
  }

  // 6. Object links — mirrors: platformContextObjectLink.findMany({ left/right_object_id })
  const allLinks = await prisma.platformContextObjectLink.findMany({
    where: {
      org_id: orgId,
      OR: [
        { left_object_id: { in: ids } },
        { right_object_id: { in: ids } },
      ],
    },
  });
  const linksByObjectId = new Map<string, typeof allLinks>();
  for (const lnk of allLinks) {
    for (const oid of [lnk.left_object_id, lnk.right_object_id]) {
      if (ids.includes(oid)) {
        const list = linksByObjectId.get(oid) ?? [];
        list.push(lnk);
        linksByObjectId.set(oid, list);
      }
    }
  }

  // 7. Jobs scoped to full paths — mirrors: raw SQL WHERE scope->>'path' IN (...)
  // Batch via IN across full_paths; limited to last 5 per object (matching per-object query).
  let allJobs: PlatformContextJob[] = [];
  if (fullPaths.length > 0) {
    allJobs = await prisma.$queryRaw<PlatformContextJob[]>(
      Prisma.sql`
        SELECT DISTINCT ON (
          COALESCE(scope->>'path', scope->>'leftScope', scope->>'rightScope'),
          created_at
        ) *
        FROM platform_context_jobs
        WHERE org_id = ${orgId}
          AND (
            scope->>'path' = ANY(${fullPaths}::text[])
            OR scope->>'leftScope' = ANY(${fullPaths}::text[])
            OR scope->>'rightScope' = ANY(${fullPaths}::text[])
          )
        ORDER BY
          COALESCE(scope->>'path', scope->>'leftScope', scope->>'rightScope'),
          created_at DESC
      `
    );
  }
  // Group jobs by their associated full_path (match per-object logic — up to 5 per path)
  const jobsByFullPath = new Map<string, PlatformContextJob[]>();
  for (const job of allJobs) {
    const scope = job.scope as Record<string, unknown> | null;
    const path = (scope?.['path'] ?? scope?.['leftScope'] ?? scope?.['rightScope']) as string | undefined;
    if (path && fullPaths.includes(path)) {
      const list = jobsByFullPath.get(path) ?? [];
      if (list.length < 5) list.push(job);
      jobsByFullPath.set(path, list);
    }
  }

  // 8. Usage snapshots (T3) — mirrors: usageObject(full_path) for objects with last_t3_at set.
  // Directly queries platformContextUsage (the same table usageObject reads) without
  // the redundant object-resolve step, since we already have all object IDs.
  const usageByObjectId = new Map<string, { key_columns: unknown }>();
  if (t3ObjectIds.length > 0) {
    // Fetch latest usage snapshot (highest version) per object
    const allUsage = await prisma.platformContextUsage.findMany({
      where: { orgId, contextObjectId: { in: t3ObjectIds } },
      orderBy: [{ contextObjectId: 'asc' }, { version: 'desc' }],
      select: { contextObjectId: true, keyColumns: true },
    });
    const seenUsage = new Set<string>();
    for (const u of allUsage) {
      if (!seenUsage.has(u.contextObjectId)) {
        seenUsage.add(u.contextObjectId);
        usageByObjectId.set(u.contextObjectId, { key_columns: u.keyColumns });
      }
    }
  }

  // 9. T4 semantic models — mirrors: platform_sem_entities.findFirst({ full_path, status: 'candidate' })
  const semanticModelByPath = new Map<string, {
    entity_label: string;
    description: string | null;
    status: string;
    dimensions: Array<{ column_name: string; dimension_label: string; dimension_type: string; description: string | null }>;
    measures: Array<{ column_name: string | null; measure_label: string; aggregate: string; description: string | null; unit: string | null }>;
  }>();
  if (t4ObjectPaths.length > 0) {
    const allEntities = await prisma.platform_sem_entities.findMany({
      where: { org_id: orgId, full_path: { in: t4ObjectPaths }, status: 'candidate' },
      include: {
        platform_sem_dimensions: { orderBy: { column_name: 'asc' } },
        platform_sem_measures: { orderBy: { measure_label: 'asc' } },
      },
    });
    for (const entity of allEntities) {
      semanticModelByPath.set(entity.full_path, {
        entity_label: entity.entity_label,
        description: entity.description,
        status: entity.status,
        dimensions: entity.platform_sem_dimensions.map((d) => ({
          column_name: d.column_name,
          dimension_label: d.dimension_label,
          dimension_type: d.dimension_type,
          description: d.description,
        })),
        measures: entity.platform_sem_measures.map((m) => ({
          column_name: m.column_name,
          measure_label: m.measure_label,
          aggregate: m.aggregate,
          description: m.description,
          unit: m.unit,
        })),
      });
    }
  }

  // ── Step 3: Score each object via the shared assembler ───────────────────────
  const distribution: Record<LevelBand, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 };
  const dimSums: Record<DataDimension, number> = { discoverable: 0, accessible: 0, trusted: 0, actionable: 0 };

  for (const obj of objects) {
    const semantic = semanticByObjectId.get(obj.id) ?? null;
    const freshness = buildFreshness({
      last_t0_at: obj.last_t0_at,
      last_t1_at: obj.last_t1_at,
      source_altered_at: obj.source_altered_at,
    });
    const usageRaw = usageByObjectId.get(obj.id) ?? null;

    // assembleDimensionInput: single source of truth — same function as hero path
    const scoreInput = assembleDimensionInput({
      object: obj,
      columns: columnsByObjectId.get(obj.id) ?? [],
      latestSemanticCard: semantic?.card ?? null,
      latestSemanticStatus: semantic?.status ?? null,
      profileHistory: profilesByObjectId.get(obj.id) ?? [],
      freshness,
      proposedMappings: mappingsByObjectId.get(obj.id) ?? [],
      objectLinks: linksByObjectId.get(obj.id) ?? [],
      lastJobs: jobsByFullPath.get(obj.full_path) ?? [],
      usageSnapshot: usageRaw,
      semanticModel: semanticModelByPath.get(obj.full_path) ?? null,
    });

    const result = computeDataScore(scoreInput);
    const level = levelFromComposite(result.composite);
    distribution[level]++;
    dimSums.discoverable += result.discoverable.score;
    dimSums.accessible += result.accessible.score;
    dimSums.trusted += result.trusted.score;
    dimSums.actionable += result.actionable.score;
  }

  // ── Step 4: Compute averages ──────────────────────────────────────────────────
  const n = objects.length;
  const avg: Record<DataDimension, number> = {
    discoverable: dimSums.discoverable / n,
    accessible: dimSums.accessible / n,
    trusted: dimSums.trusted / n,
    actionable: dimSums.actionable / n,
  };

  return { distribution, total: n, avg };
}
