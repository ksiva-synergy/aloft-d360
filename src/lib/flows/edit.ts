// Pure edit operations on a flow definition, shared by the form editor and the copilot. They work on
// plain JSON (the same shape the API validates), never on a second model, so the form, the JSON view
// and copilot proposals cannot drift. Nothing here validates: validateFlow and the policy check do.

export type Def = {
  name?: string;
  description?: string;
  trigger?: { type: string; cron?: string; name?: string };
  inputs?: InputDef[];
  budget?: { maxCostUsd: number };
  steps?: Step[];
  [key: string]: unknown;
};
export type InputDef = { name: string; type: 'string' | 'number' | 'boolean'; required?: boolean; default?: string | number | boolean; description?: string };
export type Step = { id: string; type: string; name?: string; dependsOn?: string[]; retries?: number; timeoutMs?: number; when?: { ref: string; operator: string; value: string | number | boolean }; config: Record<string, unknown>; [key: string]: unknown };

export const STEP_TYPES = ['query', 'retrieve', 'agent', 'transform', 'approval', 'output', 'tool'] as const;
export const STEP_TYPE_LABEL: Record<string, string> = {
  query: 'Query data',
  retrieve: 'Search knowledge',
  agent: 'Ask AI',
  transform: 'Transform rows',
  approval: 'Human approval',
  output: 'Save result',
  tool: 'Call a connector',
};
export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;
export const TRANSFORM_OPS = ['filter', 'limit', 'count', 'anti_join'] as const;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'query': return { semantic: { modelId: '', entityId: '', dimensions: [], measures: [], filters: [], sorts: [] }, maxRows: 1000 };
    case 'retrieve': return { query: '', topK: 5 };
    case 'agent': return { prompt: '' };
    case 'transform': return { op: 'filter', input: '', field: '', operator: 'eq', value: '' };
    case 'approval': return { message: '' };
    case 'output': return { kind: 'save', title: '', content: '' };
    case 'tool': return { capability: 'http.request', input: {} };
    default: return {};
  }
}

/** A step id not used yet, e.g. `agent_2`. */
export function uniqueStepId(def: Def, type: string): string {
  const taken = new Set((def.steps ?? []).map((s) => s.id));
  for (let n = 1; ; n++) {
    const id = `${type}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Adds a step of `type`. It runs after `afterId` when given (and is inserted right after it),
 * otherwise after the last step, so a new step is not left dangling at the start.
 */
export function addStep(def: Def, type: string, afterId?: string): Def {
  const next = clone(def);
  const steps = next.steps ?? [];
  const at = afterId ? steps.findIndex((s) => s.id === afterId) : -1;
  const prev = at >= 0 ? steps[at] : steps[steps.length - 1];
  const step: Step = { id: uniqueStepId(def, type), type, config: defaultConfig(type) };
  if (prev) step.dependsOn = [prev.id];
  next.steps = at >= 0 ? [...steps.slice(0, at + 1), step, ...steps.slice(at + 1)] : [...steps, step];
  return next;
}

export function updateStep(def: Def, id: string, patch: Partial<Step>): Def {
  const next = clone(def);
  next.steps = (next.steps ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s));
  return next;
}

export function updateStepConfig(def: Def, id: string, patch: Record<string, unknown>): Def {
  const step = def.steps?.find((s) => s.id === id);
  return step ? updateStep(def, id, { config: { ...step.config, ...patch } }) : def;
}

/** Removes a step and every dependsOn reference to it. Refs inside other steps' text are left for the validator to flag. */
export function removeStep(def: Def, id: string): Def {
  const next = clone(def);
  next.steps = (next.steps ?? []).filter((s) => s.id !== id).map((s) => (s.dependsOn ? { ...s, dependsOn: s.dependsOn.filter((d) => d !== id) } : s));
  return next;
}

export function moveStep(def: Def, id: string, delta: -1 | 1): Def {
  const steps = [...(def.steps ?? [])];
  const i = steps.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= steps.length) return def;
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
  return { ...clone(def), steps: clone(steps) };
}

/** Renames a step id everywhere it is referenced: dependsOn lists and `{{steps.<id>…}}` refs in any text. */
export function renameStep(def: Def, from: string, to: string): Def {
  if (from === to) return def;
  const re = new RegExp(`(\\{\\{\\s*steps\\.)${from}(?=[.\\s}])`, 'g');
  const text = JSON.stringify(def).replace(re, `$1${to}`);
  const next = JSON.parse(text) as Def;
  next.steps = (next.steps ?? []).map((s) => ({
    ...s,
    id: s.id === from ? to : s.id,
    ...(s.dependsOn ? { dependsOn: s.dependsOn.map((d) => (d === from ? to : d)) } : {}),
  }));
  return next;
}

export function setTrigger(def: Def, type: string, value = ''): Def {
  const next = clone(def);
  next.trigger = type === 'schedule' ? { type, cron: value || '0 8 * * 1' } : type === 'event' || type === 'webhook' ? { type, name: value || (type === 'webhook' ? 'my-webhook' : 'my.event') } : { type: 'manual' };
  return next;
}

export function setBudget(def: Def, usd: number | undefined): Def {
  const next = clone(def);
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) delete next.budget;
  else next.budget = { maxCostUsd: usd };
  return next;
}

export function setInputs(def: Def, inputs: InputDef[]): Def {
  return { ...clone(def), inputs: clone(inputs) };
}

export function setWhen(def: Def, id: string, when: Step['when'] | undefined): Def {
  const next = clone(def);
  next.steps = (next.steps ?? []).map((s) => {
    if (s.id !== id) return s;
    const { when: _old, ...rest } = s;
    return when ? { ...rest, when } : (rest as Step);
  });
  return next;
}

/** Parses an input default typed into a text box according to the input's declared type. */
export function coerceDefault(type: InputDef['type'], raw: string): string | number | boolean | undefined {
  if (raw === '') return undefined;
  if (type === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (type === 'boolean') return raw === 'true';
  return raw;
}
