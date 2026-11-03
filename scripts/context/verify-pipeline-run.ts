#!/usr/bin/env npx tsx
/**
 * Print pipeline-run verification from Postgres (jobs + scoped T4 eligibility).
 *
 * Usage:
 *   npx tsx scripts/context/verify-pipeline-run.ts --pipeline-run-id 8942f51f-c06e-44d1-8311-c67ea1049d7e
 *   npx tsx scripts/context/verify-pipeline-run.ts --job-id <uuid>
 *
 * Requires DATABASE_URL (same as the app).
 */

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const NAVITAS_LIKE = [
  'curated_db.db_smac_prod_navitasai_crewing_public.%',
  'curated_db.db_smac_prod_navitasai_crewing_shore.%',
  'curated_db.db_smac_prod_navitasai_idp_public.%',
  'curated_db.db_smac_prod_navitasai_masters_crewing.%',
  'curated_db.db_smac_prod_navitasai_masters_document.%',
  'curated_db.db_smac_prod_navitasai_masters_public.%',
  'curated_db.db_smac_prod_navitasai_masters_vessel.%',
];

async function main() {
  const pipelineRunId = arg('--pipeline-run-id');
  const jobId = arg('--job-id');

  if (!pipelineRunId && !jobId) {
    console.error('Pass --pipeline-run-id <uuid> and/or --job-id <uuid>');
    process.exit(1);
  }

  if (jobId) {
    const job = await prisma.platformContextJob.findUnique({ where: { id: jobId } });
    if (!job) {
      console.error('Job not found:', jobId);
      process.exit(1);
    }
    console.log('\n=== Job ===');
    console.log(JSON.stringify(job, null, 2));
    if (job.parent_job_id) {
      const parent = await prisma.platformContextJob.findUnique({ where: { id: job.parent_job_id } });
      console.log('\n=== Parent ===');
      console.log(JSON.stringify(parent, null, 2));
    }
    const children = await prisma.platformContextJob.findMany({
      where: { parent_job_id: job.id },
      orderBy: { child_index: 'asc' },
    });
    if (children.length) {
      console.log('\n=== Children ===');
      console.log(JSON.stringify(children, null, 2));
    }
  }

  const runId =
    pipelineRunId
    ?? (jobId
      ? ((await prisma.platformContextJob.findUnique({ where: { id: jobId } }))?.scope as Record<
          string,
          unknown
        > | null)?.pipeline_run_id
      : undefined);

  if (typeof runId !== 'string') {
    console.log('\n(No pipeline_run_id on scope — skip run-wide queries)');
    return;
  }

  const jobs = await prisma.$queryRaw<
    Array<{
      id: string;
      job_kind: string;
      status: string;
      created_at: Date;
      ui_surface: string | null;
      chain: unknown;
      stats: unknown;
    }>
  >`
    SELECT
      id,
      job_kind,
      status,
      created_at,
      scope->>'ui_surface' AS ui_surface,
      scope->'chain' AS chain,
      stats
    FROM platform_context_jobs
    WHERE scope->>'pipeline_run_id' = ${runId}
    ORDER BY created_at
  `;

  console.log(`\n=== Jobs for pipeline_run_id ${runId} (${jobs.length}) ===`);
  for (const j of jobs) {
    console.log(
      `${j.created_at.toISOString()}  ${j.job_kind.padEnd(18)} ${j.status.padEnd(14)} ${j.id}  chain=${JSON.stringify(j.chain)}  stats=${JSON.stringify(j.stats)}`,
    );
  }

  const firstRow = await prisma.$queryRaw<Array<{ org_id: string; source_id: string }>>`
    SELECT org_id, source_id::text AS source_id
    FROM platform_context_jobs
    WHERE scope->>'pipeline_run_id' = ${runId}
      AND source_id IS NOT NULL
    LIMIT 1
  `;
  const sourceId = firstRow[0];

  if (!sourceId?.source_id) {
    console.log('\n(Could not resolve source_id from pipeline jobs — use docs/jobs/verify-pipeline-run.sql)');
    return;
  }

  const pathClauses = NAVITAS_LIKE.reduce((acc, pat, i) => {
    const clause = Prisma.sql`o.full_path LIKE ${pat}`;
    return i === 0 ? clause : Prisma.sql`${acc} OR ${clause}`;
  }, Prisma.empty as Prisma.Sql);

  const counts = await prisma.$queryRaw<
    Array<{ scanned: number; not_in_model: number; ever_t3: number }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE o.last_t0_at IS NOT NULL)::int AS scanned,
      COUNT(*) FILTER (
        WHERE o.last_t2_at IS NOT NULL
          AND (o.last_t4_at IS NULL OR o.last_t4_at < o.last_t2_at)
      )::int AS not_in_model,
      COUNT(*) FILTER (WHERE o.last_t3_at IS NOT NULL)::int AS ever_t3
    FROM platform_context_objects o
    WHERE o.lifecycle = 'active'
      AND o.org_id = ${sourceId.org_id}
      AND o.source_id = ${sourceId.source_id}::uuid
      AND (${pathClauses})
  `;

  console.log('\n=== Navitas schema scope (platform_context_objects) ===');
  console.log(counts[0]);
  console.log('\nDone. See docs/jobs/verify-pipeline-run.sql for more queries.');
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
