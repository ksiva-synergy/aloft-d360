import 'server-only';

import { prisma } from '@/lib/db';
import { retryDelayMs, type JobQueue, type KnowledgeJob } from './jobs';

// knowledge_jobs on Postgres. Claiming is one UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED),
// so concurrent workers each get different jobs. A job stuck in "running" for 15 minutes is treated
// as abandoned and can be claimed again.

export const prismaJobQueue: JobQueue = {
  async claim(workerId, limit) {
    return prisma.$queryRaw<KnowledgeJob[]>`
      UPDATE knowledge_jobs SET status = 'running', locked_at = now(), locked_by = ${workerId}, updated_at = now()
      WHERE id IN (
        SELECT id FROM knowledge_jobs
        WHERE (status = 'queued' AND run_after <= now())
           OR (status = 'running' AND locked_at < now() - interval '15 minutes')
        ORDER BY run_after
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING id, org_id, kind, source_id, document_id, attempts, max_attempts, payload`;
  },

  async complete(id) {
    await prisma.knowledge_jobs.update({ where: { id }, data: { status: 'done', finished_at: new Date(), last_error: null, locked_by: null } });
  },

  async fail(job, error, retryable) {
    const attempts = job.attempts + 1;
    const again = retryable && attempts < job.max_attempts;
    await prisma.knowledge_jobs.update({
      where: { id: job.id },
      data: again
        ? { status: 'queued', attempts, last_error: error.slice(0, 2000), run_after: new Date(Date.now() + retryDelayMs(attempts)), locked_by: null }
        : { status: 'failed', attempts, last_error: error.slice(0, 2000), finished_at: new Date(), locked_by: null },
    });
    return again ? 'retrying' : 'failed';
  },
};

export async function enqueueIndexJob(input: { orgId: string; sourceId: string; documentId: string }): Promise<string> {
  const job = await prisma.knowledge_jobs.create({ data: { org_id: input.orgId, kind: 'index_document', source_id: input.sourceId, document_id: input.documentId } });
  return job.id;
}
