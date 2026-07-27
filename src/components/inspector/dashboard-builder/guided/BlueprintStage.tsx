'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, ArrowRight, ArrowLeft, X, Plus, Loader2, AlertTriangle,
  MessageSquare, CornerDownLeft, PenLine, Send, ShieldCheck, Check, GripVertical,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useBuilderStore } from '../builder-store';
import { consumePrefetchedBlueprint, fetchBlueprint } from './blueprint-prefetch';
import { SamplePreviewChart } from './SamplePreviewChart';
import { DefineMetricPanel, type CreatedDefinition } from '../../authoring/DefineMetricPanel';
import type {
  ResolvedIntent, ChartBlueprint, GuidedBlueprint,
} from '@/lib/dashboards/guided-types';
import {
  UI_FONT, ACCENT_AMBER, GOVERNED, CANDIDATE, INK as INK_TOK, INK_MUTED,
  CANVAS, CARD, BORDER,
} from '@/lib/dashboards/inspector-viz-tokens';

const GOLD = ACCENT_AMBER;
const GREEN = GOVERNED;
const VIOLET = CANDIDATE;
const MUTED = INK_MUTED;
const INK = INK_TOK;

/** Alpha-tint any color (incl. a CSS var) — theme-safe, no hex concatenation. */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

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
 * REDESIGN: a responsive GRID of chart-PREVIEW cards, not a monospace pill-list.
 * Each governed card shows a `SamplePreviewChart` thumbnail (sample-badged — no
 * query runs here) in its proposed kind; each undefined card shows a distinct
 * soft "define it" state, never a fabricated chart. Curate ops (drag-reorder /
 * rename / remove / add / accept-all) mutate only `guidedSession.blueprint`;
 * accepting hands off to Phase 4 (no widgets built).
 *
 * The per-card affordances (NL feedback → regenerate, inline define + governance
 * ladder) and their seams (refine-item / submit / promote routes) are unchanged.
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
        // Reuse the call Stage 1 warmed for this exact intent, if any; otherwise
        // fetch fresh. Either way the ~25s may already be done by now.
        const json = await (consumePrefetchedBlueprint(modelId, intent) ?? fetchBlueprint(modelId, intent));
        if (!cancelled) setBlueprint(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not propose a blueprint.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      // Reset so a re-mount (React StrictMode double-invoke, or a real re-mount)
      // can re-fetch. Without this, the second mount sees requestedRef=true and
      // bails out, while the in-flight promise from the first mount resolves with
      // cancelled=true — discarding the result and leaving the spinner forever.
      requestedRef.current = false;
    };
  }, [blueprint, modelId, intent, setBlueprint]);

  const handleAddAnother = useCallback(() => {
    const bp = useBuilderStore.getState().guidedSession.blueprint;
    if (!bp) return;
    // "Add another" seeds a define-it card the user fills in via inline define.
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

  // ── Drag-to-reorder (grid-native HTML5 DnD; replaces the up/down arrows) ──────
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const handleDrop = useCallback(
    (toIndex: number) => {
      const from = dragIndexRef.current;
      dragIndexRef.current = null;
      setDragOverIndex(null);
      if (from == null || from === toIndex) return;
      reorderItem(from, toIndex);
    },
    [reorderItem],
  );

  const governedCount = blueprint?.items.filter((i) => i.grounding === 'governed').length ?? 0;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 20, background: CANVAS, minHeight: '100%' }}>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color={GOLD} />
          <span style={{ fontFamily: UI_FONT, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: GOLD, fontWeight: 600 }}>
            Guided · Step 2 · Blueprint
          </span>
        </div>
        <h2 style={{ fontFamily: UI_FONT, fontSize: 20, lineHeight: 1.35, color: INK, margin: 0, fontWeight: 600 }}>
          Here’s a plan. Curate it before we build anything.
        </h2>
        <p style={{ fontFamily: UI_FONT, fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.5, maxWidth: 640 }}>
          Each card is a proposed chart with sample data — nothing has run yet. Drag to reorder, rename,
          remove, or add. This is the one place to see the whole dashboard at once.
        </p>
      </div>

      {/* ── Model-level candidate banner (never per-card) ───────────────────────── */}
      {blueprint?.modelStatus === 'candidate' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, border: `1px solid ${tint(VIOLET, 34)}`, background: tint(VIOLET, 8) }}>
          <AlertTriangle size={14} style={{ color: VIOLET }} />
          <span style={{ fontFamily: UI_FONT, fontSize: 11.5, color: INK, lineHeight: 1.4 }}>
            This model isn’t governed yet — charts will render in draft (owner-only) until it’s published.
          </span>
        </div>
      )}

      {/* ── Loading / error / empty ─────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: UI_FONT, fontSize: 12.5, color: MUTED, padding: '18px 0' }}>
          <Loader2 size={15} className="spin" /> Proposing charts from your governed metrics…
        </div>
      )}
      {error && !loading && (
        <div style={{ fontFamily: UI_FONT, fontSize: 12, color: '#F87171', padding: '10px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.08)' }}>
          {error}
        </div>
      )}
      {!loading && blueprint && blueprint.items.length === 0 && (
        <p style={{ fontFamily: UI_FONT, fontSize: 12.5, color: MUTED, lineHeight: 1.5, maxWidth: 640 }}>
          No charts could be grounded in this model’s governed metrics for that intent. Add one below, or
          define the metric you need — we won’t invent a metric that doesn’t exist.
        </p>
      )}

      {/* ── Card GRID ───────────────────────────────────────────────────────────── */}
      {!loading && blueprint && blueprint.items.length > 0 && (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignItems: 'stretch' }}
        >
          {blueprint.items.map((item, idx) => (
            <BlueprintCard
              key={item.id}
              item={item}
              index={idx}
              modelId={modelId}
              intent={intent}
              dragOver={dragOverIndex === idx}
              onRename={(title) => renameItem(item.id, title)}
              onRemove={() => removeItem(item.id)}
              onUpdate={(patch) => updateItem(item.id, patch)}
              onOpenDefine={() => setDefiningItemId(item.id)}
              onDragStart={() => { dragIndexRef.current = idx; }}
              onDragEnter={() => setDragOverIndex(idx)}
              onDrop={() => handleDrop(idx)}
            />
          ))}

          {/* Ghost "Add another" card at the grid's end. */}
          <button
            onClick={handleAddAnother}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              minHeight: 220, borderRadius: 10, border: `1px dashed ${tint(MUTED, 45)}`, background: 'transparent',
              color: MUTED, cursor: 'pointer', fontFamily: UI_FONT, fontSize: 12,
            }}
          >
            <Plus size={22} /> Add another chart
          </button>
        </div>
      )}

      {/* ── Curate footer ───────────────────────────────────────────────────────── */}
      {!loading && blueprint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{ fontFamily: UI_FONT, fontSize: 11.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <ArrowLeft size={13} /> Back to intent
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => blueprint && onAccept?.(blueprint)}
            disabled={governedCount === 0}
            title={governedCount === 0 ? 'Add at least one grounded chart first' : 'Accept all — refine each chart next'}
            style={{
              fontFamily: UI_FONT, fontSize: 12.5, letterSpacing: '0.02em',
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 22px', borderRadius: 8, border: 'none',
              background: governedCount > 0 ? GOLD : tint(GOLD, 30), color: '#0D1B2A',
              cursor: governedCount > 0 ? 'pointer' : 'default', fontWeight: 600,
            }}
          >
            Accept all — refine next <ArrowRight size={15} />
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
 * One blueprint card in the grid: a preview thumbnail (governed) or a soft
 * define-it state (undefined), title (inline-editable), a compact type chip, a
 * collapsed field summary, a one-line rationale, the per-chart NL feedback →
 * regenerate control (Request 1), and — for an undefined item — the inline
 * define-metric affordance + governance ladder (Request 2).
 */
function BlueprintCard({
  item, index, modelId, intent, dragOver,
  onRename, onRemove, onUpdate, onOpenDefine, onDragStart, onDragEnter, onDrop,
}: {
  item: ChartBlueprint;
  index: number;
  modelId: string;
  intent: ResolvedIntent;
  dragOver: boolean;
  onRename: (title: string) => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<ChartBlueprint>) => void;
  onOpenDefine: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
}) {
  const undefined_ = item.grounding === 'undefined';
  const accent = undefined_ ? VIOLET : GREEN;
  const pd = item.pendingDefinition;
  const [summaryOpen, setSummaryOpen] = useState(false);

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

  // Provenance-aware nudge copy — inline-define, not Teach. (Strings preserved.)
  const prov = item.undefinedProvenance;
  const nudgeLabel = prov?.candidateExists
    ? 'defined but not governed — govern it here'
    : prov?.cappedByTopK
      ? 'may exist beyond search — confirm or define it here'
      : 'not defined yet — define it here';

  const measureCount = item.measureLabels.length;
  const dimCount = item.dimensionLabels.length;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="blueprint-card"
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 10,
        border: `1px solid ${dragOver ? tint(GOLD, 60) : undefined_ ? tint(VIOLET, 30) : BORDER}`,
        background: undefined_ ? tint(VIOLET, 6) : CARD,
        boxShadow: undefined_ ? undefined : `0 0 0 1px ${tint(GREEN, 10)}, 0 6px 20px -12px rgba(0,0,0,0.6)`,
      }}
    >
      {/* Thumbnail (governed) or soft define-it panel (undefined) */}
      {undefined_ ? (
        <DefineItCard
          nudgeLabel={nudgeLabel}
          term={item.undefinedTerm ?? item.title}
          hasPending={!!pd}
          onOpenDefine={onOpenDefine}
        />
      ) : (
        <SamplePreviewChart
          chartKind={item.chartKindGuess}
          measureLabels={item.measureLabels}
          dimensionLabels={item.dimensionLabels}
          measureIds={item.measureIds}
          governance={item.grounding === 'governed' ? 'governed' : 'candidate'}
          size="thumb"
          lazy
        />
      )}

      {/* Title row: drag handle + inline rename + type chip + remove */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ color: tint(MUTED, 70), cursor: 'grab', display: 'inline-flex' }} title="Drag to reorder">
          <GripVertical size={14} />
        </span>
        <input
          value={item.title}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Chart title"
          style={{
            fontFamily: UI_FONT, fontSize: 13.5, fontWeight: 600, color: INK, background: 'transparent',
            border: 'none', borderBottom: '1px solid transparent', outline: 'none', padding: '1px 0', flex: 1, minWidth: 0,
          }}
          onFocus={(e) => (e.target.style.borderBottomColor = tint(MUTED, 50))}
          onBlur={(e) => (e.target.style.borderBottomColor = 'transparent')}
        />
        <span style={typeChip(accent)}>{item.chartKindGuess}</span>
        <button onClick={onRemove} aria-label="Remove" style={{ background: 'transparent', border: 'none', color: tint(MUTED, 75), cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
          <X size={14} />
        </button>
      </div>

      {/* Collapsed field summary — "N measures · M dimensions", expands to labels */}
      {(measureCount > 0 || dimCount > 0) && (
        <div>
          <button
            onClick={() => setSummaryOpen((o) => !o)}
            style={{ fontFamily: UI_FONT, fontSize: 11, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0 }}
          >
            {summaryOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {measureCount} measure{measureCount === 1 ? '' : 's'} · {dimCount} dimension{dimCount === 1 ? '' : 's'}
          </button>
          {summaryOpen && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
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

      {/* Governance ladder for an inline-defined metric. */}
      {pd && <LadderStrip pd={pd} busy={ladderBusy} error={ladderError} onSubmit={handleSubmitForGovernance} onPromote={handlePromote} />}

      {item.rationale && (
        <p style={{ fontFamily: UI_FONT, fontSize: 11.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>{item.rationale}</p>
      )}

      {/* Request 1: NL feedback → regenerate this chart. */}
      {showFeedback ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRegenerate(); }}
            rows={2}
            autoFocus
            aria-label="Feedback for this chart"
            placeholder="e.g. “wrong metric — use lost-time injuries”, “make it a line by month”"
            style={{
              fontFamily: UI_FONT, fontSize: 11.5, resize: 'vertical', color: INK, lineHeight: 1.5,
              background: 'rgba(0,0,0,0.18)', border: `1px solid ${tint(MUTED, 30)}`, borderRadius: 6,
              padding: '7px 9px', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleRegenerate}
              disabled={!feedback.trim() || regenerating}
              style={{
                fontFamily: UI_FONT, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 6,
                border: feedback.trim() ? `1px solid ${tint(GOLD, 60)}` : `1px dashed ${tint(MUTED, 40)}`,
                background: feedback.trim() ? tint(GOLD, 10) : 'transparent',
                color: feedback.trim() ? GOLD : MUTED, cursor: !feedback.trim() || regenerating ? 'default' : 'pointer',
              }}
            >
              {regenerating ? <Loader2 size={12} className="spin" /> : <CornerDownLeft size={12} />}
              {regenerating ? 'Regenerating…' : 'Regenerate chart'}
            </button>
            <button
              onClick={() => { setShowFeedback(false); setFeedback(''); setRegenError(null); }}
              style={{ fontFamily: UI_FONT, fontSize: 10.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
            {regenError && <span style={{ fontFamily: UI_FONT, fontSize: 10.5, color: '#F87171' }}>{regenError}</span>}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowFeedback(true)}
          style={{
            fontFamily: UI_FONT, fontSize: 10.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, alignSelf: 'flex-start', marginTop: 'auto',
          }}
        >
          <MessageSquare size={12} /> Give feedback / refine
        </button>
      )}
    </div>
  );
}

/** The distinct soft "define it" state for an undefined item (no fabricated chart). */
function DefineItCard({
  nudgeLabel, term, hasPending, onOpenDefine,
}: {
  nudgeLabel: string;
  term: string;
  hasPending: boolean;
  onOpenDefine: () => void;
}) {
  return (
    <div
      style={{
        minHeight: 132, borderRadius: 10, border: `1px dashed ${tint(VIOLET, 40)}`, background: tint(VIOLET, 5),
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, textAlign: 'center',
      }}
    >
      <PenLine size={20} style={{ color: VIOLET }} />
      {!hasPending ? (
        <button
          onClick={onOpenDefine}
          data-undefined-term={term}
          style={{
            fontFamily: UI_FONT, fontSize: 11.5, color: VIOLET, background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1.4, maxWidth: 240,
          }}
        >
          <span style={{ textDecoration: 'underline dotted', textDecorationColor: VIOLET }}>
            “{term}” — {nudgeLabel}
          </span>
          <ArrowRight size={12} />
        </button>
      ) : (
        <span data-undefined-term={term} style={{ fontFamily: UI_FONT, fontSize: 11, color: MUTED, lineHeight: 1.4 }}>
          Defining “{term}” — finish it on the ladder below.
        </span>
      )}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px', borderRadius: 6, border: `1px solid ${tint(GOLD, 28)}`, background: tint(GOLD, 6) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: UI_FONT, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, border: `1px solid ${tint(MUTED, 40)}`, borderRadius: 3, padding: '1px 6px' }}>
          {pd.tier}
        </span>
        <span style={{ fontFamily: UI_FONT, fontSize: 11, color: INK }}>{pd.label}</span>
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
          <span style={{ fontFamily: UI_FONT, fontSize: 10.5, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} /> Governed
          </span>
        )}
      </div>
      {pd.tier === 'draft' && (
        <span style={{ fontFamily: UI_FONT, fontSize: 10, color: MUTED, lineHeight: 1.4 }}>
          Draft is private to you — submit it so this chart can use it.
        </span>
      )}
      {error && <span style={{ fontFamily: UI_FONT, fontSize: 10.5, color: '#F87171', lineHeight: 1.4 }}>{error}</span>}
    </div>
  );
}

const BLUE = '#56B4E9'; // Okabe-Ito sky-blue for dimension chips

function typeChip(color: string): React.CSSProperties {
  return {
    fontFamily: UI_FONT, fontSize: 9.5, letterSpacing: '0.04em', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: 4, border: `1px solid ${tint(color, 40)}`, background: tint(color, 12), color,
    whiteSpace: 'nowrap', fontWeight: 600,
  };
}

function fieldChip(color: string): React.CSSProperties {
  return {
    fontFamily: UI_FONT, fontSize: 11, padding: '3px 9px', borderRadius: 12,
    border: `1px solid ${tint(color, 34)}`, background: tint(color, 10), color, whiteSpace: 'nowrap',
  };
}

function ladderBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    fontFamily: UI_FONT, fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 9px', borderRadius: 5, border: `1px solid ${tint(color, 55)}`,
    background: tint(color, 12), color, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}
