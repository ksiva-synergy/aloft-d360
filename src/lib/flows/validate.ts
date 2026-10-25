import CronParser from 'cron-parser';
import { flowDefinitionSchema, type FlowDefinition, type FlowStep } from './schema';

export type FlowIssue = { path: string; message: string };

export type FlowValidation =
  | { ok: true; flow: FlowDefinition; order: string[] }
  | { ok: false; issues: FlowIssue[] };

const REF_PATTERN = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;

/** Extracts every `{{steps.x.y}}` / `{{inputs.z}}` ref from a string. Unknown scopes are returned as-is for the validator to reject. */
export function extractRefs(value: string): { raw: string; scope: string; name: string; path: string[] }[] {
  const out: { raw: string; scope: string; name: string; path: string[] }[] = [];
  for (const match of value.matchAll(REF_PATTERN)) {
    const [scope = '', name = '', ...path] = match[1]!.split('.');
    out.push({ raw: match[0], scope, name, path });
  }
  return out;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, into));
}

/** Step ids a step reads from: explicit `dependsOn` plus every `{{steps.<id>…}}` ref in its config. */
export function stepDependencies(step: FlowStep): string[] {
  const strings: string[] = [];
  collectStrings(step.config, strings);
  const deps = new Set(step.dependsOn);
  for (const s of strings) {
    for (const ref of extractRefs(s)) if (ref.scope === 'steps') deps.add(ref.name);
  }
  return [...deps];
}

/** Kahn's algorithm. Returns step ids in execution order, or the ids stuck in a cycle. */
function topologicalOrder(flow: FlowDefinition): { order: string[]; cyclic: string[] } {
  const deps = new Map(flow.steps.map((s) => [s.id, new Set(stepDependencies(s).filter((d) => flow.steps.some((x) => x.id === d)))]));
  const order: string[] = [];
  const remaining = new Map(deps);
  while (remaining.size) {
    // Stable: pick ready steps in definition order so runs are deterministic.
    const ready = flow.steps.map((s) => s.id).filter((id) => remaining.has(id) && remaining.get(id)!.size === 0);
    if (!ready.length) return { order, cyclic: [...remaining.keys()] };
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
      for (const set of remaining.values()) set.delete(id);
    }
  }
  return { order, cyclic: [] };
}

/** Parses and semantically validates a flow definition. Never throws on bad input. */
export function validateFlow(raw: unknown): FlowValidation {
  const parsed = flowDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const flow = parsed.data;
  const issues: FlowIssue[] = [];

  const ids = new Set<string>();
  flow.steps.forEach((step, i) => {
    if (ids.has(step.id)) issues.push({ path: `steps.${i}.id`, message: `duplicate step id "${step.id}"` });
    ids.add(step.id);
  });

  const inputNames = new Set(flow.inputs.map((i) => i.name));
  if (inputNames.size !== flow.inputs.length) issues.push({ path: 'inputs', message: 'duplicate input name' });

  flow.steps.forEach((step, i) => {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) issues.push({ path: `steps.${i}.dependsOn`, message: `unknown step "${dep}"` });
      if (dep === step.id) issues.push({ path: `steps.${i}.dependsOn`, message: 'a step cannot depend on itself' });
    }
    const strings: string[] = [];
    collectStrings(step.config, strings);
    for (const s of strings) {
      for (const ref of extractRefs(s)) {
        if (ref.scope === 'steps') {
          if (!ids.has(ref.name)) issues.push({ path: `steps.${i}.config`, message: `${ref.raw} refers to unknown step "${ref.name}"` });
          else if (ref.name === step.id) issues.push({ path: `steps.${i}.config`, message: `${ref.raw} refers to its own step` });
        } else if (ref.scope === 'inputs') {
          if (!inputNames.has(ref.name)) issues.push({ path: `steps.${i}.config`, message: `${ref.raw} refers to unknown input "${ref.name}"` });
        } else {
          issues.push({ path: `steps.${i}.config`, message: `${ref.raw} must start with "steps." or "inputs."` });
        }
      }
    }
  });

  if (flow.trigger.type === 'schedule') {
    try {
      CronParser.parse(flow.trigger.cron);
    } catch {
      issues.push({ path: 'trigger.cron', message: `invalid cron expression "${flow.trigger.cron}"` });
    }
  }

  // Cycle detection only makes sense once refs resolve, otherwise the same mistake is reported twice.
  if (!issues.length) {
    const { order, cyclic } = topologicalOrder(flow);
    if (cyclic.length) issues.push({ path: 'steps', message: `dependency cycle among: ${cyclic.join(', ')}` });
    else return { ok: true, flow, order };
  }
  return { ok: false, issues };
}
