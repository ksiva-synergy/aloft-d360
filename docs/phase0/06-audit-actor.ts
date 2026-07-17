// ============================================================================
// 06-audit-actor.ts
// SEC-2: derive audit `actor` from the session everywhere. Removes the
// `body.createdBy` / `body.actor` client-supplied fallback that made the
// audit trail forgeable (memory doc §3.4).
//
// Maps to: src/lib/dashboards/audit.ts (new file, or add to an existing
// audit helper module if you have one).
// ============================================================================

// ASSUMPTION: next-auth v4-style server session helper. Adjust to your
// actual auth setup (next-auth v5 uses a different `auth()` pattern —
// see the alternate snippet at the bottom of this file).
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth"; // ASSUMPTION: your authOptions export path
import { getUserByEmail } from "@/lib/dashboards/permissions"; // per memory doc file map

export class UnauthenticatedError extends Error {
  constructor() {
    super("No valid session");
    this.name = "UnauthenticatedError";
  }
}

export class UnknownUserError extends Error {
  constructor() {
    super("Session resolved to no User row");
    this.name = "UnknownUserError";
  }
}

/**
 * Resolves the acting user's id + email from the request session — never
 * from the request body. Throws distinguishable errors so callers can
 * return the right status code (401 in both cases, but distinct for
 * logging/telemetry).
 *
 * Use this in every route that writes an audit row: save (versions POST),
 * restore, delete, share, collaborators.
 */
export async function resolveAuditActor(): Promise<{
  userId: string;
  email: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new UnauthenticatedError();
  }

  const user = await getUserByEmail(session.user.email);
  if (!user) {
    // A valid token resolved to no User row (e.g. deleted after token issued).
    // This is exactly the SEC-3 edge case — surface it the same way here.
    throw new UnknownUserError();
  }

  return { userId: user.id, email: user.email };
}

/**
 * If a genuine service/system actor is ever needed (e.g. a scheduled job
 * re-running a widget query), do NOT accept an actor string from a request
 * body. Mirror the INSPECTOR_SERVICE_TOKEN pattern already used in
 * guardInspectorChat: a server-side secret checked against a header,
 * resolving to a fixed, non-spoofable service identity.
 */
export async function resolveServiceActor(
  serviceTokenHeader: string | null
): Promise<{ userId: "system"; email: "system" }> {
  // ASSUMPTION: env var name matches the existing INSPECTOR_SERVICE_TOKEN
  // pattern referenced in the memory doc (§3.5, item 2).
  const expected = process.env.INSPECTOR_SERVICE_TOKEN;
  if (!expected || serviceTokenHeader !== expected) {
    throw new UnauthenticatedError();
  }
  return { userId: "system", email: "system" };
}

// ----------------------------------------------------------------------------
// next-auth v5 alternative (if applicable — delete this block if you're on v4):
//
// import { auth } from "@/auth";
//
// export async function resolveAuditActor() {
//   const session = await auth();
//   if (!session?.user?.email) throw new UnauthenticatedError();
//   const user = await getUserByEmail(session.user.email);
//   if (!user) throw new UnknownUserError();
//   return { userId: user.id, email: user.email };
// }
// ----------------------------------------------------------------------------
