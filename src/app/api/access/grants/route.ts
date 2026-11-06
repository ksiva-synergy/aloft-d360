import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { assertNotSelfUserGrant } from '@/lib/access/guards';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { bumpPolicyVersionInTx, evictPolicySnapshot, loadPolicySnapshot } from '@/lib/access/policy-store';
import { allowWouldOpenLabelled, requirePlatformAdminFor } from '@/lib/access/sensitive';
import { requireAccessAdmin, serializeGrant } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const rows = await prisma.accessGrant.findMany({
    where: { org_id: orgId },
    orderBy: [{ path: 'asc' }, { created_at: 'desc' }],
  });
  return ok({ grants: rows.map(serializeGrant) });
});

const CreateGrant = z.object({
  principalType: z.enum(['user', 'department', 'role']),
  principalId: z.string().min(1),
  path: z.string().min(1),
  level: z.enum(['discover', 'query', 'export']),
  effect: z.enum(['allow', 'deny']).default('allow'),
  reason: z.string().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(CreateGrant, await req.json());
  assertNotSelfUserGrant(auth.userId, body.principalType, body.principalId);

  const { path, pathDepth } = normalizeCatalogPath(body.path);

  if (body.effect === 'allow') {
    const label = allowWouldOpenLabelled(await loadPolicySnapshot(orgId), path);
    if (label) requirePlatformAdminFor(auth, `give access to ${label} data (${path})`);
  }

  if (body.principalType === 'department') {
    const dept = await prisma.accessDepartment.findFirst({
      where: { id: body.principalId, org_id: orgId, archived_at: null },
    });
    if (!dept) throw new ApiError(404, 'Department not found');
  } else if (body.principalType === 'role') {
    const role = await prisma.role.findUnique({ where: { name: body.principalId }, select: { id: true } });
    if (!role) throw new ApiError(404, 'App role not found');
  } else {
    const user = await prisma.user.findUnique({ where: { id: body.principalId }, select: { id: true } });
    if (!user) throw new ApiError(404, 'User not found');
  }

  const grant = await prisma.$transaction(async (tx) => {
    const row = await tx.accessGrant.create({
      data: {
        org_id: orgId,
        principal_type: body.principalType,
        principal_id: body.principalId,
        path,
        path_depth: pathDepth,
        level: body.level,
        effect: body.effect,
        reason: body.reason ?? null,
        expires_at: body.expiresAt ? new Date(body.expiresAt) : null,
        created_by: auth.userId,
      },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.grant.created',
    entityType: 'access_grant',
    entityId: grant.id,
    after: {
      principalType: grant.principal_type,
      principalId: grant.principal_id,
      path: grant.path,
      level: grant.level,
      effect: grant.effect,
    },
    ...clientMeta(req),
  });

  return created({ grant: serializeGrant(grant) });
});
