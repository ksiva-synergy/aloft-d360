'use client';

import React from 'react';
import { PlugZap, AlertTriangle, Inbox } from 'lucide-react';
import type { WidgetRenderState } from '@/lib/dashboards/widget-render-state';
import type { RowsToOptionResult } from '@/lib/dashboards/rows-to-option';
import type { ChartKindGuess } from '@/lib/dashboards/guided-types';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const MUTED = '#8892A4';
const INK = 'var(--wb-ink, #E6ECF5)';
const AMBER = '#FDB515';
const GREEN = '#34D399';
const VIOLET = '#C4B5FD';
const RED = '#F87171';

const SERIES_COLORS = [GREEN, '#93C5FD', VIOLET, AMBER, RED, '#5EEAD4'];

/**
 * The drill-in chart area — the typed render state made visible.
 *
 * FOUR non-live states stay visibly distinct (the anti-false-green guarantee):
 *   - `awaiting_data`      → hatched "NOT WIRED" scaffold. The item isn't
 *                            confirmed, so there is no widget to preview.
 *   - `empty`              → a real zero-row result (distinct from not-wired and
 *                            from a `toAlias` mapping bug — the whole point of
 *                            rowsToOption().isEmpty).
 *   - `model_not_governed` → "publish to see live data" (the non-owner degrade).
 *   - `error`              → an inspectable error message, never a blank.
 *
 * And the live state (`ok`) renders a real chart from the mapped rows→option
 * result, plus the owner-scoped "Draft — not governed" affordance when `isDraft`.
 *
 * ── KNOWN DIVERGENCE (deliberate, tracked — not a defect) ────────────────────
 * This is the authoring-preview renderer; the persisted viewer renders the SAME
 * `rowsToOption` output through StudioChart/ECharts (WidgetPreview). So the drill-in
 * and the saved dashboard use TWO different chart engines: the DATA is shared, the
 * VISUAL is not. That was a conscious trade (this SVG is jsdom-testable and avoids
 * double-mapping through widget-option.ts) — but it means "it looked right in the
 * drill-in" does NOT guarantee "it looks right in the viewer": SVG and ECharts can
 * disagree on axis handling, empty-series, and number formatting. The live-creds
 * verification pass MUST include an explicit equivalence check — the same widget
 * renders EQUIVALENTLY in drill-in SVG and viewer ECharts — so the divergence stays
 * a recorded decision, never a surprise. See memory: guided-phase4-drillin-wired.
 */
export function NotWiredChart({
  state,
  chartKindGuess,
}: {
  state: WidgetRenderState;
  chartKindGuess?: ChartKindGuess;
}) {
  if (state.kind === 'awaiting_data') {
    return (
      <div
        data-testid="widget-chart-area"
        data-widget-render-state="awaiting_data"
        role="status"
        aria-label="Awaiting data — chart not yet wired"
        style={{
          flex: 1,
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          borderRadius: 10,
          border: `1px dashed ${AMBER}55`,
          // Diagonal hatch = "scaffold, not a surface". Reads as unfinished on
          // sight, distinct from the solid fill a real chart/empty card uses.
          background:
            'repeating-linear-gradient(45deg, rgba(253,181,21,0.04) 0, rgba(253,181,21,0.04) 10px, transparent 10px, transparent 20px)',
        }}
      >
        <PlugZap size={22} color={AMBER} />
        <span
          style={{
            ...MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: AMBER, border: `1px solid ${AMBER}66`, borderRadius: 4, padding: '2px 7px',
          }}
        >
          Not wired
        </span>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 340 }}>
          <span style={{ ...MONO, fontSize: 12, color: INK, fontWeight: 600 }}>
            Awaiting data{chartKindGuess ? ` — will render as a ${chartKindGuess}` : ''}
          </span>
          <span style={{ ...MONO, fontSize: 10.5, color: MUTED, lineHeight: 1.5 }}>
            Add this chart to the dashboard and its live preview loads here. No query has run yet,
            so nothing here is real data.
          </span>
        </div>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div
        data-testid="widget-chart-area"
        data-widget-render-state="loading"
        role="status"
        aria-label="Loading live preview"
        className="animate-pulse"
        style={{
          flex: 1, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, borderRadius: 10, border: '1px solid rgba(136,146,164,0.2)', background: 'rgba(0,0,0,0.12)',
        }}
      >
        <span style={{ ...MONO, fontSize: 11, color: MUTED }}>Running the query…</span>
      </div>
    );
  }

  if (state.kind === 'ok') {
    return <LiveChart chart={state.chart} chartKindGuess={chartKindGuess} isDraft={state.isDraft} />;
  }

  if (state.kind === 'empty') {
    return (
      <div
        data-testid="widget-chart-area"
        data-widget-render-state="empty"
        style={{
          flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, padding: 24, borderRadius: 10, border: '1px solid rgba(136,146,164,0.25)', background: 'rgba(0,0,0,0.14)',
        }}
      >
        <Inbox size={20} color={MUTED} />
        <span style={{ ...MONO, fontSize: 11.5, color: INK, fontWeight: 600 }}>No rows for this query</span>
        <span style={{ ...MONO, fontSize: 10, color: MUTED, textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
          The query ran and returned zero rows — this is a real empty result, not a chart that failed to load.
          Try loosening a filter.
        </span>
      </div>
    );
  }

  if (state.kind === 'model_not_governed') {
    return (
      <div
        data-testid="widget-chart-area"
        data-widget-render-state="model_not_governed"
        style={{
          flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, padding: 24, borderRadius: 10, border: `1px solid ${AMBER}44`, background: `${AMBER}0D`,
        }}
      >
        <AlertTriangle size={20} color={AMBER} />
        <span style={{ ...MONO, fontSize: 11.5, color: INK, fontWeight: 600 }}>Publish to see live data</span>
        <span style={{ ...MONO, fontSize: 10, color: MUTED, textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
          {state.message || "This dashboard's model is still a candidate — publish it to see live data."}
        </span>
      </div>
    );
  }

  // state.kind === 'error'
  return (
    <div
      data-testid="widget-chart-area"
      data-widget-render-state="error"
      role="alert"
      style={{
        flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: 24, borderRadius: 10, border: `1px solid ${RED}44`, background: `${RED}0D`,
      }}
    >
      <AlertTriangle size={20} color={RED} />
      <span style={{ ...MONO, fontSize: 11.5, color: INK, fontWeight: 600 }}>Could not load data</span>
      <span style={{ ...MONO, fontSize: 10, color: RED, textAlign: 'center', maxWidth: 340, lineHeight: 1.5, wordBreak: 'break-word' }}>
        {state.message || 'The query failed to run.'}
      </span>
    </div>
  );
}

/**
 * The live authoring-preview chart, rendered from the pure rows→option mapping
 * (categories + per-series aliased values). A compact SVG — bars for
 * categorical/bar kinds, a line for line/scatter, a big number for a KPI (no
 * dimensions). Deliberately lightweight: this is the drill-in preview, distinct
 * from the persisted viewer's full StudioChart/ECharts render.
 */
function LiveChart({
  chart,
  chartKindGuess,
  isDraft,
}: {
  chart: RowsToOptionResult;
  chartKindGuess?: ChartKindGuess;
  isDraft: boolean;
}) {
  const rowCount = chart.categories.length || (chart.series[0]?.data.length ?? 0);
  const isKpi = chartKindGuess === 'kpi' || chart.categories.length === 0;
  const asLine = chartKindGuess === 'line' || chartKindGuess === 'scatter';

  return (
    <div
      data-testid="widget-chart-area"
      data-widget-render-state="ok"
      style={{
        flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column',
        padding: 16, gap: 10, borderRadius: 10, border: '1px solid rgba(52,211,153,0.28)', background: 'rgba(0,0,0,0.16)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            ...MONO, fontSize: 8.5, letterSpacing: '0.10em', textTransform: 'uppercase',
            color: GREEN, border: `1px solid ${GREEN}55`, borderRadius: 4, padding: '2px 6px',
          }}
        >
          Live
        </span>
        {isDraft && (
          <span
            data-testid="draft-badge"
            title="These rows came from an owner-scoped preview of a not-yet-governed definition"
            style={{
              ...MONO, fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: VIOLET, border: `1px solid ${VIOLET}66`, borderRadius: 4, padding: '2px 6px',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <AlertTriangle size={9} /> Draft — not governed
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ ...MONO, fontSize: 9, color: MUTED }}>{rowCount} row{rowCount === 1 ? '' : 's'}</span>
      </div>

      {isKpi ? (
        <KpiReadout chart={chart} />
      ) : asLine ? (
        <LineSvg chart={chart} />
      ) : (
        <BarsSvg chart={chart} />
      )}

      {/* Legend — the resolved series names (never the raw aliases). */}
      {chart.series.length > 0 && !isKpi && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          {chart.series.map((s, i) => (
            <span key={s.measureId} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 9, color: MUTED }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {s.name}{s.unit ? ` (${s.unit})` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A KPI (no dimensions): the first value of each series, big. */
function KpiReadout({ chart }: { chart: RowsToOptionResult }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24, padding: '8px 4px' }}>
      {chart.series.map((s, i) => (
        <div key={s.measureId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...MONO, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: SERIES_COLORS[i % SERIES_COLORS.length] }}>
            {formatValue(s.data[0])}
          </span>
          <span style={{ ...MONO, fontSize: 9.5, color: MUTED }}>{s.name}{s.unit ? ` (${s.unit})` : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Grouped mini-bars over the categories, one colour per series. */
function BarsSvg({ chart }: { chart: RowsToOptionResult }) {
  const width = 480;
  const height = 150;
  const values = chart.series.flatMap((s) => s.data.map(toNum));
  const max = Math.max(1, ...values.filter((v) => Number.isFinite(v)));
  const n = chart.categories.length;
  const groupW = n > 0 ? width / n : width;
  const barW = chart.series.length > 0 ? (groupW * 0.7) / chart.series.length : groupW * 0.7;

  return (
    <svg data-testid="live-chart-svg" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ flex: 1, minHeight: 120, display: 'block' }}>
      {chart.categories.map((_, ci) => (
        <g key={ci} transform={`translate(${ci * groupW + groupW * 0.15}, 0)`}>
          {chart.series.map((s, si) => {
            const v = toNum(s.data[ci]);
            const h = Number.isFinite(v) ? (v / max) * (height - 12) : 0;
            return (
              <rect
                key={s.measureId}
                x={si * barW}
                y={height - h}
                width={Math.max(1, barW - 1)}
                height={h}
                rx={1.5}
                fill={SERIES_COLORS[si % SERIES_COLORS.length]}
                opacity={0.9}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
}

/** Overlaid line(s) over the categories, one colour per series. */
function LineSvg({ chart }: { chart: RowsToOptionResult }) {
  const width = 480;
  const height = 150;
  const values = chart.series.flatMap((s) => s.data.map(toNum)).filter((v) => Number.isFinite(v));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const n = chart.categories.length;
  const stepX = n > 1 ? width / (n - 1) : width;

  return (
    <svg data-testid="live-chart-svg" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ flex: 1, minHeight: 120, display: 'block' }}>
      {chart.series.map((s, si) => {
        const pts = s.data.map((d, i) => {
          const v = toNum(d);
          const x = i * stepX;
          const y = height - 4 - ((Number.isFinite(v) ? v : min) - min) / range * (height - 8);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        return (
          <polyline
            key={s.measureId}
            points={pts.join(' ')}
            fill="none"
            stroke={SERIES_COLORS[si % SERIES_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

/** Coerce an unknown row value to a number for plotting (NaN if not numeric). */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/** Compact human display of a single value (KPI). */
function formatValue(v: unknown): string {
  const n = toNum(v);
  if (!Number.isFinite(n)) return v == null ? '—' : String(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
