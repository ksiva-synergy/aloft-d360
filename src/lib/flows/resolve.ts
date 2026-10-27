import { extractRefs, mapRefs, type FlowRef } from './validate';
import type { FlowDefinition, StepCondition, TransformOperator } from './schema';

export type ResolveContext = {
  inputs: Record<string, unknown>;
  /** Outputs of steps that have already succeeded, keyed by step id. */
  steps: Record<string, unknown>;
  /** The current item while a `forEach` step runs; `{{item}}` / `{{item.<field>}}`. */
  item?: unknown;
};

function lookup(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function resolveRef(ref: FlowRef, ctx: ResolveContext): unknown {
  const value =
    ref.scope === 'item'
      ? lookup(ctx.item, [ref.name, ...ref.path].filter(Boolean))
      : lookup(ref.scope === 'steps' ? ctx.steps : ref.scope === 'inputs' ? ctx.inputs : undefined, [ref.name, ...ref.path]);
  if (value === undefined) throw new Error(`${ref.raw} could not be resolved`);
  return value;
}

/**
 * Replaces `{{…}}` refs in a string. A string that is exactly one ref keeps the referenced value's
 * type (so an array of rows stays an array); refs embedded in longer text are stringified.
 */
export function resolveString(value: string, ctx: ResolveContext): unknown {
  const refs = extractRefs(value);
  if (!refs.length) return value;
  if (refs.length === 1 && value.trim() === refs[0]!.raw) return resolveRef(refs[0]!, ctx);
  // Single pass over the saved text: a resolved value that itself contains `{{…}}` or `$&` is
  // inserted verbatim and can never change what else gets substituted.
  return mapRefs(value, (ref) => {
    const v = resolveRef(ref, ctx);
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

/** Deep-resolves every string in a step config. Throws if any ref cannot be resolved. */
export function resolveConfig<T>(config: T, ctx: ResolveContext): T {
  if (typeof config === 'string') return resolveString(config, ctx) as T;
  if (Array.isArray(config)) return config.map((c) => resolveConfig(c, ctx)) as T;
  if (config && typeof config === 'object') {
    return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, resolveConfig(v, ctx)])) as T;
  }
  return config;
}

/** Merges provided inputs over declared defaults and checks types. Throws on a missing required input or a type mismatch. */
export function applyInputs(flow: FlowDefinition, provided: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of flow.inputs) {
    const value = provided[def.name] ?? def.default;
    if (value === undefined) {
      if (def.required) throw new Error(`missing required input "${def.name}"`);
      continue;
    }
    if (typeof value !== def.type) throw new Error(`input "${def.name}" must be a ${def.type}`);
    out[def.name] = value;
  }
  return out;
}

const asNumber = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * Comparison shared by `when` conditions and the `filter` transform. Ordering operators compare as
 * numbers (non-numeric → false). `eq`/`neq` compare numerically when both sides are numeric, else as
 * strings. `contains` checks array membership or substring.
 */
export function compare(left: unknown, operator: TransformOperator, right: unknown): boolean {
  switch (operator) {
    case 'gt':
      return asNumber(left) > asNumber(right);
    case 'gte':
      return asNumber(left) >= asNumber(right);
    case 'lt':
      return asNumber(left) < asNumber(right);
    case 'lte':
      return asNumber(left) <= asNumber(right);
    case 'eq':
    case 'neq': {
      const [a, b] = [asNumber(left), asNumber(right)];
      const equal = !Number.isNaN(a) && !Number.isNaN(b) ? a === b : String(left) === String(right);
      return operator === 'eq' ? equal : !equal;
    }
    case 'contains':
      return Array.isArray(left) ? left.some((x) => String(x) === String(right)) : String(left ?? '').includes(String(right));
  }
}

/** Resolves a step's `when` and evaluates it. Throws if the ref cannot be resolved. */
export function evaluateCondition(when: StepCondition, ctx: ResolveContext): boolean {
  return compare(resolveString(when.ref, ctx), when.operator, resolveConfig(when.value, ctx));
}
