'use client';

/**
 * BlueprintDetailDrawer
 *
 * Slide-in right panel that opens when the user clicks a blueprint card.
 * Contains all the per-card metadata that was previously cluttering the card
 * body: title editing, rationale, field list, chart kind selector, governance
 * ladder, and the NL feedback → regenerate control.
 *
 * The card itself is kept to its visual minimum (chart + overlaid title chip +
 * remove); all curate affordances live here so the grid looks like the final
 * dashboard rather than a form.
 */

import React, { useCallback, useState } from 'react';
import {
  X, CornerDownLeft, Loader2, MessageSquare, Send, ShieldCheck,
  Check, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { ChartBlueprint, ResolvedIntent } from '@/lib/dashboards/guided-types';
import {
  UI_FONT, ACCENT_AMBER, GOVERNED, CANDIDATE, INK as INK_TOK,
  INK_MUTED, CARD_ELEVATED, BORDER,
} from '@/lib/dashboards/inspector-viz-tokens';

const GOLD = ACCENT_AMBER;
const GREEN = GOVERNED;
const VIOLET = CANDIDATE;
const MUTED = INK_MUTED;
const INK = INK_TOK;
const BLUE = '#56B4E9';

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const CHART_KIND_OPTIONS = [
  'bar', 'line', 'scatter', 'kpi', 'pie', 'heatmap', 'table',
] as const;

interface Props {
  item: ChartBlueprint;
  modelId: string;
  intent: ResolvedIntent;
  onClose: () => void;
  onRename: (title: string) => void;
  onUpdate: (patch: Partial<ChartBlueprint>) => void;
  onOpenDefine: () => void;
}

export function BlueprintDetailDrawer({
  item, modelId, intent, onClose, onRename, onUpdate, onOpenDefine,
}: Props) {
  const [summaryOpen, setSummaryOpen] = useState(true);
  const pd = item.pendingDefinition;
  const measureCount = item.measureLabels.length;
  const dimCount = item.dimensionLabels.length;

  // ── NL feedback → regenerate ──────────────────────────────────────────────
  const [feedback, setFeedback] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const handleRegenerate = useCallback(async () => {
    const fb = feedback.trim();
    if (!fb || regenerating) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/blueprint/refine-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, item, feedback: fb }),
      });
      if (!res.ok) throw new Error(`Refine failed: ${res.status}`);
      const json = (await res.json()) as { item: ChartBlueprint };
      const { id: _ignored, ...patch } = json.item;
      onUpdate(patch);
      setFeedback('');
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Could not refine this chart.');
    } finally {
      setRegenerating(false);
    }
  }, [feedback, regenerating, modelId, intent, item, onUpdate]);

  // ── Governance ladder ─────────────────────────────────────────────────────
  const [ladderBusy, setLadderBusy] = useState(false);
  const [ladderError, setLadderError] = useState<string | null>(null);

  const handleSubmitForGovernance = useCallback(async () => {
    if (!pd || ladderBusy) return;
    setLadderBusy(true);
    setLadderError(null);
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionIds: [pd.id], tableKind: pd.tableKind }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? 'Submit failed');
      }
      const nextMeasureIds = pd.tableKind === 'measure' ? [...item.measureIds, pd.id] : item.measureIds;
      const nextMeasureLabels = pd.tableKind === 'measure' ? [...item.measureLabels, pd.label] : item.measureLabels;
      const nextDimIds = pd.tableKind === 'dimension' ? [...item.dimensionIds, pd.id] : item.dimensionIds;
      const nextDimLabels = pd.tableKind === 'dimension' ? [...item.dimensionLabels, pd.label] : item.dimensionLabels;
      onUpdate({
        grounding: nextMeasureIds.length > 0 ? 'governed' : 'undefined',
        undefinedTerm: nextMeasureIds.length > 0 ? undefined : item.undefinedTerm,
        undefinedProvenance: nextMeasureIds.length > 0 ? undefined : item.undefinedProvenance,
        measureIds: nextMeasureIds,
        measureLabels: nextMeasureLabels,
        dimensionIds: nextDimIds,
        dimensionLabels: nextDimLabels,
        pendingDefinition: { ...pd, tier: 'candidate' },
      });
    } catch (err) {
      setLadderError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setLadderBusy(false);
    }
  }, [pd, ladderBusy, modelId, item, onUpdate]);

  const handlePromote = useCallback(async () => {
    if (!pd || ladderBusy) return;
    setLadderBusy(true);
    setLadderError(null);
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionIds: [pd.id], tableKind: pd.tableKind }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(d.reason || d.error || 'Promote failed');
      }
      onUpdate({ pendingDefinition: { ...pd, tier: 'governed' } });
    } catch (err) {
      setLadderError(err instanceof Error ? err.message : 'Promote failed');
    } finally {
      setLadderBusy(false);
    }
  }, [pd, ladderBusy, modelId, onUpdate]);

  const undefined_ = item.grounding === 'undefined';

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 50,
        width: 340, background: CARD_ELEVATED,
        borderLeft: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
        fontFamily: UI_FONT,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        borderBottom: `1px solid ${tint(MUTED, 20)}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, fontWeight: 600, flex: 1 }}>
          Chart Details
        </span>
        <button
          onClick={onClose}
          aria-label="Close details"
          style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', padding: 4, display: 'inline-flex' }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, fontWeight: 600 }}>
            Title
          </label>
          <input
            value={item.title}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Chart title"
            style={{
              fontFamily: UI_FONT, fontSize: 13, fontWeight: 600, color: INK,
              background: tint(MUTED, 8), border: `1px solid ${tint(MUTED, 25)}`,
              borderRadius: 6, padding: '8px 10px', outline: 'none', width: '100%',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = tint(GOLD, 60))}
            onBlur={(e) => (e.currentTarget.style.borderColor = tint(MUTED, 25))}
          />
        </div>

        {/* Chart kind selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, fontWeight: 600 }}>
            Chart Type
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CHART_KIND_OPTIONS.map((kind) => (
              <button
                key={kind}
                onClick={() => onUpdate({ chartKindGuess: kind })}
                style={{
                  fontFamily: UI_FONT, fontSize: 10, letterSpacing: '0.04em',
                  textTransform: 'uppercase', fontWeight: 600,
                  padding: '4px 10px', borderRadius: 5,
                  border: `1px solid ${item.chartKindGuess === kind ? tint(GOLD, 60) : tint(MUTED, 30)}`,
                  background: item.chartKindGuess === kind ? tint(GOLD, 15) : 'transparent',
                  color: item.chartKindGuess === kind ? GOLD : MUTED,
                  cursor: 'pointer',
                }}
              >
                {kind}
              </button>
            ))}
          </div>
        </div>

        {/* Fields */}
        {(measureCount > 0 || dimCount > 0) && (
          <div>
            <button
              onClick={() => setSummaryOpen((o) => !o)}
              style={{
                fontFamily: UI_FONT, fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: MUTED, fontWeight: 600, background: 'transparent', border: 'none',
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, marginBottom: 6,
              }}
            >
              {summaryOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Fields ({measureCount} measure{measureCount === 1 ? '' : 's'} · {dimCount} dimension{dimCount === 1 ? '' : 's'})
            </button>
            {summaryOpen && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {item.measureLabels.map((label, i) => (
                  <span key={`m${i}`} style={fieldChip(GREEN)}>{label}</span>
                ))}
                {dimCount > 0 && <span style={{ fontFamily: UI_FONT, fontSize: 10, color: MUTED, alignSelf: 'center' }}>by</span>}
                {item.dimensionLabels.map((label, i) => (
                  <span key={`d${i}`} style={fieldChip(BLUE)}>{label}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rationale */}
        {item.rationale && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, fontWeight: 600 }}>
              Why this chart
            </span>
            <p style={{ fontFamily: UI_FONT, fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.6, padding: '8px 10px', background: tint(MUTED, 6), borderRadius: 6 }}>
              {item.rationale}
            </p>
          </div>
        )}

        {/* Undefined item – define nudge */}
        {undefined_ && (
          <div style={{
            padding: '12px 14px', borderRadius: 8, border: `1px dashed ${tint(VIOLET, 40)}`,
            background: tint(VIOLET, 6), display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <span style={{ fontSize: 11.5, color: VIOLET }}>
              "{item.undefinedTerm ?? item.title}" isn't in the governed catalog yet.
            </span>
            <button
              onClick={onOpenDefine}
              style={{
                fontFamily: UI_FONT, fontSize: 11.5, color: VIOLET, background: tint(VIOLET, 12),
                border: `1px solid ${tint(VIOLET, 40)}`, borderRadius: 6, padding: '6px 12px',
                cursor: 'pointer', alignSelf: 'flex-start',
              }}
            >
              Define this metric
            </button>
          </div>
        )}

        {/* Governance ladder */}
        {pd && (
          <div style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${tint(GOLD, 28)}`, background: tint(GOLD, 6), display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, border: `1px solid ${tint(MUTED, 40)}`, borderRadius: 3, padding: '1px 6px' }}>
                {pd.tier}
              </span>
              <span style={{ fontSize: 11, color: INK }}>{pd.label}</span>
              <span style={{ flex: 1 }} />
              {pd.tier === 'draft' && (
                <button onClick={handleSubmitForGovernance} disabled={ladderBusy} style={ladderBtnStyle(GOLD, ladderBusy)}>
                  {ladderBusy ? <Loader2 size={11} className="spin" /> : <Send size={11} />} Submit
                </button>
              )}
              {pd.tier === 'candidate' && (
                <button onClick={handlePromote} disabled={ladderBusy} style={ladderBtnStyle(GREEN, ladderBusy)}>
                  {ladderBusy ? <Loader2 size={11} className="spin" /> : <ShieldCheck size={11} />} Promote
                </button>
              )}
              {pd.tier === 'governed' && (
                <span style={{ fontSize: 10.5, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Check size={12} /> Governed
                </span>
              )}
            </div>
            {pd.tier === 'draft' && (
              <span style={{ fontSize: 10, color: MUTED, lineHeight: 1.4 }}>
                Draft is private to you — submit it so this chart can use it.
              </span>
            )}
            {ladderError && <span style={{ fontSize: 10.5, color: '#F87171' }}>{ladderError}</span>}
          </div>
        )}

        {/* NL feedback → regenerate */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, fontWeight: 600 }}>
            <MessageSquare size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Refine this chart
          </span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRegenerate(); }}
            rows={3}
            placeholder='e.g. "wrong metric — use lost-time injuries", "make it a line by month"'
            style={{
              fontFamily: UI_FONT, fontSize: 11.5, resize: 'vertical', color: INK, lineHeight: 1.5,
              background: tint(MUTED, 8), border: `1px solid ${tint(MUTED, 25)}`, borderRadius: 6,
              padding: '8px 10px', outline: 'none', width: '100%',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = tint(GOLD, 60))}
            onBlur={(e) => (e.currentTarget.style.borderColor = tint(MUTED, 25))}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleRegenerate}
              disabled={!feedback.trim() || regenerating}
              style={{
                fontFamily: UI_FONT, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '7px 13px', borderRadius: 6,
                border: feedback.trim() ? `1px solid ${tint(GOLD, 60)}` : `1px dashed ${tint(MUTED, 40)}`,
                background: feedback.trim() ? tint(GOLD, 10) : 'transparent',
                color: feedback.trim() ? GOLD : MUTED,
                cursor: !feedback.trim() || regenerating ? 'default' : 'pointer',
              }}
            >
              {regenerating ? <Loader2 size={12} className="spin" /> : <CornerDownLeft size={12} />}
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            {regenError && <span style={{ fontSize: 10.5, color: '#F87171' }}>{regenError}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function fieldChip(color: string): React.CSSProperties {
  return {
    fontFamily: UI_FONT, fontSize: 11, padding: '3px 9px', borderRadius: 12,
    border: `1px solid ${tint(color, 34)}`, background: tint(color, 10), color, whiteSpace: 'nowrap',
  };
}

function ladderBtnStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    fontFamily: UI_FONT, fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 9px', borderRadius: 5, border: `1px solid ${tint(color, 55)}`,
    background: tint(color, 12), color, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}
