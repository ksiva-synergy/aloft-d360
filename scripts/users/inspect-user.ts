/**
 * One-off user diagnostics (email arg). Read-only.
 * Usage: npx tsx --require ./scripts/context/noserver.cjs scripts/users/inspect-user.ts user@example.com
 */
import prisma from '@/lib/db';

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: inspect-user.ts <email>');
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { email: { contains: email.split('@')[0] ?? email, mode: 'insensitive' } },
      ],
    },
    include: { roles: { include: { role: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  console.log('=== User rows ===');
  for (const u of users) {
    console.log({
      id: u.id,
      email: u.email,
      status: u.status,
      isActive: u.isActive,
      deletedAt: u.deletedAt,
      hasAadObjectId: !!u.aadObjectId,
      authProvider: u.authProvider,
      lastLoginAt: u.lastLoginAt,
      lastSeenAt: u.lastSeenAt,
      roles: u.roles.map((r) => r.role.name),
    });
  }

  const events = await prisma.loginEvent.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      createdAt: true,
      success: true,
      failureReason: true,
      provider: true,
      userId: true,
    },
  });
  console.log('\n=== Login events (by email) ===');
  console.log(events);
}

main().finally(() => prisma.$disconnect());
