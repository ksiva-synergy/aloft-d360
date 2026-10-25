import { describe, expect, it } from 'vitest';
import { validateFlow } from '../validate';
import { resolveConfig } from '../resolve';
import { executeRun, type RunStore, type StepExecutors, type StepRunState } from '../runner';
import type { RunStatus } from '../schema';

const baseFlow = () => ({
  name: 'Weekly victualling check',
  trigger: { type: 'schedule', cron: '0 8 * * 1' },
  inputs: [{ name: 'threshold', type: 'number', default: 20 }],
  steps: [
    { id: 'find', type: 'query', config: { sql: 'select * from victualling where over_pct > {{inputs.threshold}}' } },
    {
      id: 'explain',
      type: 'agent',
      config: { prompt: 'Explain these vessels: {{steps.find.rows}}' },
    },
    { id: 'ok', type: 'approval', dependsOn: ['explain'], config: { message: 'Send to fleet team?' } },
    { id: 'save', type: 'output', config: { kind: 'save', title: 'Summary', content: '{{steps.explain.text}}' }, dependsOn: ['ok'] },
  ],
});

describe('validateFlow', () => {
  it('accepts a valid flow and orders steps by dependency', () => {
    const result = validateFlow(baseFlow());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(['find', 'explain', 'ok', 'save']);
  });

  it('orders by refs even when steps are listed out of order', () => {
    const flow = baseFlow();
    flow.steps.reverse();
    const result = validateFlow(flow);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(['find', 'explain', 'ok', 'save']);
  });

  it('rejects unknown step and input refs', () => {
    const flow = baseFlow();
    flow.steps[1]!.config = { prompt: '{{steps.nope.rows}} {{inputs.missing}}' } as never;
    const result = validateFlow(flow);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.issues.map((i) => i.message).join('\n');
      expect(messages).toContain('unknown step "nope"');
      expect(messages).toContain('unknown input "missing"');
    }
  });

  it('rejects ref scopes other than steps and inputs', () => {
    const flow = baseFlow();
    flow.steps[0]!.config = { sql: 'select {{env.SECRET}}' } as never;
    const result = validateFlow(flow);
    expect(result.ok).toBe(false);
  });

  it('rejects cycles', () => {
    const flow = baseFlow();
    flow.steps[0]!.dependsOn = ['save'] as never;
    const result = validateFlow(flow);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain('dependency cycle');
  });

  it('rejects duplicate ids, bad cron and unknown step types', () => {
    const dup = baseFlow();
    dup.steps[1]!.id = 'find';
    expect(validateFlow(dup).ok).toBe(false);

    const cron = baseFlow();
    cron.trigger = { type: 'schedule', cron: 'not a cron' };
    const cronResult = validateFlow(cron);
    expect(cronResult.ok).toBe(false);
    if (!cronResult.ok) expect(cronResult.issues[0]!.path).toBe('trigger.cron');

    const unknown = baseFlow();
    (unknown.steps[0] as { type: string }).type = 'shell';
    expect(validateFlow(unknown).ok).toBe(false);
  });

  it('rejects an empty flow', () => {
    expect(validateFlow({ name: 'x', steps: [] }).ok).toBe(false);
  });
});

describe('resolveConfig', () => {
  const ctx = { inputs: { n: 3 }, steps: { a: { rows: [{ x: 1 }], text: 'hi' } } };

  it('keeps the type for a whole-string ref and stringifies embedded refs', () => {
    expect(resolveConfig({ input: '{{steps.a.rows}}' }, ctx)).toEqual({ input: [{ x: 1 }] });
    expect(resolveConfig({ p: 'say {{steps.a.text}} x{{inputs.n}}' }, ctx)).toEqual({ p: 'say hi x3' });
  });

  it('throws when a ref cannot be resolved', () => {
    expect(() => resolveConfig({ p: '{{steps.a.missing}}' }, ctx)).toThrow('could not be resolved');
  });
});

function memoryStore(initial: StepRunState[] = []) {
  const steps = new Map(initial.map((s) => [s.stepId, s]));
  const state = { status: 'queued' as RunStatus, error: undefined as string | undefined, cancelled: false };
  const store: RunStore = {
    loadStepRuns: async () => [...steps.values()],
    saveStepRun: async (s) => void steps.set(s.stepId, s),
    setRunStatus: async (status, error) => {
      state.status = status;
      state.error = error;
    },
    isCancelled: async () => state.cancelled,
  };
  return { store, steps, state };
}

const validated = () => {
  const result = validateFlow(baseFlow());
  if (!result.ok) throw new Error('fixture invalid');
  return result;
};

const happyExecutors = (calls: string[] = []): StepExecutors => ({
  query: async (_s, resolved) => {
    calls.push(`query:${(resolved.config as { sql: string }).sql}`);
    return { kind: 'done', output: { rows: [{ vessel: 'A' }] } };
  },
  agent: async (_s, resolved) => {
    calls.push(`agent:${(resolved.config as { prompt: string }).prompt}`);
    return { kind: 'done', output: { text: 'A is over budget' } };
  },
  approval: async () => ({ kind: 'wait_approval' }),
  output: async () => ({ kind: 'done', output: { saved: true } }),
});

describe('executeRun', () => {
  it('passes resolved step outputs downstream and pauses at approval', async () => {
    const { flow, order } = validated();
    const { store, steps, state } = memoryStore();
    const calls: string[] = [];
    const status = await executeRun({ flow, order, inputs: { threshold: 20 }, store, executors: happyExecutors(calls), retryBaseDelayMs: 0 });

    expect(status).toBe('waiting_approval');
    expect(state.status).toBe('waiting_approval');
    expect(calls).toEqual([
      'query:select * from victualling where over_pct > 20',
      'agent:Explain these vessels: [{"vessel":"A"}]',
    ]);
    expect(steps.get('ok')!.status).toBe('waiting_approval');
    expect(steps.has('save')).toBe(false);
  });

  it('resumes after approval without re-running finished steps', async () => {
    const { flow, order } = validated();
    const { store, steps, state } = memoryStore([
      { stepId: 'find', status: 'succeeded', attempt: 1, output: { rows: [] } },
      { stepId: 'explain', status: 'succeeded', attempt: 1, output: { text: 'done' } },
      { stepId: 'ok', status: 'succeeded', attempt: 1, output: { approved: true } },
    ]);
    const calls: string[] = [];
    const status = await executeRun({ flow, order, inputs: {}, store, executors: happyExecutors(calls), retryBaseDelayMs: 0 });

    expect(status).toBe('succeeded');
    expect(state.status).toBe('succeeded');
    expect(calls).toEqual([]);
    expect(steps.get('save')!.status).toBe('succeeded');
  });

  it('retries a failing step, then fails the run and skips the rest', async () => {
    const { flow, order } = validated();
    flow.steps[0]!.retries = 2;
    const { store, steps, state } = memoryStore();
    let attempts = 0;
    const executors: StepExecutors = {
      ...happyExecutors(),
      query: async () => {
        attempts++;
        throw new Error('warehouse down');
      },
    };
    const status = await executeRun({ flow, order, inputs: {}, store, executors, retryBaseDelayMs: 0 });

    expect(status).toBe('failed');
    expect(attempts).toBe(3);
    expect(steps.get('find')).toMatchObject({ status: 'failed', attempt: 3, error: 'warehouse down' });
    expect(steps.get('explain')!.status).toBe('skipped');
    expect(state.error).toContain('step "find" failed');
  });

  it('succeeds on a later attempt and records the attempt count', async () => {
    const { flow, order } = validated();
    flow.steps[0]!.retries = 1;
    const { store, steps } = memoryStore();
    let n = 0;
    const executors: StepExecutors = {
      ...happyExecutors(),
      query: async () => {
        if (++n === 1) throw new Error('flaky');
        return { kind: 'done', output: { rows: [] } };
      },
    };
    await executeRun({ flow, order, inputs: {}, store, executors, retryBaseDelayMs: 0 });
    expect(steps.get('find')).toMatchObject({ status: 'succeeded', attempt: 2 });
  });

  it('times out a hung step', async () => {
    const { flow, order } = validated();
    flow.steps[0]!.timeoutMs = 1000;
    const { store, steps } = memoryStore();
    const executors: StepExecutors = {
      ...happyExecutors(),
      query: (_s, _r, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    };
    const started = Date.now();
    const status = await executeRun({ flow, order, inputs: {}, store, executors, retryBaseDelayMs: 0 });
    expect(status).toBe('failed');
    expect(steps.get('find')!.error).toContain('timed out after 1000ms');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('fails the run before any step when a required input is missing or mistyped', async () => {
    const { flow, order } = validated();
    flow.inputs[0]!.default = undefined as never;
    const missing = memoryStore();
    expect(await executeRun({ flow, order, inputs: {}, store: missing.store, executors: happyExecutors() })).toBe('failed');
    expect(missing.state.error).toBe('missing required input "threshold"');
    expect(missing.steps.size).toBe(0);

    const wrong = memoryStore();
    expect(await executeRun({ flow, order, inputs: { threshold: 'high' }, store: wrong.store, executors: happyExecutors() })).toBe('failed');
    expect(wrong.state.error).toBe('input "threshold" must be a number');
  });

  it('fails when a step type has no executor', async () => {
    const { flow, order } = validated();
    const { store, state } = memoryStore();
    const status = await executeRun({ flow, order, inputs: {}, store, executors: {}, retryBaseDelayMs: 0 });
    expect(status).toBe('failed');
    expect(state.error).toContain('no executor registered for step type "query"');
  });

  it('stops between steps when the run is cancelled', async () => {
    const { flow, order } = validated();
    const { store, steps, state } = memoryStore();
    const executors: StepExecutors = {
      ...happyExecutors(),
      query: async () => {
        state.cancelled = true;
        return { kind: 'done', output: { rows: [] } };
      },
    };
    const status = await executeRun({ flow, order, inputs: {}, store, executors, retryBaseDelayMs: 0 });
    expect(status).toBe('cancelled');
    expect(steps.get('find')!.status).toBe('succeeded');
    expect(steps.get('explain')!.status).toBe('skipped');
  });

  it('fails the step, not the process, when a ref cannot be resolved', async () => {
    const { flow, order } = validated();
    const { store, steps } = memoryStore();
    const executors: StepExecutors = {
      ...happyExecutors(),
      query: async () => ({ kind: 'done', output: { nothing: true } }),
    };
    const status = await executeRun({ flow, order, inputs: {}, store, executors, retryBaseDelayMs: 0 });
    expect(status).toBe('failed');
    expect(steps.get('explain')!.error).toContain('could not be resolved');
  });
});
