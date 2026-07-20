// ============================================================================
// 03-viewer-route.tsx
// DATA-3b: read-only dashboard viewer — the consumption counterpart to
// /builder (edit).
//
// Maps to: src/app/(agent)/inspector/dashboards/[id]/page.tsx (NEW file)
//
// This is a Next.js server component (data fetching) wrapping a client
// component (interactive grid + data loading). The existing /builder route
// at src/app/(agent)/inspector/dashboards/[id]/builder/page.tsx is the
// reference for how the server component loads the dashboard and passes it
// to a client component — mirror that pattern, but render in view mode.
//
// Pre-corrected with Phase 0 conventions.
// ============================================================================

// --- SERVER COMPONENT (page.tsx) ---
// This is a sketch — match the actual pattern in builder/page.tsx.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth"; // ASSUMPTION: verify path
import prisma from "@/lib/db";
import {
  getDashboardRole,
  getUserByEmail,
  canViewDashboard,
} from "@/lib/dashboards/permissions";
import { redirect, notFound } from "next/navigation";
import { DashboardViewer } from "@/components/inspector/dashboard-viewer/DashboardViewer";
// ^ NEW client component — see below

// ASSUMPTION: Next.js App Router page props shape. Verify against builder/page.tsx.
export default async function DashboardViewerPage({
  params,
}: {
  params: { id: string };
}) {
  const dashboardId = params.id;

  // --- Auth + RBAC (same pattern as builder/page.tsx, presumably) ---------
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/login"); // ASSUMPTION: your auth redirect path
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser) {
    redirect("/login");
  }

  const dashboard = await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
    // ASSUMPTION: include shape. Match builder/page.tsx's query — it likely
    // includes the current version, model, collaborators, etc.
    include: {
      current_version: true,
      // ASSUMPTION: relation name — verify in schema.prisma
    },
  });

  if (!dashboard || dashboard.deleted_at) {
    notFound();
  }

  const role = await getDashboardRole(
    dashboardId,
    currentUser.id,
    dashboard.visibility // 3rd arg — Phase 0 verified convention
  );

  // canViewDashboard is the loosest gate — any role (owner, editor, viewer,
  // org_member) can view. Memory doc §1.5, §4.6.
  if (!role || !canViewDashboard(role)) {
    notFound(); // or redirect to /inspector/dashboards with a toast
  }

  // --- Pass to client component ------------------------------------------
  // The client component handles data fetching (via useDashboardData hook),
  // rendering the widget grid, and consumption interactions.
  //
  // ASSUMPTION: you may need to serialize the dashboard/version data into a
  // plain object (no Date objects, no Prisma-specific types) before passing
  // to a client component. Match how builder/page.tsx handles this.
  return (
    <DashboardViewer
      dashboardId={dashboard.id}
      modelId={dashboard.model_id}
      // ASSUMPTION: pass whatever the client component needs for initial
      // render — title, widget specs from the current version, layout, etc.
      // Don't pass the full Prisma object if it has non-serializable fields.
      title={dashboard.title}
      widgets={dashboard.current_version?.widgets ?? []}
      layouts={dashboard.current_version?.layouts}
      role={role}
    />
  );
}

// ============================================================================
// --- CLIENT COMPONENT (DashboardViewer.tsx) ---
// New file: src/components/inspector/dashboard-viewer/DashboardViewer.tsx
//
// This is the consumption surface. It mirrors the builder's grid rendering
// but strips out all editing affordances.
//
// Architectural guidance (not a full implementation — Claude Code should
// build this against the actual builder component structure):
//
// 1. REUSE the same grid component the builder uses (BuilderGrid or its
//    successor) but with isDraggable={false} and isResizable={false}.
//    Don't fork the grid — a forked grid diverges on every future change.
//
// 2. REUSE WidgetPreview (now extended with the mapper from 02) to render
//    each widget. Pass it the rows from useDashboardData.
//
// 3. DO NOT render:
//    - DefinitionPicker (the side panel for adding dims/measures/charts)
//    - Add Widget / Save / version history / drift badges
//    - WidgetConfigPanel (per-widget settings editor)
//    These are edit-mode-only. The viewer is for consumption.
//
// 4. DO render:
//    - Per-widget skeleton while data loads (not a full-page spinner)
//    - Per-widget error state with the error message + retry button
//    - "This model is a candidate" banner if any widget returns
//      status: 'model_not_governed'
//    - "Last updated HH:MM" stamp (from executedAt in the data response)
//    - Dashboard title + model name as a header
//    - An "Edit" button that links to /builder (shown only if
//      canEditDashboard(role) — check against the role prop)
//
// 5. Data fetching:
//    - On mount, call GET /api/inspector/dashboards/{id}/data
//    - useDashboardData hook (see 04-use-dashboard-data.ts) manages the
//      fetch + per-widget state
//    - Each widget renders independently as its data arrives
//
// 6. Future interactions (Phase 4, not Phase 1):
//    - Cross-filtering (click a bar → filter other widgets)
//    - Drill-down (click → expand hierarchy)
//    - Global/local filter bar
//    - Hover crosshair sync across widgets
//    For Phase 1, just render the data. Interactivity comes later.
// ============================================================================

// Rough shape of the client component (for orientation, not drop-in):
/*
"use client";

import { useDashboardData } from "@/hooks/useDashboardData";
import { WidgetPreview } from "@/components/inspector/dashboard-builder/WidgetPreview";
// ASSUMPTION: WidgetPreview is importable and takes the extended signature
// from 02-mapper-guidance.ts (widget, resolvedDefs, rows?)

import type { WidgetSpec } from "@/lib/dashboards/types";

interface DashboardViewerProps {
  dashboardId: string;
  modelId: string;
  title: string;
  widgets: WidgetSpec[];
  layouts: any; // ASSUMPTION: layout type — match builder-store.ts
  role: string;
}

export function DashboardViewer({
  dashboardId,
  modelId,
  title,
  widgets,
  layouts,
  role,
}: DashboardViewerProps) {
  const { data, loading, errors, refetch } = useDashboardData(dashboardId);

  return (
    <div>
      <header>
        <h1>{title}</h1>
        {canEditDashboard(role) && (
          <a href={`/inspector/dashboards/${dashboardId}/builder`}>Edit</a>
        )}
      </header>

      <Grid
        layouts={layouts}
        isDraggable={false}
        isResizable={false}
      >
        {widgets.map((widget) => {
          const widgetData = data?.[widget.id];
          const isLoading = loading && !widgetData;
          const error = errors?.[widget.id];

          if (isLoading) return <WidgetSkeleton key={widget.id} />;
          if (error) return <WidgetError key={widget.id} error={error} onRetry={refetch} />;
          if (widgetData?.status === 'model_not_governed') {
            return <ModelNotGovernedBanner key={widget.id} />;
          }

          return (
            <WidgetPreview
              key={widget.id}
              widget={widget}
              resolvedDefs={...}  // ASSUMPTION: how defs are resolved in builder
              rows={widgetData?.rows}
            />
          );
        })}
      </Grid>
    </div>
  );
}
*/
