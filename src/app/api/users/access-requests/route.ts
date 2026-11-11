import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { requireSection } from '@/lib/sections/server';
import { resolveAuth, requireRole } from '@/middleware/auth';

export const dynamic = 'force-dynamic';

const requestSelect = {
  id: true,
  email: true,
  name: true,
  authProvider: true,
  aadObjectId: true,
  aadTenantId: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

/** Platform admins: people waiting for admission after SSO. */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.access-requests', 'view']);
  requireRole(auth, 'platform_admin');

  const requests = await prisma.user.findMany({
    where: { deletedAt: null, status: 'PENDING_APPROVAL' },
    orderBy: { createdAt: 'asc' },
    select: requestSelect,
  });

  return ok({ requests });
});
