import 'server-only';

import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { flattenPermissions, resolvePrimaryRole, userAuthInclude, PERMISSIONS } from '@/lib/rbac';
import { canViewAgentOpsRole } from './role-gate';

export { canViewAgentOpsRole } from './role-gate';

export function canViewAgentOpsFromPrimaryRole(primaryRole: string): boolean {
  return canViewAgentOpsRole(primaryRole);
}

export async function getAgentOpsAuth() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, status: 401 as const };

  const dbUser = await prisma.user.findUnique({ where: { id: userId }, include: userAuthInclude });
  if (!dbUser) return { ok: false as const, status: 401 as const };

  const primaryRole = resolvePrimaryRole(dbUser);
  if (!canViewAgentOpsFromPrimaryRole(primaryRole)) {
    return { ok: false as const, status: 403 as const };
  }

  const canReadAllSessions = flattenPermissions(dbUser).has(PERMISSIONS.SESSION_READ_ALL);

  return {
    ok: true as const,
    userId,
    primaryRole,
    canReadAllSessions,
    session: session as Session,
  };
}

export async function assertSessionReadable(sessionId: string, userId: string, canReadAll: boolean) {
  const row = await prisma.workbench_sessions.findUnique({
    where: { id: sessionId },
    select: { user_id: true },
  });
  if (!row) return { ok: false as const, status: 404 as const };
  if (!canReadAll && row.user_id !== userId) return { ok: false as const, status: 403 as const };
  return { ok: true as const };
}
