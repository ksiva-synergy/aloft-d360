import { PERMISSIONS, roleRank } from '@/lib/rbac';
import { resolveAuth, type AuthContext } from '@/middleware/auth';
import { minForMethod, requireSection } from '@/lib/sections/server';
import { ApiError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Data access console APIs (departments, grants, clearances, labels, the tree). Section access
 * `govern.data-access`: View for GET, Manage for changes. Admins and platform admins have Manage by
 * default; a bundle can give either level. Platform-admin-only actions (labelled data, clearances,
 * labels) keep their own extra check in the route.
 */
export async function requireAccessAdmin(req: Request): Promise<AuthContext> {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.data-access', minForMethod(req.method)]);
  return auth;
}

/** Labels and the classification tree: same section rule as requireAccessAdmin. */
export async function requireAccessClassify(req: Request): Promise<AuthContext> {
  return requireAccessAdmin(req);
}

export async function requireAccessAudit(req: Request): Promise<AuthContext> {
  const auth = await resolveAuth(req);
  if (auth.permissions.has(PERMISSIONS.ACCESS_AUDIT)) return auth;
  if (roleRank(auth.role) >= roleRank('platform_admin')) return auth;
  throw new ApiError(403, 'Forbidden', { required: PERMISSIONS.ACCESS_AUDIT });
}

export function serializeDepartment(d: {
  id: string;
  key: string;
  name: string;
  entra_group_id: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  _count?: { members: number };
}) {
  return {
    id: d.id,
    key: d.key,
    name: d.name,
    entraGroupId: d.entra_group_id,
    archivedAt: d.archived_at?.toISOString() ?? null,
    memberCount: d._count?.members ?? undefined,
    createdAt: d.created_at.toISOString(),
    updatedAt: d.updated_at.toISOString(),
  };
}

export function serializeGrant(g: {
  id: string;
  principal_type: string;
  principal_id: string;
  path: string;
  path_depth: number;
  level: string;
  effect: string;
  expires_at: Date | null;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
}) {
  return {
    id: g.id,
    principalType: g.principal_type,
    principalId: g.principal_id,
    path: g.path,
    pathDepth: g.path_depth,
    level: g.level,
    effect: g.effect,
    expiresAt: g.expires_at?.toISOString() ?? null,
    reason: g.reason,
    createdBy: g.created_by,
    createdAt: g.created_at.toISOString(),
  };
}

export function serializeLabel(l: {
  id: string;
  path: string;
  path_depth: number;
  label: string;
  reason: string | null;
  set_by: string | null;
  updated_at: Date;
}) {
  return {
    id: l.id,
    path: l.path,
    pathDepth: l.path_depth,
    label: l.label,
    reason: l.reason,
    setBy: l.set_by,
    updatedAt: l.updated_at.toISOString(),
  };
}

export function serializeClearance(c: {
  user_id: string;
  level: string;
  reason: string | null;
  granted_by: string | null;
  expires_at: Date | null;
  updated_at: Date;
  user?: { email: string; name: string | null };
}) {
  return {
    userId: c.user_id,
    level: c.level,
    reason: c.reason,
    grantedBy: c.granted_by,
    expiresAt: c.expires_at?.toISOString() ?? null,
    updatedAt: c.updated_at.toISOString(),
    email: c.user?.email,
    name: c.user?.name,
  };
}

export function serializeDecision(d: {
  id: string;
  ts: Date;
  user_id: string | null;
  surface: string;
  level: string;
  paths: string[];
  decision: string;
  reason: string | null;
  mode: string;
  session_id: string | null;
  tier: string | null;
}) {
  return {
    id: d.id,
    ts: d.ts.toISOString(),
    userId: d.user_id,
    surface: d.surface,
    level: d.level,
    paths: d.paths,
    decision: d.decision,
    reason: d.reason,
    mode: d.mode,
    sessionId: d.session_id,
    tier: d.tier,
  };
}
