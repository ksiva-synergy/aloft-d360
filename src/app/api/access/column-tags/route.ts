import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessClassify } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';
import {
  assertActiveTag,
  normalizeColumnName,
  normalizeTablePath,
  ReasonSchema,
  serializeColumnTag,
} from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/**
 * Tags on columns. GET ?table=catalog.schema.table lists one table's tags (with the table's known
 * columns from the estate, so the screen can offer them); GET ?tagId=… lists every column with a tag;
 * no filter lists every tagged column (up to 2000).
 */
export const GET = handle(async (req) => {
  await requireAccessClassify(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const table = url.searchParams.get('table');
  const tagId = url.searchParams.get('tagId');

  // ?underPath=catalog[.schema[.table]]: which protections sit on confirmed columns below this path.
  const underPath = url.searchParams.get('underPath')?.trim().toLowerCase();
  if (underPath) {
    if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+){0,2}$/.test(underPath)) throw new ApiError(400, 'Path must be catalog[.schema[.table]]');
    const grouped = await prisma.accessColumnTag.groupBy({
      by: ['tag_id'],
      where: {
        org_id: orgId,
        status: 'confirmed',
        OR: [{ table_path: underPath }, { table_path: { startsWith: `${underPath}.` } }],
      },
      _count: { _all: true },
    });
    return ok({
      columnTags: [],
      tagSummary: grouped.map((g) => ({ tagId: g.tag_id, columns: g._count._all })),
    });
  }

  const tablePath = table ? normalizeTablePath(table) : null;
  const rows = await prisma.accessColumnTag.findMany({
    where: {
      org_id: orgId,
      status: { not: 'rejected' },
      ...(tablePath ? { table_path: tablePath } : {}),
      ...(tagId ? { tag_id: tagId } : {}),
    },
    orderBy: [{ table_path: 'asc' }, { column_name: 'asc' }],
    take: 2000,
  });

  let knownColumns: { name: string; type: string | null }[] | undefined;
  if (tablePath) {
    const object = await prisma.platformContextObject.findFirst({
      where: { org_id: orgId, full_path: tablePath },
      select: { id: true },
    });
    if (object) {
      const cols = await prisma.platformContextColumn.findMany({
        where: { object_id: object.id },
        select: { name: true, data_type: true },
        orderBy: { ordinal: 'asc' },
      });
      knownColumns = cols.map((c) => ({ name: c.name.toLowerCase(), type: c.data_type }));
    }
  }

  return ok({ columnTags: rows.map(serializeColumnTag), knownColumns });
});

const TagColumns = z.object({
  tablePath: z.string().min(5),
  columns: z.array(z.string().min(1)).min(1).max(200),
  tagId: z.string().min(1),
  reason: ReasonSchema,
});

/** Tag one or more columns of a table. Tagging only narrows access, so Manage on Data access is enough. */
export const POST = handle(async (req) => {
  const auth = await requireAccessClassify(req);
  const orgId = await getOrgId();
  const body = parse(TagColumns, await req.json());
  const tablePath = normalizeTablePath(body.tablePath);
  const columns = [...new Set(body.columns.map(normalizeColumnName))];
  const tag = await assertActiveTag(orgId, body.tagId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const column of columns) {
      await tx.accessColumnTag.upsert({
        where: {
          org_id_table_path_column_name_tag_id: {
            org_id: orgId,
            table_path: tablePath,
            column_name: column,
            tag_id: tag.id,
          },
        },
        create: {
          org_id: orgId,
          table_path: tablePath,
          column_name: column,
          tag_id: tag.id,
          status: 'confirmed',
          source: 'steward',
          reason: body.reason,
          set_by: auth.userId,
          reviewed_by: auth.userId,
          reviewed_at: now,
        },
        update: { status: 'confirmed', reason: body.reason, reviewed_by: auth.userId, reviewed_at: now },
      });
    }
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.column_tag.set',
    entityType: 'access_tag',
    entityId: tag.id,
    after: { tablePath, columns, tag: tag.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return created({ ok: true, tablePath, columns, tagId: tag.id });
});

const UntagColumn = z.object({
  tablePath: z.string().min(5),
  column: z.string().min(1),
  tagId: z.string().min(1),
  reason: ReasonSchema,
});

/** Removing a tag stops protecting the column, so platform admin only. */
export const DELETE = handle(async (req) => {
  const auth = await requireAccessClassify(req);
  requirePlatformAdminFor(auth, 'remove a tag from a column (the column stops being protected)');
  const orgId = await getOrgId();
  const body = parse(UntagColumn, await req.json());
  const tablePath = normalizeTablePath(body.tablePath);
  const column = normalizeColumnName(body.column);

  await prisma.$transaction(async (tx) => {
    const removed = await tx.accessColumnTag.deleteMany({
      where: { org_id: orgId, table_path: tablePath, column_name: column, tag_id: body.tagId },
    });
    if (removed.count === 0) throw new ApiError(404, 'That column does not have this tag');
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.column_tag.removed',
    entityType: 'access_tag',
    entityId: body.tagId,
    before: { tablePath, column },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return noContent();
});
