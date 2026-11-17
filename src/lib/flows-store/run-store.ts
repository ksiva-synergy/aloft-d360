import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { RunStore, StepRunState } from '@/lib/flows/runner';
import type { RunStatus, StepStatus } from '@/lib/flows/schema';

// The database-backed RunStore for one run. The runner writes a step row after every state change,
// so a crashed or restarted run resumes from the last step that succeeded (executeRun skips those).

const TERMINAL: RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export function createPrismaRunStore(runId: string): RunStore {
  return {
    async loadStepRuns() {
      const rows = await prisma.platformFlowStepRun.findMany({ where: { run_id: runId } });
      return rows.map((r): StepRunState => {
        const status = r.status as StepStatus;
        // A skipped step has no output; its reason is kept in `output.skipReason`.
        const skipReason = status === 'skipped' ? ((r.output as { skipReason?: string } | null)?.skipReason ?? undefined) : undefined;
        return {
          stepId: r.step_id,
          status,
          attempt: r.attempt,
          output: status === 'skipped' ? undefined : (r.output ?? undefined),
          error: r.error ?? undefined,
          skipReason,
        };
      });
    },

    async saveStepRun(s) {
      const now = new Date();
      const output = (s.status === 'skipped' ? { skipReason: s.skipReason ?? null } : s.output) as Prisma.InputJsonValue | undefined;
      const finished = s.status !== 'running' && s.status !== 'pending';
      const data = {
        status: s.status,
        attempt: s.attempt,
        output,
        error: s.error ?? null,
        finished_at: finished ? now : null,
        ...(s.status === 'running' ? { started_at: now } : {}),
      };
      await prisma.platformFlowStepRun.upsert({
        where: { run_id_step_id: { run_id: runId, step_id: s.stepId } },
        create: { run_id: runId, step_id: s.stepId, ...data, started_at: now },
        update: data,
      });
    },

    async setRunStatus(status, error) {
      const now = new Date();
      // The first start time is kept when a run resumes after an approval or a restart.
      if (status === 'running') await prisma.platformFlowRun.updateMany({ where: { id: runId, started_at: null }, data: { started_at: now } });
      // A cancelled run stays cancelled: only `cancelled` itself may overwrite it.
      await prisma.platformFlowRun.updateMany({
        where: { id: runId, ...(status === 'cancelled' ? {} : { status: { not: 'cancelled' } }) },
        data: {
          status,
          error: error ?? null,
          ...(TERMINAL.includes(status) ? { finished_at: now } : {}),
        },
      });
    },

    async isCancelled() {
      const r = await prisma.platformFlowRun.findUnique({ where: { id: runId }, select: { status: true } });
      return r?.status === 'cancelled';
    },
  };
}
