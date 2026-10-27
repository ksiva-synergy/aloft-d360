import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { getDefaultOrg } from '@/lib/org';
import type { Actor } from '@/lib/connections/service';

// Shared by the connection routes. Not a route file: Next only routes `route.ts`.
// Self-service: anyone who can build automations (inspector:use) may create connections. Who may see,
// use, change or delete a given connection is decided per row in the service (owner, shared, admin).

export async function connectionActor(req: Request): Promise<Actor> {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.INSPECTOR_USE);
  return { userId: auth.userId, role: auth.role, orgId: getDefaultOrg().id };
}
