'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  Sparkles, ArrowRight, ArrowLeft, Plus, Loader2, AlertTriangle, PenLine,
} from 'lucide-react';
import { GridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import { useBuilderStore } from '../builder-store';
import { consumePrefetchedBlueprint, fetchBlueprint } from './blueprint-prefetch';
import { SamplePreviewChart } from './SamplePreviewChart';
import { BlueprintDetailDrawer } from './BlueprintDetailDrawer';
import { DefineMetricPanel, type CreatedDefinition } from '../../authoring/DefineMetricPanel';
import type {
  ResolvedIntent, ChartBlueprint, GuidedBlueprint, ChartKindGuess,
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

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// Grid constants that mirror the live dashboard viewer/builder
const GRID_COLS = 12;
const ROW_HEIGHT = 60;
const GRID_MARGIN: [number, number] = [12, 12];

/**
 * Default widget size per chart kind, matching builder-store.ts DEFAULT_WIDGET_SIZE.
 * Used to assign initial positions for blueprint items in the grid.
 */
const KIND_SIZE: Record<ChartKindGuess, { w: number; h: number }> = {
  kpi:     { w: 3, h: 2 },
  bar:     { w: 6, h: 4 },
  line:    { w: 6, h: 4 },
  scatter: { w: 6, h: 4 },
  heatmap: { w: 6, h: 4 },
  pie:     { w: 4, h: 4 },
  table:   { w: 6, h: 4 },
};

/** Pack blueprint items into a grid layout left-to-right, wrapping at 12 cols. */
function packLayout(items: ChartBlueprint[]): LayoutItem[] {
  let col = 0;
  let row = 0;
  let rowMaxH = 0;
  return items.map((item) => {
    const { w, h } = KIND_SIZE[item.chartKindGuess] ?? { w: 6, h: 4 };
    if (col + w > GRID_COLS) {
      col = 0;
      row += rowMaxH;
      rowMaxH = 0;
    }
    const entry: LayoutItem = { i: item.id, x: col, y: row, w, h, isResizable: false };
    col += w;
    rowMaxH = Math.max(rowMaxH, h);
    return entry;
  });
}

interface Props {
  modelId: string;
  intent: ResolvedIntent;
  onAccept?: (blueprint: GuidedBlueprint) => void;
  onBack?: () => void;
  /** Dimension label → example category values, sourced from semantic model.
   *  Used by SamplePreviewChart for domain-contextual sample data. */
  dimensionHints?: Record<string, string[]>;
}

export function BlueprintStage({ modelId, intent, onAccept, onBack, dimensionHints }: Props) {
  const blueprint = useBuilderStore((s) => s.guidedSession.blueprint);
  const setBlueprint = useBuilderStore((s) => s.setBlueprint);
  const reorderItem = useBuilderStore((s) => s.reorderBlueprintItem);
  const renameItem = useBuilderStore((s) => s.renameBlueprintItem);
  const removeItem = useBuilderStore((s) => s.removeBlueprintItem);
  const updateItem = useBuilderStore((s) => s.updateBlueprintItem);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedRef = useRef(false);

  // Detail drawer: which card is open (null = closed)
  const [openDrawerItemId, setOpenDrawerItemId] = useState<string | null>(null);
  const openDrawerItem = blueprint?.items.find((i) => i.id === openDrawerItemId) ?? null;

  // Inline "Define a metric" modal
  const [definingItemId, setDefiningItemId] = useState<string | null>(null);
  const definingItem = blueprint?.items.find((i) => i.id === definingItemId) ?? null;

  const handleDefinitionCreated = useCallback(
    (def: CreatedDefinition) => {
      if (!definingItemId) return;
      updateItem(definingItemId, {
        pendingDefinition: { id: def.id, tableKind: def.tableKind, label: def.label, tier: 'draft' },
      });
      setDefiningItemId(null);
    },
    [definingItemId, updateItem],
  );

  // Grid container width for react-grid-layout
  const { width: containerWidth, containerRef: rglContainerRef, mounted: containerMounted } = useContainerWidth({ initialWidth: 900 });

  // ── Propose once on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (blueprint || requestedRef.current) return;
    requestedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
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
      requestedRef.current = false;
    };
  }, [blueprint, modelId, intent, setBlueprint]);

  const handleAddAnother = useCallback(() => {
    const bp = useBuilderStore.getState().guidedSession.blueprint;
    if (!bp) return;
    const next: ChartBlueprint = {
      id: `bp_added_${bp.items.length}_${bp.items.reduce((n, i) => n + i.title.length, 0)}`,
      title: 'New chart',
      measureIds: [], dimensionIds: [], measureLabels: [], dimensionLabels: [],
      filters: [], chartKindGuess: 'table', rationale: '', grounding: 'undefined',
      undefinedTerm: 'New chart',
    };
    useBuilderStore.getState().addBlueprintItem(next);
  }, []);

  // React-grid-layout layout derived from the blueprint items.
  const layout = useMemo(() => blueprint ? packLayout(blueprint.items) : [], [blueprint]);

  // Handle RGL drag reorder: map the new layout order back to the store.
  // RGL's onLayoutChange fires with the full Layout (readonly LayoutItem[]).
  const handleLayoutChange = useCallback((newLayout: Layout) => {
    if (!blueprint) return;
    // Sort by visual position (top-left first) to derive the new logical order.
    const sorted = [...newLayout].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
    const currentIds = blueprint.items.map((i) => i.id);
    const newOrder = sorted.map((l) => l.i);
    // Only reorder if the order changed.
    const changed = newOrder.some((id, idx) => id !== currentIds[idx]);
    if (!changed) return;
    // Apply moves sequentially (simplest approach for small N).
    for (let toIdx = 0; toIdx < newOrder.length; toIdx++) {
      const fromIdx = useBuilderStore.getState().guidedSession.blueprint!.items.findIndex(
        (i) => i.id === newOrder[toIdx],
      );
      if (fromIdx !== toIdx) reorderItem(fromIdx, toIdx);
    }
  }, [blueprint, reorderItem]);

  const governedCount = blueprint?.items.filter((i) => i.grounding === 'governed').length ?? 0;

  return (
    <div
      style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20, background: CANVAS, minHeight: '100%' }}
      onClick={() => setOpenDrawerItemId(null)}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color={GOLD} />
          <span style={{ fontFamily: UI_FONT, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: GOLD, fontWeight: 600 }}>
            Guided · Step 2 · Blueprint
          </span>
        </div>
        <h2 style={{ fontFamily: UI_FONT, fontSize: 20, lineHeight: 1.35, color: INK, margin: 0, fontWeight: 600 }}>
          Here's a plan. Curate it before we build anything.
        </h2>
        <p style={{ fontFamily: UI_FONT, fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.5, maxWidth: 640 }}>
          Each card is a proposed chart with sample data — nothing has run yet.
          Drag to reorder, click a card to rename or refine, or remove any you don't need.
        </p>
      </div>

      {/* ── Candidate banner ──────────────────────────────────────────────── */}
      {blueprint?.modelStatus === 'candidate' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, border: `1px solid ${tint(VIOLET, 34)}`, background: tint(VIOLET, 8) }}>
          <AlertTriangle size={14} style={{ color: VIOLET }} />
          <span style={{ fontFamily: UI_FONT, fontSize: 11.5, color: INK, lineHeight: 1.4 }}>
            This model isn't governed yet — charts will render in draft (owner-only) until it's published.
          </span>
        </div>
      )}

      {/* ── Loading / error / empty ───────────────────────────────────────── */}
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
          No charts could be grounded in this model's governed metrics for that intent. Add one below, or
          define the metric you need — we won't invent a metric that doesn't exist.
        </p>
      )}

      {/* ── Dashboard-like Grid ───────────────────────────────────────────── */}
      {!loading && blueprint && blueprint.items.length > 0 && (
        <div ref={rglContainerRef as React.RefObject<HTMLDivElement>} style={{ width: '100%' }}>
          {containerMounted && (
            <GridLayout
              layout={layout as Layout}
              width={containerWidth}
              gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: GRID_MARGIN, containerPadding: [0, 0] as const }}
              dragConfig={{ enabled: true, handle: '.drag-handle' }}
              resizeConfig={{ enabled: false }}
              onLayoutChange={handleLayoutChange}
              autoSize
              style={{ minHeight: 200 }}
            >
              {blueprint.items.map((item) => (
                <div key={item.id}>
                  <BlueprintCard
                    item={item}
                    dimensionHints={dimensionHints}
                    isOpen={openDrawerItemId === item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDrawerItemId((prev) => (prev === item.id ? null : item.id));
                    }}
                    onRemove={(e) => {
                      e.stopPropagation();
                      if (openDrawerItemId === item.id) setOpenDrawerItemId(null);
                      removeItem(item.id);
                    }}
                  />
                </div>
              ))}
            </GridLayout>
          )}

          {/* "Add another" below the grid */}
          <button
            onClick={(e) => { e.stopPropagation(); handleAddAnother(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginTop: 12, padding: '8px 16px', borderRadius: 8,
              border: `1px dashed ${tint(MUTED, 40)}`, background: 'transparent',
              color: MUTED, cursor: 'pointer', fontFamily: UI_FONT, fontSize: 12,
            }}
          >
            <Plus size={14} /> Add another chart
          </button>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
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

      {/* ── Detail drawer ─────────────────────────────────────────────────── */}
      {openDrawerItem && (
        <BlueprintDetailDrawer
          item={openDrawerItem}
          modelId={modelId}
          intent={intent}
          onClose={() => setOpenDrawerItemId(null)}
          onRename={(title) => renameItem(openDrawerItem.id, title)}
          onUpdate={(patch) => updateItem(openDrawerItem.id, patch)}
          onOpenDefine={() => { setDefiningItemId(openDrawerItem.id); setOpenDrawerItemId(null); }}
        />
      )}

      {/* ── Inline define-metric modal ────────────────────────────────────── */}
      {definingItem && (
        <DefineMetricPanel
          modelId={modelId}
          prefill={{
            tableKind: 'measure',
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

// ─────────────────────────────────────────────────────────────────────────────
// BlueprintCard — clean visual shell, chart + minimal overlay only
// ─────────────────────────────────────────────────────────────────────────────

function BlueprintCard({
  item, dimensionHints, isOpen, onClick, onRemove,
}: {
  item: ChartBlueprint;
  dimensionHints?: Record<string, string[]>;
  isOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  const undefined_ = item.grounding === 'undefined';
  const accent = undefined_ ? VIOLET : GREEN;

  return (
    <div
      className="drag-handle"
      onClick={onClick}
      style={{
        width: '100%', height: '100%',
        borderRadius: 10,
        border: `1px solid ${isOpen ? tint(GOLD, 60) : undefined_ ? tint(VIOLET, 30) : BORDER}`,
        background: undefined_ ? tint(VIOLET, 6) : CARD,
        boxShadow: isOpen
          ? `0 0 0 2px ${tint(GOLD, 30)}, 0 8px 24px -8px rgba(0,0,0,0.7)`
          : `0 0 0 1px ${tint(GREEN, 10)}, 0 4px 16px -8px rgba(0,0,0,0.5)`,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      {/* Chart area — full bleed, fills the card */}
      {undefined_ ? (
        <DefineItPlaceholder term={item.undefinedTerm ?? item.title} />
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SamplePreviewChart
            chartKind={item.chartKindGuess}
            measureLabels={item.measureLabels}
            dimensionLabels={item.dimensionLabels}
            measureIds={item.measureIds}
            dimensionHints={dimensionHints}
            governance={item.grounding === 'governed' ? 'governed' : 'candidate'}
            size="fill"
            lazy
          />
        </div>
      )}

      {/* Title overlay — bottom of card */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '8px 10px 8px 10px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 60%, transparent 100%)',
          display: 'flex', alignItems: 'flex-end', gap: 6,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontFamily: UI_FONT, fontSize: 12, fontWeight: 600, color: '#e6edf3',
            flex: 1, lineHeight: 1.3, textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {item.title}
        </span>
        <span style={typeChip(accent)}>{item.chartKindGuess}</span>
      </div>

      {/* Remove button — top right */}
      <button
        onClick={onRemove}
        aria-label="Remove chart"
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
          width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: MUTED, cursor: 'pointer',
          opacity: 0.7,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Soft "define it" placeholder for undefined blueprint items. */
function DefineItPlaceholder({ term }: { term: string }) {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: 16, textAlign: 'center',
        background: tint(VIOLET, 5),
      }}
    >
      <PenLine size={22} style={{ color: VIOLET }} />
      <span style={{ fontFamily: UI_FONT, fontSize: 11.5, color: VIOLET, lineHeight: 1.4, maxWidth: 200 }}>
        "{term}" — click to define this metric
      </span>
    </div>
  );
}

function typeChip(color: string): React.CSSProperties {
  return {
    fontFamily: UI_FONT, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase',
    padding: '2px 7px', borderRadius: 4,
    border: `1px solid ${tint(color, 50)}`, background: tint(color, 18), color,
    whiteSpace: 'nowrap', fontWeight: 600, pointerEvents: 'none',
    flexShrink: 0,
  };
}
