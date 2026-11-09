import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { OptionalReasonSchema, assertActiveGroup, parseExpiry, requireGroupMemberManager } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Longest membership allowed in a group that holds protected-column access (unless the protection sets a shorter limit). */
const MAX_PROTECTED_MEMBERSHIP_DAYS = 365;

/** Active protection grants held by the group, with the protection's name and duration limit. */
async function heldProtections(orgId: string, groupId: string) {
  const now = Date.now();
  const grants = (
    await prisma.accessTagGrant.findMany({
      where: { org_id: orgId, principal_type: 'group', principal_id: groupId },
      select: { tag_id: true, level: true, expires_at: true },
    })
  ).filter((g) => !g.expires_at || g.expires_at.getTime() > now);
  if (grants.length === 0) return [];
  const tags = await prisma.accessTag.findMany({
    where: { id: { in: grants.map((g) => g.tag_id) }, archived_at: null },
    select: { id: true, name: true, max_duration_days: true },
  });
  const byId = new Map(tags.map((t) => [t.id, t]));
  return grants.flatMap((g) => {
    const t = byId.get(g.tag_id);
    return t ? [{ tagId: t.id, name: t.name, level: g.level, maxDays: t.max_duration_days }] : [];
  });
}

const AddMember = z.object({
  userId: z.string().min(1),
  /** ISO date-time. Omit for no end date. */
  expiresAt: z.string().optional().nullable(),
  reason: OptionalReasonSchema,
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

  // Review C4: joining a group that holds protected-column access is a protection grant.
  // Group owners may add members (product decision 2026-11-09), but the membership needs an end date
  // and is audited as a protection grant.
  const held = await heldProtections(orgId, groupId);
  if (held.length > 0) {
    const names = held.map((h) => `${h.name} · ${h.level === 'aggregate' ? 'Totals only' : 'Exact values'}`).join(', ');
    if (!expiresAt) throw new ApiError(400, `This group gives access to protected columns (${names}). Set an end date.`);
    const maxDays = Math.min(MAX_PROTECTED_MEMBERSHIP_DAYS, ...held.map((h) => h.maxDays ?? MAX_PROTECTED_MEMBERSHIP_DAYS));
    if (expiresAt.getTime() > Date.now() + maxDays * 86_400_000) {
      throw new ApiError(400, `End date can be at most ${maxDays} days away for a group that gives access to ${names}.`);
    }
  }

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
  if (held.length > 0) {
    await writeAudit({
      actorId: auth.userId,
      action: 'access.protection.granted_via_group',
      entityType: 'access_group',
      entityId: groupId,
      after: {
        userId: body.userId,
        email: user.email,
        protections: held.map((h) => ({ id: h.tagId, name: h.name, level: h.level })),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      metadata: { reason: body.reason },
      ...clientMeta(req),
    });
  }

  return created({ ok: true });
});

const RemoveMember = z.object({ userId: z.string().min(1), reason: OptionalReasonSchema });

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
