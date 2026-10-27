import 'server-only';

import prisma from '@/lib/db';
import { enqueue, type JobKind } from './queue';
import { launchHarvesterTask } from './launch-harvester';
import { pathMatchesIncludePatterns, resolveEffectiveScope } from './job-scope';

export function normalizeJobScope(scope: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!scope) return null;
  const resolved = resolveEffectiveScope(scope);
  const next: Record<string, unknown> = { ...scope };
  if (resolved.includePatterns.length > 0) {
    next.includePatterns = resolved.includePatterns;
  }
  if (resolved.excludeSchemas.length > 0) {
    next.excludeSchemas = resolved.excludeSchemas;
  }
  return next;
}

export async function attachWorkerTaskToJob(jobId: string, taskId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE platform_context_jobs
    SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
    WHERE id = ${jobId}::uuid
  `;
}

/**
 * Enqueue a harvest job and start an orchestrator worker for the given kind.
 */
export async function enqueueAndLaunchHarvest(
  kind: JobKind,
  sourceId: string,
  scope: Record<string, unknown> | null,
  orgId: string,
) {
  const normalized = normalizeJobScope(scope);
  const job = await enqueue(kind, sourceId, normalized, 'on_demand', orgId);
  const { taskId, taskArn, error } = await launchHarvesterTask(['--kind', kind]);
  if (taskId) {
    await attachWorkerTaskToJob(job.id, taskId);
  }
  return { job, taskId, taskArn, launched: Boolean(taskId), error };
}

/** Debounce only when an active job would overlap this object's path scope. */
export async function findScopedHarvestConflict(
  sourceId: string,
  kind: JobKind,
  fullPath: string,
): Promise<{ id: string } | null> {
  const active = await prisma.platformContextJob.findMany({
    where: {
      source_id: sourceId,
      job_kind: kind,
      status: { in: ['queued', 'running'] },
    },
    select: { id: true, scope: true },
    orderBy: { created_at: 'asc' },
  });

  for (const row of active) {
    const scope = (row.scope ?? {}) as Record<string, unknown>;
    const { includePatterns } = resolveEffectiveScope(scope);
    if (includePatterns.length === 0) {
      return row;
    }
    if (pathMatchesIncludePatterns(fullPath, includePatterns)) {
      return row;
    }
  }
  return null;
}
