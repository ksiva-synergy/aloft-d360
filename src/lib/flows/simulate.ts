import type { CapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import { BudgetMeter, invokeCapability } from '@/lib/capabilities/gateway';
import type { FlowDefinition, FlowStepType, RunStatus, StepStatus } from './schema';
import { executeRun, type StepExecutor, type StepExecutors, type StepResult } from './runner';
import { createMemoryRunStore } from './memory-store';
import { applyTransform } from './transforms';
import type { StepProfile } from './policy';

// Dry run of a flow with sample data and mocked connectors. It drives the real runner, the real
// transforms and the real capability gateway (input validation, egress and budget checks); only
// data sources, AI calls and connector handlers are replaced. Nothing outside the process is called.

export const SIMULATION_NOTICE =
  'Simulation only: sample data and mocked connectors. No system was contacted, no message was sent and nothing was saved.';

export type SimulationFault = { failAttempts: number; message?: string };

export type SimulateOptions = {
  flow: FlowDefinition;
  order: string[];
  registry: CapabilityRegistry;
  policy: PolicyContext;
  /** From checkFlowPolicy; supplies per-step cost estimates. */
  profiles: Record<string, StepProfile>;
  inputs?: Record<string, unknown>;
  /** Sample output per step id, replacing the mock for query, retrieve, agent and tool steps. */
  fixtures?: Record<string, unknown>;
  /** Make a step throw on its first `failAttempts` attempts, to preview retry and failure paths. */
  faults?: Record<string, SimulationFault>;
};

export type SimulatedStep = {
  stepId: string;
  type: FlowStepType;
  status: StepStatus;
  attempts: number;
  skipReason?: string;
  error?: string;
  /** Config after ref resolution, i.e. what the step would have been called with. */
  input?: unknown;
  output?: unknown;
  /** True when the output came from a mock or fixture rather than real code. */
  mocked: boolean;
  /** The side effect a live run would have, e.g. `Email "…" to a@b.com`. */
  effect?: string;
  costUsd: number;
  durationMs: number;
};

export type SimulationReport = {
  notice: string;
  status: RunStatus;
  error?: string;
  steps: SimulatedStep[];
  totals: { costUsd: number; durationMs: number; effects: number; approvalsAutoResolved: number };
};

const PREVIEW_CHARS = 4000;

/** Large values are cut so a report stays small enough to return over HTTP and render. */
export function preview(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined || json.length <= PREVIEW_CHARS) return value;
  return { truncated: true, chars: json.length, preview: `${json.slice(0, PREVIEW_CHARS)}…` };
}

export async function simulateFlow(opts: SimulateOptions): Promise<SimulationReport> {
  const { flow, order, registry, policy, profiles, fixtures = {}, faults = {} } = opts;
  const started = Date.now();
  const meter = new BudgetMeter(flow.budget?.maxCostUsd);
  const trace = new Map<string, Partial<SimulatedStep>>();
  const faultCounts = new Map<string, number>();
  let approvalsAutoResolved = 0;

  const note = (id: string, patch: Partial<SimulatedStep>) => trace.set(id, { ...trace.get(id), ...patch });
  const injectFault = (id: string) => {
    const fault = faults[id];
    if (!fault) return;
    const n = (faultCounts.get(id) ?? 0) + 1;
    faultCounts.set(id, n);
    if (n <= fault.failAttempts) throw new Error(fault.message ?? `injected failure (attempt ${n})`);
  };
  const fromFixture = (id: string, fallback: () => unknown) => (id in fixtures ? fixtures[id] : fallback());
  const done = (output: unknown): StepResult => ({ kind: 'done', output });

  const executors: StepExecutors = {
    query: async (step, resolved) => {
      note(step.id, { input: preview(resolved.config), mocked: true });
      injectFault(step.id);
      return done(fromFixture(step.id, () => ({ columns: [], rows: [], rowCount: 0 })));
    },
    retrieve: async (step, resolved) => {
      note(step.id, { input: preview(resolved.config), mocked: true });
      injectFault(step.id);
      return done(fromFixture(step.id, () => ({ chunks: [] })));
    },
    agent: async (step, resolved) => {
      const cost = profiles[step.id]?.estimatedCostUsd ?? 0;
      note(step.id, { input: preview(resolved.config), mocked: true });
      meter.charge(cost, `agent step "${step.id}"`);
      note(step.id, { costUsd: (trace.get(step.id)?.costUsd ?? 0) + cost });
      injectFault(step.id);
      // Same shape as a live agent run (src/lib/agents/run-catalog-agent.ts): answer fields come back
      // as `values`, here all unknown, so later steps can reference them before a real run.
      const keys = Array.isArray(step.config.answer) ? step.config.answer.map((f) => String((f as { key?: unknown }).key ?? '')).filter(Boolean) : null;
      return done(
        fromFixture(step.id, () => ({
          text: `[Simulated] ${step.config.agentSlug ? `Agent "${step.config.agentSlug}"` : 'The model'} would answer here. Add a fixture for "${step.id}" to preview real wording.`,
          ...(keys ? { values: Object.fromEntries(keys.map((k) => [k, null])), missing: keys } : {}),
        })),
      );
    },
    transform: async (step, resolved) => {
      note(step.id, { mocked: false });
      injectFault(step.id);
      return done(applyTransform(resolved.config));
    },
    approval: async (step, resolved) => {
      note(step.id, { input: preview(resolved.config), mocked: true, effect: `Approval request: ${resolved.config.message}` });
      injectFault(step.id);
      approvalsAutoResolved++;
      return done({ approved: true, simulated: true, by: 'simulation' });
    },
    output: async (step, resolved) => {
      note(step.id, { mocked: true, effect: `Save "${resolved.config.title}"` });
      injectFault(step.id);
      return done({ saved: false, simulated: true, title: resolved.config.title, content: resolved.config.content });
    },
    tool: async (step, resolved, signal) => {
      const def = registry.get(step.config.capability, step.config.version);
      if (!def) throw Object.assign(new Error(`capability ${step.config.capability} is not registered`), { retryable: false });
      note(step.id, { input: preview(resolved.config.input), mocked: true });
      const result = await invokeCapability({
        def,
        input: resolved.config.input,
        literalInput: step.config.input,
        policy,
        mode: 'simulate',
        idempotencyKey: `simulation:${step.id}`,
        budget: meter,
        signal,
      });
      note(step.id, { effect: result.summary, costUsd: (trace.get(step.id)?.costUsd ?? 0) + result.costUsd });
      injectFault(step.id);
      return done(fromFixture(step.id, () => result.output));
    },
  };

  // Time every attempt of every step.
  const timed = Object.fromEntries(
    Object.entries(executors).map(([type, fn]) => [
      type,
      (async (step, resolved, signal) => {
        const t0 = Date.now();
        try {
          return await (fn as StepExecutor)(step, resolved, signal);
        } finally {
          note(step.id, { durationMs: (trace.get(step.id)?.durationMs ?? 0) + (Date.now() - t0) });
        }
      }) as StepExecutor,
    ]),
  ) as StepExecutors;

  const { store, steps, run } = createMemoryRunStore();
  const status = await executeRun({ flow, order, inputs: opts.inputs ?? {}, store, executors: timed, retryBaseDelayMs: 0 });

  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  const report: SimulatedStep[] = order.map((id) => {
    const state = steps.get(id);
    const t = trace.get(id) ?? {};
    // A repeating step's trace holds its last item; say how many items the effect applied to.
    const total = byId.get(id)!.forEach ? (state?.output as { total?: number } | undefined)?.total : undefined;
    if (total !== undefined && t.effect) t.effect = `For each of ${total} items, e.g. ${t.effect}`;
    return {
      stepId: id,
      type: byId.get(id)!.type,
      status: state?.status ?? 'pending',
      attempts: state?.attempt ?? 0,
      skipReason: state?.skipReason,
      error: state?.error,
      input: t.input,
      output: state?.status === 'succeeded' ? preview(state.output) : undefined,
      mocked: t.mocked ?? false,
      // An effect only "happened" (in simulation) if the step finished.
      effect: state?.status === 'succeeded' ? t.effect : undefined,
      costUsd: t.costUsd ?? 0,
      durationMs: t.durationMs ?? 0,
    };
  });

  return {
    notice: SIMULATION_NOTICE,
    status,
    error: run.error,
    steps: report,
    totals: {
      costUsd: meter.spentUsd,
      durationMs: Date.now() - started,
      effects: report.filter((s) => s.effect && s.type !== 'approval').length,
      approvalsAutoResolved,
    },
  };
}
