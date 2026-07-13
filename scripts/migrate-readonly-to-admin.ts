/**
 * migrate-readonly-to-admin.ts — one-time migration that upgrades every user
 * whose sole/primary role is `readonly` to `admin`.
 *
 * Safe to re-run: users who already have admin/member/platform_admin are
 * untouched. The readonly role is removed only when it is the user's ONLY role.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/migrate-readonly-to-admin.ts
 *
 * Add --dry-run to preview without writing:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/migrate-readonly-to-admin.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const ROLE_PRECEDENCE = ['platform_admin', 'admin', 'member', 'readonly'];

function primaryRole(roleNames: string[]): string {
  for (const r of ROLE_PRECEDENCE) if (roleNames.includes(r)) return r;
  return roleNames[0] ?? 'unknown';
}

async function main() {
  console.log(`\n=== migrate-readonly-to-admin${DRY_RUN ? ' [DRY RUN]' : ''} ===\n`);

  const [adminRole, readonlyRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: 'admin' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'readonly' } }),
  ]);

  // Find all active users whose only role is readonly
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      roles: {
        some: { roleId: readonlyRole.id },
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      roles: { select: { roleId: true, role: { select: { name: true } } } },
    },
  });

  // Filter to users whose primary role is readonly (not mixed with higher roles)
  const toUpgrade = candidates.filter((u) => {
    const names = u.roles.map((r) => r.role.name);
    return primaryRole(names) === 'readonly';
  });

  if (toUpgrade.length === 0) {
    console.log('No readonly-only users found. Nothing to do.\n');
    return;
  }

  console.log(`Found ${toUpgrade.length} user(s) with only the 'readonly' role:\n`);
  for (const u of toUpgrade) {
    const displayName = u.name ? `${u.name} <${u.email}>` : u.email;
    console.log(`  • ${displayName}`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written. Remove --dry-run to apply.\n');
    return;
  }

  console.log('\nUpgrading...\n');

  let upgraded = 0;
  for (const u of toUpgrade) {
    try {
      // Remove the readonly role assignment
      await prisma.userRole.deleteMany({
        where: { userId: u.id, roleId: readonlyRole.id },
      });
      // Add the admin role (upsert — safe if somehow already assigned)
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: u.id, roleId: adminRole.id } },
        create: { userId: u.id, roleId: adminRole.id },
        update: {},
      });

      const displayName = u.name ? `${u.name} <${u.email}>` : u.email;
      console.log(`  ✓ ${displayName}  readonly → admin`);
      upgraded++;
    } catch (err) {
      console.error(`  ✗ ${u.email}: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${upgraded}/${toUpgrade.length} user(s) upgraded to admin.\n`);
  console.log('Note: Users will see their new role on their next page load (JWT refresh).\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
