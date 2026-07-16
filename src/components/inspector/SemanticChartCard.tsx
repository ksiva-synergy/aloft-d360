'use client';

import React, { useState } from 'react';
import { BookmarkPlus, Check, X, Pin } from 'lucide-react';
import StudioChart from '@/components/studio/StudioChart';
import { PinToDashboardDialog } from './PinToDashboardDialog';
import type { SemanticChartMessage } from '@/hooks/useInspectorChat';
import type { ChartSpec } from '@/lib/studio/types';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';

interface SemanticChartCardProps {
  message: SemanticChartMessage;
  /** Pre-compiled ECharts option from the SSE event — avoids re-running compiler */
  echartsOption: object;
}

/**
 * Renders a semantic chart result inline in the Inspector chat thread.
 * Provides a "Save to Charts" button that promotes the chart to platform_charts.
 * The chart can later be assigned to a dashboard widget via DefinitionPicker's
 * Charts tab (Decision 2: click-to-assign, Option B: one-time copy).
 */
export function SemanticChartCard({ message, echartsOption }: SemanticChartCardProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [savedChartId, setSavedChartId] = useState<string | null>(null);
  const [chartName, setChartName] = useState(message.chartDsl.title);
  const [chartDesc, setChartDesc] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Build a minimal ChartSpec so StudioChart can render the pre-compiled option
  const spec: ChartSpec = {
    id: message.id,
    kind: dslKindToChartKind(message.chartDsl.kind),
    title: message.chartDsl.title,
    rationale: 'semantic chart',
    echartsOption,
    dsl: message.chartDsl,
    rank: 0,
    alternatives: [],
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/inspector/charts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: message.semanticQuery.modelId,
          name: chartName.trim() || message.chartDsl.title,
          description: chartDesc.trim() || undefined,
          chartDsl: message.chartDsl,
          semanticQuery: message.semanticQuery,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        setSaveError(data.error ?? `Save failed (${resp.status})`);
        return;
      }
      const data = await resp.json().catch(() => ({})) as { chart?: { id: string } };
      if (data.chart?.id) setSavedChartId(data.chart.id);
      setSaved(true);
      setShowDialog(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${saved ? 'rgba(134,239,172,0.3)' : 'rgba(253,181,21,0.15)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid rgba(253,181,21,0.08)',
          gap: 8,
        }}
      >
        <span
          style={{
            ...MONO,
            fontSize: 10,
            letterSpacing: '0.06em',
            color: GOLD,
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {message.chartDsl.title}
        </span>
        <span
          style={{
            ...MONO,
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--wb-muted)',
            padding: '2px 6px',
            border: '1px solid rgba(74,96,128,0.25)',
            borderRadius: 3,
            flexShrink: 0,
          }}
        >
          {message.chartDsl.kind}
        </span>
        {/* Pin to dashboard — the signature Phase 2 action, always available */}
        <button
          onClick={() => setShowPinDialog(true)}
          title="Pin to dashboard"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            ...MONO,
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            border: 'none',
            borderRadius: 3,
            padding: '3px 8px',
            background: GOLD,
            color: '#0D1B2A',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <Pin size={11} />
          PIN
        </button>
        {saved ? (
          <span
            style={{
              ...MONO,
              fontSize: 9,
              color: '#86EFAC',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <Check size={11} />
            SAVED
          </span>
        ) : (
          <button
            onClick={() => setShowDialog(true)}
            title="Save to Charts"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              ...MONO,
              fontSize: 9,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              border: `1px solid rgba(253,181,21,0.35)`,
              borderRadius: 3,
              padding: '3px 8px',
              background: 'transparent',
              color: GOLD,
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(253,181,21,0.10)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <BookmarkPlus size={11} />
            SAVE TO CHARTS
          </button>
        )}
      </div>

      {/* Chart */}
      <div style={{ padding: '8px 4px' }}>
        <StudioChart spec={spec} height={260} />
      </div>

      {/* SQL disclosure */}
      <details style={{ padding: '0 12px 8px' }}>
        <summary
          style={{
            ...MONO,
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--wb-muted)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          SQL
        </summary>
        <pre
          style={{
            ...MONO,
            fontSize: 10,
            color: 'var(--wb-ink-dim)',
            overflowX: 'auto',
            margin: '6px 0 0',
            padding: '8px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 3,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {message.sql}
        </pre>
      </details>

      {/* Save dialog */}
      {showDialog && (
        <div
          style={{
            padding: '12px',
            borderTop: '1px solid rgba(253,181,21,0.15)',
            background: 'rgba(0,0,0,0.15)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.06em', color: GOLD, textTransform: 'uppercase' }}>
              SAVE CHART
            </span>
            <button
              onClick={() => { setShowDialog(false); setSaveError(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wb-muted)', display: 'flex', alignItems: 'center' }}
            >
              <X size={13} />
            </button>
          </div>
          <input
            type="text"
            value={chartName}
            onChange={(e) => setChartName(e.target.value)}
            placeholder="Chart name"
            style={{
              ...MONO,
              fontSize: 11,
              width: '100%',
              background: 'var(--wb-canvas)',
              border: '1px solid rgba(253,181,21,0.25)',
              borderRadius: 4,
              padding: '6px 8px',
              color: 'var(--wb-text)',
              outline: 'none',
              marginBottom: 6,
              boxSizing: 'border-box',
            }}
          />
          <input
            type="text"
            value={chartDesc}
            onChange={(e) => setChartDesc(e.target.value)}
            placeholder="Description (optional)"
            style={{
              ...MONO,
              fontSize: 11,
              width: '100%',
              background: 'var(--wb-canvas)',
              border: '1px solid rgba(253,181,21,0.15)',
              borderRadius: 4,
              padding: '6px 8px',
              color: 'var(--wb-text)',
              outline: 'none',
              marginBottom: 8,
              boxSizing: 'border-box',
            }}
          />
          {saveError && (
            <p style={{ ...MONO, fontSize: 10, color: '#F87171', marginBottom: 6 }}>{saveError}</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              ...MONO,
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: GOLD,
              color: '#0D1B2A',
              border: 'none',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
              fontWeight: 600,
            }}
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      )}

      {/* Pin to dashboard dialog */}
      {showPinDialog && (
        <PinToDashboardDialog
          message={message}
          savedChartId={savedChartId}
          onChartSaved={(id) => { setSavedChartId(id); setSaved(true); }}
          onClose={() => setShowPinDialog(false)}
        />
      )}
    </div>
  );
}

/**
 * Maps ChartDSLSpec.kind to WidgetSpec's ChartSpec['kind'] subset.
 * DSL kinds not present in ChartSpec are downgraded to the nearest equivalent.
 */
function dslKindToChartKind(kind: string): ChartSpec['kind'] {
  switch (kind) {
    case 'bar': return 'bar';
    case 'stacked-bar': return 'bar';   // downgrade: stack config in echartsOption
    case 'line': return 'line';
    case 'area': return 'line';         // downgrade: fill in echartsOption
    case 'pie': return 'donut';         // closest match
    case 'scatter': return 'scatter';
    case 'heatmap': return 'heatmap';
    case 'histogram': return 'histogram';
    case 'boxplot': return 'bar';       // fallback: no boxplot in ChartSpec
    default: return 'bar';
  }
}
