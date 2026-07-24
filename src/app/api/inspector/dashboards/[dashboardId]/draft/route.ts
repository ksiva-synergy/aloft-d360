import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import type { WidgetSpec, DashboardVersionLayout } from '@/lib/dashboards/types';
import {
  getUserByEmail,
  getDashboardRole,
  canEditDashboard,
  canViewDashboard,
} from '@/lib/dashboards/permissions';
import { classifyDraftFreshness } from '@/lib/dashboards/draft';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * Per-user MUTABLE draft layer for the dashboard builder (Track B).
 *
 * This is deliberately NOT the version chain (versions are immutable, snapshot-
 * frozen server-side, audited) and NOT `workbench_sessions` (no org_id, no
 * ownership check, no on-unload flush). A draft holds uncommitted edits between
 * the last Save and the next so a mid-edit browser refresh no longer discards
 * work. One row per (dashboard_id, user_id); last-write-wins.
 *
 * DELIBERATE DEVIATIONS from Inspector's persistence (see Phase 0 audit):
 *   1. EXPLICIT org_id — never inherited from process-wide getDefaultOrg alone.
 *   2. Ownership-checked reads/writes (RBAC enforced in the API, not just the UI).
 *   3. The write path is the target of a mandatory flush-on-hide beacon (client).
 *
 * SNAPSHOT INVARIANT: unlike POST …/versions, this route stores `widgets`
 * VERBATIM — it never calls computeMeasureSnapshots / resolveDeferredEntityIds.
 * A draft carries LIVE definition references; re-freezing here would silently
 * defeat drift detection on hydrate.
 */

/** Resolve caller + dashboard + effective role in one place (mirrors the sibling
 *  version routes: 404 unknown dashboard, 401 no User row, role gate by caller). */
async function resolveContext(dashboardId: string) {
  const session = await getServerSession(authOptions);
  const org = await getDefaultOrg();

  const dashboard = await prisma.platform_dashboards.findFirst({
    where: { id: dashboardId, org_id: org.id, deleted_at: null },
  });
  if (!dashboard) {
    return { error: NextResponse.json({ error: 'Dashboard not found' }, { status: 404 }) } as const;
  }

  const userEmail = session?.user?.email ?? null;
  const actor = userEmail ? await getUserByEmail(userEmail) : null;
  if (!actor) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const role = await getDashboardRole(dashboardId, actor.id, dashboard.visibility);
  return { org, dashboard, actor, role } as const;
}

/**
 * GET /api/inspector/dashboards/[dashboardId]/draft
 *
 * Returns the caller's own draft (if any) plus a freshness classification against
 * the dashboard's current version — the input to the hydrate banner:
 *   - 'none'  → no draft; builder hydrates the current version as today.
 *   - 'fresh' → draft.base_version_id == current_version_id → "Unsaved changes
 *     restored · Discard" (non-destructive).
 *   - 'stale' → a newer version was saved since the draft forked → "Dashboard
 *     changed since your draft — Keep draft / Discard / View diff".
 *
 * Read-side authz: any role that can view may read its own draft (403 otherwise).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { dashboardId } = await params;
    const ctx = await resolveContext(dashboardId);
    if ('error' in ctx) return ctx.error;
    const { dashboard, actor, role } = ctx;

    if (!canViewDashboard(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const draft = await prisma.platform_dashboard_drafts.findUnique({
      where: { dashboard_id_user_id: { dashboard_id: dashboardId, user_id: actor.id } },
    });

    const currentVersionId = dashboard.current_version_id;
    const status = classifyDraftFreshness(!!draft, draft?.base_version_id ?? null, currentVersionId);

    if (!draft || status === 'none') {
      return NextResponse.json({ status: 'none', currentVersionId });
    }

    return NextResponse.json({
      status,
      currentVersionId,
      draft: {
        widgets: draft.widgets,
        layouts: draft.layouts,
        guidedSession: draft.guided_session,
        baseVersionId: draft.base_version_id,
        updatedAt: draft.updated_at,
      },
    });
  } catch (err) {
    console.error('[dashboards/draft GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/inspector/dashboards/[dashboardId]/draft
 *
 * Upsert the caller's draft (debounced autosave AND the flush-on-hide beacon —
 * sendBeacon is POST-only, so the autosave write lives here rather than on PUT).
 * Last-write-wins per (dashboard_id, user_id). No execution, no version bump, no
 * audit row — a draft is scratch state, not a committed change.
 *
 * Body: { widgets: WidgetSpec[], layouts?: DashboardVersionLayout,
 *         guidedSession?: unknown, baseVersionId?: string | null }
 *
 * baseVersionId records the version the client forked from (its loaded
 * currentVersionId); it defaults to the dashboard's current version. It is NOT
 * used to gate the write — a stale base is expected and is exactly what the GET
 * 'stale' path later surfaces.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { dashboardId } = await params;
    const ctx = await resolveContext(dashboardId);
    if ('error' in ctx) return ctx.error;
    const { org, dashboard, actor, role } = ctx;

    // Write gate: only editors/owners may autosave (mirrors POST …/versions).
    if (!canEditDashboard(role)) {
      return NextResponse.json({ error: 'Insufficient permissions to draft this dashboard' }, { status: 403 });
    }

    const body = (await request.json()) as {
      widgets?: WidgetSpec[];
      layouts?: DashboardVersionLayout;
      guidedSession?: unknown;
      baseVersionId?: string | null;
    };

    if (!Array.isArray(body.widgets)) {
      return NextResponse.json({ error: 'widgets must be an array' }, { status: 400 });
    }

    const baseVersionId =
      body.baseVersionId !== undefined ? body.baseVersionId : dashboard.current_version_id;
    const layouts = (body.layouts ?? { columns: 12, rows: [] }) as object;

    // Store VERBATIM — no snapshot re-freeze (see SNAPSHOT INVARIANT above).
    const widgets = body.widgets as unknown as object[];
    const guidedSession = (body.guidedSession ?? null) as object | null;

    await prisma.platform_dashboard_drafts.upsert({
      where: { dashboard_id_user_id: { dashboard_id: dashboardId, user_id: actor.id } },
      create: {
        id: createId(),
        dashboard_id: dashboardId,
        user_id: actor.id,
        org_id: org.id, // EXPLICIT — Track B does not inherit the no-org design.
        base_version_id: baseVersionId,
        widgets,
        layouts,
        guided_session: guidedSession ?? undefined,
      },
      update: {
        base_version_id: baseVersionId,
        widgets,
        layouts,
        guided_session: guidedSession ?? undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dashboards/draft POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/inspector/dashboards/[dashboardId]/draft
 *
 * Discard the caller's draft. Used by (a) the "Discard" banner action and
 * (b) B4's clear-on-save so the "restored" banner doesn't reappear against
 * freshly committed work. Idempotent.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { dashboardId } = await params;
    const ctx = await resolveContext(dashboardId);
    if ('error' in ctx) return ctx.error;
    const { actor, role } = ctx;

    if (!canEditDashboard(role)) {
      return NextResponse.json({ error: 'Insufficient permissions to discard this draft' }, { status: 403 });
    }

    await prisma.platform_dashboard_drafts.deleteMany({
      where: { dashboard_id: dashboardId, user_id: actor.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dashboards/draft DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
