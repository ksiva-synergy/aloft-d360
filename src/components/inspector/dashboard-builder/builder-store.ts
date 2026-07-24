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
export interface GuidedSession {
  intent: ResolvedIntent | null;
  /** Stage-2 curated blueprint (null until proposed/accepted). Proposals are
   *  grounded server-side; curate ops here mutate ONLY this slice — accepting the
   *  blueprint hands off to Phase 4 and does not build widgets. */
  blueprint: GuidedBlueprint | null;
  /**
   * Stage-3 (Phase 4) per-chart drill-in state, on the SAME shared store (no
   * parallel tree — the Phase-1 commitment). Held here rather than in component
   * state so the guided↔manual round-trip is lossless: which item is open, and
   * which confirmed widget each blueprint item produced.
   *   - `cursor`           → index of the blueprint item currently drilled in.
   *   - `widgetIdByItemId` → ChartBlueprint.id → the WidgetSpec.widgetId it was
   *     confirmed into. Lets re-entry PATCH the same widget (never duplicate) and
   *     lets the drill-in derive "already added" state after a re-mount.
   */
  drillIn: DrillInSession;
}

export interface DrillInSession {
  cursor: number;
  widgetIdByItemId: Record<string, string>;
}

const EMPTY_GUIDED_SESSION: GuidedSession = {
  intent: null,
  blueprint: null,
  drillIn: { cursor: 0, widgetIdByItemId: {} },
};

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
  /** Phase 4: move the drill-in cursor to a blueprint item (jump / skip). */
  setDrillInCursor: (cursor: number) => void;
  /** Phase 4: record that a blueprint item was confirmed into a widget (so
   *  re-entry patches instead of duplicating, and confirmed-state survives a
   *  guided↔manual round-trip). */
  recordDrillInConfirm: (itemId: string, widgetId: string) => void;
  /** Reset guided-session state (e.g. on bail-to-manual or dashboard switch). */
  clearGuidedSession: () => void;
  loadWidgets: (widgets: WidgetSpec[]) => void;
  /**
   * Track B (draft retention): hydrate an uncommitted draft. Unlike `loadWidgets`
   * (which loads a committed version → clean), this restores work that was NEVER
   * saved, so it marks the store DIRTY — the Save button reflects that there are
   * uncommitted changes, and drift is recomputed from the restored live refs on
   * the next definitions pass (no snapshot re-freeze happened at draft time).
   */
  loadDraft: (widgets: WidgetSpec[], guidedSession?: GuidedSession | null) => void;
  addWidget: (chartKind: WidgetSpec['chartKind'], title: string) => string;
  /**
   * Phase 4: append a FULLY-FORMED WidgetSpec (as produced by
   * blueprintToWidgetSpec) into the shared widget list, auto-placed in the grid.
   * Unlike `addWidget` (which mints a blank semantic widget), this takes the
   * caller's exact spec — the drill-in confirm path — and only assigns an open
   * position + selection. No execution, no snapshot compute.
   */
  appendWidgetSpec: (spec: WidgetSpec) => void;
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
    guidedSession: {
      intent: null,
      blueprint: null,
      drillIn: { cursor: 0, widgetIdByItemId: {} },
    },

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

    setDrillInCursor: (cursor) =>
      set((s) => {
        s.guidedSession.drillIn.cursor = cursor;
      }),

    recordDrillInConfirm: (itemId, widgetId) =>
      set((s) => {
        s.guidedSession.drillIn.widgetIdByItemId[itemId] = widgetId;
      }),

    clearGuidedSession: () =>
      set((s) => {
        s.guidedSession = { intent: null, blueprint: null, drillIn: { cursor: 0, widgetIdByItemId: {} } };
      }),

    loadWidgets: (widgets) =>
      set((s) => {
        s.widgets = widgets;
        s.dirty = false;
      }),

    loadDraft: (widgets, guidedSession) =>
      set((s) => {
        s.widgets = widgets;
        if (guidedSession) s.guidedSession = guidedSession;
        // A restored draft is, by definition, uncommitted work — keep it dirty so
        // Save stays enabled and clear-on-save has something to rebase against.
        s.dirty = true;
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

    appendWidgetSpec: (spec) =>
      set((s) => {
        const size = { w: spec.position.w, h: spec.position.h };
        const pos = findOpenPosition(s.widgets, size.w, size.h);
        // Keep the caller's spec verbatim (its semanticQuery IDs, empty
        // measureSnapshots, chartKind, chartConfig) — only assign a real grid
        // slot so guided-appended widgets don't stack on the placeholder origin.
        s.widgets.push({ ...spec, position: { col: pos.col, row: pos.row, ...size } });
        s.selectedWidgetId = spec.widgetId;
        s.dirty = true;
      }),

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
