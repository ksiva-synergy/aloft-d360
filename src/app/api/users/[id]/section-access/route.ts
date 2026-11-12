import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { assignCustomRole, customRoleIds, getBundleRole, requirePlatformAdminForBundles } from '@/lib/sections/bundles';
import { BUILT_IN_ROLES } from '@/lib/sections/registry';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const SetAccess = z.object({
  /** A custom role, or null for none (the person keeps their built-in role). */
  customRoleId: z.string().nullable(),
  /** Exactly these bundles. */
  bundleIds: z.array(z.string()).max(100),
});

/**
 * One person's extra section access (platform admins only): their custom role and their bundles.
 * Setting a custom role also moves their built-in role to its base. Takes effect on their next request.
 */
export const PUT = handle<Ctx>(async (req, ctx) => {
  const { id: userId } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const body = parse(SetAccess, await req.json());

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, deletedAt: true, roles: { select: { roleId: true, role: { select: { name: true } } } } },
  });
  if (!user || user.deletedAt) throw new ApiError(404, 'User not found');

  const custom = body.customRoleId ? await getBundleRole(body.customRoleId) : null;
  if (custom && custom.kind !== 'role') throw new ApiError(400, `"${custom.name}" is a bundle, not a custom role`);
  const bundleIds = [...new Set(body.bundleIds)];
  for (const b of bundleIds) {
    const r = await getBundleRole(b);
    if (r.kind !== 'bundle') throw new ApiError(400, `"${r.name}" is a custom role, not a bundle`);
  }

  const heldIds = user.roles.filter((r) => !(BUILT_IN_ROLES as readonly string[]).includes(r.role.name)).map((r) => r.roleId);
  const heldCustom = await customRoleIds(prisma, heldIds);
  const heldBundles = heldIds.filter((r) => !heldCustom.includes(r));

  await prisma.$transaction(async (tx) => {
    // Custom role
    if (custom) await assignCustomRole(tx, userId, { id: custom.id, base: custom.base! }, auth.userId);
    else if (heldCustom.length) await tx.userRole.deleteMany({ where: { userId, roleId: { in: heldCustom } } });
    // Bundles
    const removeBundles = heldBundles.filter((b) => !bundleIds.includes(b));
    if (removeBundles.length) await tx.userRole.deleteMany({ where: { userId, roleId: { in: removeBundles } } });
    const addBundles = bundleIds.filter((b) => !heldBundles.includes(b));
    if (addBundles.length) {
      await tx.userRole.createMany({ data: addBundles.map((roleId) => ({ userId, roleId, assignedBy: auth.userId })), skipDuplicates: true });
    }
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.section_access.changed',
    entityType: 'user',
    entityId: userId,
    before: { customRoles: heldCustom, bundles: heldBundles },
    after: { customRole: custom?.id ?? null, bundles: bundleIds },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
