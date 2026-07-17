// ============================================================================
// 01-widget-data-route.ts
// DATA-1: batch widget-data route — executes all widgets in one request.
//
// Maps to: src/app/api/inspector/dashboards/[id]/data/route.ts (NEW file)
//
// Pre-corrected with conventions verified in Phase 0:
//   - prisma: import prisma from '@/lib/db' (default export)
//   - auth: inline getServerSession(authOptions), not a shared helper
//   - getDashboardRole: THREE args (dashboardId, userId, visibility)
//   - null role → 403 (matching share/route.ts)
//   - org scoping: getDefaultOrg()
//   - connection_id: on platform_dashboards, resolved via
//     loadDashboardForExecution from src/lib/dashboards/connection.ts
//
// ASSUMPTIONS still present (verify against real files):
//   - executeSemanticQuery signature: (query, connectionId) — memory doc §4.1
//     confirms this, but verify the actual import path and whether it returns
//     { rows, sql } or something else (the chat pipeline might wrap it)
//   - the shape of version.widgets — memory doc says JSONB array of WidgetSpec,
//     but verify whether it's stored as `widgets` or under a different key
//   - how the governance-gate error presents — does executeSemanticQuery throw
//     a typed error, or a generic Error with a message to match on?
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth"; // ASSUMPTION: verify path
import prisma from "@/lib/db";
import { getDefaultOrg } from "@/lib/org"; // ASSUMPTION: verify path — used throughout the codebase per Phase 0 findings
import {
  getDashboardRole,
  getUserByEmail,
  canViewDashboard,
} from "@/lib/dashboards/permissions";
import { loadDashboardForExecution } from "@/lib/dashboards/connection";
import { executeSemanticQuery } from "@/lib/semantic/execute";
import type { WidgetSpec, SemanticQuery } from "@/lib/dashboards/types";

// Per-widget result — either success, a known gate, or an error.
// The client renders each widget independently based on its status.
type WidgetDataResult =
  | {
      status: "ok";
      rows: Record<string, unknown>[];
      sql: string;
      // ASSUMPTION: executeSemanticQuery returns the compiled SQL alongside
      // rows. If it doesn't, compileSemanticQuery can be called separately
      // to surface the SQL for the trust spine — it's a pure function.
      definitionsUsed: { dimensions: string[]; measures: string[] };
      executedAt: string; // ISO timestamp
    }
  | {
      status: "model_not_governed";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const dashboardId = params.id;

  // --- Auth (inline, matching share/route.ts) ----------------------------
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Load dashboard + resolve connection (Phase 0's binding) -----------
  // loadDashboardForExecution handles exists/deleted/no-connection checks.
  // ASSUMPTION: loadDashboardForExecution returns the dashboard's visibility
  // field (or you need a separate query for it). getDashboardRole needs it
  // as the 3rd arg. If loadDashboardForExecution doesn't return visibility,
  // either extend it or query it separately here.
  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
    select: {
      id: true,
      model_id: true,
      connection_id: true,
      visibility: true, // ASSUMPTION: field name — needed for getDashboardRole's 3rd arg
      deleted_at: true,
      current_version_id: true,
    },
  });

  if (!dashboard || dashboard.deleted_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!dashboard.connection_id) {
    // Should not happen post-Phase-0 (NOT NULL), but defensive.
    return NextResponse.json(
      { error: "Dashboard has no connection binding" },
      { status: 500 }
    );
  }

  const role = await getDashboardRole(
    dashboardId,
    currentUser.id,
    dashboard.visibility // 3rd arg — verified convention from Phase 0
  );

  if (!role || !canViewDashboard(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- Load current version's widgets ------------------------------------
  if (!dashboard.current_version_id) {
    return NextResponse.json(
      { error: "Dashboard has no saved version" },
      { status: 404 }
    );
  }

  const version = await prisma.platform_dashboard_versions.findUnique({
    where: { id: dashboard.current_version_id },
  });

  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // ASSUMPTION: widgets are stored as a JSONB array on the version row.
  // Verify the actual column name — memory doc says "A dashboard version
  // stores a JSONB array of these [WidgetSpec]" but doesn't name the column.
  const widgets = (version.widgets ?? []) as WidgetSpec[];

  if (widgets.length === 0) {
    return NextResponse.json({ widgets: {} });
  }

  // --- Execute each widget's query in parallel ---------------------------
  const results: Record<string, WidgetDataResult> = {};

  await Promise.all(
    widgets.map(async (widget) => {
      try {
        // Clone the query to avoid mutating the stored spec
        const query: SemanticQuery = {
          ...widget.semanticQuery,
          // DEFENSIVE PIN (memory §4.6): force modelId to the dashboard's
          // model, never trust the stored value. validateWidgetReferences
          // guards entity ownership at save but does NOT assert
          // semanticQuery.modelId === dashboard.model_id.
          modelId: dashboard.model_id,
        };

        // executeSemanticQuery is the reusable engine (memory §4.1-4.2).
        // It's a plain server function: loads model by query.modelId,
        // validates governed status, compiles, executes via the Databricks
        // chokepoint. We are adding a new caller, not modifying it.
        //
        // ASSUMPTION: returns { rows: Record<string, unknown>[], sql: string }
        // or similar. Verify the actual return shape — the chat pipeline
        // may wrap this differently than what the raw function returns.
        const result = await executeSemanticQuery(
          query,
          dashboard.connection_id
        );

        // Extract which definitions were used (for the trust spine).
        // ASSUMPTION: semanticQuery has .dimensions[] and .measures[] as
        // arrays of IDs. Verify against the real SemanticQuery type.
        results[widget.id] = {
          status: "ok",
          rows: result.rows,
          sql: result.sql,
          definitionsUsed: {
            dimensions: query.dimensions ?? [],
            measures: query.measures ?? [],
          },
          executedAt: new Date().toISOString(),
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown execution error";

        // Governance gate: executeSemanticQuery throws unless the model
        // is 'governed'. Surface this as a typed status, not a 500.
        // ASSUMPTION: the error message or type is matchable. Verify how
        // executeSemanticQuery actually signals this — it might throw a
        // specific error class, or include 'governed' in the message.
        if (
          message.toLowerCase().includes("governed") ||
          message.toLowerCase().includes("candidate")
        ) {
          results[widget.id] = {
            status: "model_not_governed",
            message:
              "This dashboard's model is still a candidate — publish it to see live data.",
          };
        } else {
          results[widget.id] = {
            status: "error",
            message,
          };
        }
      }
    })
  );

  return NextResponse.json({ widgets: results });
}

// ============================================================================
// DIFF SUMMARY — this is a new file, no existing file to diff against.
//
// Files consumed (read, not modified):
//   - src/lib/dashboards/connection.ts (Phase 0 output — loadDashboardForExecution)
//   - src/lib/semantic/execute.ts (executeSemanticQuery — reusable engine, unchanged)
//   - src/lib/dashboards/permissions.ts (getDashboardRole, canViewDashboard)
//   - src/lib/dashboards/types.ts (WidgetSpec, SemanticQuery)
//
// Verify before shipping:
//   1. The actual return shape of executeSemanticQuery — does it return
//      { rows, sql } directly, or is it wrapped?
//   2. The actual column name for widgets on the version row.
//   3. How the governance-gate error presents (error class? message string?).
//   4. Whether SemanticQuery has .dimensions/.measures as ID arrays.
//   5. Whether loadDashboardForExecution already returns visibility, or
//      whether you need the separate prisma query shown above.
// ============================================================================
