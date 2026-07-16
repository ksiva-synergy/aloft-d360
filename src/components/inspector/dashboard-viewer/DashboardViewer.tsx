'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { ArrowLeft, Pencil, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import type { WidgetSpec, WidgetDataResult } from '@/lib/dashboards/types';
import { useDashboardData } from '@/hooks/useDashboardData';
import { WidgetPreview } from '@/components/inspector/dashboard-builder/WidgetPreview';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

const GRID_COLS = 12;
const ROW_HEIGHT = 60;

type DefinitionMap = Map<
  string,
  { label: string; status: string; aggregate?: string; expression?: string | null; metric_type?: string }
>;

interface PickerEntity {
  dimensions: Array<{ id: string; dimension_label: string; status: string }>;
  measures: Array<{
    id: string;
    measure_label: string;
    aggregate: string;
    expression: string | null;
    metric_type: string;
    status: string;
  }>;
}

/**
 * DATA-3b — read-only dashboard viewer. Consumption counterpart to /builder.
 *
 * Mirrors the builder's grid layout but strips every editing affordance:
 * no DefinitionPicker, no Add/Save, no drift badges, no WidgetConfigPanel, no
 * remove button, and the grid is neither draggable nor resizable. It renders
 * each widget with live data from the batch widget-data route, with per-widget
 * skeleton / error / candidate-model states.
 *
 * Auth is enforced by the API (both the dashboard-metadata route and the
 * widget-data route), matching how the builder delegates to the client. This
 * component additionally hides the grid when the caller has no role.
 */
export function DashboardViewer({ dashboardId }: { dashboardId: string }) {
  const router = useRouter();

  const [meta, setMeta] = useState<{
    name: string;
    modelId: string;
    role: string | null;
    widgets: WidgetSpec[];
  } | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<DefinitionMap>(new Map());
  /** Ids of source charts that still exist — resolves the provenance link's state. */
  const [availableSourceCharts, setAvailableSourceCharts] = useState<Set<string>>(new Set());

  const { data, loading, error, refetch, fetchedAt } = useDashboardData(dashboardId);

  // ── Load dashboard metadata + role + current version widgets ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inspector/dashboards/${dashboardId}`);
        if (!res.ok) {
          if (!cancelled) setMetaError(res.status === 404 ? 'Dashboard not found' : `Failed to load (${res.status})`);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        const { dashboard, currentVersion, myRole } = json;
        setMeta({
          name: dashboard.name,
          modelId: dashboard.model_id,
          role: myRole ?? null,
          widgets: (currentVersion?.widgets as WidgetSpec[]) ?? [],
        });
      } catch (err) {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardId]);

  // ── Load definitions to resolve widget dim/measure labels ───────────────────
  useEffect(() => {
    if (!meta?.modelId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inspector/semantic/${meta.modelId}/definitions`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const map: DefinitionMap = new Map();
        for (const entity of (json.entities ?? []) as PickerEntity[]) {
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
        setDefinitions(map);
      } catch {
        /* non-fatal — widgets fall back to short IDs for labels */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta?.modelId]);

  const widgets = meta?.widgets ?? [];
  const canEdit = meta?.role === 'owner' || meta?.role === 'editor';

  // ── Resolve which source charts still exist (provenance link state) ──────────
  // One list call per model, only when some widget carries a source_chart_id.
  // A missing id is expected (charts are soft-deletable) — the widget then shows
  // "Source unavailable" rather than a broken link.
  useEffect(() => {
    if (!meta?.modelId) return;
    const referenced = widgets.some((w) => w.source_chart_id);
    if (!referenced) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inspector/charts?modelId=${encodeURIComponent(meta.modelId)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { charts?: { id: string }[] };
        if (cancelled) return;
        setAvailableSourceCharts(new Set((json.charts ?? []).map((c) => c.id)));
      } catch {
        /* non-fatal — links degrade to "source unavailable" */
      }
    })();
    return () => { cancelled = true; };
  }, [meta?.modelId, widgets]);

  const anyCandidate = useMemo(
    () => Object.values(data ?? {}).some((r) => r.status === 'model_not_governed'),
    [data],
  );

  const layout: Layout = useMemo(
    () =>
      widgets.map((w) => ({
        i: w.widgetId,
        x: w.position.col,
        y: w.position.row,
        w: w.position.w,
        h: w.position.h,
      })),
    [widgets],
  );

  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 900 });

  // ── Load / access states ────────────────────────────────────────────────────
  if (metaLoading) {
    return <CenterMessage text="LOADING DASHBOARD…" />;
  }
  if (metaError) {
    return <CenterMessage text={metaError} />;
  }
  // No role → no access. Match the checklist: "users with no access see 404 or redirect".
  if (!meta || meta.role == null) {
    return <CenterMessage text="You don't have access to this dashboard" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--builder-surface)' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
          style={{ background: 'transparent', border: 'none', color: 'var(--builder-text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
        >
          <ArrowLeft size={16} />
        </button>

        <span style={{ ...MONO, fontSize: 12, color: 'var(--builder-text)', fontWeight: 600, letterSpacing: '0.02em' }}>
          {meta.name || 'Dashboard'}
        </span>

        <div style={{ flex: 1 }} />

        {fetchedAt && (
          <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', letterSpacing: '0.04em' }}>
            LAST UPDATED {formatTime(fetchedAt)}
          </span>
        )}

        <button
          onClick={() => refetch()}
          title="Refresh data"
          disabled={loading}
          style={{ background: 'transparent', border: 'none', color: 'var(--builder-text-muted)', cursor: loading ? 'default' : 'pointer', padding: 4, display: 'flex', alignItems: 'center', opacity: loading ? 0.5 : 1 }}
        >
          <RefreshCw size={14} />
        </button>

        {canEdit && (
          <button
            onClick={() => router.push(`/inspector/dashboards/${dashboardId}/builder`)}
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 4,
              border: '1px solid var(--builder-border)', background: 'transparent',
              color: 'var(--builder-text)', cursor: 'pointer',
            }}
          >
            <Pencil size={12} />EDIT
          </button>
        )}
      </div>

      {/* ── Candidate-model banner ─────────────────────────────────────────── */}
      {anyCandidate && (
        <div
          style={{
            ...MONO, fontSize: 10, padding: '8px 16px', flexShrink: 0,
            background: 'rgba(253,181,21,0.08)', borderBottom: '1px solid rgba(253,181,21,0.2)',
            color: '#FDB515', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <AlertCircle size={12} />
          This dashboard&apos;s model is still a candidate — publish it to see live data.
        </div>
      )}

      {/* ── Request-level error banner ─────────────────────────────────────── */}
      {error && (
        <div
          style={{
            ...MONO, fontSize: 10, padding: '8px 16px', flexShrink: 0,
            background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)',
            color: '#F87171', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>Failed to load widget data: {error}</span>
          <button
            onClick={() => refetch()}
            style={{ ...MONO, fontSize: 10, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, color: '#F87171', cursor: 'pointer', padding: '3px 8px' }}
          >
            RETRY
          </button>
        </div>
      )}

      {/* ── Grid (read-only) ───────────────────────────────────────────────── */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {widgets.length === 0 ? (
          <CenterMessage text="THIS DASHBOARD HAS NO WIDGETS" />
        ) : (
          mounted && (
            <GridLayout
              width={width - 32}
              layout={layout}
              gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [12, 12] as const, containerPadding: [0, 0] as const }}
              dragConfig={{ enabled: false }}
              resizeConfig={{ enabled: false }}
              compactor={verticalCompactor}
              autoSize
            >
              {widgets.map((widget) => {
                const result = data?.[widget.widgetId];
                return (
                  <div
                    key={widget.widgetId}
                    style={{
                      background: 'var(--builder-surface-raised)',
                      border: '1px solid var(--builder-border)',
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Header — title + per-widget freshness stamp / refresh / source */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--builder-border)', flexShrink: 0 }}>
                      <span
                        style={{
                          ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                          color: 'var(--builder-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {widget.title || 'Untitled Widget'}
                      </span>
                      {result?.status === 'ok' && (
                        <span
                          title={`Last updated ${formatTime(result.executedAt)}`}
                          style={{ ...MONO, fontSize: 8, letterSpacing: '0.04em', color: result.cached ? '#FDB515' : 'var(--builder-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          {result.cached ? 'CACHED · ' : ''}{formatTime(result.executedAt)}
                        </span>
                      )}
                      <button
                        onClick={() => refetch({ force: widget.widgetId })}
                        title="Refresh this widget (bypass cache)"
                        disabled={loading}
                        style={{ background: 'transparent', border: 'none', color: 'var(--builder-text-muted)', cursor: loading ? 'default' : 'pointer', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0, opacity: loading ? 0.5 : 1 }}
                      >
                        <RefreshCw size={11} />
                      </button>
                      {widget.source_chart_id && (
                        availableSourceCharts.has(widget.source_chart_id) ? (
                          <button
                            onClick={() => router.push(`/inspector?sourceChart=${encodeURIComponent(widget.source_chart_id!)}`)}
                            title="Open source chart in Inspector"
                            style={{ background: 'transparent', border: 'none', color: '#FDB515', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                          >
                            <ExternalLink size={11} />
                          </button>
                        ) : (
                          <span
                            title="Source chart unavailable"
                            style={{ ...MONO, fontSize: 8, letterSpacing: '0.04em', color: 'var(--builder-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            SOURCE N/A
                          </span>
                        )
                      )}
                    </div>

                    {/* Body */}
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <WidgetBody
                        widget={widget}
                        definitions={definitions}
                        result={result}
                        loading={loading && !result}
                        onRetry={() => refetch()}
                      />
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          )
        )}
      </div>
    </div>
  );
}

/** Per-widget state machine: skeleton → error / candidate / data. */
function WidgetBody({
  widget,
  definitions,
  result,
  loading,
  onRetry,
}: {
  widget: WidgetSpec;
  definitions: DefinitionMap;
  result: WidgetDataResult | undefined;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading || result === undefined) {
    return <WidgetSkeleton />;
  }

  if (result.status === 'error') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 }}>
        <AlertCircle size={16} color="#F87171" />
        <span style={{ ...MONO, fontSize: 9, color: '#F87171', textAlign: 'center', maxWidth: 220 }}>
          {result.message}
        </span>
        <button
          onClick={onRetry}
          style={{ ...MONO, fontSize: 9, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, color: '#F87171', cursor: 'pointer', padding: '2px 8px' }}
        >
          RETRY
        </button>
      </div>
    );
  }

  if (result.status === 'model_not_governed') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        <span style={{ ...MONO, fontSize: 9, color: '#FDB515', textAlign: 'center', maxWidth: 220 }}>
          Model not yet published
        </span>
      </div>
    );
  }

  // status === 'ok'
  return <WidgetPreview widget={widget} definitions={definitions} rows={result.rows} />;
}

function WidgetSkeleton() {
  return (
    <div className="animate-pulse" style={{ width: '100%', height: '100%', background: 'rgba(100,116,139,0.14)' }} />
  );
}

function CenterMessage({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
      <span style={{ ...MONO, fontSize: 11, color: 'var(--builder-text-label)', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center' }}>
        {text}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
