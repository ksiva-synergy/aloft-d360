// ============================================================================
// 03-versions-route.ts
// SEC-1: gate save with canEditDashboard. SEC-2: derive actor from session.
//
// Maps to: src/app/api/inspector/dashboards/[id]/versions/route.ts
//
// This is a full reference implementation of the POST handler, written to
// mirror the exact pattern the memory doc says already works in
// share/route.ts:
//   getServerSession → getUserByEmail → getDashboardRole → predicate → 401/403
//
// ASSUMPTIONS marked inline. The GET handler (version history) is untouched
// here — memory doc doesn't flag it as missing a role check, and it's a
// read most roles should have anyway (canViewDashboard), but double check
// against your real file.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getDashboardRole,
  canEditDashboard,
} from "@/lib/dashboards/permissions"; // per memory doc file map
import {
  resolveAuditActor,
  UnauthenticatedError,
  UnknownUserError,
} from "@/lib/dashboards/audit";
import { computeMeasureSnapshots } from "@/lib/dashboards/governance"; // per memory doc file map
import { validateWidgetReferences } from "@/lib/dashboards/governance";
import { prisma } from "@/lib/prisma"; // ASSUMPTION: your Prisma client singleton

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const dashboardId = params.id;

  // --- SEC-1: auth + role gate (the actual fix) ---------------------------
  let actor: { userId: string; email: string };
  try {
    actor = await resolveAuditActor();
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof UnknownUserError) {
      // Both cases → 401. Middleware already blocks fully unauthenticated
      // requests, so UnauthenticatedError here would only fire if this
      // route were ever called without going through middleware (e.g. a
      // test harness) — keep it as a defensive 401 anyway.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const role = await getDashboardRole(dashboardId, actor.userId);
  // ASSUMPTION: getDashboardRole returns one of
  // 'owner' | 'editor' | 'viewer' | 'org_member' | null (null if no access
  // at all — e.g. a private dashboard the user isn't a collaborator on).
  if (!role) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
    // 404 rather than 403 for "no access at all" avoids leaking existence
    // of private dashboards — adjust if your existing routes use 403 here
    // for consistency; match whatever share/route.ts does.
  }

  if (!canEditDashboard(role)) {
    return NextResponse.json(
      { error: "Forbidden: editor or owner role required to save" },
      { status: 403 }
    );
  }

  // --- existing save logic (unchanged shape, actor now trusted) ----------
  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
  });

  if (!dashboard || dashboard.deleted_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const widgets = body.widgets; // ASSUMPTION: request shape — adjust to match yours
  const layouts = body.layouts;

  // Cross-model guard — unchanged, already correct per memory doc §1.4 step 2.
  const referenceError = await validateWidgetReferences(widgets, dashboard.model_id);
  if (referenceError) {
    return NextResponse.json({ error: referenceError }, { status: 400 });
  }

  // Re-freeze snapshots server-side from current definitions — unchanged,
  // already correct per memory doc §1.4 step 3 / §8 invariant.
  const widgetsWithSnapshots = await computeMeasureSnapshots(widgets);

  const result = await prisma.$transaction(async (tx) => {
    const maxVersion = await tx.platform_dashboard_versions.aggregate({
      where: { dashboard_id: dashboardId },
      _max: { version_number: true },
    });
    const nextVersionNumber = (maxVersion._max.version_number ?? 0) + 1;

    const version = await tx.platform_dashboard_versions.create({
      data: {
        dashboard_id: dashboardId,
        version_number: nextVersionNumber,
        widgets: widgetsWithSnapshots,
        layouts,
      },
    });

    await tx.platform_dashboards.update({
      where: { id: dashboardId },
      data: { current_version_id: version.id },
    });

    // --- SEC-2: actor comes from resolveAuditActor(), never body.actor ----
    await tx.platform_dashboard_audit.create({
      data: {
        dashboard_id: dashboardId,
        action: "save_version",
        actor: actor.email, // NOT body.createdBy / body.actor
        actor_user_id: actor.userId,
        version_id: version.id,
      },
    });

    return version;
  });

  return NextResponse.json({ version: result });
}

// ----------------------------------------------------------------------------
// Diff summary if you're patching an existing file instead of replacing it:
//
//   + import { getDashboardRole, canEditDashboard } from "@/lib/dashboards/permissions";
//   + import { resolveAuditActor, UnauthenticatedError, UnknownUserError } from "@/lib/dashboards/audit";
//   + const actor = await resolveAuditActor();          // was: no session read at all
//   + const role = await getDashboardRole(dashboardId, actor.userId);
//   + if (!canEditDashboard(role)) return 403;
//   - const actor = body.createdBy ?? body.actor ?? 'system';   // DELETE this line
//   + actor: actor.email                                  // in the audit row create()
// ----------------------------------------------------------------------------
