/** Parse {"keep":[0,1]} from Luna scorer output. */
export function parseRerankKeepIndices(raw: string, poolLen: number): number[] | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { keep?: unknown };
    if (!Array.isArray(parsed.keep)) return null;
    return parsed.keep.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < poolLen);
  } catch {
    return null;
  }
}

export function applyRerankKeepIndices<T>(pool: T[], keep: number[], fallback = 8): T[] {
  const ok = new Set(keep.filter((i) => i >= 0 && i < pool.length));
  if (ok.size === 0) return pool.slice(0, Math.min(fallback, pool.length));
  return pool.filter((_, i) => ok.has(i));
}
