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

export interface DashboardExecutionContext {
  dashboardId: string;
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
