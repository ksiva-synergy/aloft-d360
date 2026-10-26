import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { enqueue } from '@/lib/context/queue';
import { launchHarvesterTask } from '@/lib/context/launch-harvester';
import { pathToIncludePattern } from '@/lib/context/job-scope';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

async function launchWorkerForKind(kind: string): Promise<{ taskId: string | null; taskArn: string | null; error?: string }> {
  return launchHarvesterTask(['--kind', kind]);
}

/**
 * POST /api/agent-lab/context/objects/[id]/reharvest-all
 *
 * Enqueues T0 with a single-table Focus glob and chains T1 → T2 on the orchestrator.
 * T3 (usage) is source-wide and is intentionally excluded.
 * T4 is deferred until after T2 has stamped last_t2_at on this object.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const orgId = org.id;

    const object = await prisma.platformContextObject.findFirst({
      where: { id, org_id: orgId },
      select: { source_id: true, full_path: true, last_t2_at: true },
    });

    if (!object) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const resolvedObject = object;
    const includePatterns = [pathToIncludePattern(resolvedObject.full_path)];
    const chainScope: Record<string, unknown> = {
      includePatterns,
      chain: ['t1_profile', 't2_semantic'],
    };

    const results: Record<string, { jobId: string | null; queued: boolean; launched: boolean; taskArn?: string | null; reason?: string }> = {};

    async function enqueueOrKickT0(): Promise<{ jobId: string | null; queued: boolean; launched: boolean; taskArn?: string | null; reason?: string }> {
      const kind = 't0_structural';
      const running = await prisma.platformContextJob.findFirst({
        where: { source_id: resolvedObject.source_id, job_kind: kind, status: 'running' },
        select: { id: true },
      });
      if (running) {
        return { jobId: running.id, queued: false, launched: false, reason: 'running' };
      }

      const stuck = await prisma.platformContextJob.findFirst({
        where: { source_id: resolvedObject.source_id, job_kind: kind, status: 'queued' },
        select: { id: true },
        orderBy: { created_at: 'asc' },
      });

      if (stuck) {
        const { taskId, taskArn, error } = await launchWorkerForKind(kind);
        if (taskId) {
          await prisma.$executeRaw`
            UPDATE platform_context_jobs
            SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
            WHERE id = ${stuck.id}::uuid
          `;
        }
        return { jobId: stuck.id, queued: false, launched: !!taskId, taskArn, reason: error ?? 'kicked' };
      }

      const job = await enqueue(kind, resolvedObject.source_id, chainScope, 'on_demand', orgId);
      const { taskId, taskArn, error } = await launchWorkerForKind(kind);
      if (taskId) {
        await prisma.$executeRaw`
          UPDATE platform_context_jobs
          SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
          WHERE id = ${job.id}::uuid
        `;
      }
      return { jobId: job.id, queued: true, launched: !!taskId, taskArn, reason: error };
    }

    try {
      results.t0 = await enqueueOrKickT0();
      results.t1 = {
        jobId: results.t0.jobId,
        queued: false,
        launched: false,
        reason: 'chained_after_t0',
      };
      results.t2 = {
        jobId: results.t0.jobId,
        queued: false,
        launched: false,
        reason: 'chained_after_t1',
      };
    } catch (err) {
      console.error('[reharvest-all] T0 chain failed:', err);
      results.t0 = { jobId: null, queued: false, launched: false, reason: 'error' };
      results.t1 = { jobId: null, queued: false, launched: false, reason: 'error' };
      results.t2 = { jobId: null, queued: false, launched: false, reason: 'error' };
    }

    if (!resolvedObject.last_t2_at) {
      results.t4 = { jobId: null, queued: false, launched: false, reason: 'deferred' };
    } else {
      results.t4 = { jobId: null, queued: false, launched: false, reason: 'not_in_chain' };
    }

    const anyQueued = Object.values(results).some(r => r.queued);
    const anyLaunched = Object.values(results).some(r => r.launched);
    const anyError = Object.values(results).some(r => r.reason === 'error');

    return NextResponse.json(
      { data: { results }, queued: anyQueued, launched: anyLaunched, partial: anyError },
      { status: 202 },
    );
  } catch (err) {
    console.error('[context/objects/:id/reharvest-all POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
