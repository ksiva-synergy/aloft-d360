/**
 * Repeat-for-each-item steps: where `forEach` and `{{item}}` are allowed, how the runner fans out
 * (order, concurrency, per-item failures, the item limit, non-retryable stops, cancellation), how
 * cost and budget are checked, a simulated run end to end, and the copilot operations.
 */
import { describe, expect, it } from 'vitest';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import { validateFlow } from '../validate';
import { executeRun, type ForEachOutput, type RunStore, type StepExecutors, type StepRunState } from '../runner';
import { checkFlowPolicy } from '../policy';
import { analyzeFlow } from '../analyze';
import { applyOperations } from '../copilot';
import type { RunStatus } from '../schema';

const policy = (): PolicyContext => ({ actorId: 'u-1', tenantId: 'org-1', permissions: new Set(['inspector:use']), egress: { emailDomains: [] } });

/** List certificates, then extract each one. */
const docsFlow = (over: Record<string, unknown> = {}) => ({
  name: 'Certificate check',
  budget: { maxCostUsd: 5 },
  steps: [
    { id: 'list_docs', type: 'tool', config: { capability: 'object_store.list', input: { connection: 'c-1', prefix: 'certs/' } } },
    {
      id: 'extract',
      type: 'tool',
      forEach: { items: '{{steps.list_docs.objects}}', maxItems: 10, concurrency: 2 },
      config: { capability: 'document.extract', input: { connection: 'c-1', key: '{{item.key}}', schema: 'seafarer_certificate' } },
      ...over,
    },
  ],
});

function memoryStore(cancelAfter = Infinity) {
  const steps = new Map<string, StepRunState>();
  const state = { status: 'queued' as RunStatus, error: undefined as string | undefined };
  let checks = 0;
  const store: RunStore = {
    loadStepRuns: async () => [],
    saveStepRun: async (s) => void steps.set(s.stepId, s),
    setRunStatus: async (status, error) => Object.assign(state, { status, error }),
    isCancelled: async () => ++checks > cancelAfter,
  };
  return { store, steps, state };
}

const validated = (raw: unknown) => {
  const v = validateFlow(raw);
  if (!v.ok) throw new Error(JSON.stringify(v.issues));
  return v;
};

describe('forEach validation', () => {
  it('accepts a repeating tool step and orders it after the list it reads', () => {
    const flow = docsFlow();
    flow.steps.reverse();
    expect(validated(flow).order).toEqual(['list_docs', 'extract']);
  });

  it('rejects forEach on step types that cannot repeat, and a list that is not one ref', () => {
    const query = validateFlow({ name: 'x', steps: [{ id: 'q', type: 'query', forEach: { items: '{{inputs.a}}', maxItems: 2 }, config: { sql: 'select 1' } }], inputs: [{ name: 'a', type: 'string' }] });
    expect(query.ok === false && query.issues.some((i) => /only agent and tool steps can repeat/.test(i.message))).toBe(true);
    const notRef = validateFlow(docsFlow({ forEach: { items: 'every file', maxItems: 2 } }));
    expect(notRef.ok === false && notRef.issues.some((i) => /exactly one \{\{ref\}\}/.test(i.message))).toBe(true);
  });

  it('allows {{item}} only inside the config of a repeating step', () => {
    const noForEach = validateFlow({ ...docsFlow(), steps: [docsFlow().steps[0], { ...docsFlow().steps[1], forEach: undefined }] });
    expect(noForEach.ok === false && noForEach.issues.some((i) => /needs the step to repeat/.test(i.message))).toBe(true);
    const inWhen = validateFlow(docsFlow({ when: { ref: '{{item.key}}', operator: 'eq', value: 'x' } }));
    expect(inWhen.ok === false && inWhen.issues.some((i) => /can only be used in the inputs/.test(i.message))).toBe(true);
  });

  it('rejects an item limit over 1000', () => {
    expect(validateFlow(docsFlow({ forEach: { items: '{{steps.list_docs.objects}}', maxItems: 5000 } })).ok).toBe(false);
  });
});

describe('forEach runs', () => {
  const objects = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `certs/${i + 1}.pdf` }));
  const executors = (n: number, onExtract: (key: string) => Promise<unknown>): StepExecutors => ({
    tool: async (step, resolved) =>
      step.config.capability === 'object_store.list'
        ? { kind: 'done', output: { objects: objects(n) } }
        : { kind: 'done', output: await onExtract(resolved.config.input.key as string) },
  });

  it('runs once per item with the item resolved, keeps list order and respects concurrency', async () => {
    const { flow, order } = validated(docsFlow());
    const { store, steps, state } = memoryStore();
    let running = 0;
    let peak = 0;
    const status = await executeRun({
      flow,
      order,
      inputs: {},
      store,
      retryBaseDelayMs: 0,
      executors: executors(5, async (key) => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, key.endsWith('1.pdf') ? 15 : 1));
        running--;
        return { fields: { file: key } };
      }),
    });
    expect(status).toBe('succeeded');
    expect(state.status).toBe('succeeded');
    const out = steps.get('extract')!.output as ForEachOutput;
    expect(out).toMatchObject({ total: 5, succeeded: 5, failed: 0 });
    expect(out.items.map((i) => (i.output as { fields: { file: string } }).fields.file)).toEqual(objects(5).map((o) => o.key));
    expect(peak).toBe(2);
  });

  it('records a failed item and carries on; retries apply per item', async () => {
    const { flow, order } = validated(docsFlow({ retries: 1 }));
    const { store, steps } = memoryStore();
    const tries = new Map<string, number>();
    const status = await executeRun({
      flow,
      order,
      inputs: {},
      store,
      retryBaseDelayMs: 0,
      executors: executors(3, async (key) => {
        tries.set(key, (tries.get(key) ?? 0) + 1);
        if (key === 'certs/2.pdf') throw new Error('unreadable scan');
        if (key === 'certs/3.pdf' && tries.get(key) === 1) throw new Error('throttled');
        return { fields: {} };
      }),
    });
    expect(status).toBe('succeeded');
    const out = steps.get('extract')!.output as ForEachOutput;
    expect(out).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(out.items[1]).toMatchObject({ item: { key: 'certs/2.pdf' }, error: 'unreadable scan' });
    expect(tries.get('certs/2.pdf')).toBe(2);
    expect(tries.get('certs/3.pdf')).toBe(2);
  });

  it('fails the step when every item failed', async () => {
    const { flow, order } = validated(docsFlow());
    const { store, steps } = memoryStore();
    const status = await executeRun({ flow, order, inputs: {}, store, retryBaseDelayMs: 0, executors: executors(2, async () => Promise.reject(new Error('no access'))) });
    expect(status).toBe('failed');
    expect(steps.get('extract')!.error).toMatch(/every item failed; first: no access/);
  });

  it('fails without processing anything when the list is longer than the item limit', async () => {
    const { flow, order } = validated(docsFlow());
    const { store, steps } = memoryStore();
    let calls = 0;
    const status = await executeRun({ flow, order, inputs: {}, store, retryBaseDelayMs: 0, executors: executors(11, async () => ++calls) });
    expect(status).toBe('failed');
    expect(calls).toBe(0);
    expect(steps.get('extract')!.error).toMatch(/11 items is over this step's limit of 10/);
  });

  it('stops at once on a non-retryable error such as a budget stop', async () => {
    const { flow, order } = validated(docsFlow({ forEach: { items: '{{steps.list_docs.objects}}', maxItems: 10, concurrency: 1 } }));
    const { store, steps } = memoryStore();
    let calls = 0;
    const status = await executeRun({
      flow,
      order,
      inputs: {},
      store,
      retryBaseDelayMs: 0,
      executors: executors(5, async () => {
        if (++calls === 2) throw Object.assign(new Error('budget of $5 reached'), { retryable: false });
        return {};
      }),
    });
    expect(status).toBe('failed');
    expect(calls).toBe(2);
    expect(steps.get('extract')!.error).toMatch(/item 2: budget of \$5 reached/);
  });

  it('stops starting items when the run is cancelled', async () => {
    const { flow, order } = validated(docsFlow({ forEach: { items: '{{steps.list_docs.objects}}', maxItems: 10, concurrency: 1 } }));
    // isCancelled is checked once before each step and before each item: cancel before item 3.
    const { store, state } = memoryStore(4);
    let calls = 0;
    const status = await executeRun({ flow, order, inputs: {}, store, retryBaseDelayMs: 0, executors: executors(5, async () => ++calls) });
    expect(status).toBe('cancelled');
    expect(state.status).toBe('cancelled');
    expect(calls).toBe(2);
  });
});

describe('forEach cost and simulation', () => {
  const opts = { registry: builtinCapabilityRegistry, policy: policy() };

  it('prices a repeating step at its item limit and requires a budget when it costs money', () => {
    const { flow } = validated(docsFlow());
    const report = checkFlowPolicy(flow, opts);
    // document.extract is $0.05 per call; 10 items.
    expect(report.cost.expectedUsd).toBeCloseTo(0.05 * 10 + 0.000005, 6);
    expect(report.profiles.extract!.does).toMatch(/^For each item of \{\{steps.list_docs.objects\}\} \(up to 10\)/);

    const noBudget = checkFlowPolicy(validated({ ...docsFlow(), budget: undefined }).flow, opts);
    expect(noBudget.findings).toContainEqual(expect.objectContaining({ severity: 'error', code: 'no_budget' }));

    const tight = checkFlowPolicy(validated({ ...docsFlow(), budget: { maxCostUsd: 0.2 } }).flow, opts);
    expect(tight.findings).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'budget_may_stop_run' }));
    expect(tight.findings.some((f) => f.code === 'budget_too_low')).toBe(false);
  });

  it('simulates each item with the sample responses and charges the budget per item', async () => {
    const a = await analyzeFlow(docsFlow(), {
      ...opts,
      simulate: true,
      fixtures: { list_docs: { objects: [{ key: 'certs/a.pdf' }, { key: 'certs/b.pdf' }, { key: 'certs/c.pdf' }] }, extract: { fields: { expiry_date: '2027-01-31' } } },
    });
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    const step = a.simulation!.steps.find((s) => s.stepId === 'extract')!;
    expect(step.status).toBe('succeeded');
    expect(step.output).toMatchObject({ total: 3, succeeded: 3, failed: 0 });
    expect(step.effect).toMatch(/^For each of 3 items, e\.g\. Extract "seafarer_certificate" fields from "certs\/c\.pdf"/);
    expect(step.costUsd).toBeCloseTo(0.15, 6);
    expect(a.explanation.limitations.some((l) => /repeating step runs once per item/.test(l))).toBe(true);
  });
});

describe('forEach copilot operations', () => {
  it('adds a repeating step and can stop it repeating', () => {
    const base = { name: 'x', steps: [docsFlow().steps[0]] };
    const added = applyOperations(base, [{ op: 'add_step', step: docsFlow().steps[1] as never }]);
    if (!added.ok) throw new Error(added.errors.join());
    expect(added.definition.steps![1]!.forEach).toEqual({ items: '{{steps.list_docs.objects}}', maxItems: 10, concurrency: 2 });
    const stopped = applyOperations(added.definition, [{ op: 'update_step', id: 'extract', forEach: null }]);
    if (!stopped.ok) throw new Error(stopped.errors.join());
    expect(stopped.definition.steps![1]!.forEach).toBeUndefined();
  });
});
