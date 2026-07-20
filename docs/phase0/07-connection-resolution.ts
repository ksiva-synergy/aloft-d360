// ============================================================================
// 07-connection-resolution.ts
// DEC-1 (per-dashboard): resolves the Databricks connectionId a dashboard's
// widgets should execute against. Replaces, for the dashboard code path
// only, the org-agnostic resolveToolCatalogEntry('') fallback described in
// memory doc §4.3.
//
// IMPORTANT: this does NOT change how the Inspector chat resolves its
// connection — chat is not dashboard-scoped, so it keeps using
// resolveToolCatalogEntry('') / the global default for now. Only the
// dashboard/widget-data path (Phase 1) reads through this resolver.
//
// Maps to: src/lib/dashboards/connection.ts (new file)
// ============================================================================

// CORRECTED import: the repo uses a default-exported Prisma singleton.
import prisma from "@/lib/db";
//
// Ready to drop into src/lib/dashboards/connection.ts AFTER
// platform_dashboards.connection_id exists in schema.prisma AND
// `npx prisma generate` has run — until then the `connection_id` selects below
// will not typecheck. It is intentionally NOT yet placed under src/ so the repo
// keeps typechecking clean before the migration lands.
//
// The resolved string is a platform_databricks_connections.id (see
// resolveToolCatalogEntry in src/lib/inspector/tools.ts).

export class DashboardConnectionUnboundError extends Error {
  constructor(dashboardId: string) {
    super(
      `Dashboard ${dashboardId} has no connection_id bound. ` +
        `Run the Phase 0 backfill migration or bind a connection via the dashboard settings UI.`
    );
    this.name = "DashboardConnectionUnboundError";
  }
}

/**
 * Resolves the connectionId for a dashboard's widget execution.
 *
 * Per DEC-1 (per-dashboard binding): reads connection_id directly off
 * platform_dashboards. No model-level fallback exists under this decision —
 * if a dashboard has no connection_id, that's a data problem (unbackfilled
 * row), not something to silently paper over with a global default. Widget
 * execution should surface this as an explicit, typed error state (see
 * Phase 1 §2.1's "governance gate as explicit UX state" pattern — apply the
 * same treatment here).
 */
export async function resolveDashboardConnectionId(
  dashboardId: string
): Promise<string> {
  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
    select: { id: true, connection_id: true, deleted_at: true },
  });

  if (!dashboard || dashboard.deleted_at) {
    // Let the caller's existing "dashboard exists, not deleted" check handle
    // the 404 — this resolver assumes that check already ran. If it hasn't,
    // fail loudly rather than resolving a connection for a dead dashboard.
    throw new Error(`Dashboard ${dashboardId} not found or deleted`);
  }

  if (!dashboard.connection_id) {
    throw new DashboardConnectionUnboundError(dashboardId);
  }

  return dashboard.connection_id;
}

/**
 * Convenience wrapper for the widget-data route (Phase 1 §2.1, step 3):
 * resolve dashboard + connectionId together in one call, since the route
 * needs both the dashboard row (for model_id, to pin query.modelId) and the
 * connection.
 */
export async function loadDashboardForExecution(dashboardId: string) {
  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
    select: {
      id: true,
      model_id: true,
      connection_id: true,
      deleted_at: true,
      current_version_id: true,
    },
  });

  if (!dashboard || dashboard.deleted_at) {
    return null;
  }

  if (!dashboard.connection_id) {
    throw new DashboardConnectionUnboundError(dashboardId);
  }

  return {
    id: dashboard.id,
    modelId: dashboard.model_id,
    connectionId: dashboard.connection_id,
    currentVersionId: dashboard.current_version_id,
  };
}
