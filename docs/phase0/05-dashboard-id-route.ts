// ============================================================================
// 05-dashboard-id-route.ts
// SEC-3: invert the DELETE guard from `if (currentUser) { ...check... }`
// (which silently skips the owner check when a valid token resolves to no
// User row) to 401-on-no-user, matching share/route.ts's behavior.
//
// Maps to: src/app/api/inspector/dashboards/[id]/route.ts
//
// Memory doc §3.4: "Because middleware guarantees a token, this only
// misfires when a valid token resolves to no User row (getUserByEmail →
// null) — e.g. a user deleted after their token was issued. In that narrow
// case DELETE skips the check and proceeds." This patch closes that gap.
//
// Only the DELETE handler is shown — GET is unaffected by SEC-3 (memory doc
// doesn't flag GET's role handling as broken; it returns dashboard+version+
// myRole, which is a read gated by canViewDashboard, already presumably
// correct — verify against your real file before assuming no change needed).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { canDeleteDashboard } from "@/lib/dashboards/permissions";
import {
  resolveAuditActor,
  UnauthenticatedError,
  UnknownUserError,
} from "@/lib/dashboards/audit";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const dashboardId = params.id;

  // --- SEC-3: the actual fix ------------------------------------------
  // BEFORE (the bug):
  //
  //   const currentUser = await getUserByEmail(session.user.email);
  //   if (currentUser) {
  //     const role = await getDashboardRole(dashboardId, currentUser.id);
  //     if (!canDeleteDashboard(role)) return 403;
  //   }
  //   // <-- falls through here and deletes anyway if currentUser is null
  //
  // AFTER: resolveAuditActor() throws UnknownUserError when getUserByEmail
  // returns null, and we now return 401 for that instead of silently
  // skipping the check.
  let actor: { userId: string; email: string };
  try {
    actor = await resolveAuditActor();
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof UnknownUserError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const { getDashboardRole } = await import("@/lib/dashboards/permissions");
  const role = await getDashboardRole(dashboardId, actor.userId);
  if (!role) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canDeleteDashboard(role)) {
    return NextResponse.json(
      { error: "Forbidden: owner role required to delete" },
      { status: 403 }
    );
  }

  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
  });
  if (!dashboard || dashboard.deleted_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.platform_dashboards.update({
      where: { id: dashboardId },
      data: { deleted_at: new Date() }, // soft delete, per memory doc §1.4
    });

    await tx.platform_dashboard_audit.create({
      data: {
        dashboard_id: dashboardId,
        action: "delete",
        actor: actor.email,
        actor_user_id: actor.userId,
      },
    });
  });

  return NextResponse.json({ deleted: true });
}

// ----------------------------------------------------------------------------
// Diff summary if patching in place:
//
//   - const currentUser = await getUserByEmail(session.user.email);
//   - if (currentUser) {
//   -   const role = await getDashboardRole(dashboardId, currentUser.id);
//   -   if (!canDeleteDashboard(role)) return NextResponse.json({...}, {status:403});
//   - }
//   + const actor = await resolveAuditActor();   // throws → 401 if no user row
//   + const role = await getDashboardRole(dashboardId, actor.userId);
//   + if (!role) return 404;
//   + if (!canDeleteDashboard(role)) return 403;
// ----------------------------------------------------------------------------
