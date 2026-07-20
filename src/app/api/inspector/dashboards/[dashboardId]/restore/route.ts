import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import {
  getUserByEmail,
  getDashboardRole,
  canEditDashboard,
} from '@/lib/dashboards/permissions';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * POST /api/inspector/dashboards/[dashboardId]/restore
 *
 * Restores a previous version by updating the dashboard's current_version_id
 * pointer. This is an O(1) pointer swap — no rows are copied or created.
 *
 * Per the D1 design: every version is an immutable snapshot. Restore is simply
 * directing the current pointer at a historical snapshot. The full version
 * history remains intact. A D3 re-save after restore will create a new version
 * row forked from the restored content.
 *
 * Body: { versionId: string }
 *
 * SEC-1: requires an authenticated user with an owner/editor role on this
 * dashboard. SEC-2: the audit actor is derived from the session, never from
 * the request body.
 */
export async function POST(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;
    const body = await request.json() as { versionId: string };

    if (!body.versionId) {
      return NextResponse.json({ error: 'versionId is required' }, { status: 400 });
    }

    // ── Confirm dashboard exists and is not deleted ───────────────────────────
    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // ── SEC-1: auth + role gate (owner/editor only) ───────────────────────────
    const userEmail = session?.user?.email ?? null;
    const actor = userEmail ? await getUserByEmail(userEmail) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actorRole = await getDashboardRole(dashboardId, actor.id, dashboard.visibility);
    if (!canEditDashboard(actorRole)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to restore this dashboard' },
        { status: 403 },
      );
    }

    // ── Confirm the target version belongs to this dashboard ─────────────────
    const targetVersion = await prisma.platform_dashboard_versions.findFirst({
      where: { id: body.versionId, dashboard_id: dashboardId },
    });
    if (!targetVersion) {
      return NextResponse.json({ error: 'Version not found on this dashboard' }, { status: 404 });
    }

    // ── Pointer swap ──────────────────────────────────────────────────────────
    await prisma.platform_dashboards.update({
      where: { id: dashboardId },
      data: {
        current_version_id: body.versionId,
        updated_at: new Date(),
      },
    });

    // ── Audit ─────────────────────────────────────────────────────────────────
    await prisma.platform_dashboard_audit.create({
      data: {
        id: createId(),
        org_id: org.id,
        dashboard_id: dashboardId,
        action: 'restore_version',
        version_id: body.versionId,
        actor: actor.email,
      },
    });

    return NextResponse.json({
      ok: true,
      restoredVersionId: body.versionId,
      versionNumber: targetVersion.version_number,
    });
  } catch (err) {
    console.error('[dashboards/restore POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
