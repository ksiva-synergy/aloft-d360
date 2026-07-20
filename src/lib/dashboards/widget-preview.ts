/**
 * src/lib/dashboards/widget-preview.ts
 *
 * Execute-caller core for the guided drill-in per-widget authoring preview
 * (issue #2). Kept out of the route file — free of `next/server` and
 * `next-auth` imports — so the owner-boundary security proof (route.test.ts)
 * runs as pure route logic against a mocked session + mocked
 * executeSemanticQuery, no live creds and no HTTP layer required.
 *
 * ── The security shape ───────────────────────────────────────────────────────
 * This is the moment a widget becomes capable of emitting live DRAFT rows, so
 * it is also the moment one user's ungoverned draft could leak into another
 * user's surface. Three rules make it provably non-leaking:
 *
 *  1. OWNER-SCOPED bypass. The authoring bypass (which lets a not-yet-governed
 *     candidate/draft model render live) is handed ONLY to users who can author
 *     this dashboard (canEditDashboard). A pure viewer gets the default
 *     governed-only path — a candidate model is `model_not_governed`, and a
 *     draft definition is simply invisible (excluded server-side).
 *  2. IDENTITY FROM SESSION, never the body (SEC-2). `authoringUserId` is the
 *     authenticated user id, so a caller cannot impersonate a draft's owner to
 *     unlock it.
 *  3. PER-DEFINITION owner boundary. Even an authorized author can only preview
 *     THEIR OWN drafts. A referenced draft owned by someone else makes
 *     executeSemanticQuery throw SemanticDraftAccessError, which we map to a
 *     generic 403 that carries NO rows, NO isDraft, and NO row id — the draft's
 *     very existence never appears in the payload.
 *
 * Governance / connection failures are typed WidgetDataResult states, never a
 * 500 (TIP §9).
 */

import prisma from '@/lib/db';
import {
  getDashboardRole,
  canViewDashboard,
  canEditDashboard,
} from '@/lib/dashboards/permissions';
import { resolveDeferredEntityIds } from '@/lib/dashboards/governance';
import {
  loadDashboardForExecution,
  DashboardConnectionUnboundError,
} from '@/lib/dashboards/connection';
import { executeSemanticQuery, type AuthoringOpts } from '@/lib/semantic/execute';
// Error classes come from the canonical, node-safe errors module (not the
// server-only execute re-export) so instanceof works in unit tests too.
import {
  SemanticModelNotGovernedError,
  SemanticDraftAccessError,
} from '@/lib/semantic/errors';
import { executeRawSql } from '@/lib/dashboards/execute-raw-sql';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import type { WidgetSpec, WidgetDataResult } from '@/lib/dashboards/types';
import type { SemanticQuery } from '@/lib/semantic/types';

/** The identity the caller resolved from the session — id only is enough. */
export interface PreviewActor {
  id: string;
}

/**
 * A typed outcome: the HTTP status plus the body. Only auth/existence failures
 * use non-200 statuses (401/403/404); every governance/connection/execution
 * failure is a 200 with a typed WidgetDataResult so one blocked widget is a UX
 * state, not a crash. The single exception is the owner-boundary 403 (a draft
 * owned by another user) — a real forbidden access with a body that leaks
 * nothing.
 */
export interface WidgetPreviewOutcome {
  status: number;
  body: WidgetDataResult | { error: string };
}

/**
 * Resolve + execute one widget's authoring preview.
 *
 * @param dashboardId  path param
 * @param widgetId     path param
 * @param actor        the authenticated user (null → 401), NEVER from the body
 */
export async function buildWidgetPreview(
  dashboardId: string,
  widgetId: string,
  actor: PreviewActor | null,
): Promise<WidgetPreviewOutcome> {
  // ── Auth: a token that resolves to a real user (matches the batch route) ──
  if (!actor) return { status: 401, body: { error: 'Unauthorized' } };

  // ── Load execution context (org-scoped, soft-delete-aware) ────────────────
  const ctx = await loadDashboardForExecution(dashboardId);
  if (!ctx) return { status: 404, body: { error: 'Dashboard not found' } };

  // ── RBAC: any role may view; edit rights decide the authoring bypass ──────
  const role = await getDashboardRole(dashboardId, actor.id, ctx.visibility);
  if (!canViewDashboard(role)) return { status: 403, body: { error: 'Forbidden' } };

  // ── Resolve the widget from the current version ───────────────────────────
  if (!ctx.currentVersionId) return { status: 404, body: { error: 'Widget not found' } };

  const version = await prisma.platform_dashboard_versions.findUnique({
    where: { id: ctx.currentVersionId },
    select: { widgets: true },
  });
  const widgets = (version?.widgets ?? []) as unknown as WidgetSpec[];
  const widget = widgets.find((w) => w.widgetId === widgetId);
  if (!widget) return { status: 404, body: { error: 'Widget not found' } };

  try {
    // ── Raw-SQL escape hatch: no semantic model, no authoring bypass ────────
    // Must precede any semantic resolution — a raw-SQL widget has no model and
    // would wrongly hit the governance path. enforceReadOnly runs inside
    // executeRawSql (defense in depth).
    if (isRawSqlWidget(widget)) {
      const { rows } = await executeRawSql(widget.rawSql, widget.connectionId);
      return {
        status: 200,
        body: {
          status: 'ok',
          rows,
          sql: widget.rawSql,
          definitionsUsed: { dimensions: [], measures: [] },
          executedAt: new Date().toISOString(),
          isRawSql: true,
        },
      };
    }

    // ── Connection-unbound guard (defensive; connection_id is NOT NULL) ─────
    if (!ctx.connectionId) {
      return {
        status: 200,
        body: { status: 'error', message: 'This dashboard has no bound Databricks connection.' },
      };
    }

    // ── DEFENSIVE PIN — never trust the stored modelId ──────────────────────
    // One dashboard = one model. validateWidgetReferences does not assert
    // semanticQuery.modelId === dashboard.model_id, so force it here.
    const query: SemanticQuery = { ...widget.semanticQuery, modelId: ctx.modelId };

    const definitionsUsed = {
      dimensions: query.dimensions.map((d) => d.dimensionId),
      measures: query.measures.map((m) => m.measureId),
    };

    // ── OWNER-SCOPED authoring bypass ───────────────────────────────────────
    // Only an authoring user (owner/editor) gets the bypass; the identity is
    // the session user (SEC-2), never the request body. A pure viewer gets
    // `undefined` → the default governed-only path.
    const opts: AuthoringOpts | undefined = canEditDashboard(role)
      ? { authoringMode: true, authoringUserId: actor.id }
      : undefined;

    const result = await executeSemanticQuery(query, ctx.connectionId, opts);

    return {
      status: 200,
      body: {
        status: 'ok',
        rows: result.rows,
        sql: result.sql,
        definitionsUsed,
        // Owner-scoped authoring preview of a not-yet-governed definition →
        // the client renders normally AND stamps a "Draft — not governed"
        // badge. Always false on the governed / non-authoring path.
        isDraft: result.isDraft,
        executedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return mapExecutionError(err, widgetId);
  }
}

/**
 * Shared execution-failure mapping for BOTH preview paths (version-backed and
 * ephemeral). Kept in one place so the owner-boundary + typed-state guarantees
 * cannot drift between the two entry points.
 *
 *  - SemanticDraftAccessError → generic 403 (the security centrepiece: NEVER the
 *    message — it names the draft row id — never rows, never isDraft);
 *  - SemanticModelNotGovernedError → 200 model_not_governed (no sql: thrown
 *    pre-compile);
 *  - DashboardConnectionUnboundError → 200 typed error;
 *  - anything else → 200 typed error (never a 500 for the chart area).
 */
function mapExecutionError(err: unknown, label: string): WidgetPreviewOutcome {
  if (err instanceof SemanticDraftAccessError) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  if (err instanceof SemanticModelNotGovernedError) {
    return {
      status: 200,
      body: {
        status: 'model_not_governed',
        message: "This dashboard's model is still a candidate — publish it to see live data.",
      },
    };
  }
  if (err instanceof DashboardConnectionUnboundError) {
    return {
      status: 200,
      body: { status: 'error', message: 'This dashboard has no bound Databricks connection.' },
    };
  }
  const message = err instanceof Error ? err.message : 'Unknown execution error';
  console.error(`[widgets/${label}/data] execution failed:`, err);
  return { status: 200, body: { status: 'error', message } };
}

/**
 * Resolve + execute an EPHEMERAL, in-progress widget preview (guided authoring,
 * decision (b)). Executes a REQUEST-SUPPLIED spec that has NOT been saved and
 * PERSISTS NOTHING — no version, no audit, no dashboard mutation. It exists so a
 * confirmed-but-unsaved guided widget can show a live chart during the drill-in
 * instead of the version-backed path's failsafe 404 (a widget that isn't in any
 * saved version).
 *
 * ── Why this opens no new hole (the guards do not depend on persistence) ─────
 *  1. AUTHORING-ONLY. The dashboard-level boundary is TIGHTER than the
 *     version-backed route: it requires canEditDashboard (not merely canView).
 *     A pure viewer has no in-progress spec to preview and is refused (403) —
 *     they can never drive an arbitrary spec through execution.
 *  2. MODEL IS SERVER-PINNED. `semanticQuery.modelId` is overwritten with the
 *     dashboard's own model_id, so a caller cannot point an ephemeral spec at a
 *     foreign model. entityId is likewise resolved SERVER-SIDE from the grounded
 *     fields (never trusted from the body).
 *  3. IDENTITY FROM SESSION (SEC-2). `authoringUserId` is the authenticated
 *     actor, so the per-definition owner boundary still fires: a referenced
 *     draft the caller does not own → SemanticDraftAccessError → generic 403,
 *     leaking nothing (same mapExecutionError path as the version-backed route).
 *  4. READ-ONLY CHOKEPOINT. Execution stays behind executeSemanticQuery →
 *     executeDatabricksSQL. Raw-SQL is REFUSED here entirely (400): the guided
 *     flow only produces semantic widgets, and a client-supplied rawSql +
 *     connectionId would be an unvalidated foreign-connection surface this
 *     preview deliberately does not accept. A semantic widget's connection is
 *     the dashboard's own (server-side), never client-supplied.
 */
export async function buildEphemeralWidgetPreview(
  dashboardId: string,
  widget: WidgetSpec,
  actor: PreviewActor | null,
): Promise<WidgetPreviewOutcome> {
  if (!actor) return { status: 401, body: { error: 'Unauthorized' } };

  const ctx = await loadDashboardForExecution(dashboardId);
  if (!ctx) return { status: 404, body: { error: 'Dashboard not found' } };

  // Authoring-only: the ephemeral preview executes a client-supplied spec, so it
  // is gated by EDIT rights, not merely view. A non-editor → 403.
  const role = await getDashboardRole(dashboardId, actor.id, ctx.visibility);
  if (!canEditDashboard(role)) return { status: 403, body: { error: 'Forbidden' } };

  // Raw-SQL is out of scope for ephemeral preview (see guard #4). Refuse before
  // any execution — never run a client-supplied rawSql against a client-supplied
  // connection.
  if (isRawSqlWidget(widget)) {
    return { status: 400, body: { error: 'Raw-SQL widgets cannot be previewed ephemerally' } };
  }

  if (!ctx.connectionId) {
    return {
      status: 200,
      body: { status: 'error', message: 'This dashboard has no bound Databricks connection.' },
    };
  }

  try {
    // Server-side entity binding — the guided spec defers entityId to the server
    // (it has no catalog). Resolve it the SAME way save does, so preview and the
    // eventual saved render compile identically.
    const [resolved] = await resolveDeferredEntityIds([widget], ctx.orgId);
    const semantic = resolved as Extract<WidgetSpec, { semanticQuery: SemanticQuery }>;

    // DEFENSIVE PIN — never trust the stored/supplied modelId.
    const query: SemanticQuery = { ...semantic.semanticQuery, modelId: ctx.modelId };

    const definitionsUsed = {
      dimensions: query.dimensions.map((d) => d.dimensionId),
      measures: query.measures.map((m) => m.measureId),
    };

    // Owner-scoped authoring bypass — always on here (canEditDashboard is proven
    // above), identity from the session actor (SEC-2), never the body.
    const opts: AuthoringOpts = { authoringMode: true, authoringUserId: actor.id };

    const result = await executeSemanticQuery(query, ctx.connectionId, opts);

    return {
      status: 200,
      body: {
        status: 'ok',
        rows: result.rows,
        sql: result.sql,
        definitionsUsed,
        isDraft: result.isDraft,
        executedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return mapExecutionError(err, widget.widgetId);
  }
}
