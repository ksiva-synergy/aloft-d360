/**
 * RBAC core: the single find-or-create-by-oid provisioning flow, plus helpers to
 * flatten a user's permissions and resolve a coarse "primary role" string for the
 * session/UI. Both the NextAuth AAD callback (src/lib/auth.ts) and the API-token
 * authenticator (src/middleware/auth.ts) go through `provisionUserByOid` so there
 * is exactly ONE user-creation path.
 *
 * Role hierarchy (highest to lowest):
 *   platform_admin — full access + cross-user data visibility
 *   admin          — all app actions, own data only
 *   member         — inspector access + read-only everywhere else
 *   readonly       — login and view only
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';

/** Role granted to brand-new users on first login (just-in-time provisioning). */
export const DEFAULT_ROLE = 'readonly';

/**
 * Thrown by provisionUserByOid when a first-time AAD login presents an email that
 * already belongs to an existing account. We refuse to auto-link the AAD identity
 * onto that row (which would silently inherit its roles) because AAD email /
 * preferred_username is not a securely-verified or stable identifier. Linking must
 * be a deliberate admin action. Callers translate this into a denied sign-in / 403,
 * never a 500 and never an account takeover.
 */
export class AccountLinkRequiredError extends Error {
  constructor(public readonly email: string) {
    super(`An account with email ${email} already exists and must be linked by an administrator`);
    this.name = 'AccountLinkRequiredError';
  }
}

/** Permission catalogue — keep in sync with prisma/seed.ts. */
export const PERMISSIONS = {
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  ROLE_READ: 'role:read',
  ROLE_ASSIGN: 'role:assign',
  SESSION_READ: 'session:read',
  /** View ALL users' sessions/history — platform_admin only. */
  SESSION_READ_ALL: 'session:read:all',
  SESSION_WRITE: 'session:write',
  /** Interact with the inspector (create sessions, run queries). */
  INSPECTOR_USE: 'inspector:use',
  AUDIT_READ: 'audit:read',
  // Gate raw LLM request/response payloads behind a dedicated permission so plain
  // audit:read cannot see prompt content.
  LLM_PAYLOAD_READ: 'llm:payload:read',
} as const;

/** Human-readable labels for each role — use in UI instead of raw DB name. */
export const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Platform Admin',
  admin: 'Admin',
  member: 'Member',
  readonly: 'Read Only',
};

/** Highest-privilege first — used to pick the coarse role string for the session. */
const ROLE_PRECEDENCE = ['platform_admin', 'admin', 'member', 'readonly'];

export const userAuthInclude = {
  roles: {
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  },
} satisfies Prisma.UserInclude;

export type UserWithAuth = Prisma.UserGetPayload<{ include: typeof userAuthInclude }>;

export function flattenPermissions(user: UserWithAuth): Set<string> {
  const perms = new Set<string>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) perms.add(rp.permission.key);
  }
  return perms;
}

export function resolvePrimaryRole(user: UserWithAuth): string {
  const names = user.roles.map((ur) => ur.role.name);
  for (const r of ROLE_PRECEDENCE) if (names.includes(r)) return r;
  return names[0] ?? DEFAULT_ROLE;
}

/** Resolve the human-readable label for a role name. */
export function resolveRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** A user is usable iff not soft-deleted, status ACTIVE, and the legacy flag agrees. */
export function isUsable(user: { status: string; isActive: boolean; deletedAt: Date | null }): boolean {
  return !user.deletedAt && user.status === 'ACTIVE' && user.isActive;
}

export interface OidClaims {
  oid: string;
  tid?: string | null;
  email?: string | null;
  name?: string | null;
  /** AAD group ids from the token; used for platform_admin elevation. */
  groups?: string[];
}

/**
 * THE single provisioning path. Find a user by AAD oid; if absent, link an existing
 * email-matched row (no duplicate) or create a fresh one with the default role.
 * Always refreshes login timestamps. Optionally elevates to `platform_admin` when the
 * token carries an AZURE_AD_ADMIN_GROUP_IDS group.
 */
export async function provisionUserByOid(claims: OidClaims): Promise<UserWithAuth> {
  const { oid, tid, email, name, groups } = claims;
  const normalizedEmail = email ? email.toLowerCase() : null;

  let user = await prisma.user.findUnique({ where: { aadObjectId: oid }, include: userAuthInclude });

  if (user) {
    // (1) Known AAD identity — refresh login timestamps and return.
    //     status/deletedAt gating is enforced by callers via isUsable().
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
      include: userAuthInclude,
    });
  } else {
    // (2) No oid match. If the token email already belongs to an existing account,
    //     this is a COLLISION — refuse. Do NOT link, claim, or duplicate. Linking a
    //     pre-existing account to an AAD identity must be a deliberate admin action.
    //     (User.email is @unique, so this check must run before any create.)
    if (normalizedEmail) {
      const collision = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
      if (collision) throw new AccountLinkRequiredError(normalizedEmail);
    }

    // (3) No oid match and no email collision — create a FRESH user keyed on oid + tid.
    const role = await prisma.role.findUniqueOrThrow({ where: { name: DEFAULT_ROLE } });
    try {
      user = await prisma.user.create({
        data: {
          aadObjectId: oid,
          aadTenantId: tid ?? undefined,
          // Guarantee a unique, non-null email even if the token omitted one.
          email: normalizedEmail ?? `${oid}@aad.local`,
          name: name ?? null,
          authProvider: 'aad',
          emailVerified: true,
          status: 'ACTIVE',
          isActive: true,
          lastLoginAt: new Date(),
          lastSeenAt: new Date(),
          roles: { create: { roleId: role.id } },
        },
        include: userAuthInclude,
      });
    } catch (e) {
      // Race: a row with this unique email appeared between the collision check and
      // the create. Treat it as a collision, never a 500.
      if ((e as { code?: string }).code === 'P2002' && normalizedEmail) {
        throw new AccountLinkRequiredError(normalizedEmail);
      }
      throw e;
    }

    await writeAudit({
      actorId: null, // self-provisioned via SSO; no acting admin
      action: 'user.provisioned',
      entityType: 'user',
      entityId: user.id,
      after: { email: user.email, aadObjectId: oid, aadTenantId: tid ?? null, role: DEFAULT_ROLE },
    });
  }

  // Reconcile the platform_admin role against AAD admin-group membership (authoritative,
  // admin-only). Pass the raw claim through — syncPlatformAdminFromGroups owns the three-way
  // / UNKNOWN decision, so the safety guard lives in exactly one place.
  user = await syncPlatformAdminFromGroups(user, groups);

  return user;
}

/**
 * Reconcile the `platform_admin` RBAC role to match AAD admin-group membership.
 * AUTHORITATIVE and bidirectional, but it ONLY ever touches the `platform_admin`
 * role — never member/admin/readonly or any manually granted non-platform_admin role.
 *
 * Three-way decision on the token's `groups` claim:
 *   • PRESENT & contains an admin group id       → ensure platform_admin role (grant if missing)
 *   • PRESENT & non-empty & admin id NOT present  → revoke platform_admin role if held
 *   • MISSING / empty / undefined                 → UNKNOWN: make NO change
 *
 * The UNKNOWN rule is the safety-critical part. AAD OMITS the groups claim on
 * "overage" (a user in too many groups gets a claim-source pointer instead of the
 * list) and when the app registration isn't configured to emit groups. Revoking on
 * an ABSENT claim would let a single such token strip platform_admin from everyone.
 */
async function syncPlatformAdminFromGroups(user: UserWithAuth, groups: string[] | undefined): Promise<UserWithAuth> {
  const adminGroupIds = (process.env.AZURE_AD_ADMIN_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (adminGroupIds.length === 0) return user; // admin-group mapping not configured

  // UNKNOWN signal: no groups claim to act on. Leave the platform_admin role exactly as-is.
  if (!groups || groups.length === 0) return user;

  const platformAdminRole = await prisma.role.findUnique({ where: { name: 'platform_admin' } });
  if (!platformAdminRole) return user;

  const hasPlatformAdminRole = user.roles.some((ur) => ur.roleId === platformAdminRole.id);
  const inAdminGroup = groups.some((g) => adminGroupIds.includes(g));

  if (inAdminGroup && !hasPlatformAdminRole) {
    // GRANT
    await prisma.userRole.create({ data: { userId: user.id, roleId: platformAdminRole.id } });
    await writeAudit({
      actorId: null, // system / group-sync
      action: 'user.platform_admin.granted',
      entityType: 'user',
      entityId: user.id,
      after: { role: 'platform_admin', source: 'aad-group-sync' },
    });
    return prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userAuthInclude });
  }

  if (!inAdminGroup && hasPlatformAdminRole) {
    // REVOKE — positive signal only (groups present & non-empty, admin group absent).
    await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: platformAdminRole.id } });
    await writeAudit({
      actorId: null, // system / group-sync
      action: 'user.platform_admin.revoked',
      entityType: 'user',
      entityId: user.id,
      before: { role: 'platform_admin', source: 'aad-group-sync' },
    });
    return prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userAuthInclude });
  }

  // Already in the desired state — idempotent no-op, no audit event.
  return user;
}
