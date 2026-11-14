/**
 * Grid placement for the members of an expanded table in the Estate model overview — pure and
 * client-safe. One column per dependency depth inside the table (base objects left, objects
 * built on them right), each column wrapped at `maxRows`, so a table of 60+ measures stays a
 * compact block instead of one very tall column.
 */
export function gridLayout(
  ids: string[],
  up: Map<string, string[]>,
  opts: { cellW: number; cellH: number; gapX?: number; gapY?: number; maxRows?: number },
): { w: number; h: number; pos: Map<string, { x: number; y: number }> } {
  const gapX = opts.gapX ?? 28;
  const gapY = opts.gapY ?? 10;
  const maxRowsPerCol = opts.maxRows ?? 12;
  const inSet = new Set(ids);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let d = 0;
    for (const dep of up.get(id) ?? []) if (inSet.has(dep)) d = Math.max(d, depthOf(dep) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const byDepth = new Map<number, string[]>();
  for (const id of ids) {
    const d = depthOf(id);
    byDepth.set(d, [...(byDepth.get(d) ?? []), id]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  let col = 0;
  let maxRows = 0;
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    const list = byDepth.get(d)!.sort();
    for (let i = 0; i < list.length; i += maxRowsPerCol) {
      const chunk = list.slice(i, i + maxRowsPerCol);
      chunk.forEach((id, row) => pos.set(id, { x: col * (opts.cellW + gapX), y: row * (opts.cellH + gapY) }));
      maxRows = Math.max(maxRows, chunk.length);
      col += 1;
    }
  }
  return {
    w: Math.max(1, col) * (opts.cellW + gapX) - gapX,
    h: Math.max(1, maxRows) * (opts.cellH + gapY) - gapY,
    pos,
  };
}
