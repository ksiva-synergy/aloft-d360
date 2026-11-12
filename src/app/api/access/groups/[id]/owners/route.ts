import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';
import { OptionalReasonSchema, assertActiveGroup } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const OwnerBody = z.object({ userId: z.string().min(1), reason: OptionalReasonSchema });

/** Owners approve who joins, so changing owners is platform admin only. One owner is enough. */
export const POST = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  requirePlatformAdminFor(auth, 'change the owners of an access group');
  const orgId = await getOrgId();
  const { id: groupId } = await ctx.params;
  const body = parse(OwnerBody, await req.json());
  await assertActiveGroup(orgId, groupId);

  const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true } });
  if (!user) throw new ApiError(404, 'User not found');

  await prisma.accessGroupOwner.upsert({
    where: { group_id_user_id: { group_id: groupId, user_id: body.userId } },
    create: { group_id: groupId, user_id: body.userId, added_by: auth.userId },
    update: {},
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'access.group.owner.added',
    entityType: 'access_group',
    entityId: groupId,
    after: { userId: body.userId, email: user.email },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return created({ ok: true });
});

export const DELETE = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  requirePlatformAdminFor(auth, 'change the owners of an access group');
  const orgId = await getOrgId();
  const { id: groupId } = await ctx.params;
  const body = parse(OwnerBody, await req.json());
  await assertActiveGroup(orgId, groupId);

  await prisma.$transaction(async (tx) => {
    const count = await tx.accessGroupOwner.count({ where: { group_id: groupId } });
    const isOwner = await tx.accessGroupOwner.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: body.userId } },
    });
    if (!isOwner) throw new ApiError(404, 'That person is not an owner of this group');
    if (count <= 1) throw new ApiError(409, 'A group needs at least one owner. Add another owner first.');
    await tx.accessGroupOwner.delete({
      where: { group_id_user_id: { group_id: groupId, user_id: body.userId } },
    });
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'access.group.owner.removed',
    entityType: 'access_group',
    entityId: groupId,
    before: { userId: body.userId },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return noContent();
});
