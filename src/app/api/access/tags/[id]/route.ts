import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, noContent, parse, clientMeta } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';
import { OptionalReasonSchema, ReasonSchema, assertActiveTag, serializeTag } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const PatchTag = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  requiresTwoApprovals: z.boolean().optional(),
  maxDurationDays: z.number().int().positive().max(3650).optional().nullable(),
  reason: OptionalReasonSchema,
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(PatchTag, await req.json());
  const before = await assertActiveTag(orgId, id);

  if (before.requires_two_approvals && body.requiresTwoApprovals === false) {
    requirePlatformAdminFor(auth, 'turn off two approvals on a tag');
  }

  const tag = await prisma.$transaction(async (tx) => {
    const row = await tx.accessTag.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.requiresTwoApprovals !== undefined ? { requires_two_approvals: body.requiresTwoApprovals } : {}),
        ...(body.maxDurationDays !== undefined ? { max_duration_days: body.maxDurationDays } : {}),
      },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.tag.updated',
    entityType: 'access_tag',
    entityId: id,
    before: {
      name: before.name,
      description: before.description,
      requiresTwoApprovals: before.requires_two_approvals,
      maxDurationDays: before.max_duration_days,
    },
    after: {
      name: tag.name,
      description: tag.description,
      requiresTwoApprovals: tag.requires_two_approvals,
      maxDurationDays: tag.max_duration_days,
    },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return ok({ tag: serializeTag(tag) });
});

const ArchiveBody = z.object({ reason: ReasonSchema });

/** Archive (never hard-delete). Archiving stops protecting the tag's columns, so platform admin only. */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  requirePlatformAdminFor(auth, 'archive a tag (its columns stop being protected)');
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(ArchiveBody, await req.json());
  const before = await assertActiveTag(orgId, id);

  await prisma.$transaction(async (tx) => {
    await tx.accessTag.update({ where: { id }, data: { archived_at: new Date() } });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.tag.archived',
    entityType: 'access_tag',
    entityId: id,
    before: { key: before.key, name: before.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return noContent();
});
