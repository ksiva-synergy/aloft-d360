'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, X, Plus, Loader2,
  BarChart3, LineChart, ScatterChart, PieChart, Table2, Hash, Grid3x3, AlertTriangle,
} from 'lucide-react';
import { useBuilderStore } from '../builder-store';
import type {
  ResolvedIntent, ChartBlueprint, ChartKindGuess, GuidedBlueprint,
} from '@/lib/dashboards/guided-types';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';
const GREEN = '#34D399';
const VIOLET = '#C4B5FD';
const MUTED = '#8892A4';
const INK = 'var(--wb-ink, #E6ECF5)';

/** Chart-kind → glyph. The guess comes from recommendChartKind (server-side). */
function KindIcon({ kind, color }: { kind: ChartKindGuess; color: string }) {
  const size = 15;
  switch (kind) {
    case 'kpi': return <Hash size={size} color={color} />;
    case 'line': return <LineChart size={size} color={color} />;
    case 'scatter': return <ScatterChart size={size} color={color} />;
    case 'heatmap': return <Grid3x3 size={size} color={color} />;
    case 'pie': return <PieChart size={size} color={color} />;
    case 'table': return <Table2 size={size} color={color} />;
    case 'bar':
    default: return <BarChart3 size={size} color={color} />;
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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedRef = useRef(false);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 6, border: `1px solid ${VIOLET}55`, background: `${VIOLET}12` }}>
          <AlertTriangle size={13} color={VIOLET} />
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
              onRename={(title) => renameItem(item.id, title)}
              onRemove={() => removeItem(item.id)}
              onMoveUp={() => reorderItem(idx, idx - 1)}
              onMoveDown={() => reorderItem(idx, idx + 1)}
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
              padding: '7px 12px', borderRadius: 6, border: '1px dashed rgba(136,146,164,0.4)',
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
    </div>
  );
}

/** One blueprint card: title (inline-editable), chips, kind icon, rationale. */
function BlueprintCard({
  item, index, count, onRename, onRemove, onMoveUp, onMoveDown,
}: {
  item: ChartBlueprint;
  index: number;
  count: number;
  onRename: (title: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const undefined_ = item.grounding === 'undefined';
  const accent = undefined_ ? VIOLET : GREEN;

  // Teach nudge copy is provenance-aware (Pin-2): don't say "not defined" when a
  // candidate exists or the search was truncated past the top-K cap.
  const prov = item.undefinedProvenance;
  const nudgeLabel = prov?.candidateExists
    ? 'defined but not governed — govern it in Teach'
    : prov?.cappedByTopK
      ? 'may exist beyond search — confirm or define in Teach'
      : 'not defined yet — define it in Teach';

  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 8,
        border: `1px solid ${undefined_ ? `${VIOLET}44` : 'rgba(136,146,164,0.2)'}`,
        background: undefined_ ? `${VIOLET}0D` : 'rgba(0,0,0,0.15)',
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
            <span key={`d${i}`} style={chipStyle('#93C5FD')}>{label}</span>
          ))}
        </div>

        {/* Undefined → Teach nudge (provenance-aware). */}
        {undefined_ && (
          <button
            onClick={() => window.open(`/inspector?teach=${encodeURIComponent(item.undefinedTerm ?? item.title)}`, '_blank')}
            data-undefined-term={item.undefinedTerm ?? ''}
            style={{
              ...MONO, fontSize: 10, color: VIOLET, background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5, textAlign: 'left', padding: 0,
            }}
          >
            <span style={{ textDecoration: 'underline dotted', textDecorationColor: VIOLET }}>
              “{item.undefinedTerm ?? item.title}” — {nudgeLabel}
            </span>
            <ArrowRight size={11} />
          </button>
        )}

        {item.rationale && (
          <p style={{ ...MONO, fontSize: 10.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>{item.rationale}</p>
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

function chipStyle(color: string): React.CSSProperties {
  return {
    ...MONO, fontSize: 10, padding: '3px 8px', borderRadius: 12,
    border: `1px solid ${color}44`, background: `${color}12`, color, whiteSpace: 'nowrap',
  };
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
    borderRadius: 4, border: '1px solid rgba(136,146,164,0.2)', background: 'transparent',
    color: disabled ? 'rgba(136,146,164,0.3)' : MUTED, cursor: disabled ? 'default' : 'pointer',
  };
}
