import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { requireSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.ROLE_READ);
  requireSection(auth, ['govern.users', 'view']);
  const permissions = await prisma.permission.findMany({
    orderBy: { key: 'asc' },
    select: { id: true, key: true, description: true },
  });
  return ok({ permissions });
});
