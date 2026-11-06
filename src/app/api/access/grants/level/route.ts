import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { assertNotSelfUserGrant } from '@/lib/access/guards';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { bumpPolicyVersionInTx, evictPolicySnapshot, loadPolicySnapshot } from '@/lib/access/policy-store';
import { allowWouldOpenLabelled, requirePlatformAdminFor } from '@/lib/access/sensitive';
import { requireAccessAdmin, serializeGrant } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

const SetLevel = z.object({
  principalType: z.enum(['user', 'department', 'role']),
  principalId: z.string().min(1),
  path: z.string().min(1),
  /** `none` removes the grant on this exact path; `deny` blocks it and everything below. */
  level: z.enum(['none', 'discover', 'query', 'export', 'deny']),
  reason: z.string().max(500).optional().nullable(),
});

/**
 * Set one principal's access on one path. Replaces any allow or deny that principal
 * already holds on exactly this path. Grants on parents and children are untouched.
 */
export const PUT = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(SetLevel, await req.json());
  assertNotSelfUserGrant(auth.userId, body.principalType, body.principalId);
  const { path, pathDepth } = normalizeCatalogPath(body.path);

  if (body.level === 'discover' || body.level === 'query' || body.level === 'export') {
    const label = allowWouldOpenLabelled(await loadPolicySnapshot(orgId), path);
    if (label) requirePlatformAdminFor(auth, `give access to ${label} data (${path})`);
  }

  if (body.principalType === 'department') {
    const dept = await prisma.accessDepartment.findFirst({
      where: { id: body.principalId, org_id: orgId, archived_at: null },
      select: { id: true },
    });
    if (!dept) throw new ApiError(404, 'Department not found');
  } else if (body.principalType === 'role') {
    const role = await prisma.role.findUnique({ where: { name: body.principalId }, select: { id: true } });
    if (!role) throw new ApiError(404, 'App role not found');
  } else {
    const user = await prisma.user.findUnique({ where: { id: body.principalId }, select: { id: true } });
    if (!user) throw new ApiError(404, 'User not found');
  }

  const where = {
    org_id: orgId,
    principal_type: body.principalType,
    principal_id: body.principalId,
    path,
  };

  const { before, after } = await prisma.$transaction(async (tx) => {
    const existing = await tx.accessGrant.findMany({ where });
    await tx.accessGrant.deleteMany({ where });
    const row =
      body.level === 'none'
        ? null
        : await tx.accessGrant.create({
            data: {
              ...where,
              path_depth: pathDepth,
              level: body.level === 'deny' ? 'discover' : body.level,
              effect: body.level === 'deny' ? 'deny' : 'allow',
              reason: body.reason ?? null,
              created_by: auth.userId,
            },
          });
    await bumpPolicyVersionInTx(tx, orgId);
    return { before: existing, after: row };
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.grant.level_set',
    entityType: 'access_grant',
    entityId: after?.id ?? before[0]?.id ?? path,
    before: before.length
      ? before.map((g) => ({ path: g.path, level: g.level, effect: g.effect }))
      : null,
    after: after
      ? {
          principalType: after.principal_type,
          principalId: after.principal_id,
          path: after.path,
          level: after.level,
          effect: after.effect,
        }
      : null,
    ...clientMeta(req),
  });

  return ok({ grant: after ? serializeGrant(after) : null, removed: before.length });
});
