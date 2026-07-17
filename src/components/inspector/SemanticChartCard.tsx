'use client';

import React, { useState } from 'react';
import { BookmarkPlus, Check, X, Pin, Info, Wand2, GitCompare } from 'lucide-react';
import StudioChart from '@/components/studio/StudioChart';
import { PinToDashboardDialog } from './PinToDashboardDialog';
import { DraftChangeCard } from './DraftChangeCard';
import { TrustPanel } from './TrustPanel';
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
  /**
   * platform_charts id this session is refining (from ?sourceChart=). When set,
   * an "Apply to dashboard" affordance appears so a refined chart can be pushed
   * back to the dashboard widget it came from — through a draft-accept diff.
   */
  sourceChartId?: string | null;
  /**
   * Sends a conversational follow-up to the chat (wired to useInspectorChat.send).
   * Used by the refinement input to re-run the grounded pipeline with a tweak.
   */
  onRefine?: (followUp: string) => void;
}

/**
 * Renders a semantic chart result inline in the Inspector chat thread.
 * Provides a "Save to Charts" button that promotes the chart to platform_charts.
 * The chart can later be assigned to a dashboard widget via DefinitionPicker's
 * Charts tab (Decision 2: click-to-assign, Option B: one-time copy).
 */
export function SemanticChartCard({ message, echartsOption, sourceChartId, onRefine }: SemanticChartCardProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [savedChartId, setSavedChartId] = useState<string | null>(null);
  const [chartName, setChartName] = useState(message.chartDsl.title);
  const [chartDesc, setChartDesc] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');
  const [showDraft, setShowDraft] = useState(false);

  const handleRefine = () => {
    const text = refineText.trim();
    if (!text || !onRefine) return;
    // Prepend invisible context so the agent knows which chart is being refined
    // and its current governed shape. The follow-up re-runs the grounded pipeline
    // (compile → execute → chart) — never a client-side filter.
    const ctx =
      `[Refining the "${message.chartDsl.title}" chart. Its current governed query (JSON) is ` +
      `${JSON.stringify(message.semanticQuery)}. Apply the change described below by calling ` +
      `emit_semantic_chart again with the modified query — keep every field the user did not ask ` +
      `to change, and stay within the governed semantic model.]`;
    onRefine(`${ctx}\n\n${text}`);
    setRefineText('');
  };

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

      {/* "Why this chart" — smart-defaults rationale (Phase 3A) */}
      {message.recommendation?.rationale && (
        <div
          title={message.recommendation.rationale}
          style={{
            ...MONO,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 12px 0',
            fontSize: 9,
            color: 'var(--wb-muted)',
          }}
        >
          <Info size={10} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {message.recommendation.rationale}
          </span>
        </div>
      )}

      {/* Chart */}
      <div style={{ padding: '8px 4px' }}>
        <StudioChart spec={spec} height={260} />
      </div>

      {/* Trust Spine — how this was computed (collapsed by default) */}
      <div style={{ padding: '0 12px 10px' }}>
        <TrustPanel
          sql={message.sql}
          definitionsUsed={message.definitionsUsed}
          rowCount={message.rowCount}
          executedAt={message.executedAt}
          resolvedLabels={message.resolvedLabels}
        />
      </div>

      {/* Conversational refinement — re-runs the grounded pipeline with a tweak */}
      {onRefine && (
        <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Wand2 size={12} color={GOLD} style={{ flexShrink: 0 }} />
            <input
              type="text"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleRefine(); } }}
              placeholder='Refine this chart — e.g. "break out by region"'
              style={{
                ...MONO,
                fontSize: 11,
                flex: 1,
                background: 'var(--wb-canvas)',
                border: '1px solid rgba(253,181,21,0.2)',
                borderRadius: 4,
                padding: '6px 8px',
                color: 'var(--wb-text)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleRefine}
              disabled={!refineText.trim()}
              title="Refine chart"
              style={{
                ...MONO,
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                border: `1px solid rgba(253,181,21,0.35)`,
                borderRadius: 3,
                padding: '5px 10px',
                background: refineText.trim() ? GOLD : 'transparent',
                color: refineText.trim() ? '#0D1B2A' : GOLD,
                fontWeight: 600,
                cursor: refineText.trim() ? 'pointer' : 'default',
                opacity: refineText.trim() ? 1 : 0.6,
                flexShrink: 0,
              }}
            >
              Refine
            </button>
          </div>

          {/* Apply-to-dashboard (draft-accept) — only for charts refined from a widget */}
          {sourceChartId && (
            <>
              <button
                onClick={() => setShowDraft((s) => !s)}
                style={{
                  ...MONO,
                  fontSize: 9,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  alignSelf: 'flex-start',
                  border: `1px solid rgba(253,181,21,0.25)`,
                  borderRadius: 3,
                  padding: '4px 9px',
                  background: showDraft ? 'rgba(253,181,21,0.1)' : 'transparent',
                  color: GOLD,
                  cursor: 'pointer',
                }}
              >
                <GitCompare size={11} />
                Apply to dashboard
              </button>
              {showDraft && (
                <DraftChangeCard
                  modelId={message.semanticQuery.modelId}
                  sourceChartId={sourceChartId}
                  proposedChartDsl={message.chartDsl}
                  proposedSemanticQuery={message.semanticQuery}
                  proposedTitle={message.chartDsl.title}
                  onClose={() => setShowDraft(false)}
                />
              )}
            </>
          )}
        </div>
      )}

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
