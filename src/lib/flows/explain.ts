import CronParser from 'cron-parser';
import type { FlowDefinition } from './schema';
import type { PolicyReport } from './policy';

// Plain-language summary of a flow for the creator: what it does, when it runs, where AI is used,
// what it touches, who approves, what it costs and what it cannot do. Built only from the saved
// definition and the static policy report, so it is the same before and after a simulation.

export type FlowExplanation = {
  name: string;
  /** `hybrid` when any step uses AI; a pure deterministic flow is a `workflow`. */
  kind: 'workflow' | 'hybrid';
  trigger: string;
  /** Next three fire times (ISO, UTC) for scheduled flows. */
  nextRuns: string[];
  steps: { id: string; does: string; sideEffect: string; usesAI: boolean; approvalGate: boolean; condition?: string }[];
  aiSteps: string[];
  approvals: { stepId: string; approver: string }[];
  externalEffects: { stepId: string; does: string }[];
  access: { permissions: string[]; connections: string[]; capabilities: string[] };
  cost: PolicyReport['cost'];
  limitations: string[];
};

function triggerText(flow: FlowDefinition): string {
  const t = flow.trigger;
  switch (t.type) {
    case 'manual':
      return 'Runs when someone starts it.';
    case 'schedule':
      return `Runs on the schedule "${t.cron}" (UTC).`;
    case 'event':
      return `Runs when the "${t.name}" event is raised inside ALOFT.`;
    case 'webhook':
      return `Runs when an external system calls the "${t.name}" webhook. Only the declared inputs are accepted from its payload.`;
  }
}

function nextRuns(flow: FlowDefinition, now: Date): string[] {
  if (flow.trigger.type !== 'schedule') return [];
  try {
    const it = CronParser.parse(flow.trigger.cron, { currentDate: now, tz: 'UTC' });
    return [0, 1, 2].map(() => it.next().toDate().toISOString());
  } catch {
    return [];
  }
}

export function explainFlow(flow: FlowDefinition, order: string[], report: PolicyReport, now = new Date()): FlowExplanation {
  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  const ordered = order.map((id) => byId.get(id)!).filter((s) => report.profiles[s.id]);

  const steps = ordered.map((s) => {
    const p = report.profiles[s.id]!;
    return {
      id: s.id,
      does: p.does,
      sideEffect: p.sideEffect,
      usesAI: p.usesAI,
      approvalGate: s.type === 'approval',
      condition: s.when ? `only if ${s.when.ref} ${s.when.operator} ${String(s.when.value)}` : undefined,
    };
  });

  const connections = new Set<string>();
  const capabilities = new Set<string>();
  for (const s of flow.steps) {
    if (s.type === 'tool') {
      const c = s.config.input.connection;
      if (typeof c === 'string') connections.add(c);
      const p = report.profiles[s.id];
      if (p?.capability) capabilities.add(`${p.capability.id}@${p.capability.version}`);
    }
    if (s.type === 'query' && s.config.connection) connections.add(s.config.connection);
  }

  const aiSteps = steps.filter((s) => s.usesAI).map((s) => s.id);
  const limitations: string[] = ['Steps run one at a time, in the order shown.'];
  if (flow.steps.some((s) => s.forEach)) {
    limitations.push('A repeating step runs once per item, up to its item limit; a list longer than the limit fails the step instead of skipping items. One failed item does not stop the others.');
  }
  if (flow.steps.some((s) => s.type === 'query')) {
    limitations.push('Warehouse queries use the shared ALOFT warehouse credential plus ALOFT governance checks, not your personal warehouse identity.');
  }
  if (aiSteps.length) {
    const reviewed = aiSteps.every((id) => flow.steps.some((s) => s.type === 'approval' && order.indexOf(s.id) > order.indexOf(id)));
    limitations.push(reviewed ? 'AI output can be wrong; a person reviews it before anything is saved or sent.' : 'AI output can be wrong and no approval step reviews it.');
  }
  if (flow.steps.some((s) => s.when)) limitations.push('A step whose condition is not met is skipped, and so is every step that uses its output.');

  return {
    name: flow.name,
    kind: aiSteps.length ? 'hybrid' : 'workflow',
    trigger: triggerText(flow),
    nextRuns: nextRuns(flow, now),
    steps,
    aiSteps,
    approvals: flow.steps.flatMap((s) => (s.type === 'approval' ? [{ stepId: s.id, approver: s.config.assignee ?? 'flow owner' }] : [])),
    externalEffects: steps.filter((s) => s.sideEffect === 'external' || s.sideEffect === 'write').map((s) => ({ stepId: s.id, does: s.does })),
    access: {
      permissions: [...new Set(Object.values(report.profiles).map((p) => p.requiredPermission).filter(Boolean))].sort(),
      connections: [...connections].sort(),
      capabilities: [...capabilities].sort(),
    },
    cost: report.cost,
    limitations,
  };
}
