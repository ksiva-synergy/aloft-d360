'use client';

import { useMemo, useRef } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { CHART_TEXT } from '@/lib/typography/tokens';
import { fmtUsd, fmtUsdCompact, slotDate } from '@/lib/spend/cost-derive';
import { SeriesSwatch, useCssColors } from './ui';

export type TrendView = 'daily' | 'cumulative' | 'table';

interface Point {
  i: number;
  date: Date;
  ai: number;
  harvest: number;
  total: number;
}

const COLOR_VARS = ['--cost-ai', '--cost-harvest', '--cost-grid', '--ink-3', '--surface-1'] as const;
const FALLBACK = {
  '--cost-ai': '#5B3DF5',
  '--cost-harvest': '#2A9BDB',
  '--cost-grid': 'rgba(17,19,34,.07)',
  '--ink-3': '#5C627A',
  '--surface-1': '#FFFFFF',
};

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function SpendTrendChart({
  fromIso,
  ai,
  harvest,
  show = 'both',
  view,
  height = 260,
}: {
  fromIso: string;
  ai: number[];
  harvest: number[];
  show?: 'both' | 'ai' | 'harvest';
  view: TrendView;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const c = useCssColors(ref, COLOR_VARS, FALLBACK);
  const showAi = show !== 'harvest';
  const showHv = show !== 'ai';

  const points = useMemo<Point[]>(() => {
    const cumulative = view === 'cumulative';
    const out: Point[] = [];
    for (let i = 0; i < ai.length; i++) {
      const a = showAi ? (ai[i] ?? 0) : 0;
      const h = showHv ? (harvest[i] ?? 0) : 0;
      const prev = out[i - 1];
      const pa = cumulative && prev ? prev.ai + a : a;
      const ph = cumulative && prev ? prev.harvest + h : h;
      out.push({ i, date: slotDate(fromIso, i), ai: pa, harvest: ph, total: pa + ph });
    }
    return out;
  }, [ai, harvest, fromIso, view, showAi, showHv]);

  const avg = points.length && view === 'daily' ? points.reduce((s, p) => s + p.total, 0) / points.length : 0;

  if (view === 'table') {
    return (
      <div className="max-h-[300px] overflow-auto px-5 pb-4">
        <table className="w-full text-size-ui">
          <caption className="sr-only">Daily spend</caption>
          <thead className="sticky top-0 bg-[var(--surface-1)] text-left text-caption text-[var(--ink-3)]">
            <tr>
              <th className="py-2 font-medium">Day</th>
              {showAi ? <th className="py-2 text-right font-medium">Interactive AI</th> : null}
              {showHv ? <th className="py-2 text-right font-medium">Harvest</th> : null}
              {show === 'both' ? <th className="py-2 text-right font-medium">Total</th> : null}
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.i} className="border-t border-[var(--line-1)]">
                <td className="py-1.5 text-[var(--ink-2)]">{dayLongFmt.format(p.date)}</td>
                {showAi ? <td className="py-1.5 text-right tabular-nums">{fmtUsd(p.ai)}</td> : null}
                {showHv ? <td className="py-1.5 text-right tabular-nums">{fmtUsd(p.harvest)}</td> : null}
                {show === 'both' ? <td className="py-1.5 text-right font-medium tabular-nums">{fmtUsd(p.total)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const axisTick = { fontSize: CHART_TEXT.axis, fill: c['--ink-3'] };
  const common = {
    data: points,
    margin: { top: 8, right: 16, bottom: 0, left: 0 },
  };
  const xAxis = (
    <XAxis
      dataKey="i"
      tickFormatter={(i: number) => dayFmt.format(points[i]?.date ?? new Date())}
      tick={axisTick}
      tickLine={false}
      axisLine={false}
      minTickGap={28}
      interval="preserveStartEnd"
    />
  );
  const yAxis = (
    <YAxis tickFormatter={fmtUsdCompact} tick={axisTick} tickLine={false} axisLine={false} width={52} allowDecimals />
  );
  const grid = <CartesianGrid vertical={false} stroke={c['--cost-grid']} />;
  const tooltip = (
    <Tooltip
      cursor={{ fill: c['--cost-grid'], stroke: c['--cost-grid'] }}
      content={<TrendTooltip cumulative={view === 'cumulative'} show={show} />}
      wrapperStyle={{ outline: 'none' }}
    />
  );

  return (
    <div ref={ref} className="px-2 pb-3" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {view === 'daily' ? (
          <BarChart {...common} barCategoryGap="18%">
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {showAi ? (
              <Bar
                dataKey="ai"
                stackId="s"
                fill={c['--cost-ai']}
                stroke={c['--surface-1']}
                strokeWidth={1}
                radius={showHv ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ) : null}
            {showHv ? (
              <Bar
                dataKey="harvest"
                stackId="s"
                fill={c['--cost-harvest']}
                stroke={c['--surface-1']}
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ) : null}
            {avg > 0 ? (
              <ReferenceLine
                y={avg}
                stroke={c['--ink-3']}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{ value: `avg ${fmtUsdCompact(avg)}/day`, position: 'insideTopRight', fill: c['--ink-3'], fontSize: CHART_TEXT.axis }}
              />
            ) : null}
          </BarChart>
        ) : (
          <AreaChart {...common}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {showAi ? (
              <Area
                type="monotone"
                dataKey="ai"
                stackId="s"
                stroke={c['--cost-ai']}
                strokeWidth={2}
                fill={c['--cost-ai']}
                fillOpacity={0.18}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: c['--surface-1'], strokeWidth: 2 }}
              />
            ) : null}
            {showHv ? (
              <Area
                type="monotone"
                dataKey="harvest"
                stackId="s"
                stroke={c['--cost-harvest']}
                strokeWidth={2}
                fill={c['--cost-harvest']}
                fillOpacity={0.18}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: c['--surface-1'], strokeWidth: 2 }}
              />
            ) : null}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  cumulative,
  show,
}: TooltipProps<number, string> & { cumulative: boolean; show: 'both' | 'ai' | 'harvest' }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as Point | undefined;
  if (!p) return null;
  return (
    <div className="min-w-[180px] rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2.5 shadow-[var(--shadow-pop)]">
      <p className="text-caption font-medium text-[var(--ink-2)]">
        {dayLongFmt.format(p.date)}
        {cumulative ? <span className="text-[var(--ink-3)]"> · running total</span> : null}
      </p>
      <dl className="mt-1.5 space-y-1 text-size-ui">
        {show !== 'harvest' ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-[var(--ink-2)]"><SeriesSwatch series="ai" />Interactive AI</dt>
            <dd className="tabular-nums text-[var(--ink-1)]">{fmtUsd(p.ai)}</dd>
          </div>
        ) : null}
        {show !== 'ai' ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-[var(--ink-2)]"><SeriesSwatch series="harvest" />Harvest</dt>
            <dd className="tabular-nums text-[var(--ink-1)]">{fmtUsd(p.harvest)}</dd>
          </div>
        ) : null}
        {show === 'both' ? (
          <div className="flex items-center justify-between gap-4 border-t border-[var(--line-1)] pt-1">
            <dt className="text-[var(--ink-2)]">Total</dt>
            <dd className="font-semibold tabular-nums text-[var(--ink-1)]">{fmtUsd(p.total)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** Legend for the two series, with each series' window total. Always shown for the two-series chart. */
export function TrendLegend({ aiUsd, harvestUsd }: { aiUsd?: number; harvestUsd?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-[var(--ink-2)]">
      {aiUsd != null ? (
        <span className="flex items-center gap-1.5">
          <SeriesSwatch series="ai" />
          Interactive AI <span className="font-medium tabular-nums text-[var(--ink-1)]">{fmtUsd(aiUsd)}</span>
        </span>
      ) : null}
      {harvestUsd != null ? (
        <span className="flex items-center gap-1.5">
          <SeriesSwatch series="harvest" />
          Harvest <span className="font-medium tabular-nums text-[var(--ink-1)]">{fmtUsd(harvestUsd)}</span>
        </span>
      ) : null}
    </div>
  );
}
