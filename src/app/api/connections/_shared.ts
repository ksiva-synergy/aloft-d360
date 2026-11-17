import { resolveAuth } from '@/middleware/auth';
import { levelsForContext, minForMethod, requireSection } from '@/lib/sections/server';
import { embeddedCallRequirements } from '@/lib/sections/uses';
import { getDefaultOrg } from '@/lib/org';
import type { Actor } from '@/lib/connections/service';

// Shared by the connection routes. Not a route file: Next only routes `route.ts`.
// Section access (govern.connections): View lets a person list and use connections shared with them
// (browse, test, extract); Manage lets them add, change, or remove their own. Admins have Manage by
// default; members get it from a bundle or a changed default. Who may see, use, change, or delete a
// given connection is still decided per row in the service (owner, shared, admin).
// Screens that embed connections (Automate's connection picker and extraction try-out) may make
// those exact calls with their own section instead; see src/lib/sections/uses.ts.

/** The caller as a connection actor, and whether they may add or change their own connections. */
export async function connectionContext(
  req: Request,
  need: 'view' | 'manage' = minForMethod(req.method),
): Promise<{ actor: Actor; canManage: boolean }> {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.connections', need], ...embeddedCallRequirements(req.method, new URL(req.url).pathname));
  return {
    actor: { userId: auth.userId, role: auth.role, orgId: getDefaultOrg().id },
    canManage: levelsForContext(auth)['govern.connections'] === 'manage',
  };
}

export async function connectionActor(req: Request, need: 'view' | 'manage' = minForMethod(req.method)): Promise<Actor> {
  return (await connectionContext(req, need)).actor;
}
