'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { QueryResult } from '@/hooks/useInspectorChat';

// ── Brand tokens ──────────────────────────────────────────────────────────────
const GOLD   = '#FDB515';
const NAVY   = '#003262';
const BG     = 'var(--wb-canvas)';
const SURF   = 'var(--wb-surface)';
const TXT    = 'var(--wb-ink)';
const TXT2   = 'var(--wb-muted)';
const LINE   = 'var(--wb-border-subtle)';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties  = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

// Brand-derived multi-series palette
const CHART_PALETTE = [GOLD, '#3A7BD5', '#22c55e', '#a78bfa', '#f97316', '#06b6d4', '#f43f5e'];

type ChartType = 'table' | 'bar' | 'line' | 'area' | 'pie' | 'scatter';
const CHART_TYPES: ChartType[] = ['table', 'bar', 'line', 'area', 'pie', 'scatter'];

// ── Numeric column detection ──────────────────────────────────────────────────
function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  const sample = rows.slice(0, 20);
  const nonNull = sample.filter(r => r[col] != null);
  if (nonNull.length === 0) return false;
  return nonNull.every(r => !isNaN(Number(r[col])));
}

function isDateLike(col: string): boolean {
  return /date|time|ts|created|updated|at$/i.test(col);
}

// Auto-detect best X (text/date first) and Y (numeric first) columns
function autoDetectAxes(columns: { name: string }[], rows: Record<string, unknown>[]) {
  const numericCols = columns.filter(c => isNumericColumn(rows, c.name)).map(c => c.name);
  const textCols = columns.filter(c => !isNumericColumn(rows, c.name)).map(c => c.name);
  const dateCols = textCols.filter(c => isDateLike(c));

  const xDefault = dateCols[0] ?? textCols[0] ?? columns[0]?.name ?? '';
  const yDefault = numericCols[0] ?? '';
  return { xDefault, yDefault, numericCols, textCols };
}

// ── Data diamond icon ─────────────────────────────────────────────────────────
function DataDiamond({ size = 12, opacity = 1 }: { size?: number; opacity?: number }) {
  const half = size / 2;
  const inner = size * 0.28;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ opacity, flexShrink: 0 }}>
      <rect x="6" y={12 * 0.08} width={12 * 0.7} height={12 * 0.7} rx="0"
        transform="rotate(45 6 6)" stroke={GOLD} strokeWidth="1.2" fill="none" />
      <rect x="6" y={6 - inner} width={inner * 2} height={inner * 2} rx="0"
        transform={`rotate(45 6 6)`} fill={GOLD} opacity={0.6} />
    </svg>
  );
}

// ── Compact data table ────────────────────────────────────────────────────────
interface DataTableProps {
  columns: { name: string; type_name: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

function DataTable({ columns, rows, rowCount, truncated }: DataTableProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead style={{ position: 'sticky', top: 0, background: SURF, zIndex: 2 }}>
            <tr>
              {columns.map(col => (
                <th key={col.name} style={{
                  ...mono, fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.10em', textTransform: 'uppercase',
                  color: GOLD, padding: '6px 10px',
                  borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap',
                  textAlign: 'left',
                }}>
                  {col.name}
                  <span style={{ color: TXT2, fontWeight: 400, marginLeft: 4, opacity: 0.6 }}>{col.type_name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                {columns.map(col => (
                  <td key={col.name} style={{
                    ...sans, fontSize: 11, color: TXT,
                    padding: '4px 10px',
                    borderBottom: `1px solid ${LINE}`,
                    whiteSpace: 'nowrap', maxWidth: 200,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {row[col.name] == null ? <span style={{ color: TXT2, opacity: 0.5, fontStyle: 'italic' }}>null</span> : String(row[col.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Row count footer */}
      <div style={{
        padding: '5px 10px',
        borderTop: `1px solid ${LINE}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ ...mono, fontSize: 9, color: TXT2 }}>
          {rows.length} row{rows.length !== 1 ? 's' : ''} shown
          {truncated && <span style={{ color: GOLD, marginLeft: 6 }}>· truncated at 1000</span>}
        </span>
        <span style={{ ...mono, fontSize: 9, color: TXT2 }}>{rowCount} total</span>
      </div>
    </div>
  );
}

// ── Shared chart tooltip ──────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: unknown; fill?: string; stroke?: string }[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: SURF, border: `1px solid ${LINE}`,
      borderRadius: 6, padding: '8px 12px',
      ...mono, fontSize: 11, color: TXT,
    }}>
      {label && <div style={{ color: TXT2, marginBottom: 4, fontSize: 10 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill || p.stroke || GOLD }}>
          {p.name}: <strong>{String(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

// ── Chart builder ─────────────────────────────────────────────────────────────
interface ChartBuilderProps {
  columns: { name: string; type_name: string }[];
  rows: Record<string, unknown>[];
}

function ChartBuilder({ columns, rows }: ChartBuilderProps) {
  const { xDefault, yDefault, numericCols } = useMemo(
    () => autoDetectAxes(columns, rows),
    [columns, rows],
  );

  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xCol, setXCol] = useState(xDefault);
  const [yCol, setYCol] = useState(yDefault);
  const [y2Col, setY2Col] = useState('');

  const colNames = columns.map(c => c.name);

  // Normalize chart data: numeric values, limit to 200 points for performance
  const chartData = useMemo(() => {
    return rows.slice(0, 200).map(row => {
      const entry: Record<string, unknown> = { [xCol]: row[xCol] };
      if (yCol) entry[yCol] = Number(row[yCol]) || 0;
      if (y2Col) entry[y2Col] = Number(row[y2Col]) || 0;
      return entry;
    });
  }, [rows, xCol, yCol, y2Col]);

  const axisStyle = { fontSize: 10, fill: TXT2 } as const;
  const gridProps = { stroke: LINE, strokeDasharray: '3 3' };
  const tooltipContent = <ChartTooltip />;

  const renderChart = useCallback(() => {
    if (chartType === 'table' || !yCol) return null;

    const commonProps = {
      data: chartData,
      margin: { top: 8, right: 16, bottom: 24, left: 8 },
    };

    if (chartType === 'bar') {
      return (
        <BarChart {...commonProps}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xCol} tick={axisStyle} angle={-25} textAnchor="end" interval="preserveStartEnd" />
          <YAxis tick={axisStyle} />
          <Tooltip content={tooltipContent} />
          {(y2Col || null) && <Legend wrapperStyle={mono} />}
          <Bar dataKey={yCol} fill={GOLD} radius={[2, 2, 0, 0]} />
          {y2Col && <Bar dataKey={y2Col} fill={NAVY} radius={[2, 2, 0, 0]} />}
        </BarChart>
      );
    }

    if (chartType === 'line') {
      return (
        <LineChart {...commonProps}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xCol} tick={axisStyle} angle={-25} textAnchor="end" interval="preserveStartEnd" />
          <YAxis tick={axisStyle} />
          <Tooltip content={tooltipContent} />
          {(y2Col || null) && <Legend wrapperStyle={mono} />}
          <Line type="monotone" dataKey={yCol} stroke={GOLD} strokeWidth={2} dot={false} />
          {y2Col && <Line type="monotone" dataKey={y2Col} stroke={CHART_PALETTE[1]} strokeWidth={2} dot={false} />}
        </LineChart>
      );
    }

    if (chartType === 'area') {
      return (
        <AreaChart {...commonProps}>
          <defs>
            <linearGradient id="areaGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={GOLD} stopOpacity={0.25} />
              <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xCol} tick={axisStyle} angle={-25} textAnchor="end" interval="preserveStartEnd" />
          <YAxis tick={axisStyle} />
          <Tooltip content={tooltipContent} />
          <Area type="monotone" dataKey={yCol} stroke={GOLD} strokeWidth={2} fill="url(#areaGold)" />
        </AreaChart>
      );
    }

    if (chartType === 'pie') {
      const pieData = chartData.map(d => ({ name: String(d[xCol] ?? ''), value: Number(d[yCol]) || 0 }));
      return (
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="65%" label={({ name }) => String(name)}>
            {pieData.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
          </Pie>
          <Tooltip content={tooltipContent} />
          <Legend wrapperStyle={{ ...mono, fontSize: 10 }} />
        </PieChart>
      );
    }

    if (chartType === 'scatter' && y2Col) {
      return (
        <ScatterChart {...commonProps}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={yCol} name={yCol} tick={axisStyle} />
          <YAxis dataKey={y2Col} name={y2Col} tick={axisStyle} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={tooltipContent} />
          <Scatter data={chartData.map(d => ({ [yCol]: Number(d[yCol]) || 0, [y2Col]: Number(d[y2Col]) || 0 }))} fill={GOLD} />
        </ScatterChart>
      );
    }

    return null;
  }, [chartType, chartData, xCol, yCol, y2Col]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectStyle: React.CSSProperties = {
    background: SURF, border: `1px solid ${LINE}`,
    color: TXT, borderRadius: 4, padding: '3px 6px',
    ...mono, fontSize: 10, outline: 'none', cursor: 'pointer',
    flex: 1, minWidth: 0,
  };

  const chart = renderChart();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderTop: `1px solid ${LINE}`, flexShrink: 0 }}>
      {/* Chart type pills */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {CHART_TYPES.map(ct => (
          <button key={ct} onClick={() => setChartType(ct)} style={{
            ...mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 3, border: 'none',
            background: chartType === ct ? NAVY : 'transparent',
            color: chartType === ct ? '#ffffff' : TXT2,
            cursor: 'pointer', outline: 'none', transition: 'all 0.12s',
            boxShadow: chartType === ct ? `inset 0 0 0 1px rgba(253,181,21,0.35)` : 'none',
          }}>
            {ct}
          </button>
        ))}
      </div>

      {/* Axis selectors (hidden for 'table') */}
      {chartType !== 'table' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...mono, fontSize: 9, color: TXT2, width: 18, textTransform: 'uppercase', letterSpacing: '0.08em' }}>X</span>
            <select value={xCol} onChange={e => setXCol(e.target.value)} style={selectStyle}>
              {colNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...mono, fontSize: 9, color: TXT2, width: 18, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Y</span>
            <select value={yCol} onChange={e => setYCol(e.target.value)} style={selectStyle}>
              <option value="">— select —</option>
              {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {chartType !== 'area' && chartType !== 'pie' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...mono, fontSize: 9, color: TXT2, width: 18, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.6 }}>Y2</span>
              <select value={y2Col} onChange={e => setY2Col(e.target.value)} style={{ ...selectStyle, opacity: 0.75 }}>
                <option value="">— none —</option>
                {numericCols.filter(c => c !== yCol).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Chart render area */}
      {chart && (
        <div style={{ height: 180, marginTop: 4 }}>
          <ResponsiveContainer width="100%" height="100%">
            {chart as React.ReactElement}
          </ResponsiveContainer>
        </div>
      )}

      {chartType !== 'table' && !yCol && (
        <div style={{ ...mono, fontSize: 10, color: TXT2, textAlign: 'center', padding: '12px 0', opacity: 0.7 }}>
          Select a numeric Y column to render the chart
        </div>
      )}
    </div>
  );
}

// ── SQL preview badge ─────────────────────────────────────────────────────────
function SqlBadge({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const preview = sql.trim().replace(/\s+/g, ' ').slice(0, 60);
  return (
    <div style={{ padding: '4px 12px', borderBottom: `1px solid ${LINE}`, flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      }}>
        <span style={{ ...mono, fontSize: 9, color: GOLD, letterSpacing: '0.06em', textTransform: 'uppercase' }}>SQL</span>
        <span style={{ ...mono, fontSize: 9, color: TXT2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
          {preview}{sql.length > 60 ? '…' : ''}
        </span>
        <span style={{ ...mono, fontSize: 9, color: TXT2 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre style={{
          ...mono, fontSize: 10, color: TXT, background: BG,
          border: `1px solid ${LINE}`, borderRadius: 4,
          padding: '8px 10px', margin: '4px 0 2px',
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {sql}
        </pre>
      )}
    </div>
  );
}

// ── Result history strip ──────────────────────────────────────────────────────
interface ResultStripProps {
  results: QueryResult[];
  activeIdx: number;
  onSelect: (i: number) => void;
}

function ResultStrip({ results, activeIdx, onSelect }: ResultStripProps) {
  if (results.length <= 1) return null;
  return (
    <div style={{
      display: 'flex', gap: 4, padding: '4px 12px',
      borderBottom: `1px solid ${LINE}`, overflowX: 'auto', flexShrink: 0,
    }}>
      {results.map((r, i) => (
        <button key={i} onClick={() => onSelect(i)} style={{
          ...mono, fontSize: 9, padding: '2px 7px', borderRadius: 3, border: 'none',
          background: i === activeIdx ? NAVY : 'transparent',
          color: i === activeIdx ? '#ffffff' : TXT2,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          boxShadow: i === activeIdx ? `inset 0 0 0 1px rgba(253,181,21,0.4)` : 'none',
        }}>
          Q{i + 1} · {r.rowCount}r
        </button>
      ))}
    </div>
  );
}

// ── DashboardPane (main export) ───────────────────────────────────────────────
interface DashboardPaneProps {
  queryResults: QueryResult[];
  onOpenStudio?: () => void;
  expandButtonRef?: React.RefObject<HTMLButtonElement>;
}

export function DashboardPane({ queryResults, onOpenStudio, expandButtonRef }: DashboardPaneProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Always show latest result by default
  const latestIdx = queryResults.length - 1;
  const displayIdx = queryResults.length > 0
    ? Math.min(activeIdx, latestIdx)
    : 0;

  // Reset to latest when new results arrive
  React.useEffect(() => {
    if (queryResults.length > 0) setActiveIdx(queryResults.length - 1);
  }, [queryResults.length]);

  // E-key shortcut to open Studio (fires only when no input/textarea is focused)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        onOpenStudio?.();
      }
    };
    container.addEventListener('keydown', handleKey);
    return () => container.removeEventListener('keydown', handleKey);
  }, [onOpenStudio]);

  const active = queryResults[displayIdx];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: BG, overflow: 'hidden', outline: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px',
        borderBottom: `1px solid ${LINE}`,
        flexShrink: 0,
        ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: GOLD,
      }}>
        <DataDiamond size={12} />
        DATA
        {queryResults.length > 0 && (
          <span style={{ color: TXT2, fontWeight: 400, marginLeft: 4, fontSize: 9 }}>
            · {queryResults.length} result{queryResults.length !== 1 ? 's' : ''}
          </span>
        )}
        <button
          ref={expandButtonRef}
          onClick={onOpenStudio}
          onMouseEnter={() => { import('@/components/studio/DataStudio'); }}
          title="Open Data Studio"
          style={{
            marginLeft: 'auto',
            border: '0.5px solid var(--builder-border-bright)',
            background: 'transparent',
            color: TXT2,
            borderRadius: '4px',
            padding: '2px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          <Maximize2 size={12} />
          EXPAND
        </button>
      </div>

      {/* Empty state */}
      {queryResults.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16, padding: 24,
          color: TXT2, textAlign: 'center',
        }}>
          <DataDiamond size={40} opacity={0.15} />
          <span style={{ ...mono, fontSize: 11, letterSpacing: '0.04em', lineHeight: 1.6 }}>
            Run a query to visualize results
          </span>
          <span style={{ ...sans, fontSize: 11, color: TXT2, opacity: 0.6, maxWidth: 220 }}>
            Ask about data in the chat to get started — e.g. &ldquo;show me tables&rdquo;
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Result history strip */}
          <ResultStrip results={queryResults} activeIdx={displayIdx} onSelect={setActiveIdx} />

          {/* SQL preview */}
          <SqlBadge sql={active.sql} />

          {/* Data table — top half */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <DataTable
              columns={active.columns}
              rows={active.rows}
              rowCount={active.rowCount}
              truncated={active.truncated}
            />
          </div>

          {/* Chart builder — bottom section */}
          <ChartBuilder columns={active.columns} rows={active.rows} />
        </div>
      )}
    </div>
  );
}
