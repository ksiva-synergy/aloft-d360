import 'server-only';
import prisma from '@/lib/db';
import { Prisma, PlatformContextObject, PlatformContextJob } from '@prisma/client';
import { buildFreshness, usageObject, UsageObjectResult } from './describe';
import { ESTATE_STALE_SWEEP_DAYS } from './estate';
import { TEST_SOURCE_DISPLAY_NAME_SQL } from './test-sources';
import { computeDataScore } from './data-score';
import type { DataScoreResult } from './data-score';
import { assembleDimensionInput } from './data-score/assemble';

// ── 1. listObjectsPage ─────────────────────────────────────────────────────────

export interface ListObjectsParams {
  sourceId?: string;
  catalog?: string;
  schema?: string;
  q?: string;
  status?: string;
  stale?: boolean;
  hasPii?: boolean;
  sort?: 'path' | 'rows' | 'last_seen';
  page?: number;
  pageSize?: number;
}

export interface ListObjectsResult {
  items: Array<PlatformContextObject & {
    semantic_status?: string | null;
    semantic_summary?: string | null;
    pii_columns?: any[] | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

export async function listObjectsPage(
  orgId: string,
  params: ListObjectsParams,
): Promise<ListObjectsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, params.pageSize ?? 25);
  const skip = (page - 1) * pageSize;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`o.org_id = ${orgId}`,
    Prisma.sql`o.lifecycle = 'active'`,
  ];

  if (params.sourceId) {
    conditions.push(Prisma.sql`o.source_id = ${params.sourceId}::uuid`);
  }
  if (params.catalog) {
    conditions.push(Prisma.sql`o.catalog_name = ${params.catalog}`);
  }
  if (params.schema) {
    conditions.push(Prisma.sql`o.schema_name = ${params.schema}`);
  }
  if (params.status) {
    conditions.push(Prisma.sql`s.status = ${params.status}`);
  }
  if (params.stale !== undefined) {
    if (params.stale) {
      conditions.push(Prisma.sql`(o.last_t1_at IS NULL OR o.last_t1_at < o.last_t0_at)`);
    } else {
      conditions.push(Prisma.sql`(o.last_t1_at IS NOT NULL AND o.last_t1_at >= o.last_t0_at)`);
    }
  }
  if (params.hasPii !== undefined) {
    if (params.hasPii) {
      conditions.push(Prisma.sql`(s.card->'pii_columns' IS NOT NULL AND jsonb_array_length(s.card->'pii_columns') > 0)`);
    } else {
      conditions.push(Prisma.sql`(s.card->'pii_columns' IS NULL OR jsonb_array_length(s.card->'pii_columns') = 0)`);
    }
  }
  if (params.q) {
    const likePattern = `%${params.q}%`;
    conditions.push(Prisma.sql`(o.full_path ILIKE ${likePattern} OR s.card->>'summary' ILIKE ${likePattern})`);
  }

  const whereClause = Prisma.join(conditions, ' AND ');

  let orderClause = Prisma.sql`o.full_path ASC`;
  if (params.sort === 'rows') {
    orderClause = Prisma.sql`o.row_count_est DESC NULLS LAST`;
  } else if (params.sort === 'last_seen') {
    orderClause = Prisma.sql`COALESCE(o.last_t0_at, o.source_altered_at) DESC NULLS LAST`;
  }

  // Count total matching records
  const countQuery = Prisma.sql`
    WITH latest_semantics AS (
      SELECT DISTINCT ON (subject_id) subject_id, status, card
      FROM platform_context_semantics
      WHERE subject_kind = 'object' AND org_id = ${orgId}
      ORDER BY subject_id, version DESC
    )
    SELECT COUNT(*)::int AS count
    FROM platform_context_objects o
    LEFT JOIN latest_semantics s ON o.id = s.subject_id
    WHERE ${whereClause}
  `;

  const countRes = await prisma.$queryRaw<Array<{ count: number }>>(countQuery);
  const total = countRes[0]?.count ?? 0;

  // Retrieve paginated ids
  const idsQuery = Prisma.sql`
    WITH latest_semantics AS (
      SELECT DISTINCT ON (subject_id) subject_id, status, card
      FROM platform_context_semantics
      WHERE subject_kind = 'object' AND org_id = ${orgId}
      ORDER BY subject_id, version DESC
    )
    SELECT o.id
    FROM platform_context_objects o
    LEFT JOIN latest_semantics s ON o.id = s.subject_id
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${pageSize} OFFSET ${skip}
  `;

  const idRows = await prisma.$queryRaw<Array<{ id: string }>>(idsQuery);
  const ids = idRows.map((r) => r.id);

  // Fetch full objects and sort them to match the sorted ids list
  const items =
    ids.length > 0
      ? await prisma.platformContextObject.findMany({
          where: { id: { in: ids } },
        })
      : [];

  // Fetch the latest semantics for the ids in batch
  const semantics =
    ids.length > 0
      ? await prisma.platformContextSemantic.findMany({
          where: {
            subject_kind: 'object',
            subject_id: { in: ids },
            org_id: orgId,
          },
          orderBy: [
            { subject_id: 'asc' },
            { version: 'desc' },
          ],
        })
      : [];

  const semanticsMap = new Map<string, typeof semantics[0]>();
  for (const s of semantics) {
    if (!semanticsMap.has(s.subject_id)) {
      semanticsMap.set(s.subject_id, s);
    }
  }

  const itemsMap = new Map(items.map((item) => [item.id, item]));
  const sortedItems = ids
    .map((id) => {
      const item = itemsMap.get(id);
      if (!item) return undefined;
      const sem = semanticsMap.get(id);
      const card = sem?.card as any;
      return {
        ...item,
        semantic_status: sem?.status ?? 'uncatalogued',
        semantic_summary: card?.summary ?? null,
        pii_columns: card?.pii_columns ?? null,
      };
    })
    .filter((item): item is any => item !== undefined);

  return {
    items: sortedItems,
    total,
    page,
    pageSize,
  };
}

// ── 2. getObjectAggregate ──────────────────────────────────────────────────────

export interface ObjectAggregateResult {
  object: PlatformContextObject;
  columns: any[];
  latestSemanticCard: any | null;
  latestSemanticStatus: string | null;
  /** DS3a: id of the specific semantic card row rendered — must be passed back on confirm */
  latestSemanticId: string | null;
  /** DS3a: version of the specific semantic card row rendered — used for the version guard */
  latestSemanticVersion: number | null;
  /** DS3a: true if a PlatformContextEmbedding row exists for this object (Published lifecycle signal) */
  hasEmbedding: boolean;
  profileHistory: any[];
  freshness: any;
  entityGroupObjects: PlatformContextObject[];
  proposedMappings: any[];
  objectLinks: any[];
  lastJobs: PlatformContextJob[];
  usageSnapshot: (UsageObjectResult & { co_object_id_map: Record<string, string> }) | null;
  semanticModel: {
    entity_id: string;
    entity_model_id: string | null;
    entity_label: string;
    description: string | null;
    status: string;
    dimensions: Array<{ column_name: string; dimension_label: string; dimension_type: string; description: string | null }>;
    measures: Array<{ column_name: string | null; measure_label: string; aggregate: string; description: string | null; unit: string | null }>;
  } | null;
  dataScore: DataScoreResult;
}

export async function getObjectAggregate(
  orgId: string,
  objectId: string,
): Promise<ObjectAggregateResult | null> {
  const obj = await prisma.platformContextObject.findFirst({
    where: { id: objectId, org_id: orgId },
  });
  if (!obj) return null;

  // 1. Fetch columns (with profile and semantic JSONB fields inline)
  const columns = await prisma.platformContextColumn.findMany({
    where: { object_id: objectId, lifecycle: 'active' },
    orderBy: { ordinal: 'asc' },
  });

  // 2. Fetch latest semantic card
  const latestSemantic = await prisma.platformContextSemantic.findFirst({
    where: { subject_kind: 'object', subject_id: objectId },
    orderBy: { version: 'desc' },
  });

  // 3. Fetch profile history (last 10 profiles with drift JSONB)
  const profileHistory = await prisma.platformContextProfile.findMany({
    where: { object_id: objectId },
    orderBy: { version: 'desc' },
    take: 10,
  });

  // 4. Freshness contract
  const freshness = buildFreshness({
    last_t0_at: obj.last_t0_at,
    last_t1_at: obj.last_t1_at,
    source_altered_at: obj.source_altered_at,
  });

  // 5. Entity group objects (using containment operator @>)
  const entityTags = obj.entity_tags as {
    groups?: Array<{ label: string; member_paths: string[] }>;
  } | null;
  const groupNames = entityTags?.groups?.map((g) => g.label) ?? [];
  let siblingObjects: PlatformContextObject[] = [];

  if (groupNames.length > 0) {
    const conditions = groupNames.map((name) => {
      const jsonStr = JSON.stringify({ groups: [{ label: name }] });
      return Prisma.sql`entity_tags @> ${jsonStr}::jsonb`;
    });
    const siblingQuery = Prisma.sql`
      SELECT * FROM platform_context_objects
      WHERE org_id = ${orgId}
        AND lifecycle = 'active'
        AND id != ${objectId}::uuid
        AND (${Prisma.join(conditions, ' OR ')})
    `;
    siblingObjects = await prisma.$queryRaw<PlatformContextObject[]>(siblingQuery);
  }

  // 6. Proposed mappings
  const proposedMappings = await prisma.platformContextMapping.findMany({
    where: {
      org_id: orgId,
      status: 'proposed',
      OR: [
        { left_column: { object_id: objectId } },
        { right_column: { object_id: objectId } },
      ],
    },
    include: {
      left_column: true,
      right_column: true,
    },
  });

  // 7. Object links
  const objectLinks = await prisma.platformContextObjectLink.findMany({
    where: {
      org_id: orgId,
      OR: [
        { left_object_id: objectId },
        { right_object_id: objectId },
      ],
    },
  });

  // 8. Last 5 jobs whose scope contains this object's full path
  const fullPath = obj.full_path;
  const jobsQuery = Prisma.sql`
    SELECT * FROM platform_context_jobs
    WHERE org_id = ${orgId}
      AND (
        scope->>'path' = ${fullPath}
        OR scope->>'leftScope' = ${fullPath}
        OR scope->>'rightScope' = ${fullPath}
      )
    ORDER BY created_at DESC
    LIMIT 5
  `;
  const lastJobs = await prisma.$queryRaw<PlatformContextJob[]>(jobsQuery);

  // 9. Usage snapshot (T3) — only when T3 harvest has run for this object
  let usageSnapshot: (UsageObjectResult & { co_object_id_map: Record<string, string> }) | null = null;
  if (obj.last_t3_at) {
    const rawUsage = await usageObject(obj.full_path, orgId);
    if (rawUsage) {
      // Resolve co-object full_paths → object IDs (single batch query)
      const coObjs = Array.isArray(rawUsage.co_objects) ? rawUsage.co_objects as Array<{ full_path?: string }> : [];
      const coPaths = coObjs.map((c) => c.full_path).filter((p): p is string => typeof p === 'string');
      let coObjIdMap: Record<string, string> = {};
      if (coPaths.length > 0) {
        const coRows = await prisma.platformContextObject.findMany({
          where: { org_id: orgId, full_path: { in: coPaths }, lifecycle: 'active' },
          select: { id: true, full_path: true },
        });
        coObjIdMap = Object.fromEntries(coRows.map((r) => [r.full_path, r.id]));
      }
      usageSnapshot = { ...rawUsage, co_object_id_map: coObjIdMap };
    }
  }

  // 10. T4 semantic model — entity proposed for this table's full_path
  let semanticModel: ObjectAggregateResult['semanticModel'] = null;
  if (obj.last_t4_at) {
    const entity = await prisma.platform_sem_entities.findFirst({
      where: { org_id: orgId, full_path: obj.full_path, status: 'candidate' },
      include: {
        platform_sem_dimensions: { orderBy: { column_name: 'asc' } },
        platform_sem_measures: { orderBy: { measure_label: 'asc' } },
      },
    });
    if (entity) {
      semanticModel = {
        entity_id: entity.id,
        entity_model_id: entity.model_id ?? null,
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
      };
    }
  }

  // 11. DS3a: embedding presence (Published lifecycle signal)
  const embeddingCount = await prisma.platformContextEmbedding.count({
    where: { subject_kind: 'object', subject_id: objectId },
  });
  const hasEmbedding = embeddingCount > 0;

  const aggregate = {
    object: obj,
    columns,
    latestSemanticCard: latestSemantic?.card ?? null,
    latestSemanticStatus: latestSemantic?.status ?? null,
    latestSemanticId: latestSemantic?.id ?? null,
    latestSemanticVersion: latestSemantic?.version ?? null,
    hasEmbedding,
    profileHistory,
    freshness,
    entityGroupObjects: siblingObjects,
    proposedMappings,
    objectLinks,
    lastJobs,
    usageSnapshot,
    semanticModel,
  };

  return {
    ...aggregate,
    dataScore: computeDataScore(assembleDimensionInput(aggregate)),
  };
}

// ── 3. listJobsPage ────────────────────────────────────────────────────────────

export interface ListJobsParams {
  kind?: string;
  status?: string;
  sourceId?: string;
  after?: string;
  before?: string;
  page?: number;
  pageSize?: number;
}

export interface ListJobsResult {
  items: PlatformContextJob[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listJobsPage(
  orgId: string,
  params: ListJobsParams,
): Promise<ListJobsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, params.pageSize ?? 50);
  const skip = (page - 1) * pageSize;

  const isChildKind = params.kind === 't4_entity_propose' || params.kind === 't4_dim_propose';

  const where: Prisma.PlatformContextJobWhereInput = {
    org_id: orgId,
    // Child jobs are normally hidden (they appear in their parent's expand panel).
    // T4 child kinds are the observable unit of work, so we include them.
    ...(isChildKind ? {} : { parent_job_id: null }),
    ...(params.kind ? { job_kind: params.kind } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.sourceId ? { source_id: params.sourceId } : {}),
    ...(params.after || params.before
      ? {
          created_at: {
            ...(params.after ? { gte: new Date(params.after) } : {}),
            ...(params.before ? { lte: new Date(params.before) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.platformContextJob.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.platformContextJob.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

// ── 4. getJob ──────────────────────────────────────────────────────────────────

export async function getJob(orgId: string, jobId: string): Promise<PlatformContextJob | null> {
  return prisma.platformContextJob.findFirst({
    where: { id: jobId, org_id: orgId },
  });
}

// ── 4b. getObjectsTouchedByJob ─────────────────────────────────────────────────

export interface ObjectTouchedByJob {
  id: string;
  full_path: string;
  object_kind: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  tiers_touched: string[];
  last_touched_at: string;
}

export async function getObjectsTouchedByJob(
  orgId: string,
  jobId: string,
): Promise<ObjectTouchedByJob[]> {
  const job = await prisma.platformContextJob.findFirst({
    where: { id: jobId, org_id: orgId },
    select: { source_id: true, started_at: true, finished_at: true },
  });

  if (!job?.started_at) return [];

  const windowStart = new Date(job.started_at.getTime() - 5_000);
  const windowEnd = new Date((job.finished_at ?? new Date()).getTime() + 5_000);

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    full_path: string;
    object_kind: string;
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
    last_t0_at: Date | null;
    last_t1_at: Date | null;
    last_t2_at: Date | null;
    last_knowledge_sync_at: Date | null;
  }>>(Prisma.sql`
    SELECT id, full_path, object_kind, catalog_name, schema_name, object_name,
           last_t0_at, last_t1_at, last_t2_at, last_knowledge_sync_at
    FROM platform_context_objects
    WHERE org_id = ${orgId}
      ${job.source_id ? Prisma.sql`AND source_id = ${job.source_id}::uuid` : Prisma.sql``}
      AND (
        (last_t0_at BETWEEN ${windowStart} AND ${windowEnd})
        OR (last_t1_at BETWEEN ${windowStart} AND ${windowEnd})
        OR (last_t2_at BETWEEN ${windowStart} AND ${windowEnd})
        OR (last_knowledge_sync_at BETWEEN ${windowStart} AND ${windowEnd})
      )
    ORDER BY full_path
    LIMIT 500
  `);

  return rows.map(row => {
    const tiers: string[] = [];
    let maxTs = 0;
    if (row.last_t0_at && row.last_t0_at >= windowStart && row.last_t0_at <= windowEnd) {
      tiers.push('t0_structural'); maxTs = Math.max(maxTs, row.last_t0_at.getTime());
    }
    if (row.last_t1_at && row.last_t1_at >= windowStart && row.last_t1_at <= windowEnd) {
      tiers.push('t1_profile'); maxTs = Math.max(maxTs, row.last_t1_at.getTime());
    }
    if (row.last_t2_at && row.last_t2_at >= windowStart && row.last_t2_at <= windowEnd) {
      tiers.push('t2_semantic'); maxTs = Math.max(maxTs, row.last_t2_at.getTime());
    }
    if (row.last_knowledge_sync_at && row.last_knowledge_sync_at >= windowStart && row.last_knowledge_sync_at <= windowEnd) {
      tiers.push('knowledge_sync'); maxTs = Math.max(maxTs, row.last_knowledge_sync_at.getTime());
    }
    return {
      id: row.id, full_path: row.full_path, object_kind: row.object_kind,
      catalog_name: row.catalog_name, schema_name: row.schema_name, object_name: row.object_name,
      tiers_touched: tiers, last_touched_at: new Date(maxTs).toISOString(),
    };
  });
}

// ── 5. getSourceCoverage ───────────────────────────────────────────────────────

export interface SourceCoverageResult {
  estate_total: number;
  objects_total: number;
  profiled: number;
  enriched: number;
  embedded: number;
  last_t0_at: Date | null;
  last_t1_at: Date | null;
  last_inventoried_at: Date | null;
  stale_count: number;
  queued_count: number;
}

export async function getSourceCoverage(
  orgId: string,
  sourceId: string,
): Promise<SourceCoverageResult> {
  const staleCutoff = new Date(Date.now() - ESTATE_STALE_SWEEP_DAYS * 86_400_000);

  const result = await prisma.$queryRaw<any[]>`
    SELECT
      (SELECT COUNT(*)::int FROM platform_estate_objects
       WHERE source_id = ${sourceId} AND org_id = ${orgId} AND lifecycle = 'active') AS estate_total,
      (SELECT COUNT(*)::int FROM platform_estate_objects
       WHERE source_id = ${sourceId} AND org_id = ${orgId} AND lifecycle = 'active'
         AND last_inventoried_at < ${staleCutoff}) AS stale_count,
      (SELECT MAX(last_inventoried_at) FROM platform_estate_objects
       WHERE source_id = ${sourceId} AND org_id = ${orgId} AND lifecycle = 'active') AS last_inventoried_at,
      COUNT(*)::int AS objects_total,
      COUNT(CASE WHEN o.last_t1_at IS NOT NULL THEN 1 END)::int AS profiled,
      COUNT(CASE WHEN o.last_t2_at IS NOT NULL THEN 1 END)::int AS enriched,
      COUNT(CASE WHEN e.subject_id IS NOT NULL THEN 1 END)::int AS embedded,
      MAX(o.last_t0_at) AS last_t0_at,
      MAX(o.last_t1_at) AS last_t1_at,
      (SELECT COUNT(*)::int FROM platform_context_jobs WHERE source_id = ${sourceId}::uuid AND status = 'queued' AND org_id = ${orgId}) AS queued_count
    FROM platform_context_objects o
    LEFT JOIN platform_context_embeddings e ON o.id = e.subject_id AND e.subject_kind = 'object' AND e.org_id = ${orgId}
    WHERE o.source_id = ${sourceId}::uuid AND o.org_id = ${orgId} AND o.lifecycle = 'active'
  `;

  const row = result[0];
  return {
    estate_total: row?.estate_total ?? 0,
    objects_total: row?.objects_total ?? 0,
    profiled: row?.profiled ?? 0,
    enriched: row?.enriched ?? 0,
    embedded: row?.embedded ?? 0,
    last_t0_at: row?.last_t0_at ?? null,
    last_t1_at: row?.last_t1_at ?? null,
    last_inventoried_at: row?.last_inventoried_at ?? null,
    stale_count: row?.stale_count ?? 0,
    queued_count: row?.queued_count ?? 0,
  };
}

// ── 6. listMappingsPage ────────────────────────────────────────────────────────

export interface ListMappingsParams {
  sourceId?: string;
  status?: string;
  kind?: string;
  minConfidence?: number;
  page?: number;
  pageSize?: number;
}

export interface ListMappingsResult {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listMappingsPage(
  orgId: string,
  params: ListMappingsParams,
): Promise<ListMappingsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, params.pageSize ?? 25);
  const skip = (page - 1) * pageSize;

  const where: Prisma.PlatformContextMappingWhereInput = {
    org_id: orgId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.kind ? { mapping_kind: params.kind } : {}),
    ...(params.minConfidence !== undefined ? { confidence: { gte: params.minConfidence } } : {}),
    ...(params.sourceId ? {
      OR: [
        { left_column: { object: { source_id: params.sourceId } } },
        { right_column: { object: { source_id: params.sourceId } } },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.platformContextMapping.findMany({
      where,
      include: {
        left_column: {
          include: {
            object: true,
          },
        },
        right_column: {
          include: {
            object: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.platformContextMapping.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

// ── 7. listObjectLinksPage ─────────────────────────────────────────────────────

export interface ListObjectLinksParams {
  objectId?: string;
  status?: string;
  kind?: string;
  page?: number;
  pageSize?: number;
}

export interface ListObjectLinksResult {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listObjectLinksPage(
  orgId: string,
  params: ListObjectLinksParams,
): Promise<ListObjectLinksResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, params.pageSize ?? 25);
  const skip = (page - 1) * pageSize;

  const where: Prisma.PlatformContextObjectLinkWhereInput = {
    org_id: orgId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.kind ? { link_kind: params.kind } : {}),
    ...(params.objectId ? {
      OR: [
        { left_object_id: params.objectId },
        { right_object_id: params.objectId },
      ],
    } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.platformContextObjectLink.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.platformContextObjectLink.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

// ── 8. listScannedObjects ──────────────────────────────────────────────────────

export interface ListScannedObjectsParams {
  sourceId?: string;
  kind?: string;
  tier?: 't0' | 't1' | 't2' | 'embed' | 't3' | 't4';
  catalog?: string;
  schema?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  excludeTestSources?: boolean;
}

export interface ScannedObjectRow {
  id: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  object_kind: string;
  row_count_est: string | null;
  last_t0_at: Date | null;
  last_t1_at: Date | null;
  last_t2_at: Date | null;
  last_t3_at: Date | null;
  last_t4_at: Date | null;
  has_embedding: boolean;
  lifecycle: string;
  source_id: string;
  source_name: string | null;
}

export interface ScannedTierCounts {
  t0: number;
  t1: number;
  t2: number;
  embed: number;
  t3: number;
  t4: number;
}

export interface ListScannedObjectsResult {
  items: ScannedObjectRow[];
  total: number;
  tierCounts: ScannedTierCounts;
  page: number;
  pageSize: number;
}

export async function listScannedObjects(
  orgId: string,
  params: ListScannedObjectsParams,
): Promise<ListScannedObjectsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, params.pageSize ?? 50));
  const skip = (page - 1) * pageSize;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`o.org_id = ${orgId}`,
    Prisma.sql`o.lifecycle = 'active'`,
    Prisma.sql`o.last_t0_at IS NOT NULL`,
  ];

  if (params.excludeTestSources) {
    conditions.push(Prisma.sql`o.source_id NOT IN (
      SELECT id FROM platform_context_sources
      WHERE org_id = ${orgId} AND (${Prisma.raw(TEST_SOURCE_DISPLAY_NAME_SQL)})
    )`);
  }

  if (params.sourceId) {
    conditions.push(Prisma.sql`o.source_id = ${params.sourceId}::uuid`);
  }
  if (params.kind) {
    conditions.push(Prisma.sql`o.object_kind = ${params.kind}`);
  }
  if (params.tier) {
    switch (params.tier) {
      case 't0':
        conditions.push(Prisma.sql`o.last_t0_at IS NOT NULL AND o.last_t1_at IS NULL`);
        break;
      case 't1':
        conditions.push(Prisma.sql`o.last_t1_at IS NOT NULL AND o.last_t2_at IS NULL`);
        break;
      case 't2':
        conditions.push(Prisma.sql`o.last_t2_at IS NOT NULL`);
        break;
      case 'embed':
        conditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM platform_context_embeddings e2
          WHERE e2.subject_id = o.id AND e2.subject_kind = 'object' AND e2.org_id = ${orgId}
        )`);
        break;
      case 't3':
        conditions.push(Prisma.sql`o.last_t3_at IS NOT NULL`);
        break;
      case 't4':
        conditions.push(Prisma.sql`o.last_t4_at IS NOT NULL`);
        break;
    }
  }
  if (params.catalog) {
    conditions.push(Prisma.sql`o.catalog_name = ${params.catalog}`);
  }
  if (params.schema) {
    conditions.push(Prisma.sql`o.schema_name = ${params.schema}`);
  }
  if (params.q) {
    conditions.push(Prisma.sql`o.full_path ILIKE ${'%' + params.q + '%'}`);
  }

  const whereClause = Prisma.join(conditions, ' AND ');

  const [countRes, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number; t0: number; t1: number; t2: number; embed: number; t3: number; t4: number }>>(Prisma.sql`
      SELECT
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE o.last_t0_at IS NOT NULL)::int AS t0,
        COUNT(*) FILTER (WHERE o.last_t1_at IS NOT NULL)::int AS t1,
        COUNT(*) FILTER (WHERE o.last_t2_at IS NOT NULL)::int AS t2,
        COUNT(*) FILTER (WHERE e.subject_id IS NOT NULL)::int AS embed,
        COUNT(*) FILTER (WHERE o.last_t3_at IS NOT NULL)::int AS t3,
        COUNT(*) FILTER (WHERE o.last_t4_at IS NOT NULL)::int AS t4
      FROM platform_context_objects o
      LEFT JOIN platform_context_embeddings e ON o.id = e.subject_id AND e.subject_kind = 'object' AND e.org_id = ${orgId}
      WHERE ${whereClause}
    `),
    prisma.$queryRaw<Array<{
      id: string;
      full_path: string;
      catalog_name: string | null;
      schema_name: string | null;
      object_name: string | null;
      object_kind: string;
      row_count_est: bigint | null;
      last_t0_at: Date | null;
      last_t1_at: Date | null;
      last_t2_at: Date | null;
      last_t3_at: Date | null;
      last_t4_at: Date | null;
      has_embedding: boolean;
      lifecycle: string;
      source_id: string;
      source_name: string | null;
    }>>(Prisma.sql`
      SELECT
        o.id,
        o.full_path,
        o.catalog_name,
        o.schema_name,
        o.object_name,
        o.object_kind,
        o.row_count_est,
        o.last_t0_at,
        o.last_t1_at,
        o.last_t2_at,
        o.last_t3_at,
        o.last_t4_at,
        (e.subject_id IS NOT NULL) AS has_embedding,
        o.lifecycle,
        o.source_id,
        s.display_name AS source_name
      FROM platform_context_objects o
      LEFT JOIN platform_context_sources s ON o.source_id = s.id
      LEFT JOIN platform_context_embeddings e ON o.id = e.subject_id AND e.subject_kind = 'object' AND e.org_id = ${orgId}
      WHERE ${whereClause}
      ORDER BY o.full_path ASC
      LIMIT ${pageSize} OFFSET ${skip}
    `),
  ]);

  const total = countRes[0]?.count ?? 0;
  const tierCounts: ScannedTierCounts = {
    t0: countRes[0]?.t0 ?? 0,
    t1: countRes[0]?.t1 ?? 0,
    t2: countRes[0]?.t2 ?? 0,
    embed: countRes[0]?.embed ?? 0,
    t3: countRes[0]?.t3 ?? 0,
    t4: countRes[0]?.t4 ?? 0,
  };
  const items: ScannedObjectRow[] = rows.map((row) => ({
    id: row.id,
    full_path: row.full_path,
    catalog_name: row.catalog_name,
    schema_name: row.schema_name,
    object_name: row.object_name,
    object_kind: row.object_kind,
    row_count_est: row.row_count_est !== null ? String(row.row_count_est) : null,
    last_t0_at: row.last_t0_at,
    last_t1_at: row.last_t1_at,
    last_t2_at: row.last_t2_at,
    last_t3_at: row.last_t3_at,
    last_t4_at: row.last_t4_at,
    has_embedding: Boolean(row.has_embedding),
    lifecycle: row.lifecycle,
    source_id: row.source_id,
    source_name: row.source_name,
  }));

  return { items, total, tierCounts, page, pageSize };
}

// ── 8b. listScannedFacets ────────────────────────────────────────────────────────

export async function listScannedFacets(
  orgId: string,
  opts: { excludeTestSources?: boolean } = {},
): Promise<{
  catalogs: { name: string; count: number }[];
  schemas: { catalog: string; name: string; count: number }[];
}> {
  const testExclusion = opts.excludeTestSources
    ? `AND source_id NOT IN (
        SELECT id FROM platform_context_sources
        WHERE org_id = $1 AND (${TEST_SOURCE_DISPLAY_NAME_SQL})
      )`
    : '';

  const [catalogs, schemas] = await Promise.all([
    prisma.$queryRawUnsafe<{ name: string; count: number }[]>(
      `SELECT catalog_name AS name, COUNT(*)::int AS count
       FROM platform_context_objects
       WHERE org_id = $1 AND lifecycle = 'active' AND last_t0_at IS NOT NULL AND catalog_name IS NOT NULL ${testExclusion}
       GROUP BY catalog_name
       ORDER BY catalog_name`,
      orgId,
    ),
    prisma.$queryRawUnsafe<{ catalog: string; name: string; count: number }[]>(
      `SELECT catalog_name AS catalog, schema_name AS name, COUNT(*)::int AS count
       FROM platform_context_objects
       WHERE org_id = $1 AND lifecycle = 'active' AND last_t0_at IS NOT NULL AND catalog_name IS NOT NULL AND schema_name IS NOT NULL ${testExclusion}
       GROUP BY catalog_name, schema_name
       ORDER BY catalog_name, schema_name`,
      orgId,
    ),
  ]);

  return { catalogs, schemas };
}

// ── 9. listQueuedJobs ──────────────────────────────────────────────────────────

export async function listQueuedJobs(orgId: string): Promise<PlatformContextJob[]> {
  return prisma.platformContextJob.findMany({
    where: { org_id: orgId, status: 'queued', parent_job_id: null },
    orderBy: { created_at: 'asc' },
  });
}

// ── 10. listJobKindSummaries ───────────────────────────────────────────────────

export interface JobKindSummary {
  kind: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  last_finished_at: Date | null;
}

export async function listJobKindSummaries(orgId: string): Promise<JobKindSummary[]> {
  const rows = await prisma.$queryRaw<Array<{
    job_kind: string;
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    last_finished_at: Date | null;
  }>>`
    SELECT
      job_kind,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'queued' THEN 1 END)::int AS queued,
      COUNT(CASE WHEN status = 'running' THEN 1 END)::int AS running,
      COUNT(CASE WHEN status = 'succeeded' THEN 1 END)::int AS succeeded,
      COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed,
      MAX(finished_at) AS last_finished_at
    FROM platform_context_jobs
    WHERE org_id = ${orgId}
      AND (
        parent_job_id IS NULL
        OR job_kind IN ('t4_entity_propose', 't4_dim_propose')
      )
    GROUP BY job_kind
    ORDER BY job_kind ASC
  `;

  return rows.map((row) => ({
    kind: row.job_kind,
    total: row.total,
    queued: row.queued,
    running: row.running,
    succeeded: row.succeeded,
    failed: row.failed,
    last_finished_at: row.last_finished_at,
  }));
}

// ── 11. listJobDateGroups ──────────────────────────────────────────────────────

export interface JobDateGroup {
  date: string;
  count: number;
  succeeded: number;
  failed: number;
  queued: number;
  running: number;
  total_duration_s: number;
}

export async function listJobDateGroups(orgId: string, kind: string): Promise<JobDateGroup[]> {
  const rows = await prisma.$queryRaw<Array<{
    day: Date;
    count: number;
    succeeded: number;
    failed: number;
    queued: number;
    running: number;
    total_duration_s: number;
  }>>`
    SELECT
      DATE(created_at AT TIME ZONE 'UTC') AS day,
      COUNT(*)::int AS count,
      COUNT(CASE WHEN status = 'succeeded' THEN 1 END)::int AS succeeded,
      COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed,
      COUNT(CASE WHEN status = 'queued' THEN 1 END)::int AS queued,
      COUNT(CASE WHEN status = 'running' THEN 1 END)::int AS running,
      COALESCE(SUM(
        CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (finished_at - started_at))
          ELSE 0
        END
      ), 0)::int AS total_duration_s
    FROM platform_context_jobs
    WHERE org_id = ${orgId}
      AND job_kind = ${kind}
      AND (
        parent_job_id IS NULL
        OR job_kind IN ('t4_entity_propose', 't4_dim_propose')
      )
    GROUP BY day
    ORDER BY day DESC
    LIMIT 90
  `;

  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    count: row.count,
    succeeded: row.succeeded,
    failed: row.failed,
    queued: row.queued,
    running: row.running,
    total_duration_s: row.total_duration_s,
  }));
}

// ── 12. listEstateObjects ───────────────────────────────────────────────────

export interface EstateListRow {
  id: string;
  org_id: string;
  source_id: string | null;
  full_path: string;
  catalog_name: string;
  schema_name: string;
  object_name: string;
  object_type: string;
  comment: string | null;
  last_altered_src: Date | null;
  lifecycle: string;
  harvest_state: string | null;
  first_inventoried_at: Date;
  last_inventoried_at: Date;
  row_count_est: number | null;
  last_t0_at: Date | null;
  last_t1_at: Date | null;
  last_t2_at: Date | null;
  last_t3_at: Date | null;
  last_t4_at: Date | null;
  has_embedding: boolean;
  last_knowledge_sync_at: Date | null;
  live_harvest_state: 'none' | 'scheduled' | 'queued' | 'harvested' | 'inaccessible';
  context_object_id: string | null;
}

export async function listEstateObjects(
  orgId: string,
  opts: {
    page?: number;
    pageSize?: number;
    catalog?: string;
    schema?: string;
    kind?: string;
    harvest?: 'none' | 'discovered' | 'scheduled' | 'queued' | 'harvested' | 'published' | 'stale' | 'inaccessible';
    q?: string;
    excludeTestSources?: boolean;
  },
): Promise<{ rows: EstateListRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [
    `peo.org_id = $1`,
    `peo.lifecycle = 'active'`,
  ];
  const params: any[] = [orgId];
  let paramIdx = 2;

  if (opts.excludeTestSources) {
    conditions.push(`(peo.source_id IS NULL OR peo.source_id::uuid NOT IN (
      SELECT id FROM platform_context_sources
      WHERE org_id = $1 AND (${TEST_SOURCE_DISPLAY_NAME_SQL})
    ))`);
  }

  if (opts.catalog) {
    conditions.push(`peo.catalog_name = $${paramIdx}`);
    params.push(opts.catalog);
    paramIdx++;
  }
  if (opts.schema) {
    conditions.push(`peo.schema_name = $${paramIdx}`);
    params.push(opts.schema);
    paramIdx++;
  }
  if (opts.kind) {
    conditions.push(`peo.object_type = $${paramIdx}`);
    params.push(opts.kind);
    paramIdx++;
  }
  if (opts.q) {
    const pattern = `%${opts.q}%`;
    conditions.push(`(peo.full_path ILIKE $${paramIdx} OR peo.comment ILIKE $${paramIdx})`);
    params.push(pattern);
    paramIdx++;
  }

  const harvestCase = `CASE
    WHEN pco.id IS NOT NULL                    THEN 'harvested'
    WHEN peo.harvest_state = 'queued'          THEN 'queued'
    WHEN peo.harvest_state = 'scheduled'       THEN 'scheduled'
    WHEN peo.harvest_state = 'inaccessible'    THEN 'inaccessible'
    ELSE                                            'none'
  END`;

  if (opts.harvest) {
    const h = opts.harvest;
    if (h === 'discovered') {
      conditions.push(`(${harvestCase}) = 'none'`);
    } else if (h === 'scheduled') {
      conditions.push(`(${harvestCase}) = 'scheduled'`);
    } else if (h === 'inaccessible') {
      conditions.push(`(${harvestCase}) = 'inaccessible'`);
    } else if (h === 'published') {
      conditions.push(`pco.id IS NOT NULL AND pco.last_knowledge_sync_at IS NOT NULL AND pco.last_knowledge_sync_at >= COALESCE(pco.last_t2_at, pco.last_t0_at)`);
    } else if (h === 'stale') {
      conditions.push(`pco.id IS NOT NULL AND pco.last_knowledge_sync_at IS NOT NULL AND pco.last_knowledge_sync_at < pco.last_t2_at`);
    } else {
      conditions.push(`(${harvestCase}) = $${paramIdx}`);
      params.push(h);
      paramIdx++;
    }
  }

  const whereClause = conditions.join(' AND ');

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM platform_estate_objects peo
    LEFT JOIN platform_context_objects pco
      ON pco.org_id = peo.org_id AND pco.full_path = peo.full_path
    WHERE ${whereClause}
  `;

  const dataSql = `
    SELECT
      peo.id, peo.org_id, peo.source_id, peo.full_path,
      peo.catalog_name, peo.schema_name, peo.object_name,
      peo.object_type, peo.comment, peo.last_altered_src,
      peo.lifecycle, peo.harvest_state,
      peo.first_inventoried_at, peo.last_inventoried_at,
      pco.id AS context_object_id,
      pco.row_count_est,
      pco.last_t0_at, pco.last_t1_at, pco.last_t2_at, pco.last_t3_at, pco.last_t4_at,
      pco.last_knowledge_sync_at,
      (e.subject_id IS NOT NULL) AS has_embedding,
      ${harvestCase} AS live_harvest_state
    FROM platform_estate_objects peo
    LEFT JOIN platform_context_objects pco
      ON pco.org_id = peo.org_id AND pco.full_path = peo.full_path
    LEFT JOIN platform_context_embeddings e
      ON e.subject_id = pco.id AND e.subject_kind = 'object' AND e.org_id = peo.org_id
    WHERE ${whereClause}
    ORDER BY peo.catalog_name, peo.schema_name, peo.object_name
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  params.push(pageSize, offset);

  const [countRes, rows] = await Promise.all([
    prisma.$queryRawUnsafe<{ total: number }[]>(countSql, ...params.slice(0, paramIdx - 1)),
    prisma.$queryRawUnsafe<any[]>(dataSql, ...params),
  ]);

  const total = countRes[0]?.total ?? 0;

  const mapped: EstateListRow[] = rows.map((r: any) => ({
    id: r.id,
    org_id: r.org_id,
    source_id: r.source_id,
    full_path: r.full_path,
    catalog_name: r.catalog_name,
    schema_name: r.schema_name,
    object_name: r.object_name,
    object_type: r.object_type,
    comment: r.comment,
    last_altered_src: r.last_altered_src,
    lifecycle: r.lifecycle,
    harvest_state: r.harvest_state,
    first_inventoried_at: r.first_inventoried_at,
    last_inventoried_at: r.last_inventoried_at,
    row_count_est: r.row_count_est !== null ? Number(r.row_count_est) : null,
    last_t0_at: r.last_t0_at,
    last_t1_at: r.last_t1_at,
    last_t2_at: r.last_t2_at,
    last_t3_at: r.last_t3_at ?? null,
    last_t4_at: r.last_t4_at ?? null,
    has_embedding: Boolean(r.has_embedding),
    last_knowledge_sync_at: r.last_knowledge_sync_at,
    live_harvest_state: r.live_harvest_state,
    context_object_id: r.context_object_id ?? null,
  }));

  return { rows: mapped, total, page, pageSize };
}

// ── 12b. getCoverageSummary ──────────────────────────────────────────────────
// WS4: green T1 jobs hide degraded objects, and semantic coverage is invisible.
// This rolls up — for a single source or the whole estate — active-object counts,
// semantic coverage, and per-object/per-column degrade signals straight from
// platform_context_profiles / platform_context_columns, so the summary API can
// surface them without any manual table joins.

// platform_context_semantics(subject_kind='object') is written by TWO tiers:
//   - T2 semantic enrichment writes status='assumed' (the real semantic card).
//   - T3 usage writes status='observed' (a usage narrative, NOT a semantic card).
// Both append versions to the same subject, so semantic *coverage* must count only
// T2 cards. We exclude the known T3 status rather than whitelisting 'assumed' so a
// future human-confirmed upgrade status still counts as covered.
// (Verified against live estate: 460 assumed / 226 observed rows = the "686" total.)
const T3_USAGE_SEMANTIC_STATUS = 'observed';

export interface CoverageSummary {
  scope: 'source' | 'estate';
  source_id: string | null;
  /** Distinct active objects in scope. */
  active_objects: number;
  /**
   * Distinct active objects that have a T2 semantic card (any semantics row whose
   * status is not the T3-usage 'observed' status). This is the semantic-coverage
   * numerator; T3 usage narratives do NOT count.
   */
  objects_with_semantic: number;
  /** objects_with_semantic / active_objects, 0..1 (0 when no active objects). */
  semantic_coverage_ratio: number;
  /**
   * Distinct active objects having ≥1 semantics row of each status (buckets can
   * overlap — an object with both a T2 card and a T3 narrative appears in both).
   * Makes the coverage number decomposable rather than a single soft scalar.
   */
  semantic_status_breakdown: Record<string, number>;
  degrade: {
    /** Objects whose latest profile is a partial sweep. */
    objects_partial: number;
    /** Objects whose latest profile is an unqueryable view. */
    objects_view_unqueryable: number;
    /** Objects degraded by either signal (partial OR view_unqueryable). */
    objects_degraded: number;
    /** Total active columns carrying a skip_reason. */
    columns_skipped: number;
    /** Active columns deferred to a lighter (null-only) profile. */
    columns_stats_deferred: number;
    /** skip_reason → column count (e.g. heavy_column_type, view_query_failed). */
    skip_reason_distribution: Record<string, number>;
  };
}

export async function getCoverageSummary(
  orgId: string,
  sourceId?: string,
): Promise<CoverageSummary> {
  // Scope fragment reused across queries (aliases the objects table as `o`).
  const srcObj = sourceId ? Prisma.sql`AND o.source_id = ${sourceId}::uuid` : Prisma.empty;

  const [coverageRows, statusRows, profileRows, skipRows, deferredRows] = await Promise.all([
    // 1. Active objects + how many have a T2 semantic card (excludes T3 'observed').
    prisma.$queryRaw<Array<{ active_objects: number; objects_with_semantic: number }>>(Prisma.sql`
      SELECT
        COUNT(*)::int AS active_objects,
        COUNT(*) FILTER (WHERE sem.subject_id IS NOT NULL)::int AS objects_with_semantic
      FROM platform_context_objects o
      LEFT JOIN (
        SELECT DISTINCT subject_id
        FROM platform_context_semantics
        WHERE subject_kind = 'object' AND org_id = ${orgId}
          AND status <> ${T3_USAGE_SEMANTIC_STATUS}
      ) sem ON sem.subject_id = o.id
      WHERE o.org_id = ${orgId} AND o.lifecycle = 'active' ${srcObj}
    `),
    // 1b. Distinct active objects by semantic status (decomposes the number above).
    prisma.$queryRaw<Array<{ status: string; objects: number }>>(Prisma.sql`
      SELECT s.status, COUNT(DISTINCT s.subject_id)::int AS objects
      FROM platform_context_semantics s
      JOIN platform_context_objects o ON o.id = s.subject_id
      WHERE s.subject_kind = 'object' AND s.org_id = ${orgId} AND o.lifecycle = 'active' ${srcObj}
      GROUP BY s.status
    `),
    // 2. Object-level degrade from each object's latest profile version.
    prisma.$queryRaw<Array<{ objects_partial: number; objects_view_unqueryable: number; objects_degraded: number }>>(Prisma.sql`
      WITH latest_profile AS (
        SELECT DISTINCT ON (p.object_id) p.object_id, p.stats
        FROM platform_context_profiles p
        JOIN platform_context_objects o ON o.id = p.object_id
        WHERE p.org_id = ${orgId} AND o.lifecycle = 'active' ${srcObj}
        ORDER BY p.object_id, p.version DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE stats->>'partial' = 'true')::int AS objects_partial,
        COUNT(*) FILTER (WHERE stats->>'view_unqueryable' = 'true')::int AS objects_view_unqueryable,
        COUNT(*) FILTER (WHERE stats->>'partial' = 'true' OR stats->>'view_unqueryable' = 'true')::int AS objects_degraded
      FROM latest_profile
    `),
    // 3. Per-column skip_reason distribution across active columns.
    prisma.$queryRaw<Array<{ skip_reason: string; cnt: number }>>(Prisma.sql`
      SELECT c.profile->>'skip_reason' AS skip_reason, COUNT(*)::int AS cnt
      FROM platform_context_columns c
      JOIN platform_context_objects o ON o.id = c.object_id
      WHERE c.org_id = ${orgId} AND c.lifecycle = 'active' AND o.lifecycle = 'active'
        AND c.profile->>'skip_reason' IS NOT NULL ${srcObj}
      GROUP BY c.profile->>'skip_reason'
    `),
    // 4. Columns deferred to a null-only profile (a lighter degrade than a skip).
    prisma.$queryRaw<Array<{ cnt: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS cnt
      FROM platform_context_columns c
      JOIN platform_context_objects o ON o.id = c.object_id
      WHERE c.org_id = ${orgId} AND c.lifecycle = 'active' AND o.lifecycle = 'active'
        AND c.profile->>'stats_deferred' = 'true' ${srcObj}
    `),
  ]);

  const activeObjects = coverageRows[0]?.active_objects ?? 0;
  const objectsWithSemantic = coverageRows[0]?.objects_with_semantic ?? 0;

  const statusBreakdown: Record<string, number> = {};
  for (const row of statusRows) {
    if (row.status) statusBreakdown[row.status] = row.objects;
  }

  const skipDistribution: Record<string, number> = {};
  let columnsSkipped = 0;
  for (const row of skipRows) {
    if (!row.skip_reason) continue;
    skipDistribution[row.skip_reason] = row.cnt;
    columnsSkipped += row.cnt;
  }

  return {
    scope: sourceId ? 'source' : 'estate',
    source_id: sourceId ?? null,
    active_objects: activeObjects,
    objects_with_semantic: objectsWithSemantic,
    semantic_coverage_ratio: activeObjects > 0 ? objectsWithSemantic / activeObjects : 0,
    semantic_status_breakdown: statusBreakdown,
    degrade: {
      objects_partial: profileRows[0]?.objects_partial ?? 0,
      objects_view_unqueryable: profileRows[0]?.objects_view_unqueryable ?? 0,
      objects_degraded: profileRows[0]?.objects_degraded ?? 0,
      columns_skipped: columnsSkipped,
      columns_stats_deferred: deferredRows[0]?.cnt ?? 0,
      skip_reason_distribution: skipDistribution,
    },
  };
}

// ── 13. listEstateFacets ────────────────────────────────────────────────────

export async function listEstateFacets(
  orgId: string,
  opts: { excludeTestSources?: boolean } = {},
): Promise<{
  catalogs: { name: string; count: number }[];
  schemas: { catalog: string; name: string; count: number }[];
}> {
  const testExclusion = opts.excludeTestSources
    ? `AND (source_id IS NULL OR source_id::uuid NOT IN (
        SELECT id FROM platform_context_sources
        WHERE org_id = $1 AND (${TEST_SOURCE_DISPLAY_NAME_SQL})
      ))`
    : '';

  const [catalogs, schemas] = await Promise.all([
    prisma.$queryRawUnsafe<{ name: string; count: number }[]>(
      `SELECT catalog_name AS name, COUNT(*)::int AS count
       FROM platform_estate_objects
       WHERE org_id = $1 AND lifecycle = 'active' ${testExclusion}
       GROUP BY catalog_name
       ORDER BY catalog_name`,
      orgId,
    ),
    prisma.$queryRawUnsafe<{ catalog: string; name: string; count: number }[]>(
      `SELECT catalog_name AS catalog, schema_name AS name, COUNT(*)::int AS count
       FROM platform_estate_objects
       WHERE org_id = $1 AND lifecycle = 'active' ${testExclusion}
       GROUP BY catalog_name, schema_name
       ORDER BY catalog_name, schema_name`,
      orgId,
    ),
  ]);

  return { catalogs, schemas };
}

