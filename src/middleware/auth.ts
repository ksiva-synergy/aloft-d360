/**
 * Request authentication + permission guards for App Router route handlers.
 * This is the Next.js-adapted port of the reference Express `authenticate`
 * middleware. It supports two callers, both funneled through the SINGLE
 * `provisionUserByOid` flow in src/lib/rbac.ts:
 *
 *   1. Cookie sessions — the browser app, authenticated via NextAuth (AzureAD /
 *      credentials). `authenticateSession()` reads the session and loads RBAC.
 *   2. Bearer tokens — service/SPA clients presenting a Microsoft Entra (AAD)
 *      access token. `authenticateBearer()` verifies it against Entra's JWKS.
 *
 * NOTE: this module is NOT the Next.js edge middleware (that stays in
 * src/middleware.ts). It is a server-only helper imported by route handlers.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import {
  provisionUserByOid,
  flattenPermissions,
  resolvePrimaryRole,
  isUsable,
  userAuthInclude,
  AccountLinkRequiredError,
} from '@/lib/rbac';

export interface AuthContext {
  userId: string;
  role: string;
  permissions: Set<string>;
}

// Accept either the reference env names (AAD_*) or the repo's existing NextAuth
// names (AZURE_AD_*) so both worlds keep working.
const TENANT = process.env.AAD_TENANT_ID ?? process.env.AZURE_AD_TENANT_ID;
const AUDIENCE = process.env.AAD_CLIENT_ID ?? process.env.AZURE_AD_CLIENT_ID;

// Entra's signing keys, cached and rotated automatically by jose.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  if (!TENANT) throw new ApiError(500, 'AAD tenant not configured (AAD_TENANT_ID / AZURE_AD_TENANT_ID)');
  jwksCache ??= createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`),
  );
  return jwksCache;
}

/** Validate a Microsoft Entra (AAD) Bearer token and provision on first sight. */
export async function authenticateBearer(req: Request): Promise<AuthContext> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'Missing bearer token');

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), jwks(), {
      audience: AUDIENCE,
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    }));
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const oid = payload.oid as string | undefined;
  if (!oid) throw new ApiError(401, 'Token missing oid claim');

  const user = await provisionUserByOid({
    oid,
    tid: (payload.tid as string) ?? null,
    email: (payload.preferred_username ?? payload.email ?? null) as string | null,
    name: (payload.name as string) ?? null,
    groups: (payload.groups as string[] | undefined) ?? undefined,
  }).catch((e) => {
    // Email collides with an existing account — refuse to auto-link. Return a clean
    // 403 (handled by the route's handle() wrapper), never an unhandled 500.
    if (e instanceof AccountLinkRequiredError || (e as Error)?.name === 'AccountLinkRequiredError') {
      throw new ApiError(403, (e as Error).message, {
        code: 'account_link_required',
        email: (e as AccountLinkRequiredError).email,
      });
    }
    throw e;
  });
  if (!isUsable(user)) throw new ApiError(403, 'Account disabled');

  return { userId: user.id, role: resolvePrimaryRole(user), permissions: flattenPermissions(user) };
}

/** Resolve auth from the NextAuth cookie session, or null if unauthenticated. */
export async function authenticateSession(): Promise<AuthContext | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: userAuthInclude });
  if (!user || !isUsable(user)) return null;

  return { userId: user.id, role: resolvePrimaryRole(user), permissions: flattenPermissions(user) };
}

/** Unified entry point for route handlers: Bearer token if present, else session. */
export async function resolveAuth(req: Request): Promise<AuthContext> {
  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return authenticateBearer(req);

  const ctx = await authenticateSession();
  if (!ctx) throw new ApiError(401, 'Unauthenticated');
  return ctx;
}

/** Throw 403 unless the context carries the required permission key. */
export function requirePermission(ctx: AuthContext, key: string): void {
  if (!ctx.permissions.has(key)) {
    throw new ApiError(403, 'Forbidden', { required: key });
  }
}

/**
 * Throw 403 unless the request is either from the resource owner OR the context
 * carries the given cross-user permission key.
 *
 * Use for endpoints that return/mutate data owned by a specific user — own data is
 * always allowed; cross-user access requires an explicit elevated permission (e.g.
 * session:read:all for platform_admin).
 */
export function requireOwnerOrPermission(ctx: AuthContext, resourceUserId: string | null | undefined, key: string): void {
  if (ctx.userId === resourceUserId) return;
  if (ctx.permissions.has(key)) return;
  throw new ApiError(403, 'Forbidden', { required: key });
}
