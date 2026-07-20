/**
 * Client-side state store for the dashboard builder.
 * Manages widget list, grid layout, selection state, and save status.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createId } from '@paralleldrive/cuid2';
import type { WidgetSpec, MeasureSnapshot } from '@/lib/dashboards/types';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import type { SemanticQuery } from '@/lib/semantic/types';
import type { ResolvedIntent, GuidedBlueprint, ChartBlueprint } from '@/lib/dashboards/guided-types';

export type DriftStatus = 'ok' | 'changed' | 'unavailable';

export interface WidgetDriftInfo {
  widgetId: string;
  status: DriftStatus;
  changedMeasures?: string[]; // measureIds that drifted
  unavailableIds?: string[];  // dim/measure IDs that can't be resolved
}

export type SaveErrorType = 'validation' | 'conflict' | 'other' | null;

/**
 * Authoring mode — two views over ONE `WidgetSpec[]` dashboard state (guided P1's
 * one architectural commitment), plus read-only view:
 *   - 'guided' → NL-first stage flow (Intent → Blueprint → drill-in);
 *   - 'manual' → the RGL grid + library/config panels;
 *   - 'view'   → read-only grid (viewers).
 * Switching guided↔manual is lossless because both operate on the same `widgets`
 * and the same `guidedSession` on this single store — there is no parallel tree.
 */
export type BuilderMode = 'guided' | 'manual' | 'view';

/**
 * Guided-session slice (Phase 2) — the NL-first flow's non-widget state, held on
 * the SAME shared store as `mode`/`widgets` (no parallel tree). Stage 1 (Intent)
 * writes `intent`; later stages add blueprint / drill-in cursor here.
 */
interface GuidedSession {
  intent: ResolvedIntent | null;
  /** Stage-2 curated blueprint (null until proposed/accepted). Proposals are
   *  grounded server-side; curate ops here mutate ONLY this slice — accepting the
   *  blueprint hands off to Phase 4 and does not build widgets. */
  blueprint: GuidedBlueprint | null;
}

interface BuilderState {
  dashboardId: string;
  modelId: string;
  dashboardName: string;
  widgets: WidgetSpec[];
  selectedWidgetId: string | null;
  driftMap: Record<string, WidgetDriftInfo>;
  saving: boolean;
  saveError: string | null;
  saveErrorType: SaveErrorType;
  dirty: boolean;
  currentVersionId: string | null;
  mode: BuilderMode;
  guidedSession: GuidedSession;

  // Actions
  setDashboard: (id: string, modelId: string, name: string, versionId: string | null) => void;
  /** Switch authoring mode. Lossless — never touches widgets or guidedSession. */
  setMode: (mode: BuilderMode) => void;
  /** Emit / replace the Stage-1 resolved intent (null clears it). */
  setIntent: (intent: ResolvedIntent | null) => void;
  /** Emit / replace the Stage-2 blueprint (null clears it). */
  setBlueprint: (blueprint: GuidedBlueprint | null) => void;
  /** Curate: move an item from one index to another (reorder). No-op if out of range. */
  reorderBlueprintItem: (fromIndex: number, toIndex: number) => void;
  /** Curate: rename an item inline. */
  renameBlueprintItem: (id: string, title: string) => void;
  /** Curate: remove an item. */
  removeBlueprintItem: (id: string) => void;
  /** Curate: "add another" — append a fully-formed (already-grounded) item. */
  addBlueprintItem: (item: ChartBlueprint) => void;
  /** Reset guided-session state (e.g. on bail-to-manual or dashboard switch). */
  clearGuidedSession: () => void;
  loadWidgets: (widgets: WidgetSpec[]) => void;
  addWidget: (chartKind: WidgetSpec['chartKind'], title: string) => string;
  removeWidget: (widgetId: string) => void;
  updateWidget: (widgetId: string, patch: Partial<WidgetSpec>) => void;
  updateWidgetPosition: (widgetId: string, pos: { col: number; row: number; w: number; h: number }) => void;
  updateWidgetSemanticQuery: (widgetId: string, query: SemanticQuery) => void;
  selectWidget: (widgetId: string | null) => void;
  setDriftMap: (map: Record<string, WidgetDriftInfo>) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (err: string | null, errorType?: SaveErrorType) => void;
  markClean: () => void;
}

const DEFAULT_WIDGET_SIZE: Record<string, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 },
  bar: { w: 6, h: 4 },
  line: { w: 6, h: 4 },
  donut: { w: 4, h: 4 },
  scatter: { w: 6, h: 4 },
  heatmap: { w: 6, h: 4 },
  histogram: { w: 6, h: 4 },
};

/**
 * Finds the first open position in a 12-column grid.
 * Scans rows top-down, left-right for a gap that fits { w, h }.
 * Falls-back to appending below the lowest occupied row.
 */
function findOpenPosition(
  widgets: WidgetSpec[],
  w: number,
  h: number,
): { col: number; row: number } {
  if (widgets.length === 0) return { col: 0, row: 0 };

  const maxRow = Math.max(...widgets.map((wg) => wg.position.row + wg.position.h), 0);

  // Build occupancy grid (sparse)
  const occupied = new Set<string>();
  for (const wg of widgets) {
    for (let r = wg.position.row; r < wg.position.row + wg.position.h; r++) {
      for (let c = wg.position.col; c < wg.position.col + wg.position.w; c++) {
        occupied.add(`${r},${c}`);
      }
    }
  }

  // Scan for first position where the widget fits
  for (let row = 0; row <= maxRow + h; row++) {
    for (let col = 0; col <= 12 - w; col++) {
      let fits = true;
      for (let r = row; r < row + h && fits; r++) {
        for (let c = col; c < col + w && fits; c++) {
          if (occupied.has(`${r},${c}`)) fits = false;
        }
      }
      if (fits) return { col, row };
    }
  }

  return { col: 0, row: maxRow };
}

export const useBuilderStore = create<BuilderState>()(
  immer((set) => ({
    dashboardId: '',
    modelId: '',
    dashboardName: '',
    widgets: [],
    selectedWidgetId: null,
    driftMap: {},
    saving: false,
    saveError: null,
    saveErrorType: null,
    dirty: false,
    currentVersionId: null,
    mode: 'manual',
    guidedSession: { intent: null, blueprint: null },

    setDashboard: (id, modelId, name, versionId) =>
      set((s) => {
        s.dashboardId = id;
        s.modelId = modelId;
        s.dashboardName = name;
        s.currentVersionId = versionId;
      }),

    setMode: (mode) =>
      set((s) => {
        s.mode = mode;
      }),

    setIntent: (intent) =>
      set((s) => {
        s.guidedSession.intent = intent;
      }),

    setBlueprint: (blueprint) =>
      set((s) => {
        s.guidedSession.blueprint = blueprint;
      }),

    reorderBlueprintItem: (fromIndex, toIndex) =>
      set((s) => {
        const bp = s.guidedSession.blueprint;
        if (!bp) return;
        const n = bp.items.length;
        if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) return;
        const [moved] = bp.items.splice(fromIndex, 1);
        bp.items.splice(toIndex, 0, moved);
      }),

    renameBlueprintItem: (id, title) =>
      set((s) => {
        const item = s.guidedSession.blueprint?.items.find((i) => i.id === id);
        if (item) item.title = title;
      }),

    removeBlueprintItem: (id) =>
      set((s) => {
        const bp = s.guidedSession.blueprint;
        if (!bp) return;
        bp.items = bp.items.filter((i) => i.id !== id);
      }),

    addBlueprintItem: (item) =>
      set((s) => {
        s.guidedSession.blueprint?.items.push(item);
      }),

    clearGuidedSession: () =>
      set((s) => {
        s.guidedSession = { intent: null, blueprint: null };
      }),

    loadWidgets: (widgets) =>
      set((s) => {
        s.widgets = widgets;
        s.dirty = false;
      }),

    addWidget: (chartKind, title) => {
      const widgetId = createId();
      set((s) => {
        const size = DEFAULT_WIDGET_SIZE[chartKind] ?? { w: 6, h: 4 };
        const pos = findOpenPosition(s.widgets, size.w, size.h);

        const newWidget: WidgetSpec = {
          widgetId,
          title,
          chartKind,
          semanticQuery: {
            modelId: s.modelId,
            entityId: '',
            dimensions: [],
            measures: [],
            filters: [],
            sorts: [],
          },
          measureSnapshots: [] as MeasureSnapshot[],
          chartConfig: {},
          position: { col: pos.col, row: pos.row, ...size },
        };
        s.widgets.push(newWidget);
        s.selectedWidgetId = widgetId;
        s.dirty = true;
      });
      return widgetId;
    },

    removeWidget: (widgetId) =>
      set((s) => {
        s.widgets = s.widgets.filter((w) => w.widgetId !== widgetId);
        if (s.selectedWidgetId === widgetId) s.selectedWidgetId = null;
        s.dirty = true;
      }),

    updateWidget: (widgetId, patch) =>
      set((s) => {
        const idx = s.widgets.findIndex((w) => w.widgetId === widgetId);
        if (idx >= 0) {
          Object.assign(s.widgets[idx], patch);
          s.dirty = true;
        }
      }),

    updateWidgetPosition: (widgetId, pos) =>
      set((s) => {
        const idx = s.widgets.findIndex((w) => w.widgetId === widgetId);
        if (idx >= 0) {
          s.widgets[idx].position = pos;
          s.dirty = true;
        }
      }),

    updateWidgetSemanticQuery: (widgetId, query) =>
      set((s) => {
        const idx = s.widgets.findIndex((w) => w.widgetId === widgetId);
        // Raw-SQL widgets have no semanticQuery — this is a semantic-only action.
        if (idx >= 0 && !isRawSqlWidget(s.widgets[idx])) {
          (s.widgets[idx] as { semanticQuery: SemanticQuery }).semanticQuery = query;
          s.dirty = true;
        }
      }),

    selectWidget: (widgetId) =>
      set((s) => {
        s.selectedWidgetId = widgetId;
      }),

    setDriftMap: (map) =>
      set((s) => {
        s.driftMap = map;
      }),

    setSaving: (saving) =>
      set((s) => {
        s.saving = saving;
      }),

    setSaveError: (err, errorType) =>
      set((s) => {
        s.saveError = err;
        s.saveErrorType = errorType ?? (err ? 'other' : null);
      }),

    markClean: () =>
      set((s) => {
        s.dirty = false;
      }),
  })),
);
