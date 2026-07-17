// ============================================================================
// 04-restore-route.ts
// SEC-1: gate restore with canEditDashboard. SEC-2: derive actor from session.
//
// Maps to: src/app/api/inspector/dashboards/[id]/restore/route.ts
//
// Restore is an O(1) current_version_id pointer swap (memory doc §8
// invariant: "Restore is an O(1) current_version_id pointer swap; re-save
// after restore forks a new version"). This patch only adds the auth gate —
// the pointer-swap logic itself is unchanged.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getDashboardRole,
  canEditDashboard,
} from "@/lib/dashboards/permissions";
import {
  resolveAuditActor,
  UnauthenticatedError,
  UnknownUserError,
} from "@/lib/dashboards/audit";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const dashboardId = params.id;

  // --- SEC-1: identical gate to versions/route.ts POST --------------------
  let actor: { userId: string; email: string };
  try {
    actor = await resolveAuditActor();
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof UnknownUserError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const role = await getDashboardRole(dashboardId, actor.userId);
  if (!role) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canEditDashboard(role)) {
    return NextResponse.json(
      { error: "Forbidden: editor or owner role required to restore" },
      { status: 403 }
    );
  }

  // --- existing restore logic --------------------------------------------
  const body = await req.json();
  const targetVersionId = body.versionId; // ASSUMPTION: request shape

  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
  });
  if (!dashboard || dashboard.deleted_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const targetVersion = await prisma.platform_dashboard_versions.findFirst({
    where: { id: targetVersionId, dashboard_id: dashboardId },
  });
  if (!targetVersion) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.platform_dashboards.update({
      where: { id: dashboardId },
      data: { current_version_id: targetVersion.id },
    });

    // --- SEC-2: actor from session, never body ---------------------------
    await tx.platform_dashboard_audit.create({
      data: {
        dashboard_id: dashboardId,
        action: "restore_version",
        actor: actor.email, // NOT body.createdBy / body.actor
        actor_user_id: actor.userId,
        version_id: targetVersion.id,
      },
    });
  });

  return NextResponse.json({ currentVersionId: targetVersion.id });
}

// ----------------------------------------------------------------------------
// Diff summary if patching in place:
//
//   + import { getDashboardRole, canEditDashboard } from "@/lib/dashboards/permissions";
//   + import { resolveAuditActor, ... } from "@/lib/dashboards/audit";
//   + const actor = await resolveAuditActor();
//   + const role = await getDashboardRole(dashboardId, actor.userId);
//   + if (!canEditDashboard(role)) return 403;
//   - actor: body.createdBy ?? body.actor ?? 'system',   // DELETE
//   + actor: actor.email,
// ----------------------------------------------------------------------------
