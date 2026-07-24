'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, X, Plus, Loader2,
  BarChart3, LineChart, ScatterChart, PieChart, Table2, Hash, Grid3x3, AlertTriangle,
  MessageSquare, CornerDownLeft, PenLine, Send, ShieldCheck, Check,
} from 'lucide-react';
import { useBuilderStore } from '../builder-store';
import { DefineMetricPanel, type CreatedDefinition } from '../../authoring/DefineMetricPanel';
import type {
  ResolvedIntent, ChartBlueprint, ChartKindGuess, GuidedBlueprint,
} from '@/lib/dashboards/guided-types';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';
// Theme-aware accents: bright on dark, darkened for parchment legibility on light.
const GREEN = 'var(--bp-measure, #34D399)';
const BLUE = 'var(--bp-dimension, #93C5FD)';
const VIOLET = 'var(--bp-undefined, #C4B5FD)';
const MUTED = 'var(--wb-muted, #8892A4)';
const INK = 'var(--wb-ink, #E6ECF5)';

/** Alpha-tint any color (incl. a CSS var) — theme-safe, no hex concatenation. */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/**
 * Chart-kind → glyph. The guess comes from recommendChartKind (server-side).
 * Color rides on `style` (not the `color` prop) so a CSS-var accent resolves —
 * var() is invalid in the SVG `stroke` attribute lucide's `color` prop writes to,
 * but valid in `style.color`, which the default `stroke="currentColor"` inherits.
 */
function KindIcon({ kind, color }: { kind: ChartKindGuess; color: string }) {
  const size = 15;
  const s = { color };
  switch (kind) {
    case 'kpi': return <Hash size={size} style={s} />;
    case 'line': return <LineChart size={size} style={s} />;
    case 'scatter': return <ScatterChart size={size} style={s} />;
    case 'heatmap': return <Grid3x3 size={size} style={s} />;
    case 'pie': return <PieChart size={size} style={s} />;
    case 'table': return <Table2 size={size} style={s} />;
    case 'bar':
    default: return <BarChart3 size={size} style={s} />;
  }
}

interface Props {
  /** The dashboard's bound model. */
  modelId: string;
  /** Stage-1 resolved intent — the proposal input. */
  intent: ResolvedIntent;
  /** Accept the blueprint → hand off to Phase 4 drill-in. Does NOT build widgets. */
  onAccept?: (blueprint: GuidedBlueprint) => void;
  /** Return to Stage 1 (Intent). */
  onBack?: () => void;
}

/**
 * Guided Stage 2 — Blueprint (the hero, the single human-judgment gate).
 *
 * Renders the server-grounded ChartBlueprint[] as a reviewable outline the user
 * curates (reorder / rename / remove / add / accept-all). NOTHING renders live —
 * each card is a proposed spec, not an executed chart. Curate ops mutate only
 * `guidedSession.blueprint`; accepting hands off to Phase 4 (no widgets built).
 */
export function BlueprintStage({ modelId, intent, onAccept, onBack }: Props) {
  const blueprint = useBuilderStore((s) => s.guidedSession.blueprint);
  const setBlueprint = useBuilderStore((s) => s.setBlueprint);
  const reorderItem = useBuilderStore((s) => s.reorderBlueprintItem);
  const renameItem = useBuilderStore((s) => s.renameBlueprintItem);
  const removeItem = useBuilderStore((s) => s.removeBlueprintItem);
  const updateItem = useBuilderStore((s) => s.updateBlueprintItem);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedRef = useRef(false);

  // Which item's inline "Define a metric" modal is open (null = closed). The
  // modal is mounted once at the stage root; the ladder state it produces lives
  // on the blueprint item (pendingDefinition), not here — so it survives reload.
  const [definingItemId, setDefiningItemId] = useState<string | null>(null);
  const definingItem = blueprint?.items.find((i) => i.id === definingItemId) ?? null;

  const handleDefinitionCreated = useCallback(
    (def: CreatedDefinition) => {
      if (!definingItemId) return;
      // Draft created → record the ladder rung on the item. NOT grounded yet: a
      // draft is invisible to the shared blueprint/resolve loads, so we only flip
      // to grounded after Submit (→candidate). See plan Context.
      updateItem(definingItemId, {
        pendingDefinition: { id: def.id, tableKind: def.tableKind, label: def.label, tier: 'draft' },
      });
      setDefiningItemId(null);
    },
    [definingItemId, updateItem],
  );

  // ── Propose once on mount (grounded server-side). ────────────────────────────
  useEffect(() => {
    // Reuse an existing blueprint (e.g. returning from Phase 4); only propose fresh.
    if (blueprint || requestedRef.current) return;
    requestedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/inspector/semantic/${modelId}/blueprint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent }),
        });
        if (!res.ok) throw new Error(`Blueprint request failed: ${res.status}`);
        const json = (await res.json()) as GuidedBlueprint;
        if (!cancelled) setBlueprint(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not propose a blueprint.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [blueprint, modelId, intent, setBlueprint]);

  const handleAddAnother = useCallback(() => {
    const bp = useBuilderStore.getState().guidedSession.blueprint;
    if (!bp) return;
    // "Add another" seeds a define-it row the user fills in the drill-in / Teach.
    // Never fabricated: empty ids, grounding 'undefined' until a real def is chosen.
    const next: ChartBlueprint = {
      id: `bp_added_${bp.items.length}_${bp.items.reduce((n, i) => n + i.title.length, 0)}`,
      title: 'New chart',
      measureIds: [], dimensionIds: [], measureLabels: [], dimensionLabels: [],
      filters: [], chartKindGuess: 'table', rationale: '', grounding: 'undefined',
      undefinedTerm: 'New chart',
    };
    useBuilderStore.getState().addBlueprintItem(next);
  }, []);

  const governedCount = blueprint?.items.filter((i) => i.grounding === 'governed').length ?? 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color={GOLD} />
          <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: GOLD }}>
            Guided · Step 2 · Blueprint
          </span>
        </div>
        <h2 style={{ ...MONO, fontSize: 17, lineHeight: 1.4, color: INK, margin: 0, fontWeight: 600 }}>
          Here’s a plan. Curate it before we build anything.
        </h2>
        <p style={{ ...MONO, fontSize: 11, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Each row is a proposed chart — nothing runs yet. Reorder, rename, remove, or add. This is the
          one place to review the whole dashboard at once.
        </p>
      </div>

      {/* ── Model-level candidate banner (never per-row) ────────────────────────── */}
      {blueprint?.modelStatus === 'candidate' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 6, border: `1px solid ${tint(VIOLET, 34)}`, background: tint(VIOLET, 8) }}>
          <AlertTriangle size={13} style={{ color: VIOLET }} />
          <span style={{ ...MONO, fontSize: 10.5, color: INK, lineHeight: 1.4 }}>
            This model isn’t governed yet — charts will render in draft (owner-only) until it’s published.
          </span>
        </div>
      )}

      {/* ── Loading / error / empty ─────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...MONO, fontSize: 11, color: MUTED, padding: '18px 0' }}>
          <Loader2 size={14} className="spin" /> Proposing charts from your governed metrics…
        </div>
      )}
      {error && !loading && (
        <div style={{ ...MONO, fontSize: 11, color: '#F87171', padding: '10px 12px', borderRadius: 6, background: 'rgba(248,113,113,0.08)' }}>
          {error}
        </div>
      )}
      {!loading && blueprint && blueprint.items.length === 0 && (
        <p style={{ ...MONO, fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
          No charts could be grounded in this model’s governed metrics for that intent. Add one below, or
          define the metric you need in Teach — we won’t invent a metric that doesn’t exist.
        </p>
      )}

      {/* ── Card list ───────────────────────────────────────────────────────────── */}
      {!loading && blueprint && blueprint.items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {blueprint.items.map((item, idx) => (
            <BlueprintCard
              key={item.id}
              item={item}
              index={idx}
              count={blueprint.items.length}
              modelId={modelId}
              intent={intent}
              onRename={(title) => renameItem(item.id, title)}
              onRemove={() => removeItem(item.id)}
              onMoveUp={() => reorderItem(idx, idx - 1)}
              onMoveDown={() => reorderItem(idx, idx + 1)}
              onUpdate={(patch) => updateItem(item.id, patch)}
              onOpenDefine={() => setDefiningItemId(item.id)}
            />
          ))}
        </div>
      )}

      {/* ── Curate controls ─────────────────────────────────────────────────────── */}
      {!loading && blueprint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
          <button
            onClick={handleAddAnother}
            style={{
              ...MONO, fontSize: 10.5, letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 6, border: `1px dashed ${tint(MUTED, 55)}`,
              background: 'transparent', color: MUTED, cursor: 'pointer',
            }}
          >
            <Plus size={13} /> Add another
          </button>
          <div style={{ flex: 1 }} />
          {onBack && (
            <button
              onClick={onBack}
              style={{ ...MONO, fontSize: 10, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <ArrowLeft size={12} /> Back to intent
            </button>
          )}
          <button
            onClick={() => blueprint && onAccept?.(blueprint)}
            disabled={governedCount === 0}
            title={governedCount === 0 ? 'Add at least one grounded chart first' : 'Accept all — refine each chart next'}
            style={{
              ...MONO, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 6, border: 'none',
              background: governedCount > 0 ? GOLD : 'rgba(253,181,21,0.3)', color: '#0D1B2A',
              cursor: governedCount > 0 ? 'pointer' : 'default', fontWeight: 500,
            }}
          >
            Accept all — refine next <ArrowRight size={13} />
          </button>
        </div>
      )}

      {/* ── Inline "Define a metric" — the reverse of the old Teach out-link ─────── */}
      {definingItem && (
        <DefineMetricPanel
          modelId={modelId}
          prefill={{
            tableKind: 'measure', // a default hint; the panel keeps its measure/dimension toggle
            measureLabel: definingItem.undefinedTerm ?? definingItem.title,
            nlIntent: intent.topic,
          }}
          onDefinitionCreated={handleDefinitionCreated}
          onClose={() => setDefiningItemId(null)}
        />
      )}
    </div>
  );
}

/**
 * One blueprint card: title (inline-editable), chips, kind icon, rationale, a
 * per-chart NL feedback → regenerate control (Request 1), and — for an undefined
 * item — the inline define-metric affordance + governance ladder (Request 2).
 */
function BlueprintCard({
  item, index, count, modelId, intent, onRename, onRemove, onMoveUp, onMoveDown, onUpdate, onOpenDefine,
}: {
  item: ChartBlueprint;
  index: number;
  count: number;
  modelId: string;
  intent: ResolvedIntent;
  onRename: (title: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (patch: Partial<ChartBlueprint>) => void;
  onOpenDefine: () => void;
}) {
  const undefined_ = item.grounding === 'undefined';
  const accent = undefined_ ? VIOLET : GREEN;
  const pd = item.pendingDefinition;

  // ── Request 1: NL feedback → regenerate THIS chart ───────────────────────────
  const [showFeedback, setShowFeedback] = useState(false);
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
      // Replace fields in place — id is preserved server-side; strip it defensively.
      const { id: _ignored, ...patch } = json.item;
      onUpdate(patch);
      setFeedback('');
      setShowFeedback(false);
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Could not refine this chart.');
    } finally {
      setRegenerating(false);
    }
  }, [feedback, regenerating, modelId, intent, item, onUpdate]);

  // ── Request 2: governance ladder for an inline-defined metric ────────────────
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
      // Now a candidate → flip the card to grounded, appending the new field to
      // the correct slot (measure vs dimension). Grounded only if a measure
      // exists (a chart still needs a metric to render/confirm).
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
        // 403 = reputation gate (admin-only day one) — surface the reason, don't crash.
        throw new Error(d.reason || d.error || 'Promote failed');
      }
      onUpdate({ pendingDefinition: { ...pd, tier: 'governed' } });
    } catch (err) {
      setLadderError(err instanceof Error ? err.message : 'Promote failed');
    } finally {
      setLadderBusy(false);
    }
  }, [pd, ladderBusy, modelId, onUpdate]);

  // Provenance-aware nudge copy — now inline-define, not Teach.
  const prov = item.undefinedProvenance;
  const nudgeLabel = prov?.candidateExists
    ? 'defined but not governed — govern it here'
    : prov?.cappedByTopK
      ? 'may exist beyond search — confirm or define it here'
      : 'not defined yet — define it here';

  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 8,
        border: `1px solid ${undefined_ ? tint(VIOLET, 27) : 'var(--bp-card-border, rgba(136,146,164,0.2))'}`,
        background: undefined_ ? tint(VIOLET, 6) : 'var(--bp-card-bg, rgba(0,0,0,0.15))',
      }}
    >
      {/* Kind icon */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 2 }}>
        <KindIcon kind={item.chartKindGuess} color={accent} />
        <span style={{ ...MONO, fontSize: 8, color: MUTED, textTransform: 'uppercase' }}>{item.chartKindGuess}</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          value={item.title}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Chart title"
          style={{
            ...MONO, fontSize: 13, fontWeight: 600, color: INK, background: 'transparent',
            border: 'none', borderBottom: '1px solid transparent', outline: 'none', padding: '1px 0',
          }}
          onFocus={(e) => (e.target.style.borderBottomColor = 'rgba(136,146,164,0.4)')}
          onBlur={(e) => (e.target.style.borderBottomColor = 'transparent')}
        />

        {/* Chips — labels ride beside IDs (no second lookup) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {item.measureLabels.map((label, i) => (
            <span key={`m${i}`} style={chipStyle(GREEN)}>{label}</span>
          ))}
          {item.dimensionLabels.length > 0 && (
            <span style={{ ...MONO, fontSize: 9, color: MUTED }}>by</span>
          )}
          {item.dimensionLabels.map((label, i) => (
            <span key={`d${i}`} style={chipStyle(BLUE)}>{label}</span>
          ))}
        </div>

        {/* Undefined + not yet defined → inline define affordance (provenance-aware). */}
        {undefined_ && !pd && (
          <button
            onClick={onOpenDefine}
            data-undefined-term={item.undefinedTerm ?? ''}
            style={{
              ...MONO, fontSize: 10, color: VIOLET, background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5, textAlign: 'left', padding: 0,
            }}
          >
            <PenLine size={11} />
            <span style={{ textDecoration: 'underline dotted', textDecorationColor: VIOLET }}>
              “{item.undefinedTerm ?? item.title}” — {nudgeLabel}
            </span>
            <ArrowRight size={11} />
          </button>
        )}

        {/* Governance ladder for an inline-defined metric. */}
        {pd && <LadderStrip pd={pd} busy={ladderBusy} error={ladderError} onSubmit={handleSubmitForGovernance} onPromote={handlePromote} />}

        {item.rationale && (
          <p style={{ ...MONO, fontSize: 10.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>{item.rationale}</p>
        )}

        {/* Request 1: NL feedback → regenerate this chart. */}
        {showFeedback ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRegenerate(); }}
                rows={2}
                autoFocus
                aria-label="Feedback for this chart"
                placeholder="e.g. “wrong metric — use lost-time injuries”, “make it a line by month”, “add avg days between inspections”"
                style={{
                  ...MONO, fontSize: 10.5, flex: 1, resize: 'vertical', color: INK, lineHeight: 1.5,
                  background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(136,146,164,0.28)', borderRadius: 6,
                  padding: '7px 9px', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleRegenerate}
                disabled={!feedback.trim() || regenerating}
                style={{
                  ...MONO, fontSize: 10, letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 11px', borderRadius: 6,
                  border: feedback.trim() ? `1px solid ${tint(GOLD, 60)}` : '1px dashed rgba(136,146,164,0.4)',
                  background: feedback.trim() ? tint(GOLD, 10) : 'transparent',
                  color: feedback.trim() ? GOLD : MUTED, cursor: !feedback.trim() || regenerating ? 'default' : 'pointer',
                }}
              >
                {regenerating ? <Loader2 size={12} className="spin" /> : <CornerDownLeft size={12} />}
                {regenerating ? 'Regenerating…' : 'Regenerate chart'}
              </button>
              <button
                onClick={() => { setShowFeedback(false); setFeedback(''); setRegenError(null); }}
                style={{ ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
              {regenError && <span style={{ ...MONO, fontSize: 9.5, color: '#F87171' }}>{regenError}</span>}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowFeedback(true)}
            style={{
              ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, marginTop: 2, alignSelf: 'flex-start',
            }}
          >
            <MessageSquare size={11} /> Give feedback / refine
          </button>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <button onClick={onMoveUp} disabled={index === 0} aria-label="Move up" style={iconBtn(index === 0)}>
          <ArrowUp size={13} />
        </button>
        <button onClick={onMoveDown} disabled={index === count - 1} aria-label="Move down" style={iconBtn(index === count - 1)}>
          <ArrowDown size={13} />
        </button>
        <button onClick={onRemove} aria-label="Remove" style={{ ...iconBtn(false), color: '#F87171' }}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Governance-ladder strip for a metric defined inline from this card:
 * draft → (Submit) → candidate → (Promote) → governed. Promote is
 * reputation-gated server-side; a 403 surfaces its reason here, never a crash.
 */
function LadderStrip({
  pd, busy, error, onSubmit, onPromote,
}: {
  pd: NonNullable<ChartBlueprint['pendingDefinition']>;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onPromote: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '7px 9px', borderRadius: 6, border: `1px solid ${tint(GOLD, 28)}`, background: tint(GOLD, 6) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, border: '1px solid rgba(136,146,164,0.35)', borderRadius: 3, padding: '1px 6px' }}>
          {pd.tier}
        </span>
        <span style={{ ...MONO, fontSize: 10, color: INK }}>{pd.label}</span>
        <span style={{ flex: 1 }} />
        {pd.tier === 'draft' && (
          <button onClick={onSubmit} disabled={busy} style={ladderBtn(GOLD, busy)}>
            {busy ? <Loader2 size={11} className="spin" /> : <Send size={11} />} Submit for governance
          </button>
        )}
        {pd.tier === 'candidate' && (
          <button onClick={onPromote} disabled={busy} style={ladderBtn(GREEN, busy)}>
            {busy ? <Loader2 size={11} className="spin" /> : <ShieldCheck size={11} />} Promote to governed
          </button>
        )}
        {pd.tier === 'governed' && (
          <span style={{ ...MONO, fontSize: 9.5, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} /> Governed
          </span>
        )}
      </div>
      {pd.tier === 'draft' && (
        <span style={{ ...MONO, fontSize: 9, color: MUTED, lineHeight: 1.4 }}>
          Draft is private to you — submit it so this chart can use it.
        </span>
      )}
      {error && <span style={{ ...MONO, fontSize: 9.5, color: '#F87171', lineHeight: 1.4 }}>{error}</span>}
    </div>
  );
}

function chipStyle(color: string): React.CSSProperties {
  return {
    ...MONO, fontSize: 10, padding: '3px 8px', borderRadius: 12,
    border: `1px solid ${tint(color, 34)}`, background: tint(color, 10), color, whiteSpace: 'nowrap',
  };
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
    borderRadius: 4, border: '1px solid var(--bp-card-border, rgba(136,146,164,0.2))', background: 'transparent',
    color: disabled ? tint(MUTED, 40) : MUTED, cursor: disabled ? 'default' : 'pointer',
  };
}

function ladderBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    ...MONO, fontSize: 9, letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 9px', borderRadius: 5, border: `1px solid ${tint(color, 55)}`,
    background: tint(color, 12), color, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}
