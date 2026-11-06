import type { RunStatus } from './schema';
import type { RunStore, StepRunState } from './runner';

/** A RunStore held in memory. Used by simulation and tests; nothing survives the process. */
export function createMemoryRunStore(initial: StepRunState[] = []) {
  const steps = new Map(initial.map((s) => [s.stepId, s]));
  const run = { status: 'queued' as RunStatus, error: undefined as string | undefined, cancelled: false };
  const store: RunStore = {
    loadStepRuns: async () => [...steps.values()],
    saveStepRun: async (s) => void steps.set(s.stepId, s),
    setRunStatus: async (status, error) => {
      run.status = status;
      run.error = error;
    },
    isCancelled: async () => run.cancelled,
  };
  return { store, steps, run };
}
