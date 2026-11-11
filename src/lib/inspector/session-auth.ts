/**
 * session-auth.ts — Phase D1: session-ownership guard for the inspector chat route.
 *
 * The reputation signal is only as trustworthy as the user_id we attribute a run
 * to. `/api/inspector/chat` historically trusted a client-supplied `sessionId`
 * without verifying the caller actually owns that workbench session, so a caller
 * could attribute memory outcomes to someone else's session. This guard closes
 * that hole.
 *
 * Enforcement is controlled by `INSPECTOR_AUTH_ENFORCE` (see guardInspectorChat):
 *   - unset / "true" → ENFORCE (default): 401 unauthenticated, 403 ownership mismatch.
 *   - "false"        → OBSERVE: emergency opt-out only. Logs every request that
 *     WOULD be rejected, but serves it normally.
 *
 * Non-interactive callers (Boost benchmark runner, Agent Lab admin jobs) get an
 * explicit service-auth path via a shared `INSPECTOR_SERVICE_TOKEN` — NOT the
 * old `x-user-id` header trick, which any client could forge. A valid service
 * token bypasses the per-session ownership check (the job acts on behalf of the
 * platform, not a single user).
 */
import { createHash, timingSafeEqual } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { denyUnlessSectionForApi } from '@/lib/sections/api-guard';
import { flattenPermissions, isUsable, PERMISSIONS, userAuthInclude } from '@/lib/rbac';

async function hasReadAll(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userAuthInclude }).catch(() => null);
  return !!user && isUsable(user) && flattenPermissions(user).has(PERMISSIONS.SESSION_READ_ALL);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(v: string | undefined): v is string {
  return !!v && UUID_RE.test(v);
}

/** Constant-time string compare (hash both sides so lengths never leak). */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type InspectorPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'service'; label: string }
  | null;

/**
 * Resolve the caller: a valid service token wins (non-interactive path); else the
 * NextAuth cookie session; else null (unauthenticated).
 */
export async function resolveInspectorPrincipal(req: Request): Promise<InspectorPrincipal> {
  const serviceToken = process.env.INSPECTOR_SERVICE_TOKEN;
  if (serviceToken) {
    const presented =
      req.headers.get('x-inspector-service-token') ??
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      null;
    if (presented && secretsMatch(presented, serviceToken)) {
      return { kind: 'service', label: 'inspector-service' };
    }
  }

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  return userId ? { kind: 'user', userId } : null;
}

/**
 * Workbench drafts that build an agent. A null surface is a pre-Inspector workbench row.
 * Inspector, Teach, and agent chats (`agent_use`) are not included. A missing surface
 * (`undefined`, from a lookup that did not select it) is not an agent draft.
 */
export function isAgentConstructionSurface(surface: string | null | undefined): boolean {
  return surface === null || surface === 'workbench';
}

type SessionOwner = { userId: string | null; surface: string | null | undefined };

/** Owner and surface of a workbench session. A missing row has no owner. */
async function resolveSession(sessionId: string): Promise<SessionOwner> {
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string | null; surface?: string | null }>>`
      SELECT user_id, surface FROM workbench_sessions WHERE id = ${sessionId}::uuid LIMIT 1
    `;
    const row = rows[0];
    if (!row) return { userId: null, surface: undefined };
    const uid = row.user_id && row.user_id !== 'anonymous' ? row.user_id : null;
    return { userId: uid, surface: row.surface };
  } catch {
    return { userId: null, surface: undefined };
  }
}

async function holdsPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userAuthInclude }).catch(() => null);
  return !!user && isUsable(user) && user.roles.some((r) => r.role.name === 'platform_admin');
}

type Verdict =
  | { ok: true }
  | { ok: false; status: 401 | 403; reason: string };

async function evaluate(principal: InspectorPrincipal, sessionId: string | undefined): Promise<{
  verdict: Verdict;
  callerId: string;
  sessionOwner: string | null;
}> {
  const callerId =
    principal?.kind === 'user' ? principal.userId
    : principal?.kind === 'service' ? 'service'
    : 'anonymous';

  if (!principal) {
    return { verdict: { ok: false, status: 401, reason: 'unauthenticated' }, callerId, sessionOwner: null };
  }
  // Trusted non-interactive caller — acts platform-wide, no per-session ownership.
  if (principal.kind === 'service') {
    return { verdict: { ok: true }, callerId, sessionOwner: null };
  }
  // No verifiable session to own (missing / non-UUID / new client-side id) — an
  // authenticated user is allowed; there is no other user's session to hijack.
  if (!isUUID(sessionId)) {
    return { verdict: { ok: true }, callerId, sessionOwner: null };
  }

  const session = await resolveSession(sessionId);
  const owner = session.userId;
  // Unowned / not-yet-persisted session → no victim to protect; allow.
  if (owner === null) {
    return { verdict: { ok: true }, callerId, sessionOwner: null };
  }
  if (owner === principal.userId) {
    return { verdict: { ok: true }, callerId, sessionOwner: owner };
  }
  // Platform admins may edit and delete every agent draft, including one owned by another
  // platform admin. Other people's Inspector sessions, Teach sessions, and agent chats stay closed.
  if (isAgentConstructionSurface(session.surface) && (await holdsPlatformAdmin(principal.userId))) {
    return { verdict: { ok: true }, callerId, sessionOwner: owner };
  }
  return { verdict: { ok: false, status: 403, reason: 'ownership_mismatch' }, callerId, sessionOwner: owner };
}

/**
 * Guard the inspector chat route. Returns a `Response` to send back ONLY when the
 * request must be blocked (enforce mode + failed check); returns `null` to proceed.
 *
 * In observe mode a failed check is logged with enough context to identify the
 * caller and the true session owner, then the request proceeds normally.
 */
export async function guardInspectorChat(
  req: Request,
  sessionId: string | undefined,
): Promise<Response | null> {
  const sectionDenied = await denyUnlessSectionForApi(req);
  if (sectionDenied) return sectionDenied;

  const enforce = process.env.INSPECTOR_AUTH_ENFORCE !== 'false';
  const principal = await resolveInspectorPrincipal(req);
  const { verdict, callerId, sessionOwner } = await evaluate(principal, sessionId);

  if (verdict.ok) return null;

  console.warn(
    `[inspector-auth] mode=${enforce ? 'enforce' : 'observe'} ` +
      `action=${enforce ? 'reject' : 'would-reject'} route=/api/inspector/chat ` +
      `status=${verdict.status} reason=${verdict.reason} ` +
      `caller=${callerId} sessionOwner=${sessionOwner ?? 'none'} sessionId=${sessionId ?? 'none'}`,
  );

  if (!enforce) return null; // observe: serve normally

  return new Response(JSON.stringify({ error: verdict.reason }), {
    status: verdict.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Guard a session READ that must ALWAYS enforce ownership — regardless of the
 * global `INSPECTOR_AUTH_ENFORCE` flag (which stays a Track-B/observe decision).
 *
 * This is the Teach-retention posture (session-draft-retention plan §2.1,
 * deviation #1): loading someone else's teaching session must 403, never serve.
 * Reusing `guardInspectorChat` here would inherit its observe-mode default and
 * silently serve a stranger's session, which is exactly the hole a persisted
 * hydrate route opens. Ownership evaluation is otherwise identical: unauthenticated
 * → 401, non-owner of a persisted session → 403, unowned/new session → allow.
 *
 * Returns a `Response` ONLY when the request must be blocked; `null` to proceed.
 */
export async function guardSessionRead(
  req: Request,
  sessionId: string | undefined,
  opts: { route?: string; allowReadAll?: boolean } = {},
): Promise<Response | null> {
  const sectionDenied = await denyUnlessSectionForApi(req);
  if (sectionDenied) return sectionDenied;

  const principal = await resolveInspectorPrincipal(req);
  const { verdict, callerId, sessionOwner } = await evaluate(principal, sessionId);

  if (verdict.ok) return null;
  if (opts.allowReadAll && principal?.kind === 'user' && verdict.status === 403 && (await hasReadAll(principal.userId))) {
    return null;
  }

  console.warn(
    `[inspector-auth] mode=enforce action=reject route=${opts.route ?? 'session-read'} ` +
      `status=${verdict.status} reason=${verdict.reason} ` +
      `caller=${callerId} sessionOwner=${sessionOwner ?? 'none'} sessionId=${sessionId ?? 'none'}`,
  );

  return new Response(JSON.stringify({ error: verdict.reason }), {
    status: verdict.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
