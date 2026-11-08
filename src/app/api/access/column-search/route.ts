import { prisma } from '@/lib/db';
import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessClassify } from '@/lib/access/admin-api';
import { mergeColumnSearchHits, type ColumnNameHit } from '@/lib/access/column-search-hybrid';
import { rerankColumnSearchHits } from '@/lib/access/column-search-rerank';
import { searchColumnsByMeaning } from '@/lib/access/semantic-search';

export const dynamic = 'force-dynamic';

const MAX_RESULTS = 150;

async function tagsByColumn(orgId: string, tablePaths: string[]) {
  if (!tablePaths.length) return new Map<string, string[]>();
  const tagged = await prisma.accessColumnTag.findMany({
    where: { org_id: orgId, table_path: { in: tablePaths }, status: 'confirmed' },
    select: { table_path: true, column_name: true, tag_id: true },
  });
  const tagsByColumn = new Map<string, string[]>();
  for (const t of tagged) {
    const key = `${t.table_path}.${t.column_name}`;
    tagsByColumn.set(key, [...(tagsByColumn.get(key) ?? []), t.tag_id]);
  }
  return tagsByColumn;
}

async function searchColumnsByName(orgId: string, q: string): Promise<{ rows: ColumnNameHit[]; truncated: boolean }> {
  const cols = await prisma.platformContextColumn.findMany({
    where: { org_id: orgId, name: { contains: q, mode: 'insensitive' } },
    select: {
      name: true,
      data_type: true,
      object: { select: { full_path: true, object_kind: true } },
    },
    take: MAX_RESULTS + 1,
    orderBy: { name: 'asc' },
  });

  const rows = cols
    .filter((c) => c.object?.full_path && c.object.full_path.split('.').length === 3)
    .slice(0, MAX_RESULTS)
    .map((c) => ({
      tablePath: c.object!.full_path.toLowerCase(),
      column: c.name.toLowerCase(),
      type: c.data_type,
      kind: c.object!.object_kind,
    }));

  const tablePaths = [...new Set(rows.map((r) => r.tablePath))];
  const tagMap = await tagsByColumn(orgId, tablePaths);

  const withTags = rows.map((r) => ({
    ...r,
    tagIds: tagMap.get(`${r.tablePath}.${r.column}`) ?? [],
  }));

  withTags.sort((a, b) => Number(b.column === q) - Number(a.column === q) || a.tablePath.localeCompare(b.tablePath));

  return { rows: withTags, truncated: cols.length > MAX_RESULTS };
}

/**
 * Find columns by name and by meaning (hybrid default), e.g. ?q=salary.
 * ?by=name | ?by=meaning for a single mode.
 */
export const GET = handle(async (req) => {
  await requireAccessClassify(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) throw new ApiError(400, 'Type at least 2 characters');

  const mode = url.searchParams.get('by');

  if (mode === 'meaning') {
    const hits = await searchColumnsByMeaning(orgId, q);
    const paths = [...new Set(hits.map((h) => h.tablePath))];
    const tagMap = await tagsByColumn(orgId, paths);
    return ok({
      columns: hits.map((h) => ({
        ...h,
        match: 'meaning' as const,
        tagIds: tagMap.get(`${h.tablePath}.${h.column}`) ?? [],
      })),
      truncated: false,
    });
  }

  const { rows, truncated } = await searchColumnsByName(orgId, q);

  if (mode === 'name') {
    return ok({
      columns: rows.map((r) => ({ ...r, match: 'name' as const })),
      truncated,
    });
  }

  const meaningRows = await searchColumnsByMeaning(orgId, q).catch(() => []);
  const paths = [...new Set([...rows.map((r) => r.tablePath), ...meaningRows.map((h) => h.tablePath)])];
  const tagMap = await tagsByColumn(orgId, paths);
  const tagIdsFor = (tablePath: string, column: string) => tagMap.get(`${tablePath}.${column}`) ?? [];

  let columns = mergeColumnSearchHits(q, rows, meaningRows, tagIdsFor);
  columns = await rerankColumnSearchHits(q, columns);

  return ok({
    columns,
    truncated,
  });
});
