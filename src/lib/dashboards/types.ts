/**
 * src/lib/dashboards/types.ts
 *
 * Type definitions for the D1 dashboard persistence schema.
 *
 * WidgetSpec is the canonical shape stored inside
 * platform_dashboard_versions.widgets (JSONB array).
 *
 * Key design decisions (see PHASE_INSP_D1_DECISIONS.md):
 *  - semanticQuery holds live ID references for labels/descriptions
 *  - measureSnapshots freezes computation-relevant fields at save time
 *    so render-time drift detection can surface a "changed" badge
 *  - position is written as a no-op placeholder in D1; D2 populates grid layout
 */

// ── Access control types ───────────────────────────────────────────────────────

/** Who the dashboard is visible to. */
export type DashboardVisibility = 'private' | 'org' | 'shared';

/**
 * A user's effective role on a dashboard.
 * `org_member` is a synthetic role for org-visible dashboards where the user
 * has no explicit collaborator row — they can view but cannot edit or share.
 */
export type DashboardRole = 'owner' | 'editor' | 'viewer' | 'org_member';

export interface DashboardCollaborator {
  id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  granted_by: string;
  created_at: string;
  user?: {
    id: string;
    name: string | null;
    email: string;
  };
}

import type { SemanticQuery } from '@/lib/semantic/types';
import type { ChartSpec } from '@/lib/studio/types';

// ── MeasureSnapshot ───────────────────────────────────────────────────────────
// Frozen at version-save time. Used to detect computation drift at render time.
export interface MeasureSnapshot {
  measureId: string;
  aggregate: string;        // e.g. 'sum', 'avg', 'count'
  expression: string | null;
  metric_type: string;      // e.g. 'simple', 'derived'
}

// ── WidgetSpec ────────────────────────────────────────────────────────────────
export interface WidgetSpec {
  /** Stable identity for this widget across versions. cuid2 assigned at creation. */
  widgetId: string;
  title: string;
  chartKind: ChartSpec['kind']; // 'kpi' | 'bar' | 'line' | 'donut' | 'scatter' | 'heatmap' | 'histogram'
  /** Structured query — references dims/measures BY ID. Labels stay live. */
  semanticQuery: SemanticQuery;
  /**
   * Computation snapshot — frozen at save time.
   * One entry per measure referenced in semanticQuery.measures.
   * At render time: if current measure.aggregate/expression/metric_type differ
   * from snapshot, surface a "Definition changed since last save" badge.
   */
  measureSnapshots: MeasureSnapshot[];
  chartConfig: {
    x?: string;
    y?: string[];
    series?: string;
    value?: string;
    /** User-supplied ECharts overrides only. Empty = auto-infer from chart kind. */
    echartsOption?: object;
  };
  /** Grid placement. D1 uses placeholder values; D2 drag-drop builder populates. */
  position: { col: number; row: number; w: number; h: number };

  /**
   * Provenance back-reference to the platform_charts row this widget was
   * copied from, if any (Phase 0 schema / Phase 2 "Open source chart in
   * Inspector" UI).
   *
   * Non-authoritative: NEVER used to auto-propagate edits — drift is still
   * computed only against live semantic definitions via measureSnapshots.
   * Optional because widgets built directly in the builder have no chat
   * origin, and the source chart may later be deleted (a dangling reference
   * is expected and must be handled as "source unavailable" in the UI — this
   * is not a DB relation).
   */
  source_chart_id?: string;

  /**
   * Freshness policy (scaffolded in Phase 0, wired up in Phase 2's viewer
   * route + result cache). Absence == 'live' (always re-run on load), which
   * is the safe default.
   */
  freshness?: {
    mode: 'live' | 'cached' | 'scheduled';
    /** Required semantics when mode === 'cached'. */
    staleAfterSec?: number;
    /** Cron string; required semantics when mode === 'scheduled'. */
    schedule?: string;
  };
}

// ── Widget data (Phase 1 live render path) ─────────────────────────────────────
// Per-widget result returned by GET /api/inspector/dashboards/[dashboardId]/data.
// The batch route executes every widget independently and returns a status-tagged
// result per widget, so one failing widget never takes down the others.
// Shared here so the route, the useDashboardData hook, and the viewer agree on shape.
export type WidgetDataResult =
  | {
      status: 'ok';
      rows: Record<string, unknown>[];
      /** Compiled SQL — surfaced now for the Phase 3 trust spine. */
      sql: string;
      /** IDs of the governed definitions actually referenced (trust spine). */
      definitionsUsed: { dimensions: string[]; measures: string[] };
      /**
       * ISO timestamp of execution — drives the "Last updated" stamp.
       * For a cache hit this is the time the cached result was originally
       * executed, NOT the time of the current request.
       */
      executedAt: string;
      /**
       * True when this result was served from the process-local result cache
       * (widget freshness mode 'cached'). Absent/false means it executed fresh.
       * Drives the viewer's "Cached · Last updated" indicator (Phase 2).
       */
      cached?: boolean;
    }
  | {
      /** The dashboard's model is a candidate/archived — a UX state, not a 500. */
      status: 'model_not_governed';
      message: string;
    }
  | {
      status: 'error';
      message: string;
    };

/** Response body of the widget-data batch route. */
export interface DashboardDataResponse {
  widgets: Record<string, WidgetDataResult>;
}

// ── DashboardVersionLayout ────────────────────────────────────────────────────
export interface WidgetPosition {
  widgetId: string;
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface DashboardVersionLayout {
  columns: number;
  rows: WidgetPosition[];
}
