/**
 * Authorization for memory curation (approve / retire / edit / delete / purge).
 *
 * Org-visible bullets (including HARD_RULEs) are injected into every user's system
 * prompt, so changing them is an admin action. Personal bullets may also be curated
 * by their author.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { PERMISSIONS, roleRank } from '@/lib/rbac';
import { authenticateSession, type AuthContext } from '@/middleware/auth';

export function canCurateBullet(
  auth: AuthContext,
  bullet: { visibility: string | null; createdBy: string | null },
): boolean {
  if (roleRank(auth.role) >= roleRank('admin')) return true;
  return bullet.visibility === 'personal' && !!bullet.createdBy && bullet.createdBy === auth.userId;
}

/** Session owner, session:read:all, or admin may read or purge a session's memory trace. */
export async function canPurgeSession(auth: AuthContext, sessionId: string): Promise<boolean> {
  if (auth.permissions.has(PERMISSIONS.SESSION_READ_ALL)) return true;
  if (roleRank(auth.role) >= roleRank('admin')) return true;
  const row = await prisma.workbench_sessions
    .findUnique({ where: { id: sessionId }, select: { user_id: true } })
    .catch(() => null);
  return !!row?.user_id && row.user_id === auth.userId;
}

/** Resolve the caller or return the 401 response to send. */
export async function requireMemoryCaller(): Promise<AuthContext | NextResponse> {
  const auth = await authenticateSession();
  return auth ?? NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
}

export const forbidden = () => NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

export const canAccessSessionMemory = canPurgeSession;

/** Prisma filter: admins see every bullet; others see org bullets plus their own personal ones. */
export function visibleBulletsWhere(auth: AuthContext) {
  if (roleRank(auth.role) >= roleRank('admin')) return {};
  return { OR: [{ visibility: 'org' }, { visibility: 'personal', createdBy: auth.userId }] };
}
