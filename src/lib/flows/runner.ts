import type { FlowDefinition, FlowStep, FlowStepType, RunStatus, StepStatus } from './schema';
import { applyInputs, evaluateCondition, resolveConfig, resolveString, type ResolveContext } from './resolve';
import { stepDependencies } from './validate';

// Framework-free flow runner. It talks to storage through RunStore and to the outside world through
// StepExecutors, so it can run in a Next route today and in a worker later without changes.

export type StepRunState = {
  stepId: string;
  status: StepStatus;
  attempt: number;
  output?: unknown;
  error?: string;
  /** Why a `skipped` step did not run (condition false, upstream skipped, run failed or cancelled). */
  skipReason?: string;
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

/** Errors that declare `retryable: false` (policy denials, budget stops) fail the step without further attempts. */
const isNonRetryable = (err: unknown) => (err as { retryable?: unknown } | null)?.retryable === false;

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

type Attempted = { result: StepResult; attempts: number } | { result?: undefined; attempts: number; error: string; nonRetryable: boolean };

/** Resolves refs and runs one call of a step, with its retries (exponential back-off) and its timeout per attempt. */
async function attempt(
  step: FlowStep,
  ctx: ResolveContext,
  executor: StepExecutor,
  baseDelayMs: number,
  onAttempt: (n: number) => Promise<void>,
): Promise<Attempted> {
  let error = '';
  const maxAttempts = step.retries + 1;
  for (let n = 1; n <= maxAttempts; n++) {
    await onAttempt(n);
    try {
      const resolved = { ...step, config: resolveConfig(step.config, ctx) } as FlowStep;
      return { result: await withTimeout(step.timeoutMs, (signal) => executor(step, resolved, signal)), attempts: n };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (isNonRetryable(err)) return { attempts: n, error, nonRetryable: true };
      if (n < maxAttempts) await sleep(baseDelayMs * 2 ** (n - 1));
    }
  }
  return { attempts: maxAttempts, error, nonRetryable: false };
}

/** One entry per item of a `forEach` step, in list order. */
export type ForEachItemResult = { index: number; item: unknown; output?: unknown; error?: string };
export type ForEachOutput = { items: ForEachItemResult[]; total: number; succeeded: number; failed: number };

/**
 * Runs a `forEach` step: once per item, up to `concurrency` at a time. A failed item is recorded and
 * the others continue; the step fails only when every item failed, or at once on a non-retryable
 * error (a policy or budget stop), so a budget is never exceeded by items still in flight starting.
 */
async function runForEach(
  step: FlowStep & { forEach: NonNullable<FlowStep['forEach']> },
  ctx: ResolveContext,
  executor: StepExecutor,
  baseDelayMs: number,
  isCancelled: () => Promise<boolean>,
): Promise<{ output: ForEachOutput } | { error: string; cancelled?: boolean }> {
  const list = resolveString(step.forEach.items, ctx);
  if (!Array.isArray(list)) return { error: `${step.forEach.items} is not a list` };
  if (list.length > step.forEach.maxItems) {
    return { error: `${list.length} items is over this step's limit of ${step.forEach.maxItems}; raise the limit or narrow the list (no item was processed)` };
  }
  const results: ForEachItemResult[] = new Array(list.length);
  let next = 0;
  let stop: { error: string; cancelled?: boolean } | undefined;
  const worker = async () => {
    while (!stop && next < list.length) {
      const index = next++;
      if (await isCancelled()) {
        stop = { error: 'run cancelled', cancelled: true };
        return;
      }
      const item = list[index];
      const r = await attempt(step, { ...ctx, item }, executor, baseDelayMs, async () => {});
      if (r.result?.kind === 'done') results[index] = { index, item, output: r.result.output };
      else if (r.result) results[index] = { index, item, error: 'a repeating step cannot pause for approval' };
      else {
        results[index] = { index, item, error: r.error };
        if (r.nonRetryable) stop = { error: `item ${index + 1}: ${r.error}` };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(step.forEach.concurrency, Math.max(list.length, 1)) }, worker));
  if (stop) return stop;
  const failed = results.filter((r) => r.error !== undefined);
  if (list.length > 0 && failed.length === list.length) return { error: `every item failed; first: ${failed[0]!.error}` };
  return { output: { items: results, total: list.length, succeeded: list.length - failed.length, failed: failed.length } };
}

/**
 * Runs (or resumes) a flow. Steps run one at a time in `order`; each state change is saved before
 * moving on. A step whose `when` is false is skipped, and so is every step that depends on it. A
 * step with `forEach` runs once per item of its list (see runForEach). Returns the final run status:
 * `waiting_approval` means the run paused and should be resumed by calling executeRun again once
 * the approval step has been marked succeeded.
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

  const skipRest = async (fromIndex: number, skipReason: string) => {
    for (const id of order.slice(fromIndex)) {
      if (saved.get(id)?.status === 'succeeded') continue;
      await store.saveStepRun({ stepId: id, status: 'skipped', attempt: saved.get(id)?.attempt ?? 0, skipReason });
    }
  };
  // Steps skipped by a false condition in this pass; anything that reads them is skipped too.
  const branchSkipped = new Set<string>();

  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const step = byId.get(id)!;
    const prior = saved.get(id);
    if (prior?.status === 'succeeded') continue;

    if (await store.isCancelled()) {
      await skipRest(i, 'run cancelled');
      await store.setRunStatus('cancelled');
      return 'cancelled';
    }

    const skippedUpstream = stepDependencies(step).find((d) => branchSkipped.has(d));
    if (skippedUpstream) {
      branchSkipped.add(id);
      await store.saveStepRun({ stepId: id, status: 'skipped', attempt: 0, skipReason: `upstream step "${skippedUpstream}" was skipped` });
      continue;
    }
    if (step.when) {
      let pass: boolean;
      try {
        pass = evaluateCondition(step.when, ctx);
      } catch (err) {
        const error = `condition: ${err instanceof Error ? err.message : String(err)}`;
        await store.saveStepRun({ stepId: id, status: 'failed', attempt: 0, error });
        await skipRest(i + 1, `step "${id}" failed`);
        await store.setRunStatus('failed', `step "${id}" failed: ${error}`);
        return 'failed';
      }
      if (!pass) {
        branchSkipped.add(id);
        await store.saveStepRun({ stepId: id, status: 'skipped', attempt: 0, skipReason: 'condition not met' });
        continue;
      }
    }

    const executor = executors[step.type] as StepExecutor | undefined;
    if (!executor) {
      const error = `no executor registered for step type "${step.type}"`;
      await store.saveStepRun({ stepId: id, status: 'failed', attempt: 1, error });
      await skipRest(i + 1, `step "${id}" failed`);
      await store.setRunStatus('failed', error);
      return 'failed';
    }

    const baseDelayMs = opts.retryBaseDelayMs ?? 1000;
    if (step.forEach) {
      await store.saveStepRun({ stepId: id, status: 'running', attempt: 1 });
      let r: Awaited<ReturnType<typeof runForEach>>;
      try {
        r = await runForEach(step as FlowStep & { forEach: NonNullable<FlowStep['forEach']> }, ctx, executor, baseDelayMs, () => store.isCancelled());
      } catch (err) {
        r = { error: err instanceof Error ? err.message : String(err) };
      }
      if ('error' in r) {
        if (r.cancelled) {
          await skipRest(i, 'run cancelled');
          await store.setRunStatus('cancelled');
          return 'cancelled';
        }
        await store.saveStepRun({ stepId: id, status: 'failed', attempt: 1, error: r.error });
        await skipRest(i + 1, `step "${id}" failed`);
        await store.setRunStatus('failed', `step "${id}" failed: ${r.error}`);
        return 'failed';
      }
      ctx.steps[id] = r.output;
      await store.saveStepRun({ stepId: id, status: 'succeeded', attempt: 1, output: r.output });
      continue;
    }

    const attempted = await attempt(step, ctx, executor, baseDelayMs, (n) => store.saveStepRun({ stepId: id, status: 'running', attempt: n }));
    const attemptsUsed = attempted.attempts;
    const result = attempted.result;

    if (!result) {
      const lastError = 'error' in attempted ? attempted.error : '';
      await store.saveStepRun({ stepId: id, status: 'failed', attempt: attemptsUsed, error: lastError });
      await skipRest(i + 1, `step "${id}" failed`);
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
