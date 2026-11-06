#!/usr/bin/env npx tsx
/**
 * Trace why t4_dim_propose did or did not populate platform_sem_dimensions for one table.
 *
 * Usage:
 *   npx tsx scripts/context/trace-t4-dim-for-table.ts --full-path curated_db.addressable_market.ihs_historical_snapshots
 *
 * Requires DATABASE_URL (same as the app).
 */

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';

const DIMENSION_ROLES = new Set([
  'key',
  'dimension',
  'timestamp',
  'audit',
  'text_blob',
  'fk_ref',
  'flag',
  'other',
]);
const MEASURE_ROLES = new Set(['measure']);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const fullPath = arg('--full-path');
  if (!fullPath) {
    console.error('Pass --full-path catalog.schema.table');
    process.exit(1);
  }

  const obj = await prisma.platformContextObject.findFirst({
    where: { full_path: fullPath, lifecycle: 'active' },
    select: {
      id: true,
      org_id: true,
      source_id: true,
      full_path: true,
      last_t0_at: true,
      last_t1_at: true,
      last_t2_at: true,
      last_t3_at: true,
      last_t4_at: true,
      updated_at: true,
    },
  });

  if (!obj) {
    console.error('No active platform_context_objects row for:', fullPath);
    process.exit(1);
  }

  const columns = await prisma.platformContextColumn.findMany({
    where: { object_id: obj.id, lifecycle: 'active' },
    select: { name: true, semantic: true },
    orderBy: { ordinal: 'asc' },
  });

  let wouldCreateDims = 0;
  let wouldCreateMeasures = 0;
  let skippedRole = 0;
  const skippedRoleSamples: string[] = [];
  for (const c of columns) {
    const sem =
      c.semantic && typeof c.semantic === 'object' && !Array.isArray(c.semantic)
        ? (c.semantic as Record<string, unknown>)
        : {};
    const role = typeof sem.role === 'string' ? sem.role : 'other';
    if (MEASURE_ROLES.has(role)) wouldCreateMeasures++;
    else if (DIMENSION_ROLES.has(role)) wouldCreateDims++;
    else {
      skippedRole++;
      if (skippedRoleSamples.length < 8) skippedRoleSamples.push(`${c.name}:${role}`);
    }
  }

  const entities = await prisma.platform_sem_entities.findMany({
    where: { org_id: obj.org_id, full_path: fullPath },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      model_id: true,
      entity_label: true,
      status: true,
      updated_at: true,
      _count: {
        select: {
          platform_sem_dimensions: true,
          platform_sem_measures: true,
          platform_sem_joins_platform_sem_joins_from_entity_idToplatform_sem_entities: true,
          platform_sem_joins_platform_sem_joins_to_entity_idToplatform_sem_entities: true,
        },
      },
    },
  });

  const dimJobsRaw = await prisma.$queryRaw<
    Array<{
      id: string;
      status: string;
      created_at: Date;
      started_at: Date | null;
      finished_at: Date | null;
      stats: unknown;
      scope: unknown;
      parent_job_id: string | null;
    }>
  >`
    SELECT id, status, created_at, started_at, finished_at, stats, scope, parent_job_id
    FROM platform_context_jobs
    WHERE org_id = ${obj.org_id}
      AND job_kind = 't4_dim_propose'
      AND scope->>'context_object_id' = ${obj.id}
    ORDER BY created_at DESC
    LIMIT 10
  `;

  console.log('\n=== Object tier timestamps ===');
  console.log(JSON.stringify(obj, null, 2));
  console.log('\n=== Column inventory (active) ===');
  console.log(`count=${columns.length}`);
  console.log(
    `If t4_dim_propose ran TODAY with current column semantics: ~${wouldCreateDims} new dimensions, ~${wouldCreateMeasures} measures, skipped_role=${skippedRole}`,
  );
  if (skippedRoleSamples.length) console.log('skipped role samples:', skippedRoleSamples.join(', '));


  console.log('\n=== T4 eligibility (scanEstateForT4 rule) ===');
  const t4Stale =
    obj.last_t2_at !== null &&
    (obj.last_t4_at === null || obj.last_t4_at < obj.last_t2_at);
  console.log({
    last_t2_at: obj.last_t2_at?.toISOString() ?? null,
    last_t4_at: obj.last_t4_at?.toISOString() ?? null,
    would_be_picked_by_t4_scan: t4Stale,
    interpretation: t4Stale
      ? 'Table is stale for T4 — re-run t4_scan (or scoped Continue with T4) to enqueue t4_dim_propose again.'
      : obj.last_t4_at && obj.last_t2_at && obj.last_t4_at >= obj.last_t2_at
        ? 'T4 stamp is at or after last T2 — scan will skip until T2 runs again (last_t2_at moves forward).'
        : 'Missing T2 or T4 timestamps — check harvest tiers.',
  });

  if (obj.last_t4_at && obj.last_t2_at && obj.last_t4_at < obj.last_t2_at) {
    console.log(
      '\n*** Likely root cause: last_t4_at is OLDER than last_t2_at (T2 re-ran after dim propose). Dimensions were never re-proposed; entity/joins may exist from an earlier partial T4. ***',
    );
  }
  if (obj.last_t4_at && columns.length > 0 && wouldCreateDims > 0) {
    const entityWithDims = entities.find((e) => e._count.platform_sem_dimensions > 0);
    if (!entityWithDims) {
      console.log(
        '\n*** Likely root cause: last_t4_at is set but entity has 0 platform_sem_dimensions while columns have T2 roles — dim job probably ran when column count was 0 or entity lookup failed (see jobs below). ***',
      );
    }
  }

  console.log('\n=== platform_sem_entities (newest first) ===');
  for (const e of entities) {
    console.log({
      id: e.id,
      model_id: e.model_id,
      status: e.status,
      updated_at: e.updated_at.toISOString(),
      dimensions: e._count.platform_sem_dimensions,
      measures: e._count.platform_sem_measures,
      joins_out: e._count.platform_sem_joins_platform_sem_joins_from_entity_idToplatform_sem_entities,
      joins_in: e._count.platform_sem_joins_platform_sem_joins_to_entity_idToplatform_sem_entities,
    });
  }

  console.log('\n=== t4_dim_propose jobs for this object (newest 10) ===');
  if (dimJobsRaw.length === 0) {
    console.log('NONE — dimensions were never written by the worker, OR jobs used a different context_object_id.');
    console.log(
      'If entity + joins exist but no dim jobs: entity/joins may have been created outside the t4_entity_propose → t4_dim_propose chain.',
    );
  } else {
    for (const j of dimJobsRaw) {
      const stats = j.stats as Record<string, unknown> | null;
      console.log({
        id: j.id,
        status: j.status,
        finished_at: j.finished_at?.toISOString() ?? null,
        dimensions_written: stats?.dimensions_written,
        measures_written: stats?.measures_written,
        model_id: (j.scope as Record<string, unknown>)?.model_id,
        parent_job_id: j.parent_job_id,
      });
    }
  }

  // Queued dim jobs never run
  const queuedDim = await prisma.platformContextJob.count({
    where: { org_id: obj.org_id, job_kind: 't4_dim_propose', status: 'queued' },
  });
  if (queuedDim > 0) {
    console.log(`\n*** Org has ${queuedDim} queued t4_dim_propose job(s) — harvester may be stalled. ***`);
  }

  console.log('\n=== Diagnosis checklist ===');
  console.log([
    '1. No t4_dim_propose job → entity propose never enqueued children, or queue not drained.',
    '2. Job succeeded with dimensions_written=0 → empty columns at run time, or no matching entity (model_id/full_path).',
    '3. last_t4_at < last_t2_at → T2 refreshed after T4; re-run t4_scan for this table.',
    '4. last_t4_at >= last_t2_at and dims=0 in DB → dim ran with 0 active columns then columns/T2 arrived later.',
  ].join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
