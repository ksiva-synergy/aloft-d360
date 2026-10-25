import type { FlowDefinition, FlowStep, FlowStepType, RunStatus, StepStatus } from './schema';
import { applyInputs, resolveConfig, type ResolveContext } from './resolve';

// Framework-free flow runner. It talks to storage through RunStore and to the outside world through
// StepExecutors, so it can run in a Next route today and in a worker later without changes.

export type StepRunState = {
  stepId: string;
  status: StepStatus;
  attempt: number;
  output?: unknown;
  error?: string;
};

/** What an executor returns: either a result, or a request to pause the run for a human. */
export type StepResult = { kind: 'done'; output: unknown } | { kind: 'wait_approval' };

export type StepExecutor<S extends FlowStep = FlowStep> = (
  step: S,
  /** The step with every `{{ref}}` in its config already resolved. */
  resolved: S,
  signal: AbortSignal,
) => Promise<StepResult>;

export type StepExecutors = { [T in FlowStepType]?: StepExecutor<Extract<FlowStep, { type: T }>> };

export interface RunStore {
  /** Step states persisted so far; a resumed run skips steps that already succeeded. */
  loadStepRuns(): Promise<StepRunState[]>;
  saveStepRun(state: StepRunState): Promise<void>;
  setRunStatus(status: RunStatus, error?: string): Promise<void>;
  /** True once someone cancelled the run; checked between steps. */
  isCancelled(): Promise<boolean>;
}

export type ExecuteRunOptions = {
  flow: FlowDefinition;
  /** Step ids in execution order, from validateFlow. */
  order: string[];
  inputs: Record<string, unknown>;
  store: RunStore;
  executors: StepExecutors;
  /** Doubles the wait after each failed attempt. Tests pass 0. */
  retryBaseDelayMs?: number;
};

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the timeout message wins over whatever the aborted step throws.
      reject(new Error(`timed out after ${ms}ms`));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs (or resumes) a flow. Steps run one at a time in `order`; each state change is saved before
 * moving on. Returns the final run status: `waiting_approval` means the run paused and should be
 * resumed by calling executeRun again once the approval step has been marked succeeded.
 */
export async function executeRun(opts: ExecuteRunOptions): Promise<RunStatus> {
  const { flow, order, store, executors } = opts;
  let inputs: Record<string, unknown>;
  try {
    inputs = applyInputs(flow, opts.inputs);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await store.setRunStatus('failed', error);
    return 'failed';
  }
  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  const saved = new Map((await store.loadStepRuns()).map((s) => [s.stepId, s]));

  const ctx: ResolveContext = { inputs, steps: {} };
  for (const s of saved.values()) if (s.status === 'succeeded') ctx.steps[s.stepId] = s.output;

  await store.setRunStatus('running');

  const skipRest = async (fromIndex: number) => {
    for (const id of order.slice(fromIndex)) {
      if (saved.get(id)?.status === 'succeeded') continue;
      await store.saveStepRun({ stepId: id, status: 'skipped', attempt: saved.get(id)?.attempt ?? 0 });
    }
  };

  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const step = byId.get(id)!;
    const prior = saved.get(id);
    if (prior?.status === 'succeeded') continue;

    if (await store.isCancelled()) {
      await skipRest(i);
      await store.setRunStatus('cancelled');
      return 'cancelled';
    }

    const executor = executors[step.type] as StepExecutor | undefined;
    if (!executor) {
      const error = `no executor registered for step type "${step.type}"`;
      await store.saveStepRun({ stepId: id, status: 'failed', attempt: 1, error });
      await skipRest(i + 1);
      await store.setRunStatus('failed', error);
      return 'failed';
    }

    let lastError = '';
    let result: StepResult | undefined;
    let attemptsUsed = 0;
    const maxAttempts = step.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts && !result; attempt++) {
      attemptsUsed = attempt;
      await store.saveStepRun({ stepId: id, status: 'running', attempt });
      try {
        const resolved = { ...step, config: resolveConfig(step.config, ctx) } as FlowStep;
        result = await withTimeout(step.timeoutMs, (signal) => executor(step, resolved, signal));
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) await sleep((opts.retryBaseDelayMs ?? 1000) * 2 ** (attempt - 1));
      }
    }

    if (!result) {
      await store.saveStepRun({ stepId: id, status: 'failed', attempt: attemptsUsed, error: lastError });
      await skipRest(i + 1);
      await store.setRunStatus('failed', `step "${id}" failed: ${lastError}`);
      return 'failed';
    }

    if (result.kind === 'wait_approval') {
      await store.saveStepRun({ stepId: id, status: 'waiting_approval', attempt: attemptsUsed });
      await store.setRunStatus('waiting_approval');
      return 'waiting_approval';
    }

    ctx.steps[id] = result.output;
    await store.saveStepRun({ stepId: id, status: 'succeeded', attempt: attemptsUsed, output: result.output });
  }

  await store.setRunStatus('succeeded');
  return 'succeeded';
}
