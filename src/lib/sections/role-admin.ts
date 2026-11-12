/**
 * Server-only storage for Users → Section access (built-in role defaults) and Users → Permissions.
 * Both are plain permission keys on role rows, so they are re-read on every request through
 * flattenPermissions and need no cache. Only platform admins call the writers (routes check).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { EDITABLE_PERMISSION_KEYS, PERMISSION_BY_KEY, PERMISSION_CATALOG, planPermissionChange } from '@/lib/permission-catalog';
import {
  ROLE_BASE_PREFIX,
  ROLE_DEFAULT_PREFIX,
  baseFromKeys,
  isBuiltInRole,
  roleDefaultKeysFor,
  roleDefaultOverridesFromKeys,
  type DefaultRole,
  type SectionLevels,
} from './registry';

const DEFAULT_ROLE_NAMES: DefaultRole[] = ['readonly', 'member', 'admin'];

async function builtInRoleId(tx: Prisma.TransactionClient | typeof prisma, role: DefaultRole): Promise<string> {
  const row = await tx.role.findUnique({ where: { name: role }, select: { id: true } });
  if (!row) throw new ApiError(500, `Built-in role "${role}" is missing; run the seed`);
  return row.id;
}

/** Ensure Permission rows exist for `keys` and return their ids. */
async function permissionIds(tx: Prisma.TransactionClient, keys: string[], describe: (key: string) => string): Promise<string[]> {
  for (const key of keys) {
    await tx.permission.upsert({ where: { key }, create: { key, description: describe(key) }, update: {} });
  }
  return keys.length ? (await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } })).map((p) => p.id) : [];
}

// ── Built-in role defaults ────────────────────────────────────────────────────────────────────

/** Changed defaults for each built-in role (empty map when nobody changed that role). */
export async function loadRoleDefaultOverrides(): Promise<Record<DefaultRole, SectionLevels>> {
  const rows = await prisma.rolePermission.findMany({
    where: { role: { name: { in: DEFAULT_ROLE_NAMES } }, permission: { key: { startsWith: ROLE_DEFAULT_PREFIX } } },
    select: { permission: { select: { key: true } } },
  });
  const parsed = roleDefaultOverridesFromKeys(rows.map((r) => r.permission.key));
  return { readonly: parsed.readonly ?? {}, member: parsed.member ?? {}, admin: parsed.admin ?? {} };
}

/**
 * Set a built-in role's section defaults. `levels` lists the sections to set; sections left out go
 * back to the code default. Returns the stored keys before and after.
 */
export async function setRoleDefaults(role: DefaultRole, levels: SectionLevels): Promise<{ before: string[]; after: string[] }> {
  const after = roleDefaultKeysFor(role, levels).sort();
  let before: string[] = [];
  await prisma.$transaction(async (tx) => {
    const roleId = await builtInRoleId(tx, role);
    before = (
      await tx.rolePermission.findMany({
        where: { roleId, permission: { key: { startsWith: ROLE_DEFAULT_PREFIX } } },
        select: { permission: { select: { key: true } } },
      })
    )
      .map((r) => r.permission.key)
      .sort();
    const ids = await permissionIds(tx, after, (k) => `Changed ${role} default: ${k.slice(ROLE_DEFAULT_PREFIX.length + role.length + 1)}`);
    await tx.rolePermission.deleteMany({ where: { roleId, permission: { key: { startsWith: ROLE_DEFAULT_PREFIX } } } });
    if (ids.length) await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId, permissionId })), skipDuplicates: true });
    await tx.role.update({ where: { id: roleId }, data: { updatedAt: new Date() } });
  });
  return { before, after };
}

// ── Role permissions ──────────────────────────────────────────────────────────────────────────

export type PermissionRoleKind = 'builtin' | 'role' | 'bundle';

export interface PermissionRoleRow {
  id: string;
  name: string;
  kind: PermissionRoleKind;
  /** Custom roles only: the built-in role its people also hold. */
  base: DefaultRole | null;
  /** Catalog permission keys the role carries (section keys left out). */
  keys: string[];
  memberCount: number;
}

const BUILT_IN_ORDER: Record<string, number> = { admin: 0, member: 1, readonly: 2 };

/** Built-in roles (not platform admin), then custom roles, then bundles, each with its catalog keys. */
export async function listRolePermissions(): Promise<PermissionRoleRow[]> {
  const catalogKeys = PERMISSION_CATALOG.map((p) => p.key);
  const roles = await prisma.role.findMany({
    where: { name: { not: 'platform_admin' }, OR: [{ name: { in: DEFAULT_ROLE_NAMES } }, { isSystem: false }] },
    select: {
      id: true,
      name: true,
      permissions: {
        where: { permission: { OR: [{ key: { in: catalogKeys } }, { key: { startsWith: ROLE_BASE_PREFIX } }] } },
        select: { permission: { select: { key: true } } },
      },
      _count: { select: { users: { where: { user: { deletedAt: null } } } } },
    },
  });
  const rows = roles.map((r): PermissionRoleRow => {
    const all = r.permissions.map((p) => p.permission.key);
    const builtIn = isBuiltInRole(r.name);
    const base = builtIn ? null : baseFromKeys(all);
    return {
      id: r.id,
      name: r.name,
      kind: builtIn ? 'builtin' : base ? 'role' : 'bundle',
      base,
      keys: all.filter((k) => PERMISSION_BY_KEY.has(k)).sort(),
      memberCount: r._count.users,
    };
  });
  const kindOrder: Record<PermissionRoleKind, number> = { builtin: 0, role: 1, bundle: 2 };
  return rows.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      (BUILT_IN_ORDER[a.name] ?? 9) - (BUILT_IN_ORDER[b.name] ?? 9) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Give a role exactly `requested` among the editable catalog keys. Section keys, platform-admin-only
 * keys and anything else on the role stay as they are. Refuses platform admin and unknown roles, and
 * unknown or platform-admin-only keys (so a typo never silently does nothing).
 */
export async function setRolePermissions(roleId: string, requested: string[]): Promise<{ role: { id: string; name: string }; before: string[]; after: string[] }> {
  for (const key of requested) {
    const info = PERMISSION_BY_KEY.get(key);
    if (!info) throw new ApiError(400, `Unknown permission: ${key}`);
    if (info.platformAdminOnly) throw new ApiError(400, `"${info.label}" stays with platform admins and cannot be given to a role.`);
  }
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true, isSystem: true } });
  if (!role) throw new ApiError(404, 'Role not found');
  if (role.name === 'platform_admin') throw new ApiError(400, 'Platform admins always hold every permission.');
  if (role.isSystem && !isBuiltInRole(role.name)) throw new ApiError(400, 'This system role cannot be changed here.');

  const editable = [...EDITABLE_PERMISSION_KEYS];
  let before: string[] = [];
  let after: string[] = [];
  await prisma.$transaction(async (tx) => {
    before = (
      await tx.rolePermission.findMany({
        where: { roleId, permission: { key: { in: editable } } },
        select: { permission: { select: { key: true } } },
      })
    )
      .map((r) => r.permission.key)
      .sort();
    const { add, remove } = planPermissionChange(before, requested);
    if (remove.length) await tx.rolePermission.deleteMany({ where: { roleId, permission: { key: { in: remove } } } });
    const ids = await permissionIds(tx, add, (k) => PERMISSION_BY_KEY.get(k)?.description ?? k);
    if (ids.length) await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId, permissionId })), skipDuplicates: true });
    after = [...before.filter((k) => !remove.includes(k)), ...add].sort();
    await tx.role.update({ where: { id: roleId }, data: { updatedAt: new Date() } });
  });
  return { role: { id: role.id, name: role.name }, before, after };
}

