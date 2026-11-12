/**
 * Bundles and custom roles: roles that carry `section:<id>:<level>` permission keys. Server-only.
 *
 *   bundle      — adds section access on top of a person's role. Any number per person.
 *   custom role — sets every section exactly (can take access away). Carries `section:role-base:<base>`;
 *                 its people also hold that built-in base role, which decides everything outside
 *                 sections. At most one per person; never given to platform admins.
 *
 * Only platform admins create, change, delete, or assign either. Neither can give Manage on a Data
 * Estate or view-only section (keysForLevels lowers those to View).
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import type { AuthContext } from '@/middleware/auth';
import {
  BUILT_IN_ROLES,
  ROLE_BASE_PREFIX,
  SECTION_BY_ID,
  baseFromKeys,
  isBuiltInRole,
  keysForLevels,
  levelsFromKeys,
  roleBaseKey,
  type DefaultRole,
  type SectionLevels,
} from './registry';

export type AccessKind = 'bundle' | 'role';

export interface BundleSummary {
  id: string;
  name: string;
  description: string | null;
  kind: AccessKind;
  /** Custom roles only: the built-in role it starts from. */
  base: DefaultRole | null;
  levels: SectionLevels;
  members: { id: string; name: string | null; email: string }[];
  updatedAt: string;
}

export const BaseRoleSchema = z.enum(['readonly', 'member', 'admin']);

export const BundleLevelsSchema = z.record(z.string(), z.enum(['none', 'view', 'manage'])).superRefine((levels, ctx) => {
  for (const id of Object.keys(levels)) {
    if (!SECTION_BY_ID.has(id)) ctx.addIssue({ code: 'custom', message: `Unknown section: ${id}` });
  }
});

export const BundleNameSchema = z
  .string()
  .trim()
  .min(2, 'Name needs at least 2 characters')
  .max(60, 'Name can be at most 60 characters')
  .refine((n) => !isBuiltInRole(n.toLowerCase()), 'That name is a built-in role');

export function requirePlatformAdminForBundles(auth: AuthContext): void {
  if (auth.role !== 'platform_admin') {
    throw new ApiError(403, 'Only platform admins can change roles, bundles, or who has them.', { requiredRole: 'platform_admin' });
  }
}

const sectionKeysSelect = {
  where: { permission: { key: { startsWith: 'section:' } } },
  select: { permission: { select: { key: true } } },
} as const;

/** Every custom role and bundle with its section levels and members. Custom roles first. */
export async function listBundles(): Promise<BundleSummary[]> {
  const roles = await prisma.role.findMany({
    where: { name: { notIn: [...BUILT_IN_ROLES] }, isSystem: false },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      permissions: sectionKeysSelect,
      users: {
        where: { user: { deletedAt: null } },
        select: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  const out = roles.map((r) => {
    const keys = r.permissions.map((p) => p.permission.key);
    const base = baseFromKeys(keys);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      kind: (base ? 'role' : 'bundle') as AccessKind,
      base,
      levels: levelsFromKeys(keys),
      members: r.users.map((u) => u.user).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
  return out.sort((a, b) => Number(b.kind === 'role') - Number(a.kind === 'role') || a.name.localeCompare(b.name));
}

/** Load a bundle or custom role by id (404 for unknown ids and built-in roles), with its kind. */
export async function getBundleRole(id: string) {
  const role = await prisma.role.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, isSystem: true, permissions: sectionKeysSelect },
  });
  if (!role || role.isSystem || isBuiltInRole(role.name)) throw new ApiError(404, 'Role or bundle not found');
  const base = baseFromKeys(role.permissions.map((p) => p.permission.key));
  return { id: role.id, name: role.name, description: role.description, base, kind: (base ? 'role' : 'bundle') as AccessKind };
}

/**
 * Replace a role's section keys with `levels` (plus the base key for a custom role). Other permission
 * keys on the role are left alone. Permission rows are created on first use. Returns the keys set.
 */
export async function setBundleLevels(roleId: string, levels: Record<string, string>, base: DefaultRole | null): Promise<string[]> {
  const keys = [...keysForLevels(levels as SectionLevels), ...(base ? [roleBaseKey(base)] : [])];
  await prisma.$transaction(async (tx) => {
    for (const key of keys) {
      await tx.permission.upsert({
        where: { key },
        create: {
          key,
          description: key.startsWith(ROLE_BASE_PREFIX)
            ? `Custom role based on ${key.slice(ROLE_BASE_PREFIX.length)}`
            : `Section access: ${key.slice('section:'.length)}`,
        },
        update: {},
      });
    }
    const perms = keys.length ? await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } }) : [];
    await tx.rolePermission.deleteMany({ where: { roleId, permission: { key: { startsWith: 'section:' } } } });
    if (perms.length) {
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })), skipDuplicates: true });
    }
    await tx.role.update({ where: { id: roleId }, data: { updatedAt: new Date() } });
  });
  return keys;
}

/** Ids of the custom roles among a set of role ids. */
export async function customRoleIds(tx: Prisma.TransactionClient | typeof prisma, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const rows = await tx.rolePermission.findMany({
    where: { roleId: { in: roleIds }, permission: { key: { startsWith: ROLE_BASE_PREFIX } } },
    select: { roleId: true },
  });
  return [...new Set(rows.map((r) => r.roleId))];
}

/**
 * Give a person a custom role: drop any other custom role, and make their built-in role the custom
 * role's base. Refuses platform admins (they already have everything). Bundles stay.
 */
export async function assignCustomRole(
  tx: Prisma.TransactionClient,
  userId: string,
  role: { id: string; base: DefaultRole },
  assignedBy: string,
): Promise<void> {
  const current = await tx.userRole.findMany({ where: { userId }, select: { roleId: true, role: { select: { name: true } } } });
  if (current.some((r) => r.role.name === 'platform_admin')) {
    throw new ApiError(400, 'Platform admins cannot be given a custom role; they already have full access.');
  }
  const otherCustom = (await customRoleIds(tx, current.map((r) => r.roleId))).filter((id) => id !== role.id);
  const baseRole = await tx.role.findUnique({ where: { name: role.base }, select: { id: true } });
  if (!baseRole) throw new ApiError(500, `Built-in role "${role.base}" is missing; run the seed`);

  await tx.userRole.deleteMany({
    where: { userId, OR: [{ roleId: { in: otherCustom } }, { role: { name: { in: [...BUILT_IN_ROLES] } } }] },
  });
  await tx.userRole.createMany({
    data: [
      { userId, roleId: baseRole.id, assignedBy },
      { userId, roleId: role.id, assignedBy },
    ],
    skipDuplicates: true,
  });
}
