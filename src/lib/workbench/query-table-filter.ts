/** Row indices where any cell value matches the filter (case-insensitive). */
export function filterQueryRowIndices(
  rows: Record<string, unknown>[],
  columns: { name: string }[],
  query: string,
): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows.map((_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const col of columns) {
      const val = row[col.name];
      if (val != null && String(val).toLowerCase().includes(q)) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}
