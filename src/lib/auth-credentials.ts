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

// Per-account brute-force throttle. In-memory per instance: it bounds online guessing on each
// task; a shared store would be needed for a strict cluster-wide limit.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

function isLockedOut(email: string, now = Date.now()): boolean {
  const f = failures.get(email);
  if (!f) return false;
  if (f.lockedUntil > now) return true;
  if (now - f.first > WINDOW_MS) failures.delete(email);
  return false;
}

function recordFailure(email: string, now = Date.now()): void {
  const f = failures.get(email);
  if (!f || now - f.first > WINDOW_MS) {
    failures.set(email, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  f.count += 1;
  if (f.count >= MAX_FAILURES) f.lockedUntil = now + WINDOW_MS;
  if (failures.size > 10_000) failures.delete(failures.keys().next().value as string);
}

/** Test hook. */
export function resetCredentialsThrottle(): void {
  failures.clear();
}

// Compared against when the account does not exist, so response time does not reveal valid emails.
const DUMMY_HASH = '$2b$12$bN/UVA02ihcqBPybJ5/Hi.xaLmASq/vv6B/vyzikrO15NB02fpf42';

/** Verify email + password for NextAuth CredentialsProvider. */
export async function verifyCredentialsLogin(
  emailRaw: string,
  password: string,
): Promise<{ id: string; email: string; name: string | null; role: string; roleLabel: string } | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return null;
  if (isLockedOut(email)) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    include: userAuthInclude,
  });

  if (!user || user.deletedAt || !user.passwordHash || !isUsable(user)) {
    await bcrypt.compare(password, DUMMY_HASH);
    recordFailure(email);
    return null;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    recordFailure(email);
    return null;
  }
  failures.delete(email);

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
