import { prisma } from '@/lib/db';
import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessClassify } from '@/lib/access/admin-api';
import { normalizeColumnName, normalizeTablePath } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/**
 * Everything the estate knows about one column, for the ⓘ panel on the Data access screens:
 * where it lives, type, description and role, profile (empty rate, distinct count, min, max, most
 * common values, patterns), the table's summary and size, harvest times, and its protections.
 * Data access admins only; sample values are shown on purpose (user decision 2026-11-08).
 */
export const GET = handle(async (req) => {
  await requireAccessClassify(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const table = normalizeTablePath(url.searchParams.get('table') ?? '');
  const column = normalizeColumnName(url.searchParams.get('column') ?? '');
  const [catalog, schema, name] = table.split('.') as [string, string, string];

  const object = await prisma.platformContextObject.findFirst({
    where: { org_id: orgId, full_path: table },
    select: {
      id: true,
      object_kind: true,
      native_comment: true,
      row_count_est: true,
      last_t0_at: true,
      last_t1_at: true,
      last_t2_at: true,
      domain_keywords: true,
    },
  });
  if (!object) throw new ApiError(404, 'This table has not been harvested');

  const [col, card, tags, pathProtections] = await Promise.all([
    prisma.platformContextColumn.findFirst({
      where: { object_id: object.id, name: { equals: column, mode: 'insensitive' } },
      select: { name: true, ordinal: true, data_type: true, is_nullable: true, native_comment: true, profile: true, semantic: true, updated_at: true },
    }),
    prisma.platformContextSemantic.findFirst({
      where: { subject_kind: 'object', subject_id: object.id },
      orderBy: { version: 'desc' },
      select: { card: true },
    }),
    prisma.accessColumnTag.findMany({
      where: { org_id: orgId, table_path: table, column_name: column, status: 'confirmed' },
      select: { tag_id: true, reason: true },
    }),
    prisma.accessPathProtection.findMany({ where: { org_id: orgId }, select: { tag_id: true, path: true } }),
  ]);
  if (!col) throw new ApiError(404, 'This column has not been harvested');

  const covering = pathProtections.filter((p) => table === p.path || table.startsWith(`${p.path}.`));
  const tagIds = [...new Set([...tags.map((t) => t.tag_id), ...covering.map((p) => p.tag_id)])];
  const tagRows = tagIds.length ? await prisma.accessTag.findMany({ where: { id: { in: tagIds }, archived_at: null }, select: { id: true, name: true } }) : [];
  const tagName = new Map(tagRows.map((t) => [t.id, t.name]));

  const profile = (col.profile ?? {}) as Record<string, unknown>;
  const semantic = (col.semantic ?? {}) as Record<string, unknown>;
  const tableCard = (card?.card ?? {}) as Record<string, unknown>;

  return ok({
    where: { catalog, schema, table: name, path: table, kind: object.object_kind },
    column: {
      name: col.name,
      position: col.ordinal,
      type: col.data_type ?? (profile.data_type as string | undefined) ?? null,
      nullable: col.is_nullable,
      comment: col.native_comment,
      description: (semantic.description as string | undefined) ?? null,
      role: (semantic.role as string | undefined) ?? null,
      entity: (semantic.entity as string | undefined) ?? null,
      personalData: semantic.pii_flag === true,
    },
    profile: {
      emptyRate: typeof profile.null_rate === 'number' ? profile.null_rate : null,
      distinct: typeof profile.distinct_est === 'number' ? profile.distinct_est : null,
      min: profile.min ?? null,
      max: profile.max ?? null,
      topValues: Array.isArray(profile.top_k) ? (profile.top_k as { value: unknown; count: number }[]).slice(0, 10) : [],
      patterns: Array.isArray(profile.patterns) ? (profile.patterns as unknown[]).slice(0, 10) : [],
    },
    tableInfo: {
      summary: (tableCard.summary as string | undefined) ?? object.native_comment ?? null,
      grain: (tableCard.grain as string | undefined) ?? null,
      rows: object.row_count_est !== null ? Number(object.row_count_est) : null,
      keywords: object.domain_keywords,
    },
    harvested: {
      structure: object.last_t0_at?.toISOString() ?? null,
      profile: object.last_t1_at?.toISOString() ?? null,
      description: object.last_t2_at?.toISOString() ?? null,
    },
    protections: [
      ...tags.filter((t) => tagName.has(t.tag_id)).map((t) => ({ name: tagName.get(t.tag_id)!, on: 'column', reason: t.reason })),
      ...covering.filter((p) => tagName.has(p.tag_id)).map((p) => ({ name: tagName.get(p.tag_id)!, on: p.path, reason: null })),
    ],
  });
});
