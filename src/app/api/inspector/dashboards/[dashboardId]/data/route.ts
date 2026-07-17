import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';
import {
  getUserByEmail,
  getDashboardRole,
  canViewDashboard,
} from '@/lib/dashboards/permissions';
import { loadDashboardForExecution } from '@/lib/dashboards/connection';
import { executeSemanticQuery } from '@/lib/semantic/execute';
import { executeRawSql } from '@/lib/dashboards/execute-raw-sql';
import { SemanticModelNotGovernedError } from '@/lib/semantic/errors';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import {
  widgetCacheKey,
  getFreshCached,
  setCached,
} from '@/lib/dashboards/widget-cache';
import type { WidgetSpec, WidgetDataResult } from '@/lib/dashboards/types';
import type { SemanticQuery } from '@/lib/semantic/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ dashboardId: string }> };

/**
 * GET /api/inspector/dashboards/[dashboardId]/data
 *
 * DATA-1 — batch widget-data route. Loads the dashboard once (auth +
 * connection resolution + version lookup), then executes every widget's
 * semantic query and returns a map of widgetId → per-widget result.
 *
 * Batch by design: a dashboard with N widgets shouldn't fire N requests that
 * each repeat the identical auth + dashboard-load + version-lookup overhead.
 * Individual widget failures are per-widget status objects, never a 500 — one
 * broken widget must not blank out the other seven.
 *
 * Access: canViewDashboard — any role (owner/editor/viewer/org_member) may
 * read. This is a read path.
 */
export async function GET(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const session = await getServerSession(authOptions);
    const { dashboardId } = await params;

    // ── Force-refresh param (Phase 2 freshness) ───────────────────────────────
    // ?force=all | true  → bypass the result cache for every cached widget.
    // ?force=<widgetId>  → bypass the cache for that one widget only (per-widget
    //   "Refresh" button in the viewer). Live-mode widgets ignore this entirely
    //   since they never read the cache.
    const forceParam = request.nextUrl.searchParams.get('force');
    const forceAll = forceParam === 'all' || forceParam === 'true';
    const forcedWidgetId = forceParam && !forceAll ? forceParam : null;
    const isForced = (widgetId: string) => forceAll || forcedWidgetId === widgetId;

    // ── Auth: a valid session that resolves to a real User row ────────────────
    // (matches share/route.ts + [dashboardId]/route.ts — a token with no User
    // is rejected with 401 rather than falling through.)
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Load dashboard execution context (org-scoped, soft-delete-aware) ──────
    // Missing / deleted / other-org → 404 (existence isn't secret; the org
    // scope already gates cross-tenant access).
    const ctx = await loadDashboardForExecution(dashboardId);
    if (!ctx) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    // ── RBAC: any role may view ───────────────────────────────────────────────
    const role = await getDashboardRole(dashboardId, currentUser.id, ctx.visibility);
    if (!canViewDashboard(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Load the current version's widgets ────────────────────────────────────
    if (!ctx.currentVersionId) {
      // Never saved → nothing to render, but not an error.
      return NextResponse.json({ widgets: {} });
    }

    const version = await prisma.platform_dashboard_versions.findUnique({
      where: { id: ctx.currentVersionId },
      select: { widgets: true },
    });

    // version.widgets is a JSONB array of WidgetSpec (see versions/route.ts).
    const widgets = (version?.widgets ?? []) as unknown as WidgetSpec[];
    if (widgets.length === 0) {
      return NextResponse.json({ widgets: {} });
    }

    // ── Execute each widget in parallel, isolating failures per-widget ────────
    const entries = await Promise.all(
      widgets.map(async (widget): Promise<[string, WidgetDataResult]> => {
        try {
          // ── Phase 3.5C: raw-SQL escape-hatch branch ──────────────────────────
          // MUST come before any semantic-model resolution — a raw-SQL widget
          // has no model and would wrongly throw SemanticModelNotGovernedError
          // if it fell into the semantic path. It executes its own frozen SQL
          // against its own connection via the guarded executeRawSql helper
          // (enforceReadOnly runs there again as defense in depth).
          if (isRawSqlWidget(widget)) {
            const { rows } = await executeRawSql(widget.rawSql, widget.connectionId);
            return [
              widget.widgetId,
              {
                status: 'ok',
                rows,
                sql: widget.rawSql,
                definitionsUsed: { dimensions: [], measures: [] },
                executedAt: new Date().toISOString(),
                isRawSql: true,
              },
            ];
          }

          // Clone the stored query and PIN the model. validateWidgetReferences
          // guards entity ownership at save time but does NOT assert
          // semanticQuery.modelId === dashboard.model_id, so a stale/mismatched
          // stored modelId could otherwise point a widget at a foreign model.
          // Force it to the dashboard's model at execution time.
          const query: SemanticQuery = {
            ...widget.semanticQuery,
            modelId: ctx.modelId,
          };

          const definitionsUsed = {
            dimensions: query.dimensions.map((d) => d.dimensionId),
            measures: query.measures.map((m) => m.measureId),
          };

          // ── Freshness: 'cached' mode consults the process-local cache ────────
          // Absent freshness or mode 'live' → always fresh (unchanged behavior).
          // mode 'scheduled' is Phase 3 — treat as live for now.
          const freshness = widget.freshness;
          const useCache =
            freshness?.mode === 'cached' &&
            typeof freshness.staleAfterSec === 'number' &&
            freshness.staleAfterSec > 0 &&
            !isForced(widget.widgetId);

          if (useCache) {
            const key = widgetCacheKey(ctx.connectionId, query);
            const hit = getFreshCached(key, freshness!.staleAfterSec!, Date.now());
            if (hit) {
              return [
                widget.widgetId,
                {
                  status: 'ok',
                  rows: hit.rows,
                  sql: hit.sql,
                  definitionsUsed,
                  executedAt: hit.executedAt,
                  cached: true,
                },
              ];
            }
          }

          const result = await executeSemanticQuery(query, ctx.connectionId);

          // Populate/refresh the cache for cached-mode widgets (also on a
          // forced refresh, so the next non-forced read is fresh from now).
          if (freshness?.mode === 'cached' && typeof freshness.staleAfterSec === 'number') {
            const key = widgetCacheKey(ctx.connectionId, query);
            const stored = setCached(key, { rows: result.rows, sql: result.sql }, Date.now());
            return [
              widget.widgetId,
              {
                status: 'ok',
                rows: stored.rows,
                sql: stored.sql,
                definitionsUsed,
                executedAt: stored.executedAt,
                cached: false,
              },
            ];
          }

          return [
            widget.widgetId,
            {
              status: 'ok',
              rows: result.rows,
              sql: result.sql,
              definitionsUsed,
              executedAt: new Date().toISOString(),
            },
          ];
        } catch (err) {
          // Governance gate: only 'governed' models are queryable. This is a
          // UX state (publish the model), not a server error.
          if (err instanceof SemanticModelNotGovernedError) {
            return [
              widget.widgetId,
              {
                status: 'model_not_governed',
                message:
                  "This dashboard's model is still a candidate — publish it to see live data.",
              },
            ];
          }

          const message =
            err instanceof Error ? err.message : 'Unknown execution error';
          console.error(
            `[dashboards/data] widget ${widget.widgetId} execution failed:`,
            err,
          );
          return [widget.widgetId, { status: 'error', message }];
        }
      }),
    );

    const widgetsMap: Record<string, WidgetDataResult> = Object.fromEntries(entries);
    return NextResponse.json({ widgets: widgetsMap });
  } catch (err) {
    console.error('[dashboards/data GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
