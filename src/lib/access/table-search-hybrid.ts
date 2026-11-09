import type { MeaningTable } from '@/lib/access/semantic-search';

type NameTable = { path: string; kind: string; name?: string };

export type TableSearchHit = NameTable & {
  match: 'name' | 'meaning';
  description?: string | null;
  score?: number;
};

/** Name matches first, then embedding tables not already listed. */
export function mergeTableSearchHits<T extends NameTable>(nameRows: T[], meaningRows: MeaningTable[]): TableSearchHit[] {
  const paths = new Set(nameRows.map((n) => n.path));
  const fromName: TableSearchHit[] = nameRows.map((n) => ({ ...n, match: 'name' }));
  const fromMeaning: TableSearchHit[] = meaningRows
    .filter((h) => !paths.has(h.path))
    .map((h) => ({
      path: h.path,
      kind: h.kind === 'view' ? 'view' : 'table',
      match: 'meaning' as const,
      description: h.description,
      score: h.score,
    }));
  fromMeaning.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return [...fromName, ...fromMeaning];
}
