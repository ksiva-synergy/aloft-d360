import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import type { WidgetSpec } from '@/lib/dashboards/types';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import type { DashboardVersionLayout } from '@/lib/dashboards/types';
import { enforceReadOnly } from '@/lib/databricks/execute';
import {
  getUserByEmail,
  getDashboardRole,
  canEditDashboard,
  canViewDashboard,
} from '@/lib/dashboards/permissions';
import {
  validateWidgetReferences,
  computeMeasureSnapshots,
} from '@/lib/dashboards/governance';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * POST /api/inspector/dashboards/[dashboardId]/versions
 *
 * Creates a new immutable version snapshot for a dashboard.
 *
 * Steps:
 *  1. Load dashboard (must exist, not deleted)
 *  2. validateWidgetReferences — rejects with 400 if any widget references a
 *     dim/measure from outside this dashboard's model_id (cross-model guard)
 *  3. computeMeasureSnapshots — freezes aggregate/expression/metric_type for
 *     each measure at save time (drift detection at render time)
 *  4. Write version row with version_number = max + 1
 *     NOTE: max+1 has no concurrency lock. The UNIQUE(dashboard_id, version_number)
 *     constraint turns a concurrent-write race into a loud failure rather than
 *     silent data loss. Acceptable for single-editor usage; revisit if D2/D3
 *     ever introduce concurrent editors (needs SELECT FOR UPDATE or optimistic
 *     retry loop).
 *  5. Update parent dashboard's current_version_id
 *  6. Write audit row action='save_version'
 *
 * Body: { widgets: WidgetSpec[], layout?: DashboardVersionLayout, changeSummary?: string }
 *
 * SEC-1: requires an authenticated user with an owner/editor role on this
 * dashboard. SEC-2: the audit/created_by actor is derived from the session,
 * never from the request body.
 */
export async function POST(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;
    const body = await request.json() as {
      widgets: WidgetSpec[];
      layout?: DashboardVersionLayout;
      changeSummary?: string;
    };

    if (!Array.isArray(body.widgets)) {
      return NextResponse.json({ error: 'widgets must be an array' }, { status: 400 });
    }

    // ── 1. Load dashboard ─────────────────────────────────────────────────────
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
        { error: 'Insufficient permissions to save this dashboard' },
        { status: 403 },
      );
    }

    // ── Phase 3.5C: read-only guard for raw-SQL widgets (pin/save chokepoint) ──
    // This route is where a raw-SQL chart becomes a durable dashboard widget
    // (via the pin flow) AND where the builder saves. enforceReadOnly runs here
    // as the belt-and-suspenders check the escape hatch demands — a mutating or
    // malformed statement can never enter a dashboard version.
    for (const w of body.widgets) {
      if (isRawSqlWidget(w)) {
        try {
          enforceReadOnly(w.rawSql);
        } catch (e) {
          return NextResponse.json(
            {
              error: 'Raw-SQL widget rejected',
              details: [
                `Widget "${w.title || w.widgetId}": ${e instanceof Error ? e.message : 'not a read-only statement'}`,
              ],
            },
            { status: 400 },
          );
        }
        if (!w.connectionId) {
          return NextResponse.json(
            { error: 'Raw-SQL widget rejected', details: [`Widget "${w.title || w.widgetId}" has no connection`] },
            { status: 400 },
          );
        }
      }
    }

    // ── 2. Cross-model widget reference validation ────────────────────────────
    const refCheck = await validateWidgetReferences(
      body.widgets,
      dashboard.model_id,
      org.id,
    );
    if (!refCheck.valid) {
      return NextResponse.json(
        { error: 'Cross-model widget references detected', details: refCheck.errors },
        { status: 400 },
      );
    }

    // ── 3. Compute measure snapshots ──────────────────────────────────────────
    // Collect all unique measure IDs across all SEMANTIC widgets. Raw-SQL
    // widgets have no measures and no snapshots — they are passed through
    // untouched (measure_snapshots has no meaning for them).
    const allMeasureIds = Array.from(
      new Set(
        body.widgets.flatMap((w) =>
          isRawSqlWidget(w) ? [] : w.semanticQuery.measures.map((m) => m.measureId),
        ),
      ),
    );
    const snapshots = await computeMeasureSnapshots(allMeasureIds, org.id);
    const snapshotMap = new Map(snapshots.map((s) => [s.measureId, s]));

    // Embed snapshots into each semantic widget; leave raw-SQL widgets as-is.
    const widgetsWithSnapshots: WidgetSpec[] = body.widgets.map((w) =>
      isRawSqlWidget(w)
        ? w
        : {
            ...w,
            measureSnapshots: w.semanticQuery.measures
              .map((m) => snapshotMap.get(m.measureId))
              .filter((s): s is NonNullable<typeof s> => s !== undefined),
          },
    );

    // ── 4. Compute version_number = max + 1 ───────────────────────────────────
    const maxVersion = await prisma.platform_dashboard_versions.aggregate({
      where: { dashboard_id: dashboardId },
      _max: { version_number: true },
    });
    const nextVersionNumber = (maxVersion._max.version_number ?? 0) + 1;

    const versionId = createId();
    const layout = body.layout ?? { columns: 12, rows: [] };

    // ── 5. Write version row ──────────────────────────────────────────────────
    const version = await prisma.platform_dashboard_versions.create({
      data: {
        id: versionId,
        dashboard_id: dashboardId,
        version_number: nextVersionNumber,
        widgets: widgetsWithSnapshots as object[],
        layout: layout as object,
        created_by: actor.email,
        change_summary: body.changeSummary ?? null,
      },
    });

    // ── Update parent's current_version_id ───────────────────────────────────
    await prisma.platform_dashboards.update({
      where: { id: dashboardId },
      data: { current_version_id: versionId, updated_at: new Date() },
    });

    // ── 6. Audit ──────────────────────────────────────────────────────────────
    await prisma.platform_dashboard_audit.create({
      data: {
        id: createId(),
        org_id: org.id,
        dashboard_id: dashboardId,
        action: 'save_version',
        version_id: versionId,
        actor: actor.email,
      },
    });

    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    // Unique constraint violation = concurrent version_number race
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint') &&
      err.message.includes('version_number')
    ) {
      return NextResponse.json(
        { error: 'Concurrent save detected — please retry' },
        { status: 409 },
      );
    }
    console.error('[dashboards/versions POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * GET /api/inspector/dashboards/[dashboardId]/versions
 * Returns all versions for a dashboard (history list), latest first.
 * Optional ?includeWidgets=true to include widget JSONB for diff computation.
 */
export async function GET(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { dashboardId } = await params;
    const includeWidgets = request.nextUrl.searchParams.get('includeWidgets') === 'true';

    const dashboard = await prisma.platform_dashboards.findFirst({
      where: { id: dashboardId, org_id: org.id, deleted_at: null },
    });
    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // ── SEC-4: read-side authz gate (any role may view) ───────────────────────
    // Version history exposes structure + authorship; an authenticated user with
    // no role on this dashboard must not read it. 401 on no-User-row matches the
    // write routes; 403 on no role matches share/route.ts.
    const userEmail = session?.user?.email ?? null;
    const actor = userEmail ? await getUserByEmail(userEmail) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actorRole = await getDashboardRole(dashboardId, actor.id, dashboard.visibility);
    if (!canViewDashboard(actorRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const select: Record<string, boolean> = {
      id: true,
      version_number: true,
      created_by: true,
      created_at: true,
      change_summary: true,
    };
    if (includeWidgets) {
      select.widgets = true;
    }

    const versions = await prisma.platform_dashboard_versions.findMany({
      where: { dashboard_id: dashboardId },
      orderBy: { version_number: 'desc' },
      select,
    });

    return NextResponse.json({ versions, currentVersionId: dashboard.current_version_id });
  } catch (err) {
    console.error('[dashboards/versions GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
