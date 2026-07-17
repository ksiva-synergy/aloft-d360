'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { GitCompare, Check, X, AlertCircle } from 'lucide-react';
import type { ChartDSLSpec } from '@/lib/studio/chart-dsl';
import type { SemanticQuery } from '@/lib/semantic/types';
import type { WidgetSpec } from '@/lib/dashboards/types';
import { buildWidgetSpecFromChart, dslKindToWidgetKind, encodingsToChartConfig } from './dashboard-builder/chart-mapping';
import {
  computeWidgetDiff,
  summarizeWidgetDiff,
  widgetDiffIsEmpty,
  type WidgetDiffLabelResolver,
} from '@/lib/dashboards/widget-diff';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';
const MUTED = '#8892A4';
const GREEN = '#86EFAC';
const RED = '#F87171';

interface DraftChangeCardProps {
  modelId: string;
  /** platform_charts id the refined chart derives from — matched against widgets. */
  sourceChartId: string;
  /** The proposed (refined) chart to apply. */
  proposedChartDsl: ChartDSLSpec;
  proposedSemanticQuery: SemanticQuery;
  proposedTitle: string;
  onClose: () => void;
}

interface MatchTarget {
  dashboardId: string;
  dashboardName: string;
  widgets: WidgetSpec[];
  widget: WidgetSpec;
}

type Phase = 'loading' | 'no_match' | 'ready' | 'applying' | 'applied' | 'error';

/** id → label resolver built from the model's definitions. */
type LabelMap = Map<string, string>;

/**
 * Draft-then-accept (Hex "Magic" pattern, Phase 3B). When a chart refined in the
 * Inspector chat derives from a dashboard widget (shared source_chart_id), the
 * user can apply the refinement back to that widget — but NOT silently. This
 * card shows a before/after diff and requires an explicit Apply.
 *
 * The diff is computed entirely client-side (computeWidgetDiff); Apply reuses
 * the same version-save flow as "Pin to dashboard" (load current widgets →
 * replace the matched widget → POST a new version).
 */
export function DraftChangeCard({
  modelId,
  sourceChartId,
  proposedChartDsl,
  proposedSemanticQuery,
  proposedTitle,
  onClose,
}: DraftChangeCardProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [target, setTarget] = useState<MatchTarget | null>(null);
  const [labels, setLabels] = useState<LabelMap>(new Map());
  const [error, setError] = useState<string | null>(null);

  // ── Locate the dashboard widget that references this source chart ───────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Definitions → label resolver for the diff.
        const defsRes = await fetch(`/api/inspector/semantic/${modelId}/definitions`);
        const map: LabelMap = new Map();
        if (defsRes.ok) {
          const json = (await defsRes.json()) as {
            entities?: Array<{
              dimensions: Array<{ id: string; dimension_label: string }>;
              measures: Array<{ id: string; measure_label: string }>;
            }>;
          };
          for (const e of json.entities ?? []) {
            for (const d of e.dimensions) map.set(d.id, d.dimension_label);
            for (const m of e.measures) map.set(m.id, m.measure_label);
          }
        }
        if (!cancelled) setLabels(map);

        // Editable dashboards in this model.
        const dashRes = await fetch('/api/inspector/dashboards?filter=all');
        if (!dashRes.ok) throw new Error(`Failed to load dashboards (${dashRes.status})`);
        const dashJson = (await dashRes.json()) as {
          dashboards: Array<{ id: string; name: string; model_id: string; my_role: string | null }>;
        };
        const editable = (dashJson.dashboards ?? []).filter(
          (d) => d.model_id === modelId && (d.my_role === 'owner' || d.my_role === 'editor'),
        );

        // Search each dashboard's current version for a widget with this source.
        for (const d of editable) {
          if (cancelled) return;
          const res = await fetch(`/api/inspector/dashboards/${d.id}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { currentVersion?: { widgets?: WidgetSpec[] } };
          const widgets = (data.currentVersion?.widgets as WidgetSpec[]) ?? [];
          const widget = widgets.find((w) => w.source_chart_id === sourceChartId);
          if (widget) {
            if (!cancelled) {
              setTarget({ dashboardId: d.id, dashboardName: d.name, widgets, widget });
              setPhase('ready');
            }
            return;
          }
        }
        if (!cancelled) setPhase('no_match');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to locate the dashboard widget');
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [modelId, sourceChartId]);

  const resolveLabel: WidgetDiffLabelResolver = useCallback(
    (id) => labels.get(id) ?? id,
    [labels],
  );

  // Build the "after" widget from the refined chart (widgetId/position are
  // placeholders — the diff ignores them; Apply preserves the matched widget's).
  const afterWidget: WidgetSpec | null = target
    ? buildWidgetSpecFromChart({
        widgetId: target.widget.widgetId,
        title: proposedTitle,
        chartDsl: proposedChartDsl,
        semanticQuery: proposedSemanticQuery,
        sourceChartId,
        position: target.widget.position,
      })
    : null;

  const diff = target && afterWidget ? computeWidgetDiff(target.widget, afterWidget, resolveLabel) : null;
  const diffLines = diff ? summarizeWidgetDiff(diff) : [];
  const nothingChanged = diff ? widgetDiffIsEmpty(diff) : false;

  // ── Apply — save a new dashboard version with the widget replaced ───────────
  const handleApply = useCallback(async () => {
    if (!target || !afterWidget) return;
    setPhase('applying');
    setError(null);

    const replaced: WidgetSpec = {
      ...target.widget,
      title: afterWidget.title,
      chartKind: dslKindToWidgetKind(proposedChartDsl.kind),
      semanticQuery: proposedSemanticQuery,
      chartConfig: encodingsToChartConfig(proposedChartDsl),
      // widgetId, position, source_chart_id, freshness preserved from the original.
    };

    const attempt = async (): Promise<Response> => {
      // Re-read current widgets so we save on top of the latest version.
      const res = await fetch(`/api/inspector/dashboards/${target.dashboardId}`);
      if (!res.ok) throw new Error(`Failed to reload dashboard (${res.status})`);
      const data = (await res.json()) as { currentVersion?: { widgets?: WidgetSpec[] } };
      const current = (data.currentVersion?.widgets as WidgetSpec[]) ?? target.widgets;
      const widgets = current.map((w) => (w.widgetId === target.widget.widgetId ? replaced : w));
      return fetch(`/api/inspector/dashboards/${target.dashboardId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgets,
          layout: { columns: 12, rows: widgets.map((w) => ({ widgetId: w.widgetId, ...w.position })) },
          changeSummary: `Applied Inspector refinement to "${afterWidget.title}"`,
        }),
      });
    };

    try {
      let resp = await attempt();
      if (resp.status === 409) resp = await attempt(); // concurrent version race
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string; details?: string[] };
        const detail = Array.isArray(data.details) ? data.details.join('; ') : data.error;
        throw new Error(detail ?? `Save failed (${resp.status})`);
      }
      setPhase('applied');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
      setPhase('error');
    }
  }, [target, afterWidget, proposedChartDsl, proposedSemanticQuery]);

  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid rgba(253,181,21,0.3)',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(253,181,21,0.12)' }}>
        <GitCompare size={12} color={GOLD} />
        <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.06em', color: GOLD, textTransform: 'uppercase', flex: 1 }}>
          Apply to dashboard widget
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex' }}>
          <X size={13} />
        </button>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {phase === 'loading' && (
          <span style={{ ...MONO, fontSize: 10, color: MUTED }}>Locating the source widget…</span>
        )}

        {phase === 'no_match' && (
          <div style={{ ...MONO, fontSize: 10, color: MUTED, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            No dashboard widget references this chart, so there is nothing to update. Use “Pin to dashboard” to add it as a new widget instead.
          </div>
        )}

        {phase === 'error' && (
          <div style={{ ...MONO, fontSize: 10, color: RED, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            {error ?? 'Something went wrong.'}
          </div>
        )}

        {phase === 'applied' && (
          <div style={{ ...MONO, fontSize: 10, color: GREEN, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={12} />
            Updated “{target?.widget.title}” on {target?.dashboardName}.
          </div>
        )}

        {(phase === 'ready' || phase === 'applying') && target && afterWidget && (
          <>
            <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
              Widget “{target.widget.title}” · {target.dashboardName}
            </span>

            {/* Before / After summaries */}
            <div style={{ display: 'flex', gap: 8 }}>
              <WidgetFacet label="Before" widget={target.widget} resolveLabel={resolveLabel} tone="muted" />
              <WidgetFacet label="After" widget={afterWidget} resolveLabel={resolveLabel} tone="gold" />
            </div>

            {/* What changed */}
            {nothingChanged ? (
              <span style={{ ...MONO, fontSize: 10, color: MUTED }}>No differences — the widget already matches this chart.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>What changed</span>
                {diffLines.map((line, i) => (
                  <span key={i} style={{ ...MONO, fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>• {line}</span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                disabled={phase === 'applying'}
                style={{
                  ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                  border: '1px solid rgba(74,96,128,0.35)', borderRadius: 4, padding: '5px 12px',
                  background: 'transparent', color: MUTED, cursor: phase === 'applying' ? 'default' : 'pointer',
                }}
              >
                Discard
              </button>
              <button
                onClick={handleApply}
                disabled={phase === 'applying' || nothingChanged}
                style={{
                  ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                  border: 'none', borderRadius: 4, padding: '5px 14px', fontWeight: 600,
                  background: GOLD, color: '#0D1B2A',
                  cursor: phase === 'applying' || nothingChanged ? 'default' : 'pointer',
                  opacity: phase === 'applying' || nothingChanged ? 0.6 : 1,
                }}
              >
                {phase === 'applying' ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Compact before/after facet: chart kind + dims/measures by label. */
function WidgetFacet({
  label,
  widget,
  resolveLabel,
  tone,
}: {
  label: string;
  widget: WidgetSpec;
  resolveLabel: WidgetDiffLabelResolver;
  tone: 'muted' | 'gold';
}) {
  const dims = widget.semanticQuery.dimensions.map((d) => resolveLabel(d.dimensionId, 'dimension'));
  const measures = widget.semanticQuery.measures.map((m) => resolveLabel(m.measureId, 'measure'));
  const accent = tone === 'gold' ? GOLD : MUTED;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: `1px solid ${tone === 'gold' ? 'rgba(253,181,21,0.25)' : 'rgba(74,96,128,0.25)'}`,
        borderRadius: 4,
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span style={{ ...MONO, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent }}>{label}</span>
      <span style={{ ...MONO, fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>
        <span style={{ color: MUTED }}>Kind: </span>{widget.chartKind}
      </span>
      <span style={{ ...MONO, fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)', wordBreak: 'break-word' }}>
        <span style={{ color: MUTED }}>Dims: </span>{dims.length ? dims.join(', ') : '—'}
      </span>
      <span style={{ ...MONO, fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)', wordBreak: 'break-word' }}>
        <span style={{ color: MUTED }}>Measures: </span>{measures.length ? measures.join(', ') : '—'}
      </span>
    </div>
  );
}
