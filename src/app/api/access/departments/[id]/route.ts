import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin, serializeDepartment } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function loadDepartment(orgId: string, id: string) {
  const row = await prisma.accessDepartment.findFirst({
    where: { id, org_id: orgId },
    include: { _count: { select: { members: true } } },
  });
  if (!row) throw new ApiError(404, 'Department not found');
  return row;
}

export const GET = handle(async (req, ctx: Ctx) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const row = await loadDepartment(orgId, id);
  const members = await prisma.accessDepartmentMember.findMany({
    where: { department_id: id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return ok({
    department: serializeDepartment(row),
    members: members.map((m) => ({
      userId: m.user_id,
      email: m.user.email,
      name: m.user.name,
      source: m.source,
      addedAt: m.added_at.toISOString(),
    })),
  });
});

const PatchDepartment = z.object({
  name: z.string().min(2).optional(),
  entraGroupId: z.string().nullable().optional(),
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const before = await loadDepartment(orgId, id);
  const body = parse(PatchDepartment, await req.json());

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.accessDepartment.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.entraGroupId !== undefined ? { entra_group_id: body.entraGroupId } : {}),
      },
      include: { _count: { select: { members: true } } },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.department.updated',
    entityType: 'access_department',
    entityId: id,
    before: { name: before.name, entraGroupId: before.entra_group_id },
    after: { name: updated.name, entraGroupId: updated.entra_group_id },
    ...clientMeta(req),
  });

  return ok({ department: serializeDepartment(updated) });
});

export const DELETE = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const before = await loadDepartment(orgId, id);

  await prisma.$transaction(async (tx) => {
    await tx.accessDepartment.update({
      where: { id },
      data: { archived_at: new Date() },
    });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.department.archived',
    entityType: 'access_department',
    entityId: id,
    before: { key: before.key, name: before.name },
    ...clientMeta(req),
  });

  return noContent();
});
