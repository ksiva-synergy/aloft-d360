/**
 * Job Health — read-derived staleness checker for memory DAG jobs.
 *
 * Each job has a STALE_THRESHOLD (hours since last successful run).
 * If the threshold is exceeded, the job is flagged amber/red.
 */

import { prisma } from '@/lib/prisma';

// ── Stale Thresholds (hours) ─────────────────────────────────────────────────

const STALE_THRESHOLDS: Record<string, number> = {
  synthesize:   36,   // daily job — stale if no success in 36h
  grow_refine:  216,  // weekly job — stale if no success in 9 days (216h)
  reclassify:   240,  // runs weekly + conditionally nightly — stale at 10 days (240h)
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = 'green' | 'amber' | 'red';

export interface JobHealthEntry {
  jobKey: string;
  lastOkAt: Date | null;
  ageHours: number | null;
  staleThresholdHours: number;
  status: HealthStatus;
}

export interface JobHealthReport {
  jobs: JobHealthEntry[];
  computedAt: Date;
}

// ── Status derivation ─────────────────────────────────────────────────────────

function deriveStatus(ageHours: number | null, threshold: number): HealthStatus {
  if (ageHours === null) return 'red';
  if (ageHours <= threshold) return 'green';
  if (ageHours <= threshold * 1.5) return 'amber';
  return 'red';
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function computeJobHealth(orgId: string): Promise<JobHealthReport> {
  const now = new Date();
  const jobs: JobHealthEntry[] = [];

  for (const [jobKey, threshold] of Object.entries(STALE_THRESHOLDS)) {
    const lastOk = await prisma.platformJobRun.findFirst({
      where: { orgId, jobKey, status: 'ok' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });

    const lastOkAt = lastOk?.finishedAt ?? null;
    const ageHours = lastOkAt
      ? (now.getTime() - lastOkAt.getTime()) / (1000 * 60 * 60)
      : null;

    jobs.push({
      jobKey,
      lastOkAt,
      ageHours: ageHours !== null ? Math.round(ageHours * 10) / 10 : null,
      staleThresholdHours: threshold,
      status: deriveStatus(ageHours, threshold),
    });
  }

  return { jobs, computedAt: now };
}
