import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

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
 * Body: { versionId: string, actor?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const org = await getDefaultOrg();
    const { dashboardId } = await params;
    const body = await request.json() as { versionId: string; actor?: string };

    if (!body.versionId) {
      return NextResponse.json({ error: 'versionId is required' }, { status: 400 });
    }

    const actor = body.actor ?? 'system';

    // ── Confirm dashboard exists and is not deleted ───────────────────────────
    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
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
        actor,
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
