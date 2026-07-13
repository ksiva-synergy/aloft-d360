/**
 * RBAC seed: permissions + roles (platform_admin / admin / member / readonly), and an OPTIONAL
 * break-glass local admin. Idempotent — safe to re-run.
 *
 * Self-contained on purpose (imports @prisma/client directly, not the `@/` path
 * alias) so it runs cleanly under `tsx`. Keep the permission keys below in sync
 * with PERMISSIONS in src/lib/rbac.ts.
 *
 * Role hierarchy (highest to lowest):
 *   platform_admin — full access + cross-user data visibility (sees ALL users' sessions/history)
 *   admin          — all app actions scoped to own data only
 *   member         — can use inspector + read-only access to all other sections
 *   readonly       — login and view only, no write interactions
 *
 * Bootstrap admin is created only if SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD (or
 * ADMIN_EMAIL + ADMIN_PASSWORD) are set. In an AAD-only world you can skip it and
 * instead grant `platform_admin` to your own AAD user after first login.
 *
 * Migration note for existing data:
 *   - existing `admin`  users → should be migrated to `platform_admin` via migration script
 *   - existing `viewer` users → should be migrated to `readonly` via migration script
 *   - existing `member` users → stay as `member`, gain `inspector:use` permission
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PERMISSIONS: Array<{ key: string; description: string }> = [
  { key: 'user:read', description: 'View users' },
  { key: 'user:create', description: 'Create users' },
  { key: 'user:update', description: 'Update users' },
  { key: 'user:delete', description: 'Deactivate / soft-delete users' },
  { key: 'role:read', description: 'View roles and permissions' },
  { key: 'role:assign', description: 'Create roles and assign/revoke user roles' },
  { key: 'session:read', description: 'View own application sessions and actions' },
  { key: 'session:read:all', description: 'View ALL users\' sessions and history (platform admin only)' },
  { key: 'session:write', description: 'Create/update sessions and actions' },
  { key: 'inspector:use', description: 'Interact with the inspector (create sessions, run queries)' },
  { key: 'audit:read', description: 'Read the audit trail' },
  // Gate raw LLM request/response payloads behind a dedicated permission so plain
  // audit:read cannot see prompt content.
  { key: 'llm:payload:read', description: 'Read raw LLM request/response payloads' },
];

const ROLES: Array<{ name: string; description: string; isSystem: boolean; permissions: string[] | '*' }> = [
  {
    name: 'platform_admin',
    description: 'Full access including cross-user data visibility',
    isSystem: true,
    permissions: '*',
  },
  {
    name: 'admin',
    description: 'All app actions scoped to own data only',
    isSystem: true,
    permissions: [
      'user:read',
      'user:create',
      'user:update',
      'user:delete',
      'role:read',
      'role:assign',
      'session:read',
      'session:write',
      'inspector:use',
      'audit:read',
    ],
  },
  {
    name: 'member',
    description: 'Inspector access + read-only on all other sections',
    isSystem: true,
    permissions: ['user:read', 'session:read', 'session:write', 'inspector:use'],
  },
  {
    name: 'readonly',
    description: 'Login and view only — no write interactions',
    isSystem: true,
    permissions: ['user:read', 'session:read'],
  },
];

async function main() {
  // 1. Permissions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, description: p.description },
      update: { description: p.description },
    });
  }
  const allPerms = await prisma.permission.findMany();
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  // 2. Roles + role→permission links
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      create: { name: r.name, description: r.description, isSystem: r.isSystem },
      update: { description: r.description, isSystem: r.isSystem },
    });
    const keys = r.permissions === '*' ? PERMISSIONS.map((p) => p.key) : r.permissions;
    for (const key of keys) {
      const permissionId = permByKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { roleId: role.id, permissionId },
        update: {},
      });
    }
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions and ${ROLES.length} roles.`);

  // 3. Optional break-glass local admin (platform_admin role)
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const platformAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'platform_admin' } });
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const user = await prisma.user.upsert({
      where: { email: adminEmail.toLowerCase() },
      create: {
        email: adminEmail.toLowerCase(),
        name: 'Bootstrap Admin',
        authProvider: 'credentials',
        passwordHash,
        status: 'ACTIVE',
        isActive: true,
        emailVerified: true,
      },
      update: { passwordHash, status: 'ACTIVE', isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: platformAdminRole.id } },
      create: { userId: user.id, roleId: platformAdminRole.id },
      update: {},
    });
    console.log(`Bootstrap platform_admin ready: ${adminEmail}`);
  } else {
    console.log('No SEED_ADMIN_EMAIL/PASSWORD set — skipping bootstrap admin (grant platform_admin to your AAD user after first login).');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
