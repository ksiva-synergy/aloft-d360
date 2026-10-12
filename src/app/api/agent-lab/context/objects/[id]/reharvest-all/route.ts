import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { enqueue } from '@/lib/context/queue';
import { launchHarvesterTask } from '@/lib/context/launch-harvester';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

async function launchWorkerForKind(kind: string): Promise<{ taskId: string | null; taskArn: string | null; error?: string }> {
  return launchHarvesterTask(['--kind', kind]);
}

/**
 * POST /api/agent-lab/context/objects/[id]/reharvest-all
 *
 * Enqueues AND launches workers for T0 → T1 → T2 → T4 for a single object.
 * T3 (usage) is always source-wide/meta and is intentionally excluded.
 *
 * With HARVEST_RUNTIME=local, workers spawn on this machine; otherwise ECS Fargate.
 *
 * Each tier is debounce-checked independently. If a job for that kind is already
 * queued or running, the existing job ID is returned and no new worker is launched.
 * A tier failing to launch does NOT abort the remaining tiers.
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
    const scope = { path: resolvedObject.full_path };
    const results: Record<string, { jobId: string | null; queued: boolean; launched: boolean; taskArn?: string | null; reason?: string }> = {};

    /**
     * Enqueue-or-kick helper.
     * - If a job is already RUNNING → debounce (worker already executing, do nothing).
     * - If a job is QUEUED (stuck, no worker picked it up) → kick it by launching a new worker.
     * - If no active job → enqueue a new row and launch a fresh worker.
     */
    async function enqueueOrKick(
      kind: 't0_structural' | 't1_profile' | 't2_semantic' | 't4_scan',
      jobScope: Record<string, unknown> | null,
    ): Promise<{ jobId: string | null; queued: boolean; launched: boolean; taskArn?: string | null; reason?: string }> {
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

      const job = await enqueue(kind, resolvedObject.source_id, jobScope, 'on_demand', orgId);
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

    // ── T0: Structural ────────────────────────────────────────────────────────
    try {
      results.t0 = await enqueueOrKick('t0_structural', scope);
    } catch (err) {
      console.error('[reharvest-all] T0 failed:', err);
      results.t0 = { jobId: null, queued: false, launched: false, reason: 'error' };
    }

    // ── T1: Profile ───────────────────────────────────────────────────────────
    try {
      results.t1 = await enqueueOrKick('t1_profile', scope);
    } catch (err) {
      console.error('[reharvest-all] T1 failed:', err);
      results.t1 = { jobId: null, queued: false, launched: false, reason: 'error' };
    }

    // ── T2: Semantic ──────────────────────────────────────────────────────────
    try {
      results.t2 = await enqueueOrKick('t2_semantic', scope);
    } catch (err) {
      console.error('[reharvest-all] T2 failed:', err);
      results.t2 = { jobId: null, queued: false, launched: false, reason: 'error' };
    }

    // ── T4: Entity Model scan ─────────────────────────────────────────────────
    // t4_scan is source-wide. It uses scanEstate(..., minT2=true) which filters
    // to objects where last_t2_at IS NOT NULL. If T2 has never run for this
    // object, the scan will find 0 tables and exit immediately — so we defer T4
    // until T2 has been stamped at least once. Re-run Reharvest All (or trigger
    // T4 from the Jobs page) after T2 completes.
    if (!resolvedObject.last_t2_at) {
      results.t4 = { jobId: null, queued: false, launched: false, reason: 'deferred' };
    } else {
      try {
        results.t4 = await enqueueOrKick('t4_scan', null);
      } catch (err) {
        console.error('[reharvest-all] T4 failed:', err);
        results.t4 = { jobId: null, queued: false, launched: false, reason: 'error' };
      }
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
