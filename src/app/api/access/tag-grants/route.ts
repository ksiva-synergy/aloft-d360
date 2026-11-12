import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';
import { assertNotSelfUserGrant } from '@/lib/access/guards';
import { OptionalReasonSchema, ReasonSchema, assertActiveGroup, assertActiveTag, parseExpiry, serializeTagGrant } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/** Tag grants, optionally for one tag (?tagId=…). */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const tagId = new URL(req.url).searchParams.get('tagId');
  const rows = await prisma.accessTagGrant.findMany({
    where: { org_id: orgId, ...(tagId ? { tag_id: tagId } : {}) },
    orderBy: { created_at: 'asc' },
  });
  return ok({ grants: rows.map(serializeTagGrant) });
});

const GrantBody = z.object({
  tagId: z.string().min(1),
  principalType: z.enum(['group', 'user']),
  principalId: z.string().min(1),
  level: z.enum(['aggregate', 'full']),
  expiresAt: z.string().optional().nullable(),
  reason: ReasonSchema,
});

/**
 * Give a group (or one person) a tag. This opens sensitive data, so platform admin only, and never
 * to yourself. Re-granting the same tag to the same holder replaces the level and end date.
 */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  requirePlatformAdminFor(auth, 'give a group or a person access to a data tag');
  const orgId = await getOrgId();
  const body = parse(GrantBody, await req.json());
  assertNotSelfUserGrant(auth.userId, body.principalType, body.principalId);
  const tag = await assertActiveTag(orgId, body.tagId);
  const expiresAt = parseExpiry(body.expiresAt);

  if (body.principalType === 'group') {
    await assertActiveGroup(orgId, body.principalId);
  } else {
    const user = await prisma.user.findUnique({ where: { id: body.principalId }, select: { id: true } });
    if (!user) throw new ApiError(404, 'User not found');
  }

  const before = await prisma.accessTagGrant.findUnique({
    where: {
      tag_id_principal_type_principal_id: {
        tag_id: tag.id,
        principal_type: body.principalType,
        principal_id: body.principalId,
      },
    },
  });

  const grant = await prisma.$transaction(async (tx) => {
    const row = await tx.accessTagGrant.upsert({
      where: {
        tag_id_principal_type_principal_id: {
          tag_id: tag.id,
          principal_type: body.principalType,
          principal_id: body.principalId,
        },
      },
      create: {
        org_id: orgId,
        tag_id: tag.id,
        principal_type: body.principalType,
        principal_id: body.principalId,
        level: body.level,
        expires_at: expiresAt,
        reason: body.reason,
        created_by: auth.userId,
      },
      update: { level: body.level, expires_at: expiresAt, reason: body.reason, created_by: auth.userId },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: before ? 'access.tag_grant.updated' : 'access.tag_grant.created',
    entityType: 'access_tag',
    entityId: tag.id,
    before: before ? { level: before.level, expiresAt: before.expires_at?.toISOString() ?? null } : undefined,
    after: {
      tag: tag.name,
      principalType: body.principalType,
      principalId: body.principalId,
      level: body.level,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return created({ grant: serializeTagGrant(grant) });
});

const RevokeBody = z.object({ id: z.string().min(1), reason: OptionalReasonSchema });

/** Remove a tag grant. Only narrows access, so Manage on Data access is enough. */
export const DELETE = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(RevokeBody, await req.json());

  const grant = await prisma.accessTagGrant.findFirst({ where: { id: body.id, org_id: orgId } });
  if (!grant) throw new ApiError(404, 'Grant not found');

  await prisma.$transaction(async (tx) => {
    await tx.accessTagGrant.delete({ where: { id: grant.id } });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.tag_grant.revoked',
    entityType: 'access_tag',
    entityId: grant.tag_id,
    before: serializeTagGrant(grant),
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return noContent();
});
