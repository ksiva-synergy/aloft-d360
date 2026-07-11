import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import {
  getUserByEmail,
  getDashboardRole,
  canShareDashboard,
} from '@/lib/dashboards/permissions';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * GET /api/inspector/dashboards/[dashboardId]/collaborators
 * Returns all collaborators for a dashboard with user info.
 *
 * POST /api/inspector/dashboards/[dashboardId]/collaborators
 * Adds or updates a collaborator. Requires owner or editor role.
 * Body: { email: string, role: 'editor' | 'viewer' }
 *
 * DELETE /api/inspector/dashboards/[dashboardId]/collaborators
 * Removes a collaborator. Requires owner or editor role (can't remove owner).
 * Body: { userId: string }
 */

export async function GET(
  _request: NextRequest,
  { params }: Params,
) {
  try {
    const org = await getDefaultOrg();
    const { dashboardId } = await params;

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    const collaborators = await prisma.platform_dashboard_collaborators.findMany({
      where: { dashboard_id: dashboardId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({ collaborators });
  } catch (err) {
    console.error('[collaborators GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;

    const body = await request.json() as {
      email: string;
      role: 'editor' | 'viewer';
    };

    if (!body.email || !body.role) {
      return NextResponse.json({ error: 'email and role are required' }, { status: 400 });
    }
    if (body.role !== 'editor' && body.role !== 'viewer') {
      return NextResponse.json({ error: 'role must be editor or viewer' }, { status: 400 });
    }

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // Permission check
    const userEmail = session?.user?.email ?? null;
    const actor = userEmail ? await getUserByEmail(userEmail) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actorRole = await getDashboardRole(dashboardId, actor.id, dashboard.visibility);
    if (!canShareDashboard(actorRole)) {
      return NextResponse.json({ error: 'Insufficient permissions to share this dashboard' }, { status: 403 });
    }

    // Resolve target user
    const targetUser = await getUserByEmail(body.email);
    if (!targetUser) {
      return NextResponse.json({ error: `No user found with email: ${body.email}` }, { status: 404 });
    }

    // Can't demote the owner
    const existingCollab = await prisma.platform_dashboard_collaborators.findUnique({
      where: { dashboard_id_user_id: { dashboard_id: dashboardId, user_id: targetUser.id } },
    });
    if (existingCollab?.role === 'owner') {
      return NextResponse.json({ error: 'Cannot change the owner role' }, { status: 400 });
    }

    // Upsert collaborator
    const collaborator = await prisma.platform_dashboard_collaborators.upsert({
      where: { dashboard_id_user_id: { dashboard_id: dashboardId, user_id: targetUser.id } },
      create: {
        id: createId(),
        dashboard_id: dashboardId,
        user_id: targetUser.id,
        role: body.role,
        granted_by: actor.id,
      },
      update: {
        role: body.role,
        granted_by: actor.id,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit
    await prisma.platform_dashboard_audit.create({
      data: {
        id: createId(),
        org_id: org.id,
        dashboard_id: dashboardId,
        action: existingCollab ? 'update_collaborator' : 'add_collaborator',
        version_id: null,
        actor: actor.email,
      },
    });

    return NextResponse.json({ collaborator }, { status: 201 });
  } catch (err) {
    console.error('[collaborators POST]', err);
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

    const body = await request.json() as { userId: string };
    if (!body.userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // Permission check
    const userEmail = session?.user?.email ?? null;
    const actor = userEmail ? await getUserByEmail(userEmail) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actorRole = await getDashboardRole(dashboardId, actor.id, dashboard.visibility);
    if (!canShareDashboard(actorRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Can't remove the owner
    const target = await prisma.platform_dashboard_collaborators.findUnique({
      where: { dashboard_id_user_id: { dashboard_id: dashboardId, user_id: body.userId } },
    });
    if (target?.role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 });
    }

    await prisma.platform_dashboard_collaborators.deleteMany({
      where: { dashboard_id: dashboardId, user_id: body.userId },
    });

    // Audit
    await prisma.platform_dashboard_audit.create({
      data: {
        id: createId(),
        org_id: org.id,
        dashboard_id: dashboardId,
        action: 'remove_collaborator',
        version_id: null,
        actor: actor.email,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[collaborators DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
