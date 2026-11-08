import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import {
  assertActiveGroup,
  parseExpiry,
  ReasonSchema,
  requireGroupMemberManager,
} from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const AddMember = z.object({
  userId: z.string().min(1),
  /** ISO date-time. Omit for no end date. */
  expiresAt: z.string().optional().nullable(),
  reason: ReasonSchema,
});

/**
 * Add a member, or change an existing member's end date. Group owner or platform admin only.
 * Nobody adds themselves.
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id: groupId } = await ctx.params;
  const auth = await requireGroupMemberManager(req, groupId);
  const orgId = await getOrgId();
  const body = parse(AddMember, await req.json());
  await assertActiveGroup(orgId, groupId);

  if (body.userId === auth.userId) {
    throw new ApiError(403, 'You cannot add yourself to a group. Ask another owner or a platform admin.');
  }

  const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true } });
  if (!user) throw new ApiError(404, 'User not found');
  const expiresAt = parseExpiry(body.expiresAt);

  const before = await prisma.accessGroupMember.findUnique({
    where: { group_id_user_id: { group_id: groupId, user_id: body.userId } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.accessGroupMember.upsert({
      where: { group_id_user_id: { group_id: groupId, user_id: body.userId } },
      create: {
        group_id: groupId,
        user_id: body.userId,
        expires_at: expiresAt,
        reason: body.reason,
        granted_by: auth.userId,
      },
      update: { expires_at: expiresAt, reason: body.reason, granted_by: auth.userId },
    });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: before ? 'access.group.member.updated' : 'access.group.member.added',
    entityType: 'access_group',
    entityId: groupId,
    before: before ? { userId: before.user_id, expiresAt: before.expires_at?.toISOString() ?? null } : undefined,
    after: { userId: body.userId, email: user.email, expiresAt: expiresAt?.toISOString() ?? null },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return created({ ok: true });
});

const RemoveMember = z.object({ userId: z.string().min(1), reason: ReasonSchema });

/** Remove a member. Owner, platform admin, or Manage on Data access (removing only narrows access). */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id: groupId } = await ctx.params;
  const auth = await requireGroupMemberManager(req, groupId);
  const orgId = await getOrgId();
  const body = parse(RemoveMember, await req.json());
  await assertActiveGroup(orgId, groupId);

  await prisma.$transaction(async (tx) => {
    const removed = await tx.accessGroupMember.deleteMany({
      where: { group_id: groupId, user_id: body.userId },
    });
    if (removed.count === 0) throw new ApiError(404, 'Member not found');
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.group.member.removed',
    entityType: 'access_group',
    entityId: groupId,
    before: { userId: body.userId },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return noContent();
});
