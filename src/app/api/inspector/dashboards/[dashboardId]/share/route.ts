import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import {
  getUserByEmail,
  getDashboardRole,
  canShareDashboard,
  coerceVisibility,
} from '@/lib/dashboards/permissions';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * PATCH /api/inspector/dashboards/[dashboardId]/share
 * Updates the visibility of a dashboard.
 * Requires owner or editor role.
 * Body: { visibility: 'private' | 'org' | 'shared' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;

    const body = await request.json() as { visibility?: string };

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    const userEmail = session?.user?.email ?? null;
    const actor = userEmail ? await getUserByEmail(userEmail) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorRole = await getDashboardRole(dashboardId, actor.id, dashboard.visibility);
    if (!canShareDashboard(actorRole)) {
      return NextResponse.json({ error: 'Insufficient permissions to update sharing settings' }, { status: 403 });
    }

    const visibility = coerceVisibility(body.visibility);

    const updated = await prisma.platform_dashboards.update({
      where: { id: dashboardId },
      data: { visibility, updated_at: new Date() },
    });

    return NextResponse.json({ dashboard: updated });
  } catch (err) {
    console.error('[share PATCH]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
