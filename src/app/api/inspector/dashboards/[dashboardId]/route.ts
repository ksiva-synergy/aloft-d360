import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { getUserByEmail, getDashboardRole, canDeleteDashboard, canViewDashboard } from '@/lib/dashboards/permissions';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * GET /api/inspector/dashboards/[dashboardId]
 * Returns the dashboard, its current version, collaborators list, and the
 * requesting user's effective role.
 *
 * DELETE /api/inspector/dashboards/[dashboardId]
 * Soft-deletes the dashboard. Requires owner role.
 * SEC-3: a valid session token that resolves to no User row is rejected with
 * 401 rather than falling through and deleting. SEC-2: the audit actor is
 * derived from the session, never from the request body.
 */

export async function GET(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // ── SEC-4: read-side authz gate (any role may view) ───────────────────────
    // This response includes the collaborator list and version pointer — an
    // authenticated user with no role on this dashboard must not read it. Gate
    // BEFORE the currentVersion/collaborators fetches; reuse myRole for the
    // response so no second getDashboardRole call is needed.
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const myRole = await getDashboardRole(dashboardId, currentUser.id, dashboard.visibility);
    if (!canViewDashboard(myRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let currentVersion: Awaited<ReturnType<typeof prisma.platform_dashboard_versions.findUnique>> | null = null;
    if (dashboard.current_version_id) {
      currentVersion = await prisma.platform_dashboard_versions.findUnique({
        where: { id: dashboard.current_version_id },
      });
    }

    // Collaborators with user details
    const collaborators = await prisma.platform_dashboard_collaborators.findMany({
      where: { dashboard_id: dashboardId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({ dashboard, currentVersion, collaborators, myRole });
  } catch (err) {
    console.error('[dashboards/[dashboardId] GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // Check delete permission — only owners can delete.
    // SEC-3: reject a valid token that resolves to no User row (e.g. a user
    // deleted after their token was issued) with 401 instead of skipping the
    // role check and deleting anyway.
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const role = await getDashboardRole(dashboardId, currentUser.id, dashboard.visibility);
    if (!canDeleteDashboard(role)) {
      return NextResponse.json({ error: 'Only the owner can delete this dashboard' }, { status: 403 });
    }

    const actor = currentUser.email;
    const now = new Date();

    await prisma.platform_dashboards.update({
      where: { id: dashboardId },
      data: { deleted_at: now, updated_at: now },
    });

    await prisma.platform_dashboard_audit.create({
      data: {
        id: createId(),
        org_id: org.id,
        dashboard_id: dashboardId,
        action: 'delete',
        version_id: null,
        actor,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dashboards/[dashboardId] DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
