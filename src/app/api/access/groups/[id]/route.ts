import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, noContent, parse, clientMeta } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { assertActiveGroup, ReasonSchema } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const PatchGroup = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  reason: ReasonSchema,
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(PatchGroup, await req.json());
  const before = await assertActiveGroup(orgId, id);

  const group = await prisma.accessGroup.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    },
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'access.group.updated',
    entityType: 'access_group',
    entityId: id,
    before: { name: before.name, description: before.description },
    after: { name: group.name, description: group.description },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return ok({ group: { id: group.id, key: group.key, name: group.name, description: group.description } });
});

const ArchiveBody = z.object({ reason: ReasonSchema });

/** Archive (never hard-delete). Members lose what the group gave them, so this only narrows access. */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(ArchiveBody, await req.json());
  const before = await assertActiveGroup(orgId, id);

  await prisma.$transaction(async (tx) => {
    await tx.accessGroup.update({ where: { id }, data: { archived_at: new Date() } });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.group.archived',
    entityType: 'access_group',
    entityId: id,
    before: { key: before.key, name: before.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return noContent();
});
