import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { normalizeTablePath } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/** Columns of one table (names and types from the harvest, never values) with their protections. */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const table = normalizeTablePath(new URL(req.url).searchParams.get('table') ?? '');

  const [object, tags, columnTags] = await Promise.all([
    prisma.platformContextObject.findFirst({ where: { org_id: orgId, full_path: table }, select: { id: true } }),
    prisma.accessTag.findMany({ where: { org_id: orgId, archived_at: null }, select: { id: true, name: true } }),
    prisma.accessColumnTag.findMany({
      where: { org_id: orgId, table_path: table, status: 'confirmed' },
      select: { column_name: true, tag_id: true },
    }),
  ]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const cols = object
    ? await prisma.platformContextColumn.findMany({
        where: { object_id: object.id },
        select: { name: true, data_type: true },
        orderBy: { ordinal: 'asc' },
      })
    : [];

  const byColumn = new Map<string, { tagId: string; name: string }[]>();
  for (const c of columnTags) {
    const name = tagName.get(c.tag_id);
    if (!name) continue;
    byColumn.set(c.column_name, [...(byColumn.get(c.column_name) ?? []), { tagId: c.tag_id, name }]);
  }
  const known = new Set(cols.map((c) => c.name.toLowerCase()));
  const columns = [
    ...cols.map((c) => ({ name: c.name.toLowerCase(), type: c.data_type, protections: byColumn.get(c.name.toLowerCase()) ?? [] })),
    // Protected columns the harvest has not seen (still protected).
    ...[...byColumn.keys()].filter((n) => !known.has(n)).map((n) => ({ name: n, type: null, protections: byColumn.get(n)! })),
  ];
  return ok({ table, harvested: !!object, columns });
});
