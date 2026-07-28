'use client';

/**
 * src/components/inspector/dashboard-builder/guided/SamplePreviewChart.tsx
 *
 * The "show-don't-describe" chart renderer shared by the Blueprint gallery
 * thumbnails and the Refine canvas. ONE component, three living modes plus the
 * anti-false-green distinct states:
 *
 *   - SAMPLE   (no renderState)            → deterministic locally-generated data
 *                                            (buildSampleData), badged "Sample data".
 *                                            data-widget-render-state="sample".
 *   - SKELETON (renderState.kind:'loading')→ a SHAPED skeleton of the chart kind,
 *                                            never a spinner or empty box.
 *   - LIVE     (renderState.kind:'ok')     → real rows via renderState.chart
 *                                            (already toAlias-mapped upstream),
 *                                            badged "Live" (+ "Draft" when owner-
 *                                            scoped). data-widget-render-state="ok".
 *   - empty / error / model_not_governed / awaiting_data → DELEGATED to
 *     NotWiredChart so those states stay visibly DISTINCT. "sample" is ADDED to
 *     the render-state vocabulary, it does NOT replace the distinct union.
 *
 * Both chart-drawing modes (sample + live) go through the SAME pure option
 * builder (`buildPreviewOption`) fed by a `RowsToOptionResult`. The sample branch
 * is fed ONLY by the local deterministic generator — never anything that touches
 * execute. `buildPreviewOption` is exported so the toAlias-binding guard can
 * assert on the captured option without mounting ECharts (canvas is unpaintable
 * in jsdom).
 *
 * Colour: each series' colour is `colorForMeasure(identity)` so the SAME metric
 * is the SAME hue regardless of series ORDER across cards — an identity encoding,
 * distinct from the theme's positional default palette. Everything else (axes,
 * fonts, gridlines, tooltip) rides the registered inspector-dark/-light theme; we
 * never redefine the palette inline.
 *
 * size modes:
 *   - 'canvas' → fixed 260px height (Refine canvas)
 *   - 'thumb'  → kind-aware height: KPI=120px, bar/line/scatter/heatmap=240px, table=200px
 *   - 'fill'   → 100% of parent height (Blueprint grid cards — parent is the RGL cell)
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useIsDark } from '@/hooks/useIsDark';
import echartsCore from '@/lib/studio/echartsCore';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { NotWiredChart } from './NotWiredChart';
import { buildSampleData } from '@/lib/dashboards/sample-data';
import type { RowsToOptionResult } from '@/lib/dashboards/rows-to-option';
import type { WidgetRenderState } from '@/lib/dashboards/widget-render-state';
import {
  buildPreviewOption, canon, formatValue,
  type PreviewChartKind, type CanonKind,
} from '@/lib/dashboards/preview-option';
import {
  UI_FONT, GOVERNED, CANDIDATE, ACCENT_AMBER, INK_MUTED,
} from '@/lib/dashboards/inspector-viz-tokens';

export type { PreviewChartKind };

/** Kind-aware thumb height: avoids a cramped 132px for all chart types. */
function thumbHeightFor(kind: PreviewChartKind): number {
  const k = canon(kind);
  if (k === 'kpi') return 120;
  if (k === 'table') return 200;
  return 240; // bar / line / scatter / heatmap / pie
}

export interface SamplePreviewChartProps {
  chartKind: PreviewChartKind;
  measureLabels: string[];
  dimensionLabels: string[];
  /** Stable colour/seed identity (definition ids). Falls back to labels. */
  measureIds?: string[];
  /**
   * Domain-specific example values per dimension label, sourced from the semantic
   * model. When present, used by buildSampleData for domain-relevant categories
   * instead of the generic NATO-alphabet vocabulary.
   */
  dimensionHints?: Record<string, string[]>;
  /**
   * Real render state. ABSENT → sample mode. See the module header for the full
   * mode table. Passing an 'ok' state fills from real (toAlias-mapped) rows.
   */
  renderState?: WidgetRenderState;
  /** Quiet governance affordance — a dot/halo, never a loud badge. */
  governance?: 'governed' | 'candidate';
  /**
   * 'canvas' → fixed 260px (Refine canvas)
   * 'thumb'  → kind-aware height (Blueprint thumbnails)
   * 'fill'   → 100% of parent (Blueprint grid — parent is the RGL cell)
   */
  size?: 'thumb' | 'canvas' | 'fill';
  /** Lazy-mount: render a skeleton until scrolled into view (blueprint grid). */
  lazy?: boolean;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

function SamplePreviewChartImpl({
  chartKind, measureLabels, dimensionLabels, measureIds, dimensionHints,
  renderState, governance, size = 'canvas', lazy = false, className,
}: SamplePreviewChartProps) {
  // All hooks run unconditionally (rules of hooks) — the delegated early-return
  // below sits AFTER every hook.
  const isDark = useIsDark();
  const inkColor = isDark ? '#e6edf3' : '#0f172a';
  const theme = isDark ? 'inspector-dark' : 'inspector-light';
  const [ref, inView] = useInView<HTMLDivElement>(!lazy);
  // Client-only mount gate — ECharts never renders during SSR (no canvas there).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Resolve pixel height: 'fill' means 100% of the parent, tracked via ResizeObserver.
  const [fillHeight, setFillHeight] = useState(240);
  const fillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (size !== 'fill') return;
    const el = fillRef.current;
    if (!el) return;
    // Seed immediately from current layout so the first render has a real size.
    if (el.offsetHeight > 0) setFillHeight(el.offsetHeight);
    const obs = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setFillHeight(h);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [size]);

  const height =
    size === 'fill'
      ? fillHeight
      : size === 'thumb'
        ? thumbHeightFor(chartKind)
        : 260;

  const seriesIdentities = useMemo(
    () => measureLabels.map((label, i) => measureIds?.[i] || label),
    [measureLabels, measureIds],
  );

  const isLive = renderState?.kind === 'ok';
  const isLoading = renderState?.kind === 'loading';

  // Sample branch is fed ONLY by the local deterministic generator.
  const result: RowsToOptionResult = useMemoResult(
    isLive ? (renderState as Extract<WidgetRenderState, { kind: 'ok' }>).chart : null,
    chartKind, measureLabels, dimensionLabels, measureIds, dimensionHints,
  );

  const option = useMemo(
    () => buildPreviewOption(chartKind, result, { inkColor, seriesIdentities }),
    [chartKind, result, inkColor, seriesIdentities],
  );

  // Delegate the distinct non-live states so the anti-false-green union holds.
  if (
    renderState &&
    (renderState.kind === 'empty' ||
      renderState.kind === 'error' ||
      renderState.kind === 'model_not_governed' ||
      renderState.kind === 'awaiting_data')
  ) {
    return <NotWiredChart state={renderState} chartKindGuess={guessFor(chartKind)} />;
  }

  const stateAttr = isLive ? 'ok' : isLoading ? 'loading' : 'sample';
  const showSkeleton = isLoading || !mounted || (lazy && !inView);

  const containerStyle: React.CSSProperties =
    size === 'fill'
      ? {
          position: 'relative', display: 'flex', flexDirection: 'column',
          width: '100%', height: '100%',
          overflow: 'hidden',
          border: `1px solid ${governanceRing(governance, isDark)}`,
          boxShadow: governance === 'governed' ? `0 0 0 1px ${GOVERNED}22` : undefined,
        }
      : {
          position: 'relative', display: 'flex', flexDirection: 'column',
          borderRadius: 10, overflow: 'hidden', minHeight: height,
          border: `1px solid ${governanceRing(governance, isDark)}`,
          boxShadow: governance === 'governed' ? `0 0 0 1px ${GOVERNED}22` : undefined,
        };

  return (
    <div
      ref={size === 'fill' ? fillRef : ref}
      data-testid="widget-chart-area"
      data-widget-render-state={stateAttr}
      className={className}
      style={containerStyle}
    >
      {/* Mode chip + governance dot */}
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, display: 'flex', alignItems: 'center', gap: 6, opacity: size === 'fill' && !isLive ? 0.65 : 1 }}>
        {isLive ? (
          <Chip color={GOVERNED} label="Live" />
        ) : !isLoading ? (
          <Chip color={ACCENT_AMBER} label="Sample data" />
        ) : null}
        {isLive && (renderState as Extract<WidgetRenderState, { kind: 'ok' }>).isDraft && (
          <Chip color={CANDIDATE} label="Draft — not governed" icon={<AlertTriangle size={9} />} testId="draft-badge" />
        )}
      </div>
      {governance && (
        <span
          aria-hidden
          title={governance === 'governed' ? 'Governed' : 'Candidate — not yet governed'}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 2, width: 8, height: 8, borderRadius: '50%',
            background: governance === 'governed' ? GOVERNED : CANDIDATE,
            opacity: governance === 'governed' ? 1 : 0.55,
          }}
        />
      )}

      {chartKind === 'table' && !isLoading ? (
        <SampleTable result={result} inkColor={inkColor} height={height} />
      ) : showSkeleton ? (
        <ChartSkeleton kind={canon(chartKind)} height={size === 'fill' ? fillHeight : height} />
      ) : (
        <div
          ref={size !== 'fill' ? ref : undefined}
          style={size === 'fill' ? { width: '100%', flex: 1, minHeight: 0 } : { width: '100%', height }}
        >
          <ReactEChartsCore
            echarts={echartsCore}
            option={option}
            theme={theme}
            notMerge
            opts={{ renderer: 'canvas' }}
            style={{ width: '100%', height: size === 'fill' ? '100%' : height }}
          />
        </div>
      )}
    </div>
  );
}

export const SamplePreviewChart = React.memo(SamplePreviewChartImpl);

// ── helpers ───────────────────────────────────────────────────────────────────

/** Memoise the result: live rows pass through; otherwise deterministic sample. */
function useMemoResult(
  liveChart: RowsToOptionResult | null,
  chartKind: PreviewChartKind,
  measureLabels: string[],
  dimensionLabels: string[],
  measureIds?: string[],
  dimensionHints?: Record<string, string[]>,
): RowsToOptionResult {
  return useMemo(() => {
    if (liveChart) return liveChart;
    return buildSampleData({ chartKind: guessFor(chartKind), measureLabels, dimensionLabels, measureIds, dimensionHints });
  }, [liveChart, chartKind, measureLabels, dimensionLabels, measureIds, dimensionHints]);
}

/** Map the preview kind back to a ChartKindGuess for sample-data / NotWiredChart. */
function guessFor(kind: PreviewChartKind): 'line' | 'bar' | 'scatter' | 'kpi' | 'pie' | 'heatmap' | 'table' {
  const k = canon(kind);
  return k;
}

function governanceRing(governance: SamplePreviewChartProps['governance'], isDark: boolean): string {
  const base = isDark ? '#262d36' : '#C8C2AD';
  if (governance === 'candidate') return `${CANDIDATE}55`;
  if (governance === 'governed') return `${GOVERNED}44`;
  return base;
}

function Chip({ color, label, icon, testId }: { color: string; label: string; icon?: React.ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId}
      style={{
        fontFamily: UI_FONT, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase',
        color, border: `1px solid ${color}66`, background: `${color}14`, borderRadius: 4,
        padding: '2px 7px', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600,
      }}
    >
      {icon}{label}
    </span>
  );
}

/** A shaped skeleton of the chart kind — never a spinner (spec). */
function ChartSkeleton({ kind, height }: { kind: CanonKind; height: number }) {
  const bar = 'rgba(136,146,164,0.18)';
  return (
    <div className="animate-pulse" style={{ width: '100%', height, padding: 16, display: 'flex', alignItems: 'flex-end', gap: 8 }} data-testid="chart-skeleton">
      {kind === 'kpi' ? (
        <div style={{ margin: 'auto', width: '52%', height: 40, borderRadius: 6, background: bar }} />
      ) : kind === 'line' || kind === 'scatter' ? (
        <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none">
          <polyline points="2,48 20,30 38,38 56,18 74,26 98,8" fill="none" stroke={bar} strokeWidth={3} strokeLinecap="round" />
        </svg>
      ) : kind === 'pie' ? (
        <div style={{ margin: 'auto', width: Math.min(height - 40, 120), height: Math.min(height - 40, 120), borderRadius: '50%', border: `12px solid ${bar}` }} />
      ) : (
        [0.5, 0.8, 0.35, 0.65, 0.9, 0.45].map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h * 100}%`, borderRadius: 3, background: bar }} />
        ))
      )}
    </div>
  );
}

/**
 * Minimal HTML table for the 'table' kind (not an ECharts chart).
 * overflow is hidden — no scrollbars in small tiles; a truncation indicator
 * shows when there are more rows than visible.
 */
function SampleTable({ result, inkColor, height }: { result: RowsToOptionResult; inkColor: string; height: number }) {
  // Row height ≈ 26px; header ≈ 28px; padding 12px top+bottom = 24px.
  const ROW_H = 26;
  const HEADER_H = 28;
  const PADDING = 24;
  const maxRows = Math.max(1, Math.floor((height - HEADER_H - PADDING) / ROW_H));
  const allRows = result.categories;
  const rows = allRows.slice(0, maxRows);
  const remaining = allRows.length - rows.length;

  return (
    <div style={{ width: '100%', height, overflow: 'hidden', padding: '12px 12px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: UI_FONT, fontSize: 11, color: inkColor }}>
        <thead>
          <tr>
            <th style={thStyle}>{result.dimAliases[0] ? 'Category' : '#'}</th>
            {result.series.map((s) => <th key={s.measureId} style={thStyle}>{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={i}>
              <td style={tdStyle}>{String(c)}</td>
              {result.series.map((s) => <td key={s.measureId} style={tdStyle}>{formatValue(s.data[i])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <div style={{ fontFamily: UI_FONT, fontSize: 9.5, color: INK_MUTED, padding: '4px 0 8px', letterSpacing: '0.02em' }}>
          +{remaining} more row{remaining === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(136,146,164,0.25)', color: INK_MUTED, fontWeight: 600, fontSize: 10 };
const tdStyle: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid rgba(136,146,164,0.12)' };

/** IntersectionObserver-backed in-view gate for lazy-mounting off-screen cards. */
function useInView<T extends HTMLElement>(eager: boolean): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(eager);
  useEffect(() => {
    if (eager || inView) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); obs.disconnect(); }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [eager, inView]);
  return [ref as React.RefObject<T>, inView];
}
