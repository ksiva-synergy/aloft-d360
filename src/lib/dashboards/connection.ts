/**
 * src/lib/dashboards/connection.ts
 *
 * DEC-1: per-dashboard connection binding.
 *
 * `platform_dashboards.connection_id` is the authoritative Databricks
 * connection for every widget on a dashboard (migration
 * 20260715_dashboard_connection_binding — String, NOT NULL, backfilled to the
 * org default). This module is the single loader that resolves a dashboard
 * into the context needed to execute its widgets: model, connection, and the
 * current version pointer.
 *
 * It replaces the old tool_catalog → slug → config.connection_id indirection
 * for the dashboard execution path. All access is org-scoped via
 * getDefaultOrg() and honours the soft-delete flag, matching every other
 * dashboard route (see [dashboardId]/route.ts, versions/route.ts).
 */

import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/platform/agents';

/**
 * Thrown when a dashboard resolves but has no bound Databricks connection
 * (issue #2). DEC-1 made `platform_dashboards.connection_id` NOT NULL and
 * backfilled it, so this is DEFENSIVE-ONLY today — it cannot arise from
 * `loadDashboardForExecution` on current data. It exists so the execution
 * caller can map an unbound connection to a typed WidgetDataResult error state
 * ("no bound connection") rather than crashing, and so a future nullable /
 * unbind path has a named boundary instead of a raw throw.
 */
export class DashboardConnectionUnboundError extends Error {
  constructor(public readonly dashboardId: string) {
    super(`Dashboard '${dashboardId}' has no bound Databricks connection.`);
    this.name = 'DashboardConnectionUnboundError';
  }
}

/**
 * Thrown at bind time (issue #3) when a dashboard would bind a model to a
 * connection that differs from the one an existing dashboard already bound for
 * that same model.
 *
 * DEC-1 keeps `connection_id` PER-DASHBOARD, so the schema cannot express "all
 * dashboards on model X share connection Y" — nothing stops two dashboards on
 * one model from pointing at different warehouses and silently disagreeing on
 * the same numbers. `resolveModelConnection` enforces that invariant at the
 * application layer; this typed error is how a genuine divergence surfaces to
 * the caller (a loud reject, never a silent store).
 */
export class DashboardModelConnectionConflictError extends Error {
  constructor(
    public readonly modelId: string,
    public readonly boundConnectionId: string,
    public readonly suppliedConnectionId: string,
  ) {
    super(
      `Model '${modelId}' is already bound to connection '${boundConnectionId}' by ` +
        `an existing dashboard; refusing to bind another dashboard on the same ` +
        `model to a different connection '${suppliedConnectionId}'. All dashboards ` +
        `on one model must share a connection so their numbers agree (DEC-1).`,
    );
    this.name = 'DashboardModelConnectionConflictError';
  }
}

/**
 * Resolve the Databricks connection a dashboard must bind for `modelId`,
 * enforcing the DEC-1 invariant that every dashboard on one model shares one
 * connection (issue #3 — the bind-time guard).
 *
 * The per-dashboard schema permits a reachable violation: two dashboards on the
 * same model with different connections. This is the single choke point both
 * binding paths (create + save) call so the invariant is enforced application-
 * side rather than left to the incidental fact that connection resolution is
 * deterministic today.
 *
 * Rules:
 *  - If a non-deleted dashboard in the org already binds `modelId`, the earliest
 *    such dashboard's connection is CANONICAL. It is returned (inherited). If
 *    `supplied` is given and DIFFERS from it, throw
 *    DashboardModelConnectionConflictError (reject, never silently store).
 *  - If no dashboard yet binds `modelId`, `supplied` stands and becomes the
 *    canonical connection for that model. `supplied` is required in that case —
 *    there is nothing to inherit, so a missing value is a programming error.
 *
 * Org-scoped via getDefaultOrg() and soft-delete-aware, matching every other
 * dashboard access path in this module.
 */
export async function resolveModelConnection(
  modelId: string,
  supplied?: string,
): Promise<string> {
  const org = await getDefaultOrg();

  // Earliest-created dashboard on this model is the canonical connection holder.
  const existing = await prisma.platform_dashboards.findFirst({
    where: { org_id: org.id, model_id: modelId, deleted_at: null },
    orderBy: { created_at: 'asc' },
    select: { connection_id: true },
  });

  if (existing) {
    if (supplied && supplied !== existing.connection_id) {
      throw new DashboardModelConnectionConflictError(
        modelId,
        existing.connection_id,
        supplied,
      );
    }
    return existing.connection_id;
  }

  // First dashboard to bind this model — the supplied/default connection stands.
  if (!supplied) {
    throw new Error(
      `resolveModelConnection: model '${modelId}' has no bound dashboard yet and ` +
        `no connection was supplied to establish the canonical binding.`,
    );
  }
  return supplied;
}

export interface DashboardExecutionContext {
  dashboardId: string;
  /** The resolving org (getDefaultOrg). Carried so callers can org-scope further
   *  lookups (e.g. the guided ephemeral preview's deferred-entity resolution)
   *  without re-importing the server-only getDefaultOrg into node-safe modules. */
  orgId: string;
  /** platform_dashboards.model_id — the ONLY model widgets may execute against. */
  modelId: string;
  /** platform_dashboards.connection_id — the Databricks connection (DEC-1). */
  connectionId: string;
  /** current_version_id — null when the dashboard has never been saved. */
  currentVersionId: string | null;
  /** Needed by getDashboardRole() as its 3rd arg for the visibility fallback. */
  visibility: string;
}

/**
 * Load the execution context for a dashboard, org-scoped and soft-delete-aware.
 * Returns null if the dashboard does not exist in the current org or has been
 * soft-deleted — callers map that to a 404.
 */
export async function loadDashboardForExecution(
  dashboardId: string,
): Promise<DashboardExecutionContext | null> {
  const org = await getDefaultOrg();

  const dashboard = await prisma.platform_dashboards.findFirst({
    where: { id: dashboardId, org_id: org.id, deleted_at: null },
    select: {
      id: true,
      model_id: true,
      connection_id: true,
      current_version_id: true,
      visibility: true,
    },
  });

  if (!dashboard) return null;

  return {
    dashboardId: dashboard.id,
    orgId: org.id,
    modelId: dashboard.model_id,
    connectionId: dashboard.connection_id,
    currentVersionId: dashboard.current_version_id,
    visibility: dashboard.visibility,
  };
}

/**
 * Convenience accessor for just the connection id. Returns null when the
 * dashboard is missing/deleted (same rules as loadDashboardForExecution).
 */
export async function resolveDashboardConnectionId(
  dashboardId: string,
): Promise<string | null> {
  const ctx = await loadDashboardForExecution(dashboardId);
  return ctx?.connectionId ?? null;
}
