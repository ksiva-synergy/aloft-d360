import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import {
  BaseRoleSchema,
  BundleLevelsSchema,
  BundleNameSchema,
  getBundleRole,
  requirePlatformAdminForBundles,
  setBundleLevels,
} from '@/lib/sections/bundles';
import { BUILT_IN_ROLES, levelsFromKeys } from '@/lib/sections/registry';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const UpdateBundle = z.object({
  name: BundleNameSchema.optional(),
  description: z.string().trim().max(300).nullable().optional(),
  levels: BundleLevelsSchema.optional(),
  /** Custom roles only: change the starting role. Everyone with the role moves to the new base. */
  base: BaseRoleSchema.optional(),
});

async function sectionKeys(roleId: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId, permission: { key: { startsWith: 'section:' } } },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key).sort();
}

/** Rename, describe, or replace the section levels of a bundle or custom role (platform admins only). */
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const body = parse(UpdateBundle, await req.json());
  const role = await getBundleRole(id);
  if (body.base && role.kind !== 'role') throw new ApiError(400, 'Only a custom role has a starting role');

  if (body.name !== undefined && body.name !== role.name) {
    const taken = await prisma.role.findUnique({ where: { name: body.name }, select: { id: true } });
    if (taken) throw new ApiError(409, `A role or bundle called "${body.name}" already exists`);
  }
  const beforeKeys = await sectionKeys(id);

  if (body.name !== undefined || body.description !== undefined) {
    await prisma.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
      },
    });
  }

  const base = body.base ?? role.base;
  const baseChanged = role.kind === 'role' && body.base !== undefined && body.base !== role.base;
  const afterKeys =
    body.levels || baseChanged ? await setBundleLevels(id, body.levels ?? levelsFromKeys(beforeKeys), base) : beforeKeys;

  if (baseChanged) {
    // Everyone with this custom role moves to the new built-in base.
    const baseRole = await prisma.role.findUniqueOrThrow({ where: { name: base! }, select: { id: true } });
    const members = (await prisma.userRole.findMany({ where: { roleId: id }, select: { userId: true } })).map((m) => m.userId);
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: { in: members }, role: { name: { in: [...BUILT_IN_ROLES] } } } }),
      prisma.userRole.createMany({ data: members.map((userId) => ({ userId, roleId: baseRole.id, assignedBy: auth.userId })), skipDuplicates: true }),
    ]);
  }

  await writeAudit({
    actorId: auth.userId,
    action: role.kind === 'role' ? 'section_role.updated' : 'section_bundle.updated',
    entityType: 'role',
    entityId: id,
    before: { name: role.name, description: role.description, base: role.base, keys: beforeKeys },
    after: { name: body.name ?? role.name, description: body.description ?? role.description, base, keys: afterKeys },
    ...clientMeta(req),
  });
  return ok({ bundle: { id, name: body.name ?? role.name, kind: role.kind, base, levels: levelsFromKeys(afterKeys) } });
});

/**
 * Delete a bundle or custom role (platform admins only). Bundle holders lose the access it gave;
 * people with a custom role go back to its starting role's defaults.
 */
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const role = await getBundleRole(id);
  const [keys, members] = await Promise.all([
    sectionKeys(id),
    prisma.userRole.findMany({ where: { roleId: id }, select: { userId: true } }),
  ]);

  await prisma.role.delete({ where: { id } });

  await writeAudit({
    actorId: auth.userId,
    action: role.kind === 'role' ? 'section_role.deleted' : 'section_bundle.deleted',
    entityType: 'role',
    entityId: id,
    before: { name: role.name, description: role.description, base: role.base, keys, members: members.map((m) => m.userId) },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
