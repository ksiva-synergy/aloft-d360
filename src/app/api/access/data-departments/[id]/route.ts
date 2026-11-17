import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { OptionalReasonSchema } from '@/lib/access/column-admin';
import { assertActiveDepartment, commitDepartmentChange } from '@/lib/access/department-admin';

export const dynamic = 'force-dynamic';

const RenameBody = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional().nullable(), reason: OptionalReasonSchema });

export const PATCH = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(RenameBody, await req.json());
  const before = await assertActiveDepartment(orgId, id);
  await commitDepartmentChange(orgId, async (tx) => {
    await tx.accessDataDepartment.update({ where: { id }, data: { name: body.name, description: body.description ?? null } });
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department.renamed',
    entityType: 'access_data_department',
    entityId: id,
    before: { name: before.name },
    after: { name: body.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});

const ArchiveBody = z.object({ reason: OptionalReasonSchema });

/** Archiving a department stops the access it gave (its paths and links are kept for audit). */
export const DELETE = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(ArchiveBody, await req.json());
  const before = await assertActiveDepartment(orgId, id);
  await commitDepartmentChange(orgId, async (tx) => {
    await tx.accessDataDepartment.update({ where: { id }, data: { archived_at: new Date() } });
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department.archived',
    entityType: 'access_data_department',
    entityId: id,
    before: { name: before.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
