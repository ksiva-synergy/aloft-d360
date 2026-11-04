import 'server-only';

import { prisma } from '@/lib/db';
import { recordSpendEvent } from '@/lib/spend/record-spend-event';

/** USD per vCPU-hour for harvest Fargate tasks (override in env). */
function fargateUsdPerHour(): number {
  const raw = process.env.HARVEST_FARGATE_USD_PER_VCPU_HOUR ?? process.env.HARVEST_FARGATE_USD_PER_HOUR;
  const n = raw ? parseFloat(raw) : 0.08;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Optional warehouse/compute USD already computed in job stats. */
function statsInfraUsd(stats: Record<string, unknown>): number | null {
  for (const key of ['warehouse_usd', 'databricks_usd', 'infra_usd', 'compute_usd']) {
    const v = stats[key];
    if (typeof v === 'number' && v > 0) return v;
  }
  return null;
}

export function estimateHarvestInfraUsd(job: {
  started_at: Date | null;
  finished_at: Date | null;
  stats: unknown;
}): number {
  const stats =
    job.stats && typeof job.stats === 'object' && !Array.isArray(job.stats)
      ? (job.stats as Record<string, unknown>)
      : {};
  const fromStats = statsInfraUsd(stats);
  if (fromStats != null) return fromStats;

  const start = job.started_at ?? job.finished_at;
  const end = job.finished_at ?? job.started_at;
  if (!start || !end) return 0;
  const ms = Math.max(0, end.getTime() - start.getTime());
  const hours = ms / 3_600_000;
  const vcpus = typeof stats.fargate_vcpus === 'number' ? stats.fargate_vcpus : 1;
  return hours * vcpus * fargateUsdPerHour();
}

/** Fargate / warehouse compute attributed to a completed harvest job (idempotent). */
export async function recordHarvestInfraSpend(jobId: string): Promise<void> {
  const job = await prisma.platformContextJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      org_id: true,
      job_kind: true,
      source_id: true,
      status: true,
      started_at: true,
      finished_at: true,
      stats: true,
      triggered_by_user_id: true,
    },
  });
  if (!job || job.status === 'queued' || job.status === 'running') return;

  const usd = estimateHarvestInfraUsd(job);
  if (usd <= 0) return;

  const stats =
    job.stats && typeof job.stats === 'object' && !Array.isArray(job.stats)
      ? (job.stats as Record<string, unknown>)
      : {};

  await recordSpendEvent({
    orgId: job.org_id,
    bucket: 'harvest',
    surface: 'harvest',
    action: 'job_infra',
    usd,
    userId: job.triggered_by_user_id,
    jobId: job.id,
    jobKind: job.job_kind,
    sourceId: job.source_id,
    status: job.status,
    referenceType: 'platform_context_job',
    referenceId: job.id,
    occurredAt: job.finished_at ?? undefined,
    meta: {
      duration_ms:
        job.started_at && job.finished_at
          ? job.finished_at.getTime() - job.started_at.getTime()
          : undefined,
      fargate_vcpus: stats.fargate_vcpus ?? 1,
      estimate: statsInfraUsd(stats) == null,
    },
  });
}
