/**
 * Set email+password sign-in for a local / credentials user. Dev utility only.
 * Usage: npx tsx --require ./scripts/context/noserver.cjs scripts/users/set-credentials-password.ts <email> <new-password>
 */
import { hashPassword } from '@/lib/auth-credentials';
import prisma from '@/lib/db';

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const password = process.argv[3] ?? '';
  if (!email || !password) {
    console.error('Usage: set-credentials-password.ts <email> <new-password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } });
  if (!user || user.deletedAt) {
    console.error(`No active user with email ${email}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      authProvider: 'credentials',
      emailVerified: true,
      status: 'ACTIVE',
      isActive: true,
    },
  });
  console.log(`Password updated for ${email} (credentials sign-in).`);
}

main().finally(() => prisma.$disconnect());
