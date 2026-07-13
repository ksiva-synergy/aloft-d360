/**
 * session-auth.ts — Phase D1: session-ownership guard for the inspector chat route.
 *
 * The reputation signal is only as trustworthy as the user_id we attribute a run
 * to. `/api/inspector/chat` historically trusted a client-supplied `sessionId`
 * without verifying the caller actually owns that workbench session, so a caller
 * could attribute memory outcomes to someone else's session. This guard closes
 * that hole.
 *
 * Rollout is behind `INSPECTOR_AUTH_ENFORCE` (see guardInspectorChat):
 *   - unset / "false" → OBSERVE: log every request that WOULD be rejected, but
 *     serve it normally. Deploy here first and read the logs.
 *   - "true"          → ENFORCE: 401 unauthenticated, 403 ownership mismatch.
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

/** Look up the owner (`user_id`) of a workbench session, or null if unknown. */
async function resolveSessionOwner(sessionId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string | null }>>`
      SELECT user_id FROM workbench_sessions WHERE id = ${sessionId}::uuid LIMIT 1
    `;
    const uid = rows[0]?.user_id ?? null;
    return uid && uid !== 'anonymous' ? uid : null;
  } catch {
    return null;
  }
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

  const owner = await resolveSessionOwner(sessionId);
  // Unowned / not-yet-persisted session → no victim to protect; allow.
  if (owner === null) {
    return { verdict: { ok: true }, callerId, sessionOwner: null };
  }
  if (owner === principal.userId) {
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
  const enforce = process.env.INSPECTOR_AUTH_ENFORCE === 'true';
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
