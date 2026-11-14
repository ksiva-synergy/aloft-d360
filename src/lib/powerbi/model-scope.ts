/** Model scope helpers for Power BI jobs (pure). */

/** Scope model ids of a job; undefined = every model. */
export function scopeModelIds(scope: unknown): string[] | undefined {
  const ids = (scope as { model_ids?: unknown } | null)?.model_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : undefined;
}

/** Two model scopes overlap (an undefined scope covers every model). */
export function scopesOverlap(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return true;
  const set = new Set(a);
  return b.some((x) => set.has(x));
}
