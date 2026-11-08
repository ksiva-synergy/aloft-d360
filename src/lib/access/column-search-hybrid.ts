import type { MeaningColumn } from '@/lib/access/semantic-search';

export type ColumnNameHit = {
  tablePath: string;
  column: string;
  type: string | null;
  kind: string;
  tagIds: string[];
};

export type ColumnSearchHit = ColumnNameHit & {
  match: 'name' | 'meaning';
  description?: string | null;
  score?: number;
};

const colKey = (tablePath: string, column: string) => `${tablePath}.${column}`;

/** Name hits first (exact column name, then path); then embedding matches not already listed. */
export function mergeColumnSearchHits(q: string, nameRows: ColumnNameHit[], meaningRows: MeaningColumn[], tagIdsFor: (tablePath: string, column: string) => string[]): ColumnSearchHit[] {
  const term = q.trim().toLowerCase();
  const merged = new Map<string, ColumnSearchHit>();

  for (const r of nameRows) {
    merged.set(colKey(r.tablePath, r.column), { ...r, match: 'name' });
  }

  for (const h of meaningRows) {
    const k = colKey(h.tablePath, h.column);
    if (merged.has(k)) continue;
    merged.set(k, {
      tablePath: h.tablePath,
      column: h.column,
      type: h.type,
      kind: h.kind,
      tagIds: tagIdsFor(h.tablePath, h.column),
      match: 'meaning',
      description: h.description,
      score: h.score,
    });
  }

  const list = [...merged.values()];
  list.sort((a, b) => {
    const rank = (r: ColumnSearchHit) => {
      if (r.match === 'name') return r.column === term ? 0 : 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.match === 'meaning' && b.match === 'meaning') return (b.score ?? 0) - (a.score ?? 0);
    return a.tablePath.localeCompare(b.tablePath) || a.column.localeCompare(b.column);
  });
  return list;
}
