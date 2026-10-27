import type { CapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import type { FlowDefinition } from './schema';
import { validateFlow, type FlowIssue } from './validate';
import { checkFlowPolicy, type PolicyFinding, type PolicyReport } from './policy';
import { explainFlow, type FlowExplanation } from './explain';
import { simulateFlow, type SimulationFault, type SimulationReport } from './simulate';

// One call for the creation loop: validate → policy check → explain → (optionally) simulate.
// Framework-free; the API route only supplies the actor's policy context and pricing.

export type AnalyzeOptions = {
  registry: CapabilityRegistry;
  policy: PolicyContext;
  estimateAgentCostUsd?: (model?: string) => number;
  simulate?: boolean;
  inputs?: Record<string, unknown>;
  fixtures?: Record<string, unknown>;
  faults?: Record<string, SimulationFault>;
  now?: Date;
};

export type FlowAnalysis =
  | { ok: false; issues: FlowIssue[] }
  | {
      ok: true;
      flow: FlowDefinition;
      order: string[];
      findings: PolicyFinding[];
      cost: PolicyReport['cost'];
      explanation: FlowExplanation;
      simulation?: SimulationReport;
      /**
       * Would pass the publish gate: no policy errors and, when simulated, a run that succeeded.
       * Publishing itself is not available until flow persistence is enabled.
       */
      readyToPublish: boolean;
    };

export async function analyzeFlow(raw: unknown, opts: AnalyzeOptions): Promise<FlowAnalysis> {
  const validation = validateFlow(raw);
  if (!validation.ok) return { ok: false, issues: validation.issues };
  const { flow, order } = validation;

  const report = checkFlowPolicy(flow, opts);
  const explanation = explainFlow(flow, order, report, opts.now);
  const simulation = opts.simulate
    ? await simulateFlow({
        flow,
        order,
        registry: opts.registry,
        policy: opts.policy,
        profiles: report.profiles,
        inputs: opts.inputs,
        fixtures: opts.fixtures,
        faults: opts.faults,
      })
    : undefined;

  const blocked = report.findings.some((f) => f.severity === 'error');
  return {
    ok: true,
    flow,
    order,
    findings: report.findings,
    cost: report.cost,
    explanation,
    simulation,
    readyToPublish: !blocked && (!simulation || simulation.status === 'succeeded'),
  };
}
