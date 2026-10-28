// Background jobs for knowledge bases, on a Postgres table (knowledge_jobs): a worker claims ready
// jobs with FOR UPDATE SKIP LOCKED so several workers never take the same one, runs them, and either
// finishes them or schedules a retry with back-off (1, 2, 4, 8 … minutes) up to max_attempts. A job
// left "running" by a worker that died is picked up again after 15 minutes. The same pattern can
// serve the Automate run engine later.

export type KnowledgeJob = { id: string; org_id: string; kind: string; source_id: string | null; document_id: string | null; attempts: number; max_attempts: number; payload: unknown };

export interface JobQueue {
  claim(workerId: string, limit: number): Promise<KnowledgeJob[]>;
  complete(id: string): Promise<void>;
  /** Retry later when `retryable` and attempts remain; otherwise mark failed. */
  fail(job: KnowledgeJob, error: string, retryable: boolean): Promise<'retrying' | 'failed'>;
}

export type JobHandler = (job: KnowledgeJob) => Promise<void>;

/** Back-off before attempt n+1, in milliseconds: 1, 2, 4, 8 … minutes, capped at one hour. */
export const retryDelayMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;

const isRetryable = (e: unknown) => (e as { retryable?: unknown } | null)?.retryable === true;

/**
 * Claims and runs ready jobs until none are left or `maxJobs` ran. Returns what happened, for logs.
 * Errors that are not marked retryable fail the job at once.
 */
export async function runJobs(
  queue: JobQueue,
  handlers: Record<string, JobHandler>,
  opts: { workerId: string; batch?: number; maxJobs?: number; onEvent?: (e: { job: KnowledgeJob; result: 'done' | 'retrying' | 'failed'; error?: string }) => void },
): Promise<{ done: number; retrying: number; failed: number }> {
  const totals = { done: 0, retrying: 0, failed: 0 };
  const max = opts.maxJobs ?? Infinity;
  let ran = 0;
  while (ran < max) {
    const jobs = await queue.claim(opts.workerId, Math.min(opts.batch ?? 2, max - ran));
    if (!jobs.length) break;
    for (const job of jobs) {
      ran++;
      const handler = handlers[job.kind];
      try {
        if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
        await handler(job);
        await queue.complete(job.id);
        totals.done++;
        opts.onEvent?.({ job, result: 'done' });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const result = await queue.fail(job, error, isRetryable(e));
        totals[result]++;
        opts.onEvent?.({ job, result, error });
      }
    }
  }
  return totals;
}
