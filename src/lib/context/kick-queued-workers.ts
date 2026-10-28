import prisma from '@/lib/db';
import { launchHarvesterTask } from './launch-harvester';

/** Queued jobs younger than this may still be receiving a task id from the launcher. */
export const ORPHAN_QUEUE_MIN_AGE_MS = 15_000;

export function isOrphanedQueuedJob(
  job: { created_at: Date | null; scope: unknown },
  now = Date.now(),
  minAgeMs = ORPHAN_QUEUE_MIN_AGE_MS,
): boolean {
  if (!job.created_at) return false;
  if (now - job.created_at.getTime() < minAgeMs) return false;
  const scope =
    job.scope && typeof job.scope === 'object' && !Array.isArray(job.scope)
      ? (job.scope as Record<string, unknown>)
      : {};
  const taskId = scope.fargate_task_id;
  return typeof taskId !== 'string' || taskId.length === 0;
}

let inflight: Promise<void> | null = null;

/**
 * Start one worker per kind for top-level queued jobs that never got a task id.
 * The Fargate task cannot RunTask the next chain tier (task role has no ECS
 * network config), so those rows sit queued until the web process launches them.
 */
export function kickOrphanedQueuedJobs(
  orgId: string,
  opts?: { minAgeMs?: number },
): Promise<void> {
  if (inflight) return inflight;
  inflight = runKick(orgId, opts?.minAgeMs ?? ORPHAN_QUEUE_MIN_AGE_MS).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runKick(orgId: string, minAgeMs: number): Promise<void> {
  const rows = await prisma.platformContextJob.findMany({
    where: {
      org_id: orgId,
      status: 'queued',
      parent_job_id: null,
    },
    select: { id: true, job_kind: true, created_at: true, scope: true },
    orderBy: { created_at: 'asc' },
    take: 50,
  });

  const orphans = rows.filter((row) => isOrphanedQueuedJob(row, Date.now(), minAgeMs));
  if (orphans.length === 0) return;

  const byKind = new Map<string, string[]>();
  for (const row of orphans) {
    const ids = byKind.get(row.job_kind) ?? [];
    ids.push(row.id);
    byKind.set(row.job_kind, ids);
  }

  for (const [kind, ids] of byKind) {
    const { taskId, error } = await launchHarvesterTask(['--kind', kind]);
    if (!taskId) {
      console.error(`[kick-queued] ${kind} launch failed: ${error ?? 'no task id'}`);
      continue;
    }
    for (const id of ids) {
      await prisma.$executeRaw`
        UPDATE platform_context_jobs
        SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
        WHERE id = ${id}::uuid
          AND status = 'queued'
          AND parent_job_id IS NULL
      `;
    }
    console.log(`[kick-queued] ${kind} task=${taskId} jobs=${ids.length}`);
  }
}
