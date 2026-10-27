import { z } from 'zod';
import { STEP_ID_PATTERN } from './schema';
import { extractRefs } from './validate';
import { STEP_TYPE_LABEL, removeStep, renameStep, type Def, type InputDef, type Step } from './edit';

// Copilot edits: the model proposes typed operations, never a whole definition. They are applied
// here, all or nothing, to a copy of the user's draft; the caller then validates and policy-checks
// the result and shows it as a proposal the user accepts or discards. Nothing is saved here.

const stepId = z.string().regex(STEP_ID_PATTERN);
const condition = z.object({ ref: z.string().min(1).max(300), operator: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean()]) });
const input = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().max(300).optional(),
});

export const copilotOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_name'), name: z.string().min(1).max(120) }),
  z.object({ op: z.literal('set_description'), description: z.string().max(1000) }),
  z.object({
    op: z.literal('set_trigger'),
    trigger: z.object({ type: z.enum(['manual', 'schedule', 'event', 'webhook']), cron: z.string().max(100).optional(), name: z.string().max(100).optional() }),
  }),
  z.object({ op: z.literal('set_budget'), maxCostUsd: z.number().positive().max(1000).nullable() }),
  z.object({ op: z.literal('add_input'), input }),
  z.object({ op: z.literal('remove_input'), name: z.string() }),
  z.object({
    op: z.literal('add_step'),
    step: z.object({
      id: stepId,
      type: z.string(),
      name: z.string().max(120).optional(),
      dependsOn: z.array(stepId).optional(),
      when: condition.optional(),
      retries: z.number().int().min(0).max(5).optional(),
      config: z.record(z.unknown()),
    }),
  }),
  z.object({
    op: z.literal('update_step'),
    id: stepId,
    name: z.string().max(120).optional(),
    dependsOn: z.array(stepId).optional(),
    /** `null` removes the condition. */
    when: condition.nullable().optional(),
    retries: z.number().int().min(0).max(5).optional(),
    /** Merged into the existing config, key by key. A key set to `null` is removed. */
    config: z.record(z.unknown()).optional(),
  }),
  z.object({ op: z.literal('remove_step'), id: stepId }),
  z.object({ op: z.literal('rename_step'), from: stepId, to: stepId }),
]);

export type CopilotOperation = z.infer<typeof copilotOperationSchema>;

export type ApplyResult =
  | { ok: true; definition: Def; changes: string[] }
  | { ok: false; errors: string[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const label = (s: Step) => `"${s.name || s.id}"`;

/** Parses raw operations (from a model) without applying them. */
export function parseOperations(raw: unknown): { ok: true; operations: CopilotOperation[] } | { ok: false; errors: string[] } {
  const list = z.array(z.unknown()).max(40).safeParse(raw);
  if (!list.success) return { ok: false, errors: ['operations must be a list of at most 40 changes'] };
  const operations: CopilotOperation[] = [];
  const errors: string[] = [];
  list.data.forEach((item, i) => {
    const r = copilotOperationSchema.safeParse(item);
    if (r.success) operations.push(r.data);
    else errors.push(`change ${i + 1}: ${r.error.issues.map((x) => `${x.path.join('.') || 'op'} ${x.message}`).join('; ')}`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, operations };
}

/** Applies operations in order to a copy of `def`. Any failing operation rejects the whole set. */
export function applyOperations(def: Def, operations: CopilotOperation[]): ApplyResult {
  let next = clone(def);
  const changes: string[] = [];
  const errors: string[] = [];
  const find = (id: string) => (next.steps ?? []).find((s) => s.id === id);

  operations.forEach((op, i) => {
    const fail = (msg: string) => errors.push(`change ${i + 1} (${op.op}): ${msg}`);
    switch (op.op) {
      case 'set_name':
        next.name = op.name;
        changes.push(`Renamed the workflow to "${op.name}"`);
        break;
      case 'set_description':
        if (op.description) next.description = op.description;
        else delete next.description;
        changes.push('Updated the description');
        break;
      case 'set_trigger': {
        const t = op.trigger;
        if (t.type === 'schedule' && !t.cron) return fail('a schedule needs a cron expression');
        if ((t.type === 'event' || t.type === 'webhook') && !t.name) return fail(`a ${t.type} trigger needs a name`);
        next.trigger = t.type === 'schedule' ? { type: t.type, cron: t.cron } : t.type === 'manual' ? { type: 'manual' } : { type: t.type, name: t.name };
        changes.push(t.type === 'schedule' ? `Runs on the schedule ${t.cron} (UTC)` : t.type === 'manual' ? 'Runs when someone starts it' : `Runs on the ${t.type} "${t.name}"`);
        break;
      }
      case 'set_budget':
        if (op.maxCostUsd === null) delete next.budget;
        else next.budget = { maxCostUsd: op.maxCostUsd };
        changes.push(op.maxCostUsd === null ? 'Removed the per-run budget' : `Set the per-run budget to $${op.maxCostUsd}`);
        break;
      case 'add_input':
        if ((next.inputs ?? []).some((x) => x.name === op.input.name)) return fail(`an input named "${op.input.name}" already exists`);
        next.inputs = [...(next.inputs ?? []), op.input as InputDef];
        changes.push(`Added the input "${op.input.name}"`);
        break;
      case 'remove_input':
        if (!(next.inputs ?? []).some((x) => x.name === op.name)) return fail(`there is no input named "${op.name}"`);
        next.inputs = (next.inputs ?? []).filter((x) => x.name !== op.name);
        changes.push(`Removed the input "${op.name}"`);
        break;
      case 'add_step': {
        if (find(op.step.id)) return fail(`a step with id "${op.step.id}" already exists`);
        if (!STEP_TYPE_LABEL[op.step.type]) return fail(`unknown step type "${op.step.type}"`);
        const missing = (op.step.dependsOn ?? []).filter((d) => !find(d));
        if (missing.length) return fail(`runs after unknown step(s) ${missing.join(', ')}`);
        const step = clone(op.step) as Step;
        next.steps = [...(next.steps ?? []), step];
        changes.push(`Added step ${label(step)} (${STEP_TYPE_LABEL[step.type]})`);
        break;
      }
      case 'update_step': {
        const step = find(op.id);
        if (!step) return fail(`there is no step "${op.id}"`);
        const missing = (op.dependsOn ?? []).filter((d) => d === op.id || !find(d));
        if (missing.length) return fail(`runs after unknown step(s) ${missing.join(', ')}`);
        if (op.name !== undefined) step.name = op.name || undefined;
        if (op.dependsOn !== undefined) step.dependsOn = op.dependsOn;
        if (op.retries !== undefined) step.retries = op.retries;
        if (op.when === null) delete step.when;
        else if (op.when) step.when = op.when;
        if (op.config) {
          const config = { ...step.config };
          for (const [k, v] of Object.entries(op.config)) {
            if (v === null) delete config[k];
            else config[k] = v;
          }
          step.config = config;
        }
        changes.push(`Changed step ${label(step)}`);
        break;
      }
      case 'remove_step': {
        const step = find(op.id);
        if (!step) return fail(`there is no step "${op.id}"`);
        next = removeStep(next, op.id);
        changes.push(`Removed step ${label(step)}`);
        break;
      }
      case 'rename_step':
        if (!find(op.from)) return fail(`there is no step "${op.from}"`);
        if (find(op.to)) return fail(`a step with id "${op.to}" already exists`);
        next = renameStep(next, op.from, op.to);
        changes.push(`Renamed step id ${op.from} to ${op.to}`);
        break;
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, definition: next, changes };
}

export type FlowDiff = { added: string[]; removed: string[]; changed: string[]; settings: boolean };

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

/** Which steps a proposal adds, removes or changes, and whether workflow settings changed. Used to highlight a proposal. */
export function diffFlows(before: Def, after: Def): FlowDiff {
  const a = new Map((before.steps ?? []).map((s) => [s.id, stable(s)]));
  const b = new Map((after.steps ?? []).map((s) => [s.id, stable(s)]));
  const { steps: _sa, ...restA } = before;
  const { steps: _sb, ...restB } = after;
  return {
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed: [...a.keys()].filter((id) => !b.has(id)),
    changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)),
    settings: stable(restA) !== stable(restB),
  };
}

/** Edges for drawing a draft, which may not validate yet: explicit `dependsOn` plus `{{steps.x}}` refs, to steps that exist. */
export function draftEdges(def: Def): { from: string; to: string }[] {
  const ids = new Set((def.steps ?? []).map((s) => s.id));
  const edges: { from: string; to: string }[] = [];
  for (const s of def.steps ?? []) {
    const deps = new Set(s.dependsOn ?? []);
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(s.config);
    if (s.when) walk(s.when);
    for (const str of strings) for (const r of extractRefs(str)) if (r.scope === 'steps') deps.add(r.name);
    for (const d of deps) if (d !== s.id && ids.has(d)) edges.push({ from: d, to: s.id });
  }
  return edges;
}

/**
 * Drops an edge a→c when c is also reachable from a through other steps, so a step that references
 * an early step's output does not draw a second line past the chain. Used for drawing only.
 */
export function reduceEdges(edges: { from: string; to: string }[]): { from: string; to: string }[] {
  const out = new Map<string, string[]>();
  edges.forEach((e) => out.set(e.from, [...(out.get(e.from) ?? []), e.to]));
  const reachableWithout = (from: string, to: string) => {
    const seen = new Set<string>();
    const stack = (out.get(from) ?? []).filter((n) => n !== to);
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(out.get(n) ?? []));
    }
    return false;
  };
  return edges.filter((e) => !reachableWithout(e.from, e.to));
}
