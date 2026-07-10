import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export interface TouchedObject {
  id: string;
  full_path: string;
  object_kind: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  tiers_touched: string[];
  last_touched_at: string;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  const org = await getDefaultOrg();

  const job = await prisma.platformContextJob.findFirst({
    where: { id, org_id: org.id },
    select: { id: true, status: true, source_id: true, started_at: true, finished_at: true, job_kind: true, scope: true },
  });

  if (!job) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  if (!job.started_at) {
    return NextResponse.json({ data: [], total: 0, note: 'Job has not started yet' });
  }

  // T4 coordinator jobs (t4_scan) don't stamp any tier timestamps themselves —
  // they orchestrate children. Resolve the effective time window by spanning all
  // descendant jobs so their t4_at stamps are covered.
  const isT4Coordinator = job.job_kind === 't4_scan';

  let windowStart: Date;
  let windowEnd: Date;

  if (isT4Coordinator) {
    // Collect all descendant jobs and union their windows
    const descendants = await prisma.platformContextJob.findMany({
      where: { org_id: org.id, parent_job_id: id },
      select: { started_at: true, finished_at: true, id: true },
    });
    // Also fetch grandchildren (t4_dim_propose under t4_entity_propose)
    const entityJobIds = descendants.map((d) => d.id);
    const grandchildren = entityJobIds.length > 0
      ? await prisma.platformContextJob.findMany({
          where: { org_id: org.id, parent_job_id: { in: entityJobIds } },
          select: { started_at: true, finished_at: true },
        })
      : [];

    const allJobs = [...descendants, ...grandchildren, { started_at: job.started_at, finished_at: job.finished_at }];
    const startTimes = allJobs.map((j) => j.started_at?.getTime()).filter(Boolean) as number[];
    const endTimes = allJobs.map((j) => (j.finished_at ?? new Date()).getTime());

    const minStart = startTimes.length > 0 ? Math.min(...startTimes) : job.started_at.getTime();
    const maxEnd = Math.max(...endTimes, job.started_at.getTime());

    windowStart = new Date(minStart - 5_000);
    windowEnd = new Date(maxEnd + 5_000);
  } else {
    const startedAt = job.started_at;
    // For running jobs, use current time as upper bound
    const finishedAt = job.finished_at ?? new Date();
    // Add a small buffer (5 seconds either side) to catch boundary writes
    windowStart = new Date(startedAt.getTime() - 5_000);
    windowEnd = new Date(finishedAt.getTime() + 5_000);
  }

  try {
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
      last_t3_at: Date | null;
      last_t4_at: Date | null;
      last_knowledge_sync_at: Date | null;
    }>>(Prisma.sql`
      SELECT
        id,
        full_path,
        object_kind,
        catalog_name,
        schema_name,
        object_name,
        last_t0_at,
        last_t1_at,
        last_t2_at,
        last_t3_at,
        last_t4_at,
        last_knowledge_sync_at
      FROM platform_context_objects
      WHERE org_id = ${org.id}
        ${job.source_id ? Prisma.sql`AND source_id = ${job.source_id}::uuid` : Prisma.sql``}
        AND (
          (last_t0_at BETWEEN ${windowStart} AND ${windowEnd})
          OR (last_t1_at BETWEEN ${windowStart} AND ${windowEnd})
          OR (last_t2_at BETWEEN ${windowStart} AND ${windowEnd})
          OR (last_t3_at BETWEEN ${windowStart} AND ${windowEnd})
          OR (last_t4_at BETWEEN ${windowStart} AND ${windowEnd})
          OR (last_knowledge_sync_at BETWEEN ${windowStart} AND ${windowEnd})
        )
      ORDER BY full_path
      LIMIT 500
    `);

    const objects: TouchedObject[] = rows.map(row => {
      const tiers: string[] = [];
      let maxTs = 0;

      if (row.last_t0_at && row.last_t0_at >= windowStart && row.last_t0_at <= windowEnd) {
        tiers.push('t0_structural');
        maxTs = Math.max(maxTs, row.last_t0_at.getTime());
      }
      if (row.last_t1_at && row.last_t1_at >= windowStart && row.last_t1_at <= windowEnd) {
        tiers.push('t1_profile');
        maxTs = Math.max(maxTs, row.last_t1_at.getTime());
      }
      if (row.last_t2_at && row.last_t2_at >= windowStart && row.last_t2_at <= windowEnd) {
        tiers.push('t2_semantic');
        maxTs = Math.max(maxTs, row.last_t2_at.getTime());
      }
      if (row.last_t3_at && row.last_t3_at >= windowStart && row.last_t3_at <= windowEnd) {
        tiers.push('t3_usage');
        maxTs = Math.max(maxTs, row.last_t3_at.getTime());
      }
      if (row.last_t4_at && row.last_t4_at >= windowStart && row.last_t4_at <= windowEnd) {
        tiers.push('t4_entity_model');
        maxTs = Math.max(maxTs, row.last_t4_at.getTime());
      }
      if (row.last_knowledge_sync_at && row.last_knowledge_sync_at >= windowStart && row.last_knowledge_sync_at <= windowEnd) {
        tiers.push('knowledge_sync');
        maxTs = Math.max(maxTs, row.last_knowledge_sync_at.getTime());
      }

      return {
        id: row.id,
        full_path: row.full_path,
        object_kind: row.object_kind,
        catalog_name: row.catalog_name,
        schema_name: row.schema_name,
        object_name: row.object_name,
        tiers_touched: tiers,
        last_touched_at: new Date(maxTs).toISOString(),
      };
    });

    return NextResponse.json({ data: objects, total: objects.length });
  } catch (err) {
    console.error('[context/jobs/:id/objects GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
