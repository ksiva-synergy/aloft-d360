import { extractRefs } from './validate';
import type { FlowDefinition } from './schema';

export type ResolveContext = {
  inputs: Record<string, unknown>;
  /** Outputs of steps that have already succeeded, keyed by step id. */
  steps: Record<string, unknown>;
};

function lookup(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function resolveRef(ref: { raw: string; scope: string; name: string; path: string[] }, ctx: ResolveContext): unknown {
  const root = ref.scope === 'steps' ? ctx.steps : ref.scope === 'inputs' ? ctx.inputs : undefined;
  const value = lookup(root, [ref.name, ...ref.path]);
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
  let out = value;
  for (const ref of refs) {
    const v = resolveRef(ref, ctx);
    out = out.replace(ref.raw, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return out;
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
