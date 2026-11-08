import { prisma } from '@/lib/db';
import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessClassify } from '@/lib/access/admin-api';
import { searchColumnsByMeaning } from '@/lib/access/semantic-search';

export const dynamic = 'force-dynamic';

const MAX_RESULTS = 150;

/**
 * Find columns by name across the whole estate, e.g. ?q=salary → every harvested column whose name
 * contains "salary", in every table and view, with the tags it already carries. Metadata only:
 * names and types, never values. Used by the Column access page to tag many columns at once.
 */
export const GET = handle(async (req) => {
  await requireAccessClassify(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) throw new ApiError(400, 'Type at least 2 characters');

  // ?by=meaning: columns whose meaning matches (embeddings); names, types and descriptions only.
  if (url.searchParams.get('by') === 'meaning') {
    const hits = await searchColumnsByMeaning(orgId, q);
    const paths = [...new Set(hits.map((h) => h.tablePath))];
    const tagged = paths.length
      ? await prisma.accessColumnTag.findMany({ where: { org_id: orgId, table_path: { in: paths }, status: 'confirmed' }, select: { table_path: true, column_name: true, tag_id: true } })
      : [];
    return ok({
      columns: hits.map((h) => ({
        ...h,
        match: 'meaning' as const,
        tagIds: tagged.filter((t) => t.table_path === h.tablePath && t.column_name === h.column).map((t) => t.tag_id),
      })),
      truncated: false,
    });
  }

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
      tablePath: c.object.full_path.toLowerCase(),
      column: c.name.toLowerCase(),
      type: c.data_type,
      kind: c.object.object_kind,
    }));

  const tablePaths = [...new Set(rows.map((r) => r.tablePath))];
  const tagged = tablePaths.length
    ? await prisma.accessColumnTag.findMany({
        where: { org_id: orgId, table_path: { in: tablePaths }, status: 'confirmed' },
        select: { table_path: true, column_name: true, tag_id: true },
      })
    : [];
  const tagsByColumn = new Map<string, string[]>();
  for (const t of tagged) {
    const key = `${t.table_path}.${t.column_name}`;
    tagsByColumn.set(key, [...(tagsByColumn.get(key) ?? []), t.tag_id]);
  }

  // Exact name matches first, then by table.
  rows.sort((a, b) => Number(b.column === q) - Number(a.column === q) || a.tablePath.localeCompare(b.tablePath));

  return ok({
    columns: rows.map((r) => ({ ...r, tagIds: tagsByColumn.get(`${r.tablePath}.${r.column}`) ?? [] })),
    truncated: cols.length > MAX_RESULTS,
  });
});
