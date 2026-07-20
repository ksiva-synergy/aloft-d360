import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { buildWidgetPreview } from '@/lib/dashboards/widget-preview';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string; widgetId: string }> };

/**
 * GET /api/inspector/dashboards/[dashboardId]/widgets/[widgetId]/data
 *
 * Per-widget authoring-preview data route for the guided drill-in (issue #2).
 *
 * Distinct from the batch `[dashboardId]/data` viewer route: this route hands
 * the OWNER-SCOPED authoring bypass to users who can author the dashboard, so
 * an owner previewing their own draft/candidate model gets live rows +
 * `isDraft: true` while the shared viewer route stays governed-only. The
 * owner boundary (a draft owned by another user → 403, no leak) and all typed
 * governance/connection states live in buildWidgetPreview, which is unit-tested
 * as pure route logic. This wrapper only resolves the session identity — the
 * authoring user id comes from the token, never the request body (SEC-2).
 *
 * Access: canViewDashboard (any role may load data — it's a read). Edit rights
 * gate only whether the authoring bypass applies.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const session = await getServerSession(authOptions);
    const { dashboardId, widgetId } = await params;

    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;

    const { status, body } = await buildWidgetPreview(
      dashboardId,
      widgetId,
      currentUser ? { id: currentUser.id } : null,
    );

    return NextResponse.json(body, { status });
  } catch (err) {
    console.error('[widgets/data GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
