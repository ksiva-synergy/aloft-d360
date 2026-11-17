import prisma from '@/lib/db';
import { failStale } from '@/lib/context/queue';
import { PBI_LINEAGE_KINDS } from '@/lib/powerbi/launch-scope';

export const PBI_LINEAGE_STALE_MINUTES = 30;

const ACTIVE = new Set(['queued', 'running', 'orchestrating']);

/** Reap abandoned all-reports Power BI lineage jobs after network/worker loss. */
export async function reapAbandonedPbiAllReportsJobs(
  maxAgeMinutes = PBI_LINEAGE_STALE_MINUTES,
): Promise<{ runningReaped: number; pipelineReaped: number }> {
  const runningReaped = await failStale(maxAgeMinutes);
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  const errorMsg = `reaped: no progress within ${maxAgeMinutes} minutes (worker lost)`;
  const pipelineReaped = await prisma.platformContextJob.updateMany({
    where: {
      job_kind: { in: [...PBI_LINEAGE_KINDS] },
      status: { in: ['orchestrating', 'queued'] },
      scope: { path: ['all_reports'], equals: true },
      OR: [{ updated_at: null }, { updated_at: { lt: cutoff } }],
    },
    data: {
      status: 'failed',
      error: errorMsg,
      finished_at: new Date(),
      updated_at: new Date(),
    },
  });
  return { runningReaped, pipelineReaped: pipelineReaped.count };
}

export function pbiAllReportsJobBlocksUi(
  job: { status: string; updated_at: Date | null; scope?: unknown } | null | undefined,
  maxAgeMinutes = PBI_LINEAGE_STALE_MINUTES,
): boolean {
  if (!job || !ACTIVE.has(job.status)) return false;
  const scope = job.scope && typeof job.scope === 'object' ? (job.scope as Record<string, unknown>) : {};
  if (scope.all_reports !== true) return ACTIVE.has(job.status);
  if (!job.updated_at) return true;
  const ageMs = Date.now() - job.updated_at.getTime();
  return ageMs <= maxAgeMinutes * 60 * 1000;
}