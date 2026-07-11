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
