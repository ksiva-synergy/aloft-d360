import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import {
  isUsable,
  resolvePrimaryRole,
  resolveRoleLabel,
  userAuthInclude,
} from '@/lib/rbac';

export function credentialsLoginEnabled(): boolean {
  return process.env.ENABLE_CREDENTIALS_LOGIN !== 'false';
}

/** Verify email + password for NextAuth CredentialsProvider. */
export async function verifyCredentialsLogin(
  emailRaw: string,
  password: string,
): Promise<{ id: string; email: string; name: string | null; role: string; roleLabel: string } | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    include: userAuthInclude,
  });

  if (!user || user.deletedAt || !user.passwordHash) return null;
  if (!isUsable(user)) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const role = resolvePrimaryRole(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    roleLabel: resolveRoleLabel(role),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
