import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.ROLE_READ);
  const permissions = await prisma.permission.findMany({
    orderBy: { key: 'asc' },
    select: { id: true, key: true, description: true },
  });
  return ok({ permissions });
});
