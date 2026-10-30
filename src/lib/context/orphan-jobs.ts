import prisma from '@/lib/db';

/** Default: fail active rows with no worker after this age (ms). */
export const ORPHAN_REAP_MIN_AGE_MS = 10 * 60 * 1000;

export function jobScopeHasWorker(scope: unknown): boolean {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  const taskId = (scope as Record<string, unknown>).fargate_task_id;
  return typeof taskId === 'string' && taskId.length > 0;
}

/**
 * Fail queued/running/orchestrating jobs that never received `scope.fargate_task_id`.
 * Prevents overlap blockers when ECS RunTask failed or the web never attached a worker.
 */
export async function reapOrphanActiveJobs(
  orgId: string,
  maxAgeMs = ORPHAN_REAP_MIN_AGE_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await prisma.platformContextJob.findMany({
    where: {
      org_id: orgId,
      status: { in: ['queued', 'running', 'orchestrating'] },
      created_at: { lt: cutoff },
    },
    select: { id: true, scope: true },
    take: 200,
  });

  const ids = rows.filter((r) => !jobScopeHasWorker(r.scope)).map((r) => r.id);
  if (ids.length === 0) return 0;

  const result = await prisma.platformContextJob.updateMany({
    where: { id: { in: ids } },
    data: {
      status: 'failed',
      error: 'reaped: no harvester worker attached (RunTask failed or never launched)',
      finished_at: new Date(),
      updated_at: new Date(),
    },
  });
  if (result.count > 0) {
    console.warn(`[orphan-jobs] reaped ${result.count} active job(s) without fargate_task_id for org=${orgId}`);
  }
  return result.count;
}

/** Mark jobs failed when launch returned no task (same request as enqueue). */
export async function failJobsAfterLaunchError(
  jobIds: string[],
  error: string,
): Promise<void> {
  if (jobIds.length === 0) return;
  await prisma.platformContextJob.updateMany({
    where: { id: { in: jobIds }, status: { in: ['queued', 'running'] } },
    data: {
      status: 'failed',
      error: error.slice(0, 500),
      finished_at: new Date(),
      updated_at: new Date(),
    },
  });
}
