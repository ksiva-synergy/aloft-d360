'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Save, History, ArrowLeft, Share2, Eye, Sparkles, LayoutGrid } from 'lucide-react';
import { useBuilderStore } from './builder-store';
import type { WidgetDriftInfo, DriftStatus, GuidedSession } from './builder-store';
import { useDraftAutosave } from './use-draft-autosave';
import { computeVersionDiff, type VersionDiffSummary } from './version-diff';
import { DefinitionPicker } from './DefinitionPicker';
import type { SavedChart } from './DefinitionPicker';
import { BuilderGrid } from './BuilderGrid';
import { EmptyStatePrompts } from '@/components/inspector/EmptyStatePrompts';
import { IntentStage } from './guided/IntentStage';
import { BlueprintStage } from './guided/BlueprintStage';
import { DrillInStage } from './guided/DrillInStage';
import { WidgetConfigPanel } from './WidgetConfigPanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { ShareDialog } from './ShareDialog';
import { dslKindToWidgetKind, encodingsToChartConfig } from './chart-mapping';
import {
  recommendChartKind,
  recommendedKindToWidgetKind,
  type ResolvedDefinitions,
} from '@/lib/dashboards/chart-defaults';
import type { WidgetSpec } from '@/lib/dashboards/types';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import type { DashboardVisibility } from '@/lib/dashboards/types';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

interface PickerEntity {
  id: string;
  entity_label: string;
  full_path: string;
  description: string | null;
  status: string;
  dimensions: Array<{
    id: string;
    column_name: string;
    dimension_label: string;
    dimension_type: string;
    description: string | null;
    format_hint: string | null;
    status: string;
  }>;
  measures: Array<{
    id: string;
    column_name: string | null;
    measure_label: string;
    aggregate: string;
    expression: string | null;
    metric_type: string;
    description: string | null;
    format_hint: string | null;
    unit: string | null;
    status: string;
  }>;
}

type RightPanel = 'config' | 'history';

export function DashboardBuilder({ dashboardId }: { dashboardId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [entities, setEntities] = useState<PickerEntity[]>([]);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [rightPanel, setRightPanel] = useState<RightPanel>('config');
  const [initialLoading, setInitialLoading] = useState(true);
  const [pickerHint, setPickerHint] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<DashboardVisibility>('org');
  const [shareOpen, setShareOpen] = useState(false);
  // Guided-flow cursor: intent captured advances to Blueprint (Stage 2);
  // accepting the blueprint hands off to the Phase-4 drill-in (Stage 3).
  const [intentCaptured, setIntentCaptured] = useState(false);
  const [blueprintAccepted, setBlueprintAccepted] = useState(false);

  // ── Track B: draft-retention state ──────────────────────────────────────────
  // `draftBanner` drives the non-destructive hydrate prompt. Autosave is armed
  // (`autosaveEnabled`) only once the hydrate decision is resolved — never while a
  // 'stale' banner is open, or a blind write would clobber the stale draft.
  const [draftBanner, setDraftBanner] = useState<'fresh' | 'stale' | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [showDraftDiff, setShowDraftDiff] = useState(false);
  // Held for the 'stale' decision: the committed version to revert to on Discard
  // and the user's draft to restore on Keep (+ compute the diff between them).
  const committedWidgetsRef = useRef<WidgetSpec[]>([]);
  const staleDraftRef = useRef<{ widgets: WidgetSpec[]; guidedSession: GuidedSession | null } | null>(null);

  const autosave = useDraftAutosave(dashboardId, autosaveEnabled);
  const guidedIntent = useBuilderStore((s) => s.guidedSession.intent);
  const setBlueprint = useBuilderStore((s) => s.setBlueprint);
  const {
    modelId,
    dashboardName,
    widgets,
    selectedWidgetId,
    saving,
    saveError,
    saveErrorType,
    dirty,
    mode,
    setDashboard,
    setMode,
    loadWidgets,
    loadDraft,
    addWidget,
    selectWidget,
    updateWidget,
    updateWidgetSemanticQuery,
    setDriftMap,
    setSaving,
    setSaveError,
    markClean,
  } = useBuilderStore();

  // ── Load dashboard (+ Track B draft hydrate) ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // Default mode (Phase 1): empty → guided (cold start is where a blank grid is
    // most hostile); existing → manual. Applied to whichever widget set we hydrate.
    const pickMode = (w: WidgetSpec[]): 'guided' | 'manual' => (w.length === 0 ? 'guided' : 'manual');
    (async () => {
      try {
        const res = await fetch(`/api/inspector/dashboards/${dashboardId}`);
        if (!res.ok) throw new Error(`Dashboard load failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        const { dashboard, currentVersion, myRole: role } = data;
        setDashboard(dashboard.id, dashboard.model_id, dashboard.name, dashboard.current_version_id);
        setMyRole(role ?? null);
        setVisibility((dashboard.visibility ?? 'org') as DashboardVisibility);

        const committedWidgets = (currentVersion?.widgets ?? []) as WidgetSpec[];
        committedWidgetsRef.current = committedWidgets;

        // Read-only roles cannot edit → no draft layer; hydrate the committed
        // version and never arm autosave.
        const readOnly = role === 'viewer' || role === 'org_member';
        if (readOnly) {
          loadWidgets(committedWidgets);
          setMode('view');
          return;
        }

        // Editable → reconcile any per-user draft against the current version
        // (Track B, B3). The draft route classifies freshness server-side.
        let draftStatus: 'none' | 'fresh' | 'stale' = 'none';
        let draftPayload: { widgets: WidgetSpec[]; guidedSession: GuidedSession | null } | null = null;
        try {
          const dres = await fetch(`/api/inspector/dashboards/${dashboardId}/draft`);
          if (dres.ok) {
            const d = await dres.json();
            if (d.status === 'fresh' || d.status === 'stale') {
              draftStatus = d.status;
              draftPayload = {
                widgets: (d.draft?.widgets ?? []) as WidgetSpec[],
                guidedSession: (d.draft?.guidedSession ?? null) as GuidedSession | null,
              };
            }
          }
        } catch (e) {
          // A draft-read failure must never block the builder — fall back to the
          // committed version (status stays 'none').
          console.error('[DashboardBuilder] draft load error:', e);
        }
        if (cancelled) return;

        if (draftStatus === 'fresh' && draftPayload) {
          // (1) draft forked from the current version → restore it silently and
          // show a non-destructive "restored · Discard" banner. Arm autosave.
          loadDraft(draftPayload.widgets, draftPayload.guidedSession);
          setMode(pickMode(draftPayload.widgets));
          if (draftPayload.guidedSession?.intent) setIntentCaptured(true);
          if (draftPayload.guidedSession?.blueprint) setBlueprintAccepted(true);
          setDraftBanner('fresh');
          setAutosaveEnabled(true);
        } else if (draftStatus === 'stale' && draftPayload) {
          // (2) a newer version was saved since the draft forked. Show the
          // committed version, hold the draft for a Keep/Discard/View-diff choice,
          // and DO NOT arm autosave yet (a blind write would clobber the draft).
          loadWidgets(committedWidgets);
          setMode(pickMode(committedWidgets));
          staleDraftRef.current = draftPayload;
          setDraftBanner('stale');
        } else {
          // (3) no draft → hydrate the current version, as before. Arm autosave.
          loadWidgets(committedWidgets);
          setMode(pickMode(committedWidgets));
          setAutosaveEnabled(true);
        }
      } catch (err) {
        console.error('[DashboardBuilder] load error:', err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dashboardId, setDashboard, loadWidgets, loadDraft, setMode]);

  // Open share dialog if navigated here with ?share=1
  useEffect(() => {
    if (searchParams?.get('share') === '1') {
      setShareOpen(true);
    }
  }, [searchParams]);

  // ── Load definitions picker ──────────────────────────────────────────────────
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    (async () => {
      try {
        setPickerLoading(true);
        const res = await fetch(`/api/inspector/semantic/${modelId}/definitions`);
        if (!res.ok) throw new Error(`Definitions load failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setEntities(data.entities ?? []);
      } catch (err) {
        console.error('[DashboardBuilder] definitions error:', err);
      } finally {
        if (!cancelled) setPickerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modelId]);

  // ── Compute drift map whenever widgets or definitions change ─────────────────
  useEffect(() => {
    if (entities.length === 0 || widgets.length === 0) return;
    const driftMap = computeDriftMap(widgets, entities);
    setDriftMap(driftMap);
  }, [widgets, entities, setDriftMap]);

  // ── Definitions lookup map ───────────────────────────────────────────────────
  const definitionsMap = useMemo(() => {
    const map = new Map<string, { label: string; status: string; aggregate?: string; expression?: string | null; metric_type?: string }>();
    for (const entity of entities) {
      for (const dim of entity.dimensions) {
        map.set(dim.id, { label: dim.dimension_label, status: dim.status });
      }
      for (const meas of entity.measures) {
        map.set(meas.id, {
          label: meas.measure_label,
          status: meas.status,
          aggregate: meas.aggregate,
          expression: meas.expression,
          metric_type: meas.metric_type,
        });
      }
    }
    return map;
  }, [entities]);

  // ── Smart chart defaults (Phase 3A) ──────────────────────────────────────────
  // Resolved definitions (types) drive recommendChartKind. Rebuilt when the
  // definitions load; consumed by the add-field auto-kind + config panel.
  const resolvedDefs = useMemo<ResolvedDefinitions>(() => {
    const dimensions: ResolvedDefinitions['dimensions'] = {};
    const measures: ResolvedDefinitions['measures'] = {};
    for (const entity of entities) {
      for (const dim of entity.dimensions) {
        dimensions[dim.id] = { id: dim.id, type: dim.dimension_type };
      }
      for (const meas of entity.measures) {
        measures[meas.id] = { id: meas.id };
      }
    }
    return { dimensions, measures };
  }, [entities]);

  // Widgets whose chart kind the user set by hand — auto-recommendation must not
  // clobber a manual choice. Transient (not persisted): a fresh session starts
  // with every widget eligible for auto-kind.
  const manualKindRef = useRef<Set<string>>(new Set());

  const markManualKind = useCallback(
    (widgetId: string, chartKind: WidgetSpec['chartKind']) => {
      manualKindRef.current.add(widgetId);
      updateWidget(widgetId, { chartKind });
    },
    [updateWidget],
  );

  // ── Picker handlers ──────────────────────────────────────────────────────────
  const showPickerHint = useCallback((msg: string) => {
    setPickerHint(msg);
    setTimeout(() => setPickerHint(null), 2500);
  }, []);

  const handleAddDimension = useCallback(
    (entityId: string, dim: { id: string; dimension_label: string }) => {
      const widgetId = selectedWidgetId;
      if (!widgetId) {
        showPickerHint('Select a widget first');
        return;
      }
      const widget = widgets.find((w) => w.widgetId === widgetId);
      if (!widget) return;
      if (isRawSqlWidget(widget)) {
        showPickerHint('Raw-SQL widgets aren’t edited here');
        return;
      }
      if (widget.semanticQuery.dimensions.some((d) => d.dimensionId === dim.id)) {
        showPickerHint('Already assigned');
        return;
      }
      const sq = { ...widget.semanticQuery };
      sq.entityId = sq.entityId || entityId;
      sq.dimensions = [...sq.dimensions, { dimensionId: dim.id }];
      updateWidgetSemanticQuery(widgetId, sq);
      // Smart default: recommend a chart kind for the new field combination
      // unless the user has already chosen a kind by hand.
      if (!manualKindRef.current.has(widgetId)) {
        const rec = recommendChartKind(sq, resolvedDefs);
        updateWidget(widgetId, { chartKind: recommendedKindToWidgetKind(rec.chartKind) });
      }
    },
    [selectedWidgetId, widgets, updateWidgetSemanticQuery, updateWidget, resolvedDefs, showPickerHint],
  );

  const handleAddMeasure = useCallback(
    (entityId: string, meas: { id: string; measure_label: string }) => {
      const widgetId = selectedWidgetId;
      if (!widgetId) {
        showPickerHint('Select a widget first');
        return;
      }
      const widget = widgets.find((w) => w.widgetId === widgetId);
      if (!widget) return;
      if (isRawSqlWidget(widget)) {
        showPickerHint('Raw-SQL widgets aren’t edited here');
        return;
      }
      if (widget.semanticQuery.measures.some((m) => m.measureId === meas.id)) {
        showPickerHint('Already assigned');
        return;
      }
      const sq = { ...widget.semanticQuery };
      sq.entityId = sq.entityId || entityId;
      sq.measures = [...sq.measures, { measureId: meas.id }];
      updateWidgetSemanticQuery(widgetId, sq);
      // Smart default: recommend a chart kind for the new field combination
      // unless the user has already chosen a kind by hand.
      if (!manualKindRef.current.has(widgetId)) {
        const rec = recommendChartKind(sq, resolvedDefs);
        updateWidget(widgetId, { chartKind: recommendedKindToWidgetKind(rec.chartKind) });
      }
    },
    [selectedWidgetId, widgets, updateWidgetSemanticQuery, updateWidget, resolvedDefs, showPickerHint],
  );

  // ── Chart assign handler (Decision 2: click-to-assign, Option B: one-time copy) ──
  const handleAddChart = useCallback(
    (chart: SavedChart) => {
      const widgetId = selectedWidgetId;
      if (!widgetId) {
        showPickerHint('Select a widget first');
        return;
      }
      const target = widgets.find((w) => w.widgetId === widgetId);
      if (target && isRawSqlWidget(target)) {
        showPickerHint('Raw-SQL widgets aren’t edited here');
        return;
      }
      const chartConfig = encodingsToChartConfig(chart.chart_dsl);
      updateWidget(widgetId, {
        chartSource: 'semantic',
        title: chart.name,
        chartKind: dslKindToWidgetKind(chart.chart_dsl.kind),
        semanticQuery: chart.semantic_query,
        measureSnapshots: chart.measure_snapshots,
        chartConfig,
        // Provenance: record the copied-from chart. Non-authoritative — this
        // never drives drift (that stays on live definitions) and a later
        // delete of the chart is fine (dangling ref handled in the UI).
        source_chart_id: chart.id,
      });
    },
    [selectedWidgetId, widgets, updateWidget, showPickerHint],
  );

  // ── Track B: draft-banner actions ────────────────────────────────────────────
  // Diff between the newer committed version and the user's held draft (the
  // "View diff" affordance in the 'stale' banner). Reuses version-diff.ts.
  const draftDiff = useMemo<VersionDiffSummary | null>(() => {
    if (draftBanner !== 'stale' || !staleDraftRef.current) return null;
    return computeVersionDiff(
      { widgets: committedWidgetsRef.current },
      { widgets: staleDraftRef.current.widgets },
    );
  }, [draftBanner]);

  const handleDiscardDraft = useCallback(async () => {
    autosave.cancel();
    try {
      await fetch(`/api/inspector/dashboards/${dashboardId}/draft`, { method: 'DELETE' });
    } catch {
      /* idempotent — a leftover row simply re-classifies on the next load */
    }
    // Revert the store to the committed version. loadWidgets marks the store
    // clean, so the armed autosave will NOT re-create the row we just deleted.
    loadWidgets(committedWidgetsRef.current);
    staleDraftRef.current = null;
    setShowDraftDiff(false);
    setDraftBanner(null);
    setAutosaveEnabled(true);
  }, [dashboardId, autosave, loadWidgets]);

  const handleKeepDraft = useCallback(async () => {
    const draft = staleDraftRef.current;
    if (!draft) return;
    autosave.cancel();
    // Rebase the draft onto the current version FIRST and synchronously, so an
    // immediate reload re-classifies as 'fresh' (never 'stale' again).
    try {
      await fetch(`/api/inspector/dashboards/${dashboardId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgets: draft.widgets,
          layouts: { columns: 12, rows: draft.widgets.map((w) => ({ widgetId: w.widgetId, ...w.position })) },
          guidedSession: draft.guidedSession,
          baseVersionId: useBuilderStore.getState().currentVersionId,
        }),
      });
    } catch {
      /* best-effort — the armed autosave re-persists on the next edit */
    }
    loadDraft(draft.widgets, draft.guidedSession);
    setMode(draft.widgets.length === 0 ? 'guided' : 'manual');
    if (draft.guidedSession?.intent) setIntentCaptured(true);
    if (draft.guidedSession?.blueprint) setBlueprintAccepted(true);
    staleDraftRef.current = null;
    setShowDraftDiff(false);
    setDraftBanner('fresh'); // now a fresh draft against the current version
    setAutosaveEnabled(true);
  }, [dashboardId, autosave, loadDraft, setMode]);

  // ── Save handler ──────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    // Stop a queued debounced draft write from racing the version save.
    autosave.cancel();

    try {
      const res = await fetch(`/api/inspector/dashboards/${dashboardId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgets,
          layout: { columns: 12, rows: widgets.map((w) => ({ widgetId: w.widgetId, ...w.position })) },
          changeSummary: `D2 builder save — ${widgets.length} widget(s)`,
        }),
      });

      if (res.status === 400) {
        const data = await res.json();
        const details = Array.isArray(data.details) ? data.details.join('; ') : (data.error ?? 'Validation failed');
        setSaveError(`Validation error: ${details}`, 'validation');
        return;
      }

      if (res.status === 409) {
        // B5: the loser of a concurrent save. Persist their edits to the draft
        // synchronously BEFORE the reload prompt so reloading lands in the B3
        // 'stale' recovery path (Keep / Discard / View diff) instead of the old
        // window.location.reload() that silently discarded the work.
        await autosave.flushNow();
        setSaveError('Another user saved at the same time. Your edits are saved as a draft — reload to review and merge them.', 'conflict');
        return;
      }

      if (!res.ok) {
        setSaveError(`Save failed (${res.status})`, 'other');
        return;
      }

      // Server re-computes measureSnapshots — reload the dashboard to pick up
      // fresh snapshots so drift detection stays accurate after save.
      const data = await res.json();
      const versionId = data.version?.id;

      // Reload the dashboard to sync server-computed snapshots into local state
      const reloadRes = await fetch(`/api/inspector/dashboards/${dashboardId}`);
      if (reloadRes.ok) {
        const reloadData = await reloadRes.json();
        const { dashboard, currentVersion } = reloadData;
        setDashboard(dashboard.id, dashboard.model_id, dashboard.name, dashboard.current_version_id);
        if (currentVersion?.widgets) {
          loadWidgets(currentVersion.widgets as WidgetSpec[]);
        }
      } else {
        // Fallback: just mark clean without full reload
        markClean();
      }

      // B4: promotion succeeded → clear the draft so the "restored" banner does
      // not reappear against freshly-committed work. The reload above already
      // synced the store to the new version (clean), so a leftover draft row is
      // pure noise. DELETE is simpler than rebase-with-empty-payload and reaches
      // the same end state (next edit forks a fresh draft off the new version).
      try {
        await fetch(`/api/inspector/dashboards/${dashboardId}/draft`, { method: 'DELETE' });
      } catch {
        /* best-effort */
      }
      staleDraftRef.current = null;
      setShowDraftDiff(false);
      setDraftBanner(null);
    } catch (err) {
      setSaveError(`Network error: ${err instanceof Error ? err.message : 'Unknown'}`, 'other');
    } finally {
      setSaving(false);
    }
  }, [dashboardId, widgets, saving, autosave, setSaving, setSaveError, markClean, setDashboard, loadWidgets]);

  // ── Add widget ────────────────────────────────────────────────────────────────
  const handleAddWidget = () => {
    addWidget('bar', `Widget ${widgets.length + 1}`);
  };

  const selectedWidget = widgets.find((w) => w.widgetId === selectedWidgetId) ?? null;

  // "Why this chart" recommendation for the selected widget's current shape.
  const selectedWidgetRecommendation = useMemo(() => {
    if (!selectedWidget || isRawSqlWidget(selectedWidget)) return null;
    const sq = selectedWidget.semanticQuery;
    if (sq.dimensions.length === 0 && sq.measures.length === 0) return null;
    return recommendChartKind(sq, resolvedDefs);
  }, [selectedWidget, resolvedDefs]);

  const isReadOnly = myRole === 'viewer' || myRole === 'org_member';
  const canShare = myRole === 'owner' || myRole === 'editor';

  if (initialLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span style={{ ...MONO, fontSize: 11, color: 'var(--builder-text-label)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          LOADING DASHBOARD…
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--builder-surface)' }}>
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderBottom: '1px solid var(--builder-border)',
          flexShrink: 0,
          background: 'var(--builder-surface-raised)',
        }}
      >
        <button
          onClick={() => router.push('/inspector/dashboards')}
          title="Back to Dashboards"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--builder-text-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <ArrowLeft size={16} />
        </button>

        <span style={{ ...MONO, fontSize: 12, color: 'var(--builder-text)', fontWeight: 600, letterSpacing: '0.02em' }}>
          {dashboardName || 'Dashboard Builder'}
        </span>

        {isReadOnly && (
          <span
            style={{
              ...MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 4,
              color: '#8892A4', background: 'rgba(136,146,164,0.1)',
              border: '1px solid rgba(136,146,164,0.25)', borderRadius: 3, padding: '2px 7px',
            }}
          >
            <Eye size={10} />VIEW ONLY
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Mode toggle (Phase 1) — two views over one WidgetSpec[]; lossless. */}
        {!isReadOnly && (
          <div style={{ display: 'inline-flex', border: '1px solid var(--builder-border)', borderRadius: 5, overflow: 'hidden' }}>
            {(['guided', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={m === 'guided' ? 'NL-first guided authoring' : 'Manual grid builder'}
                style={{
                  ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: 'none',
                  background: mode === m ? '#FDB515' : 'transparent',
                  color: mode === m ? '#0D1B2A' : 'var(--builder-text)',
                  cursor: 'pointer', fontWeight: mode === m ? 600 : 400,
                }}
              >
                {m === 'guided' ? <Sparkles size={12} /> : <LayoutGrid size={12} />}
                {m}
              </button>
            ))}
          </div>
        )}

        {!isReadOnly && mode === 'manual' && (
          <button
            onClick={handleAddWidget}
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
              borderRadius: 4, border: '1px solid var(--builder-border)',
              background: 'transparent', color: 'var(--builder-text)', cursor: 'pointer',
            }}
          >
            <Plus size={12} />ADD WIDGET
          </button>
        )}

        <button
          onClick={() => setRightPanel(rightPanel === 'history' ? 'config' : 'history')}
          style={{
            ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 4,
            border: `1px solid ${rightPanel === 'history' ? '#FDB515' : 'var(--builder-border)'}`,
            background: rightPanel === 'history' ? 'rgba(253,181,21,0.08)' : 'transparent',
            color: rightPanel === 'history' ? '#FDB515' : 'var(--builder-text)', cursor: 'pointer',
          }}
        >
          <History size={12} />VERSIONS
        </button>

        {canShare && (
          <button
            onClick={() => setShareOpen(true)}
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 4,
              border: '1px solid var(--builder-border)', background: 'transparent',
              color: 'var(--builder-text)', cursor: 'pointer',
            }}
          >
            <Share2 size={12} />SHARE
          </button>
        )}

        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 4,
              border: 'none', background: dirty ? '#FDB515' : 'rgba(253,181,21,0.3)',
              color: '#0D1B2A', cursor: dirty && !saving ? 'pointer' : 'default',
              opacity: saving ? 0.6 : 1, fontWeight: 500,
            }}
          >
            <Save size={12} />{saving ? 'SAVING…' : 'SAVE'}
          </button>
        )}
      </div>

      {/* ── Save error banner ──────────────────────────────────────────────── */}
      {saveError && (
        <div
          style={{
            ...MONO,
            fontSize: 10,
            padding: '8px 16px',
            background: saveErrorType === 'conflict' ? 'rgba(253,181,21,0.08)' : 'rgba(239,68,68,0.08)',
            borderBottom: `1px solid ${saveErrorType === 'conflict' ? 'rgba(253,181,21,0.2)' : 'rgba(239,68,68,0.2)'}`,
            color: saveErrorType === 'conflict' ? '#FDB515' : '#F87171',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>{saveError}</span>
          {saveErrorType === 'conflict' && (
            <button
              onClick={() => window.location.reload()}
              style={{ ...MONO, fontSize: 10, background: 'rgba(253,181,21,0.15)', border: '1px solid rgba(253,181,21,0.3)', borderRadius: 3, color: '#FDB515', cursor: 'pointer', padding: '3px 8px' }}
            >
              RELOAD
            </button>
          )}
          <button
            onClick={() => setSaveError(null)}
            style={{ background: 'transparent', border: 'none', color: saveErrorType === 'conflict' ? '#FDB515' : '#F87171', cursor: 'pointer', textDecoration: 'underline', ...MONO, fontSize: 10 }}
          >
            dismiss
          </button>
        </div>
      )}

      {/* ── Track B: draft-retention banner ──────────────────────────────────── */}
      {draftBanner === 'fresh' && (
        <div
          style={{
            ...MONO, fontSize: 10, padding: '8px 16px', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(96,165,250,0.08)', borderBottom: '1px solid rgba(96,165,250,0.2)', color: '#93C5FD',
          }}
        >
          <span style={{ flex: 1 }}>Unsaved changes restored — pick up where you left off. Save to commit them as a version.</span>
          <button
            onClick={handleDiscardDraft}
            style={{ ...MONO, fontSize: 10, background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 3, color: '#93C5FD', cursor: 'pointer', padding: '3px 8px' }}
          >
            DISCARD
          </button>
        </div>
      )}

      {draftBanner === 'stale' && (
        <div
          style={{
            ...MONO, fontSize: 10, padding: '8px 16px', flexShrink: 0,
            display: 'flex', flexDirection: 'column', gap: 6,
            background: 'rgba(253,181,21,0.08)', borderBottom: '1px solid rgba(253,181,21,0.2)', color: '#FDB515',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              This dashboard changed since your draft — someone saved a newer version. Keep your draft, or discard it for the current version?
            </span>
            <button
              onClick={handleKeepDraft}
              style={{ ...MONO, fontSize: 10, background: '#FDB515', border: 'none', borderRadius: 3, color: '#0D1B2A', cursor: 'pointer', padding: '3px 8px', fontWeight: 600 }}
            >
              KEEP DRAFT
            </button>
            <button
              onClick={() => setShowDraftDiff((v) => !v)}
              style={{ ...MONO, fontSize: 10, background: 'transparent', border: '1px solid rgba(253,181,21,0.3)', borderRadius: 3, color: '#FDB515', cursor: 'pointer', padding: '3px 8px' }}
            >
              {showDraftDiff ? 'HIDE DIFF' : 'VIEW DIFF'}
            </button>
            <button
              onClick={handleDiscardDraft}
              style={{ ...MONO, fontSize: 10, background: 'transparent', border: '1px solid rgba(253,181,21,0.3)', borderRadius: 3, color: '#FDB515', cursor: 'pointer', padding: '3px 8px' }}
            >
              DISCARD
            </button>
          </div>
          {showDraftDiff && draftDiff && (
            <div style={{ ...MONO, fontSize: 9, opacity: 0.85 }}>
              Your draft vs. the current version — {draftDiff.added} added · {draftDiff.removed} removed · {draftDiff.modified} modified widget(s).
            </div>
          )}
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {mode === 'guided' && !isReadOnly ? (
          // ── Guided flow (Stage 1 Intent → Stage 2 Blueprint). Focused chrome.
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            {!modelId ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ ...MONO, fontSize: 11, color: 'var(--builder-text-muted)' }}>No semantic model bound — switch to manual.</span>
              </div>
            ) : !intentCaptured ? (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <IntentStage
                  modelId={modelId}
                  onProceed={() => setIntentCaptured(true)}
                  onCancel={() => setMode('manual')}
                />
              </div>
            ) : !guidedIntent ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ ...MONO, fontSize: 11, color: 'var(--builder-text-muted)' }}>Intent missing — restart the guided flow.</span>
              </div>
            ) : !blueprintAccepted ? (
              // Stage 2 — Blueprint. Accepting hands off to Stage 3 (no widgets built here).
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <BlueprintStage
                  modelId={modelId}
                  intent={guidedIntent}
                  onAccept={() => setBlueprintAccepted(true)}
                  onBack={() => { setIntentCaptured(false); setBlueprint(null); }}
                />
              </div>
            ) : (
              // Stage 3 — per-chart drill-in. Renders "not wired" charts; confirm
              // appends a WidgetSpec to the shared store (no execution this phase).
              <DrillInStage
                modelId={modelId}
                resolvedDefs={resolvedDefs}
                onBackToBlueprint={() => setBlueprintAccepted(false)}
                onDone={() => setMode('manual')}
              />
            )}
          </div>
        ) : (
          <>
            {/* Left: Definition Picker — hidden for read-only viewers */}
            {!isReadOnly && (
              <div
                style={{
                  width: 260,
                  flexShrink: 0,
                  borderRight: '1px solid var(--builder-border)',
                  background: 'var(--builder-surface-raised)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--builder-text-label)', padding: '10px 12px 4px', flexShrink: 0 }}>
                  LIBRARY
                </div>
                {pickerHint && (
                  <div style={{ ...MONO, fontSize: 9, padding: '4px 12px', color: '#FDB515', background: 'rgba(253,181,21,0.06)', flexShrink: 0 }}>
                    {pickerHint}
                  </div>
                )}
                <DefinitionPicker
                  entities={entities}
                  loading={pickerLoading}
                  modelId={modelId}
                  onAddDimension={handleAddDimension}
                  onAddMeasure={handleAddMeasure}
                  onAddChart={handleAddChart}
                />
              </div>
            )}

            {/* Center: Grid (or generative empty state when there are no widgets) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {widgets.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
                  <EmptyStatePrompts
                    modelId={modelId}
                    title="This dashboard is empty. Get started:"
                    footerHint={isReadOnly ? undefined : 'Switch to Guided above, add a blank widget, or build one in Inspector and pin it here.'}
                    onPromptClick={(p) => router.push(`/inspector?prompt=${encodeURIComponent(p)}`)}
                  />
                </div>
              ) : (
                <BuilderGrid widgets={widgets} definitions={definitionsMap} readOnly={isReadOnly} />
              )}
            </div>

            {/* Right: Config / History */}
            <div
              style={{
                width: 280,
                flexShrink: 0,
                borderLeft: '1px solid var(--builder-border)',
                background: 'var(--builder-surface-raised)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--builder-text-label)', padding: '10px 12px 4px', flexShrink: 0 }}>
                {rightPanel === 'config' ? (isReadOnly ? 'WIDGET INFO' : 'WIDGET CONFIG') : 'VERSION HISTORY'}
              </div>
              {rightPanel === 'config' && selectedWidget && (
                <WidgetConfigPanel
                  widget={selectedWidget}
                  definitions={definitionsMap}
                  readOnly={isReadOnly}
                  recommendation={selectedWidgetRecommendation}
                  onChartKindChange={(kind) => markManualKind(selectedWidget.widgetId, kind)}
                />
              )}
              {rightPanel === 'config' && !selectedWidget && (
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                  <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)', textAlign: 'center' }}>
                    {isReadOnly ? 'Click a widget to inspect it' : 'Select a widget to configure it'}
                  </span>
                </div>
              )}
              {rightPanel === 'history' && (
                <VersionHistoryPanel dashboardId={dashboardId} />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Share Dialog ─────────────────────────────────────────────────────── */}
      {shareOpen && (
        <ShareDialog
          dashboardId={dashboardId}
          dashboardName={dashboardName || 'Dashboard'}
          currentVisibility={visibility}
          myRole={myRole}
          onClose={() => setShareOpen(false)}
          onVisibilityChange={(v) => setVisibility(v)}
        />
      )}
    </div>
  );
}

// ── Drift computation ─────────────────────────────────────────────────────────

function computeDriftMap(
  widgets: WidgetSpec[],
  entities: PickerEntity[],
): Record<string, WidgetDriftInfo> {
  // Build a flat lookup of all live measures
  const liveMeasures = new Map<string, { aggregate: string; expression: string | null; metric_type: string }>();
  const allDefinitionIds = new Set<string>();

  for (const entity of entities) {
    for (const dim of entity.dimensions) allDefinitionIds.add(dim.id);
    for (const meas of entity.measures) {
      allDefinitionIds.add(meas.id);
      liveMeasures.set(meas.id, {
        aggregate: meas.aggregate,
        expression: meas.expression,
        metric_type: meas.metric_type,
      });
    }
  }

  const result: Record<string, WidgetDriftInfo> = {};

  for (const widget of widgets) {
    // Raw-SQL widgets (Phase 3.5C) are never drift-checked — they have no
    // governed definitions and carry the "Unverified · Raw SQL" badge instead.
    if (isRawSqlWidget(widget)) {
      result[widget.widgetId] = {
        widgetId: widget.widgetId,
        status: 'ok',
        changedMeasures: [],
        unavailableIds: [],
      };
      continue;
    }

    const unavailableIds: string[] = [];
    const changedMeasures: string[] = [];

    // Check all referenced dims/measures exist in the definitions response
    for (const d of widget.semanticQuery.dimensions) {
      if (!allDefinitionIds.has(d.dimensionId)) {
        unavailableIds.push(d.dimensionId);
      }
    }
    for (const m of widget.semanticQuery.measures) {
      if (!allDefinitionIds.has(m.measureId)) {
        unavailableIds.push(m.measureId);
      }
    }

    // Check measure snapshots for drift
    if (widget.measureSnapshots && widget.measureSnapshots.length > 0) {
      for (const snapshot of widget.measureSnapshots) {
        const live = liveMeasures.get(snapshot.measureId);
        if (!live) {
          // Already caught as unavailable above
          continue;
        }
        if (
          live.aggregate !== snapshot.aggregate ||
          live.expression !== snapshot.expression ||
          live.metric_type !== snapshot.metric_type
        ) {
          changedMeasures.push(snapshot.measureId);
        }
      }
    }

    let status: DriftStatus = 'ok';
    if (unavailableIds.length > 0) status = 'unavailable';
    else if (changedMeasures.length > 0) status = 'changed';

    result[widget.widgetId] = { widgetId: widget.widgetId, status, changedMeasures, unavailableIds };
  }

  return result;
}
