import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { getUserByEmail, getDashboardRole } from '@/lib/dashboards/permissions';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * GET /api/inspector/dashboards/[dashboardId]
 * Returns the dashboard, its current version, collaborators list, and the
 * requesting user's effective role.
 *
 * DELETE /api/inspector/dashboards/[dashboardId]
 * Soft-deletes the dashboard. Requires owner role.
 * Body: { actor?: string }
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

    // Effective role for the requesting user
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    const myRole = currentUser
      ? await getDashboardRole(dashboardId, currentUser.id, dashboard.visibility)
      : null;

    return NextResponse.json({ dashboard, currentVersion, collaborators, myRole });
  } catch (err) {
    console.error('[dashboards/[dashboardId] GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;
    const body = await request.json().catch(() => ({})) as { actor?: string };

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // Check delete permission — only owners can delete
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (currentUser) {
      const role = await getDashboardRole(dashboardId, currentUser.id, dashboard.visibility);
      if (role !== 'owner') {
        return NextResponse.json({ error: 'Only the owner can delete this dashboard' }, { status: 403 });
      }
    }

    const actor = body.actor ?? currentUser?.email ?? 'system';
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
