import 'server-only';

import prisma from '@/lib/db';

/**
 * Run survival for long Power BI bridge jobs (Architecture v2, L3):
 * heartbeat on the job row, a reaper for jobs that stopped heartbeating, and a retry wrapper
 * for database calls that fail on transient connectivity (dev RDS dropped 3× on 2026-11-14).
 */

/** Job kinds that heartbeat; only these are ever reaped. */
export const HEARTBEAT_JOB_KINDS = ['pbi_translate', 'pbi_parity'] as const;

const TRANSIENT_DB_RE = /P1001|P1002|P1008|P1017|Can't reach database server|ECONNRESET|ETIMEDOUT|Connection terminated|server closed the connection/i;

export async function withDbRetry<T>(fn: () => Promise<T>, label = 'db', attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT_DB_RE.test(msg) || i === attempts) throw err;
      const waitMs = Math.min(60_000, 5_000 * 2 ** (i - 1));
      console.warn(`[job-health] ${label}: transient DB error, retry ${i}/${attempts - 1} in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw last;
}

/** Throttled heartbeat: keeps `updated_at` fresh and records progress in `stats.progress`. */
export function createHeartbeat(jobId: string, everyMs = 30_000) {
  let lastBeat = 0;
  return async (progress: Record<string, unknown>, force = false) => {
    const now = Date.now();
    if (!force && now - lastBeat < everyMs) return;
    lastBeat = now;
    try {
      await withDbRetry(
        () =>
          prisma.platformContextJob.updateMany({
            where: { id: jobId, status: 'running' },
            data: { updated_at: new Date(), stats: { progress } as object },
          }),
        'heartbeat',
        2,
      );
    } catch {
      /* a missed heartbeat must not fail the job */
    }
  };
}

/**
 * Mark heartbeat-capable jobs failed when they've been silent longer than `silentMs`
 * (their process died without finalizing). Never touches other job kinds.
 */
export async function reapStaleJobs(opts: { silentMs?: number; kinds?: readonly string[] } = {}): Promise<number> {
  const silentMs = opts.silentMs ?? 20 * 60_000;
  const kinds = [...(opts.kinds ?? HEARTBEAT_JOB_KINDS)];
  const cutoff = new Date(Date.now() - silentMs);
  const res = await withDbRetry(
    () =>
      prisma.platformContextJob.updateMany({
        where: { status: 'running', job_kind: { in: kinds }, updated_at: { lt: cutoff } },
        data: {
          status: 'failed',
          finished_at: new Date(),
          updated_at: new Date(),
          error: `Reaped: no heartbeat for ${Math.round(silentMs / 60_000)} min (process stopped without finalizing)`,
        },
      }),
    'reaper',
  );
  if (res.count) console.warn(`[job-health] reaped ${res.count} stale job(s)`);
  return res.count;
}
