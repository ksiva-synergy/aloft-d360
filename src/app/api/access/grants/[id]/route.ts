import { prisma } from '@/lib/db';
import { handle, noContent, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { assertNotSelfUserGrant } from '@/lib/access/guards';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (req, ctx: Ctx) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;

  const existing = await prisma.accessGrant.findFirst({ where: { id, org_id: orgId } });
  if (!existing) throw new ApiError(404, 'Grant not found');
  assertNotSelfUserGrant(auth.userId, existing.principal_type, existing.principal_id);

  await prisma.$transaction(async (tx) => {
    await tx.accessGrant.delete({ where: { id } });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.grant.deleted',
    entityType: 'access_grant',
    entityId: id,
    before: {
      principalType: existing.principal_type,
      principalId: existing.principal_id,
      path: existing.path,
      level: existing.level,
      effect: existing.effect,
    },
    ...clientMeta(req),
  });

  return noContent();
});
