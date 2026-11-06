import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot, loadPolicySnapshot, clearanceForUser } from '@/lib/access/policy-store';
import { departmentReachesLabelled, requirePlatformAdminFor } from '@/lib/access/sensitive';
import { requireAccessAdmin } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const MemberBody = z.object({ userId: z.string().min(1) });

async function assertDepartment(orgId: string, departmentId: string) {
  const row = await prisma.accessDepartment.findFirst({
    where: { id: departmentId, org_id: orgId, archived_at: null },
  });
  if (!row) throw new ApiError(404, 'Department not found');
  return row;
}

export const POST = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id: departmentId } = await ctx.params;
  const body = parse(MemberBody, await req.json());
  await assertDepartment(orgId, departmentId);

  const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true } });
  if (!user) throw new ApiError(404, 'User not found');

  const policy = await loadPolicySnapshot(orgId);
  if (clearanceForUser(policy, body.userId) !== 'internal' && departmentReachesLabelled(policy, departmentId)) {
    requirePlatformAdminFor(
      auth,
      'add a person with Confidential or Restricted clearance to a department that has labelled data',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.accessDepartmentMember.upsert({
      where: { department_id_user_id: { department_id: departmentId, user_id: body.userId } },
      create: {
        department_id: departmentId,
        user_id: body.userId,
        source: 'manual',
        added_by: auth.userId,
      },
      update: {},
    });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.department.member.added',
    entityType: 'access_department',
    entityId: departmentId,
    after: { userId: body.userId, email: user.email },
    ...clientMeta(req),
  });

  return created({ ok: true });
});

export const DELETE = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id: departmentId } = await ctx.params;
  const body = parse(MemberBody, await req.json());
  await assertDepartment(orgId, departmentId);

  await prisma.$transaction(async (tx) => {
    const removed = await tx.accessDepartmentMember.deleteMany({
      where: { department_id: departmentId, user_id: body.userId },
    });
    if (removed.count === 0) throw new ApiError(404, 'Member not found');
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.department.member.removed',
    entityType: 'access_department',
    entityId: departmentId,
    before: { userId: body.userId },
    ...clientMeta(req),
  });

  return noContent();
});
