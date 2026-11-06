import { resolveAuth } from '@/middleware/auth';
import { minForMethod, requireSection } from '@/lib/sections/server';
import { getDefaultOrg } from '@/lib/org';
import type { Actor } from '@/lib/connections/service';

// Shared by the connection routes. Not a route file: Next only routes `route.ts`.
// Section access (govern.connections): View lets a person list and use connections shared with them
// (browse, test, extract); Manage lets them add, change, or remove their own. Members and admins have
// Manage by default. Who may see, use, change, or delete a given connection is still decided per row
// in the service (owner, shared, admin).

export async function connectionActor(req: Request, need: 'view' | 'manage' = minForMethod(req.method)): Promise<Actor> {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.connections', need]);
  return { userId: auth.userId, role: auth.role, orgId: getDefaultOrg().id };
}
