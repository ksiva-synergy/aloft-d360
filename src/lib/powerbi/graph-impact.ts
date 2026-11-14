/**
 * Impact analysis over the model graph's dependency edges — pure and client-safe.
 * Downstream = everything that (transitively) uses the start objects; upstream = everything
 * they read. Used by the Estate model overview.
 */

export type Adjacency = { down: Map<string, string[]>; up: Map<string, string[]> };

/** edges: [dependency, dependent]. */
export function buildAdjacency(edges: [string, string][]): Adjacency {
  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  for (const [dep, user] of edges) {
    down.set(dep, [...(down.get(dep) ?? []), user]);
    up.set(user, [...(up.get(user) ?? []), dep]);
  }
  return { down, up };
}

/** Nodes reachable from `start` (excluding the start nodes themselves). */
export function reach(start: Iterable<string>, adj: Adjacency, direction: 'down' | 'up'): Set<string> {
  const next = direction === 'down' ? adj.down : adj.up;
  const startSet = new Set(start);
  const out = new Set<string>();
  const stack = [...startSet];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of next.get(cur) ?? []) {
      if (out.has(n) || startSet.has(n)) continue;
      out.add(n);
      stack.push(n);
    }
  }
  return out;
}
