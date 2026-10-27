import { classifyCapability, type CapabilityClass, type CapabilityDefinition, type PolicyContext } from '@/lib/capabilities/types';
import type { CapabilityRegistry } from '@/lib/capabilities/registry';
import { CAPABILITY_PERMISSIONS } from '@/lib/capabilities/builtin';
import type { FlowDefinition, FlowStep } from './schema';
import { extractRefs, stepDependencies } from './validate';
import { checkCustomFields } from '@/lib/extraction/schemas';

// Static policy check over a structurally valid flow: capability contracts, binding rules,
// permissions, approval gates and budget. Errors block publishing; warnings are shown to the creator.
// Runtime checks (egress, input validation, budget meter) still run in the gateway on every call.

/** Proposed permission for raw-SQL query steps (docs/flows-architecture.md §12.2). Not seeded yet. */
export const RAW_SQL_PERMISSION = 'flow:sql';
/** Used when no model-price function is supplied. Deliberately pessimistic; see 08-evaluations-cost-slos.md. */
export const DEFAULT_AGENT_STEP_COST_USD = 0.05;

export type StepProfile = CapabilityClass & {
  usesAI: boolean;
  estimatedCostUsd: number;
  /** Plain-language description of what the step does, from the saved (unresolved) definition. */
  does: string;
  capability?: { id: string; version: string };
};

export type PolicyFinding = { severity: 'error' | 'warning'; code: string; message: string; stepId?: string };

export type PolicyOptions = {
  registry: CapabilityRegistry;
  policy: PolicyContext;
  /** Price of one agent step for a model id. The API layer wires ALOFT's pricing table in here. */
  estimateAgentCostUsd?: (model?: string) => number;
};

export type PolicyReport = {
  findings: PolicyFinding[];
  profiles: Record<string, StepProfile>;
  cost: { expectedUsd: number; worstCaseUsd: number; budgetUsd?: number };
};

const hasRef = (value: unknown): boolean => {
  if (typeof value === 'string') return extractRefs(value).length > 0;
  if (Array.isArray(value)) return value.some(hasRef);
  if (value && typeof value === 'object') return Object.values(value).some(hasRef);
  return false;
};

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const NO_EFFECT: CapabilityClass = { sideEffect: 'none', risk: 'low', approval: 'none', requiredPermission: '' };
const READ: CapabilityClass = { sideEffect: 'read', risk: 'low', approval: 'none', requiredPermission: CAPABILITY_PERMISSIONS.READ };

/** Classifies one step. Returns undefined only for a `tool` step whose capability is not registered. */
export function profileStep(step: FlowStep, opts: PolicyOptions): StepProfile | undefined {
  const agentCost = (model?: string) => opts.estimateAgentCostUsd?.(model) ?? DEFAULT_AGENT_STEP_COST_USD;
  switch (step.type) {
    case 'query': {
      const c = step.config;
      if (c.semantic) return { ...READ, usesAI: false, estimatedCostUsd: 0, does: `Reads governed data from semantic model "${c.semantic.modelId}"` };
      return { ...READ, requiredPermission: RAW_SQL_PERMISSION, usesAI: false, estimatedCostUsd: 0, does: `Runs a read-only SQL query (up to ${c.maxRows} rows)` };
    }
    case 'retrieve':
      return { ...READ, usesAI: false, estimatedCostUsd: 0, does: `Searches the knowledge base for "${clip(step.config.query, 60)}"` };
    case 'agent':
      return {
        ...READ,
        risk: 'medium',
        usesAI: true,
        estimatedCostUsd: agentCost(step.config.model),
        does: step.config.agentSlug ? `Asks agent "${step.config.agentSlug}" (AI, read-only tools)` : 'Asks an AI model (no tools)',
      };
    case 'transform': {
      const c = step.config;
      const does =
        c.op === 'filter' ? `Keeps rows where ${c.field} ${c.operator} ${String(c.value)}`
        : c.op === 'limit' ? `Keeps the first ${c.count} rows`
        : c.op === 'count' ? 'Counts rows'
        : `Finds rows whose "${c.key}" has no match in another list`;
      return { ...NO_EFFECT, usesAI: false, estimatedCostUsd: 0, does };
    }
    case 'approval':
      return { ...NO_EFFECT, usesAI: false, estimatedCostUsd: 0, does: `Waits for ${step.config.assignee ?? 'the automation owner'} to approve` };
    case 'output':
      return {
        ...READ,
        sideEffect: 'write',
        usesAI: false,
        estimatedCostUsd: 0,
        does: `Saves "${clip(step.config.title, 60)}" to the run results`,
      };
    case 'tool': {
      const def = opts.registry.get(step.config.capability, step.config.version);
      if (!def) return undefined;
      return {
        ...classifyCapability(def, step.config.input),
        usesAI: false,
        estimatedCostUsd: def.estimatedCostUsd,
        does: `${def.title}: ${def.describe(step.config.input)}`,
        capability: { id: def.id, version: def.version },
      };
    }
  }
}

function checkToolBindings(step: Extract<FlowStep, { type: 'tool' }>, def: CapabilityDefinition, ctx: PolicyContext, out: PolicyFinding[]): void {
  const input = step.config.input;
  for (const message of def.checkLiteral?.(input) ?? []) out.push({ severity: 'error', code: 'invalid_input', stepId: step.id, message });
  for (const key of Object.keys(input)) {
    if (!def.fields[key]) out.push({ severity: 'error', code: 'unknown_field', stepId: step.id, message: `${def.id} has no input "${key}"` });
  }
  for (const [key, spec] of Object.entries(def.fields)) {
    const value = input[key];
    if (value === undefined) {
      if (spec.required) out.push({ severity: 'error', code: 'missing_field', stepId: step.id, message: `${def.id} needs "${key}" (${spec.description})` });
      continue;
    }
    if (spec.binding === 'literal' && hasRef(value)) {
      out.push({
        severity: 'error',
        code: 'data_bound_control_field',
        stepId: step.id,
        message: `"${key}" must be fixed in the definition; it cannot come from run data`,
      });
    }
    if (spec.egress === 'email' && hasRef(value) && ctx.egress.emailDomains.length === 0) {
      out.push({
        severity: 'warning',
        code: 'egress_unconfigured',
        stepId: step.id,
        message: 'no email domains are allowed for this organisation, so every recipient will be refused',
      });
    }
  }
}

/** Agent statuses a published flow may call. A draft or deprecated agent can still be tried and tested. */
export const RUNNABLE_AGENT_STATUSES = ['live', 'staging', 'preview'] as const;

function checkAgentStep(step: Extract<FlowStep, { type: 'agent' }>, ctx: PolicyContext, out: PolicyFinding[]): void {
  if (step.config.answer !== undefined) {
    for (const message of checkCustomFields(step.config.answer)) out.push({ severity: 'error', code: 'invalid_input', stepId: step.id, message: `answer ${message}` });
  }
  const slug = step.config.agentSlug;
  if (!slug || !ctx.agents || hasRef(slug)) return;
  const agent = ctx.agents.get(slug);
  if (!agent) {
    out.push({ severity: 'error', code: 'unknown_agent', stepId: step.id, message: `there is no saved agent "${slug}"` });
  } else if (agent.hasInstructions === false) {
    out.push({ severity: 'error', code: 'agent_not_ready', stepId: step.id, message: `agent "${agent.name}" has no instructions yet, so it cannot run` });
  } else if (!(RUNNABLE_AGENT_STATUSES as readonly string[]).includes(agent.status ?? '')) {
    out.push({
      severity: 'error',
      code: 'agent_not_ready',
      stepId: step.id,
      message: `agent "${agent.name}" is ${agent.status ?? 'not released'}; publishing needs a live, staging or preview agent`,
    });
  }
}

/** Every step id that must finish before `id` runs. */
function ancestorsOf(flow: FlowDefinition): Map<string, Set<string>> {
  const direct = new Map(flow.steps.map((s) => [s.id, stepDependencies(s)]));
  const memo = new Map<string, Set<string>>();
  const visit = (id: string): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const acc = new Set<string>();
    memo.set(id, acc); // the validator already rejected cycles
    for (const d of direct.get(id) ?? []) {
      acc.add(d);
      visit(d).forEach((x) => acc.add(x));
    }
    return acc;
  };
  flow.steps.forEach((s) => visit(s.id));
  return memo;
}

export function checkFlowPolicy(flow: FlowDefinition, opts: PolicyOptions): PolicyReport {
  const findings: PolicyFinding[] = [];
  const profiles: Record<string, StepProfile> = {};
  const ancestors = ancestorsOf(flow);
  const approvals = new Set(flow.steps.filter((s) => s.type === 'approval').map((s) => s.id));
  let expectedUsd = 0;
  let worstCaseUsd = 0;

  for (const step of flow.steps) {
    const profile = profileStep(step, opts);
    if (!profile) {
      const cfg = (step as Extract<FlowStep, { type: 'tool' }>).config;
      const other = opts.registry.get(cfg.capability);
      findings.push({
        severity: 'error',
        code: 'unknown_capability',
        stepId: step.id,
        message: other
          ? `${cfg.capability}@${cfg.version} is not registered (current version is ${other.version})`
          : `no capability "${cfg.capability}" is available to this organisation`,
      });
      continue;
    }
    // A repeating step is priced for its item limit: the list size is only known at run time.
    const calls = step.forEach?.maxItems ?? 1;
    profiles[step.id] = step.forEach ? { ...profile, does: `For each item of ${step.forEach.items} (up to ${calls}): ${profile.does}` } : profile;
    expectedUsd += profile.estimatedCostUsd * calls;
    worstCaseUsd += profile.estimatedCostUsd * calls * (step.retries + 1);

    if (step.type === 'tool') checkToolBindings(step, opts.registry.get(step.config.capability, step.config.version)!, opts.policy, findings);
    if (step.type === 'agent' && (hasRef(step.config.agentSlug) || hasRef(step.config.model))) {
      findings.push({ severity: 'error', code: 'data_bound_control_field', stepId: step.id, message: 'agent and model must be fixed in the definition' });
    }
    if (step.type === 'agent') checkAgentStep(step, opts.policy, findings);
    if (step.type === 'query' && step.config.sql) {
      findings.push({ severity: 'warning', code: 'raw_sql', stepId: step.id, message: 'raw SQL bypasses the governed semantic layer; prefer a semantic query' });
    }
    if (profile.requiredPermission && !opts.policy.permissions.has(profile.requiredPermission)) {
      findings.push({
        severity: 'error',
        code: 'missing_permission',
        stepId: step.id,
        message: `publishing needs permission "${profile.requiredPermission}", which you do not have`,
      });
    }
    if (profile.approval !== 'none' && ![...(ancestors.get(step.id) ?? [])].some((a) => approvals.has(a))) {
      findings.push({
        severity: profile.approval === 'required' ? 'error' : 'warning',
        code: 'missing_approval',
        stepId: step.id,
        message: `${profile.sideEffect === 'external' ? 'sends outside the platform' : 'changes another system'}; add an approval step before it`,
      });
    }
  }

  const repeating = flow.steps.some((s) => s.forEach);
  const budgetUsd = flow.budget?.maxCostUsd;
  if (budgetUsd !== undefined) {
    if (expectedUsd > budgetUsd && repeating) {
      // With a repeating step this is the cost at the item limit; smaller lists can still finish.
      findings.push({ severity: 'warning', code: 'budget_may_stop_run', message: `at the item limit the cost would be $${expectedUsd.toFixed(4)}, over the $${budgetUsd} budget; a run stops when the budget is used up` });
    } else if (expectedUsd > budgetUsd) {
      findings.push({ severity: 'error', code: 'budget_too_low', message: `expected cost $${expectedUsd.toFixed(4)} is over the $${budgetUsd} budget, so no run can finish` });
    } else if (worstCaseUsd > budgetUsd) {
      findings.push({ severity: 'warning', code: 'budget_may_stop_run', message: `with every retry used, cost could reach $${worstCaseUsd.toFixed(4)} and the run would stop at the $${budgetUsd} budget` });
    }
  } else if (repeating && expectedUsd > 0) {
    // Without a budget nothing caps a repeating paid step but its item limit.
    findings.push({ severity: 'error', code: 'no_budget', message: `a step repeats for each item and costs money, so set a per-run budget (up to $${expectedUsd.toFixed(4)} at the item limit)` });
  } else if (expectedUsd > 0) {
    findings.push({ severity: 'warning', code: 'no_budget', message: `no per-run budget is set (expected cost $${expectedUsd.toFixed(4)})` });
  }

  return { findings, profiles, cost: { expectedUsd, worstCaseUsd, budgetUsd } };
}
