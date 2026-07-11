/**
 * src/lib/inspector/digest.ts
 *
 * Templated digest of a T4 semantic-bootstrap run.
 * Produces a structured T4DigestPayload from the platform_context_jobs hierarchy
 * and the platform_sem_* tables — entirely read-derived, no new schema required.
 *
 * Safety invariant (R1 dependency): R1's advisory lock (`ctx-orch:{orgId}:t4_scan`)
 * guarantees no two t4_scan runs overlap. The dim/measure created_at window join
 * on the parent scan's overall window is deterministic because of this. If the lock
 * were ever removed, overlapping scans would blend their outputs here.
 *
 * Cluster-attribution invariant: t4_entity_propose children run with concurrency=2
 * (MAX_CONCURRENT_BY_KIND in queue.ts). Their started_at/finished_at windows overlap,
 * so entity→cluster matching uses the job-hierarchy chain (parent_job_id), not
 * timestamps. Each t4_dim_propose grandchild's scope.context_object_id maps to a
 * platform_context_objects row whose full_path matches a platform_sem_entities row.
 */

import { prisma } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────────────────

export interface T4DigestEntity {
  id: string;
  fullPath: string;
  entityLabel: string;
  description: string | null;
  dimensionCount: number;
  measureCount: number;
}

export interface T4DigestCluster {
  catalog: string;
  schema: string;
  entities: T4DigestEntity[];
}

export interface T4DigestPayload {
  runId: string;
  orgId: string;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number;

  previousRunFinishedAt: string | null;
  isFirstRun: boolean;

  totals: {
    clustersProcessed: number;
    tablesScanned: number;
    entitiesProposed: number;
    dimensionsProposed: number;
    measuresProposed: number;
    joinsProposed: number;
  };

  clusters: T4DigestCluster[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface JobStats {
  clusters_enqueued?: number;
  tables_total?: number;
  entities_proposed?: number;
  joins_proposed?: number;
  dimensions_written?: number;
  measures_written?: number;
}

function parseStats(stats: unknown): JobStats {
  if (stats && typeof stats === 'object') return stats as JobStats;
  return {};
}

// ── Core: assemble digest payload ────────────────────────────────────────────

/**
 * Assemble a T4DigestPayload for a given run (or the most recent run if
 * runId is omitted). Returns null if no succeeded t4_scan exists.
 */
export async function assembleDigest(
  orgId: string,
  runId?: string,
): Promise<T4DigestPayload | null> {
  // 1. Find the target t4_scan run
  const scanJob = runId
    ? await prisma.platformContextJob.findFirst({
        where: { id: runId, org_id: orgId, job_kind: 't4_scan', status: 'succeeded' },
      })
    : await prisma.platformContextJob.findFirst({
        where: { org_id: orgId, job_kind: 't4_scan', status: 'succeeded' },
        orderBy: { finished_at: 'desc' },
      });

  if (!scanJob || !scanJob.started_at || !scanJob.finished_at) return null;

  // 2. Find the previous run (for "since last run" framing).
  //    Uses lt: scanJob.finished_at so the current run is never its own predecessor.
  const previousRun = await prisma.platformContextJob.findFirst({
    where: {
      org_id: orgId,
      job_kind: 't4_scan',
      status: 'succeeded',
      finished_at: { lt: scanJob.finished_at },
    },
    orderBy: { finished_at: 'desc' },
    select: { finished_at: true },
  });

  // 3. Get t4_entity_propose children (cluster-level jobs)
  const entityProposeJobs = await prisma.platformContextJob.findMany({
    where: {
      parent_job_id: scanJob.id,
      job_kind: 't4_entity_propose',
      status: 'succeeded',
    },
    select: { id: true, scope: true, stats: true },
  });

  const entityProposeIds = entityProposeJobs.map((j) => j.id);

  // 4. Get t4_dim_propose grandchildren — all, including failed, to avoid
  //    silent gaps in scope. We only read scope, not status-filtered output.
  const allDimJobs = await prisma.platformContextJob.findMany({
    where: {
      parent_job_id: { in: entityProposeIds },
      job_kind: 't4_dim_propose',
    },
    select: { parent_job_id: true, scope: true, stats: true },
  });

  // 5. Aggregate totals from job stats (authoritative — no recount from tables)
  const scanStats = parseStats(scanJob.stats);
  let totalEntities = 0;
  let totalJoins = 0;
  let totalDims = 0;
  let totalMeasures = 0;

  for (const j of entityProposeJobs) {
    const s = parseStats(j.stats);
    totalEntities += s.entities_proposed ?? 0;
    totalJoins += s.joins_proposed ?? 0;
  }
  for (const j of allDimJobs) {
    const s = parseStats(j.stats);
    totalDims += s.dimensions_written ?? 0;
    totalMeasures += s.measures_written ?? 0;
  }

  // 6. Build per-cluster breakdown via the job-hierarchy chain.
  //
  //    WHY NOT timestamps: t4_entity_propose children run at concurrency=2
  //    (queue.ts MAX_CONCURRENT_BY_KIND). Two children can overlap in wall-clock
  //    time, so querying entities by BETWEEN child.started_at AND child.finished_at
  //    would misattribute entities to whichever window they happen to fall in.
  //
  //    HOW: each t4_dim_propose grandchild carries scope.context_object_id, the
  //    platform_context_objects.id of the table it processed. That id's full_path
  //    matches exactly one platform_sem_entities row. Following the chain
  //    entity_propose_job → dim_propose_jobs → context_object_id → full_path → entity
  //    assigns each entity to its correct cluster with no timestamp dependency.

  // Map: entity_propose job id → [context_object_id, ...]
  const entityProposeToContextIds = new Map<string, string[]>();
  for (const dj of allDimJobs) {
    if (!dj.parent_job_id) continue;
    const djScope = (dj.scope ?? {}) as Record<string, unknown>;
    const contextObjectId =
      typeof djScope.context_object_id === 'string' ? djScope.context_object_id : null;
    if (!contextObjectId) continue;
    const list = entityProposeToContextIds.get(dj.parent_job_id) ?? [];
    list.push(contextObjectId);
    entityProposeToContextIds.set(dj.parent_job_id, list);
  }

  // Resolve context_object_ids → full_path in one batch query
  const allContextObjectIds = [
    ...new Set([...entityProposeToContextIds.values()].flat()),
  ];

  const contextObjects =
    allContextObjectIds.length > 0
      ? await prisma.platformContextObject.findMany({
          where: { id: { in: allContextObjectIds } },
          select: { id: true, full_path: true },
        })
      : [];

  const contextIdToFullPath = new Map(contextObjects.map((o) => [o.id, o.full_path]));

  // Fetch all sem entities whose full_path was touched by this scan, restricted
  // to candidate rows created within the scan's overall window (safe under R1 lock)
  const allFullPaths = [...new Set(contextObjects.map((o) => o.full_path))];

  const allSemEntities =
    allFullPaths.length > 0
      ? await prisma.platform_sem_entities.findMany({
          where: {
            org_id: orgId,
            full_path: { in: allFullPaths },
            status: 'candidate',
            created_at: { gte: scanJob.started_at!, lte: scanJob.finished_at! },
          },
          select: { id: true, full_path: true, entity_label: true, description: true },
        })
      : [];

  const semEntityByFullPath = new Map(allSemEntities.map((e) => [e.full_path, e]));
  const allSemEntityIds = allSemEntities.map((e) => e.id);

  // Count dims/measures per entity in one batch — same scan window
  const dimCounts =
    allSemEntityIds.length > 0
      ? await prisma.platform_sem_dimensions.groupBy({
          by: ['entity_id'],
          where: {
            entity_id: { in: allSemEntityIds },
            created_at: { gte: scanJob.started_at!, lte: scanJob.finished_at! },
          },
          _count: true,
        })
      : [];

  const measureCounts =
    allSemEntityIds.length > 0
      ? await prisma.platform_sem_measures.groupBy({
          by: ['entity_id'],
          where: {
            entity_id: { in: allSemEntityIds },
            created_at: { gte: scanJob.started_at!, lte: scanJob.finished_at! },
          },
          _count: true,
        })
      : [];

  const dimMap = new Map(dimCounts.map((r) => [r.entity_id, r._count]));
  const measureMap = new Map(measureCounts.map((r) => [r.entity_id, r._count]));

  // Assemble clusters from entity_propose jobs
  const clusters: T4DigestCluster[] = [];

  for (const job of entityProposeJobs) {
    const scope = (job.scope ?? {}) as Record<string, unknown>;
    const catalog =
      typeof scope.cluster_catalog === 'string' ? scope.cluster_catalog : 'unknown';
    const schema =
      typeof scope.cluster_schema === 'string' ? scope.cluster_schema : 'unknown';

    // Walk the hierarchy chain to find which sem entities belong to this cluster
    const contextIds = entityProposeToContextIds.get(job.id) ?? [];
    const seenEntityIds = new Set<string>();
    const digestEntities: T4DigestEntity[] = [];

    for (const cid of contextIds) {
      const fullPath = contextIdToFullPath.get(cid);
      if (!fullPath) continue;
      const e = semEntityByFullPath.get(fullPath);
      if (!e || seenEntityIds.has(e.id)) continue;
      seenEntityIds.add(e.id);
      digestEntities.push({
        id: e.id,
        fullPath: e.full_path,
        entityLabel: e.entity_label,
        description: e.description,
        dimensionCount: dimMap.get(e.id) ?? 0,
        measureCount: measureMap.get(e.id) ?? 0,
      });
    }

    digestEntities.sort((a, b) => a.entityLabel.localeCompare(b.entityLabel));

    if (digestEntities.length === 0) continue;
    clusters.push({ catalog, schema, entities: digestEntities });
  }

  // Sort clusters by catalog.schema for stable output
  clusters.sort((a, b) =>
    `${a.catalog}.${a.schema}`.localeCompare(`${b.catalog}.${b.schema}`),
  );

  const durationMs = scanJob.finished_at.getTime() - scanJob.started_at.getTime();

  return {
    runId: scanJob.id,
    orgId,
    startedAt: scanJob.started_at.toISOString(),
    finishedAt: scanJob.finished_at.toISOString(),
    durationMinutes: Math.round(durationMs / 60_000),
    previousRunFinishedAt: previousRun?.finished_at?.toISOString() ?? null,
    isFirstRun: !previousRun,
    totals: {
      clustersProcessed: scanStats.clusters_enqueued ?? entityProposeJobs.length,
      tablesScanned: scanStats.tables_total ?? 0,
      entitiesProposed: totalEntities,
      dimensionsProposed: totalDims,
      measuresProposed: totalMeasures,
      joinsProposed: totalJoins,
    },
    clusters,
  };
}

// ── Templated narrative ──────────────────────────────────────────────────────

/**
 * Render a human-readable text digest from a T4DigestPayload.
 * Deterministic — no LLM call. Designed as the substrate Seneca would consume
 * if narrative generation is layered on later.
 */
export function renderDigestNarrative(payload: T4DigestPayload): string {
  const { totals, clusters, isFirstRun, durationMinutes } = payload;

  const heading = isFirstRun
    ? '## First T4 Semantic Bootstrap Run'
    : '## T4 Semantic Bootstrap — What Changed';

  const runDate = new Date(payload.startedAt).toUTCString();
  const meta = [
    `**Run:** ${runDate}`,
    `**Duration:** ${durationMinutes} min`,
    isFirstRun ? null : `**Since:** ${new Date(payload.previousRunFinishedAt!).toUTCString()}`,
  ]
    .filter(Boolean)
    .join('  \n');

  const summary = [
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Schema clusters processed | ${totals.clustersProcessed} |`,
    `| Tables scanned | ${totals.tablesScanned} |`,
    `| Entities proposed | ${totals.entitiesProposed} |`,
    `| Dimensions proposed | ${totals.dimensionsProposed} |`,
    `| Measures proposed | ${totals.measuresProposed} |`,
    `| Joins proposed | ${totals.joinsProposed} |`,
  ].join('\n');

  const noOutput =
    totals.entitiesProposed === 0
      ? '\n\n_No new candidates proposed — all eligible tables were already processed in prior runs._'
      : '';

  const clusterSections = clusters.map((c) => {
    const header = `### ${c.catalog}.${c.schema}`;
    if (c.entities.length === 0) return `${header}\n\n_No new entities proposed._`;

    const rows = c.entities.map(
      (e) =>
        `| ${e.entityLabel} | \`${e.fullPath}\` | ${e.dimensionCount} | ${e.measureCount} |`,
    );

    return [
      header,
      '',
      '| Entity | Path | Dims | Measures |',
      '|--------|------|------|----------|',
      ...rows,
    ].join('\n');
  });

  const parts = [heading, '', meta, '', summary, noOutput, '', ...clusterSections];

  return parts.join('\n');
}
