'use client';

import React, { useMemo, useState } from 'react';
import { X, FlaskConical, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import type { RunMetric, TurnOutcome } from '@/hooks/useInspectorChat';
import type { ToolKind } from '@/lib/boost/classify';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';
import {
  useBoostResults,
  ContextBoostTab,
  ModelMatrixTab,
  BenchmarkSuiteTab,
  ScoringMethodologyTab,
} from '@/components/inspector/BoostTabs';
import { BOOST_V2_SUMMARY } from '@/lib/boost/v2-summary';

// ── Brand tokens ─────────────────────────────────────────────────────────────
const GOLD   = '#FDB515';
const NAVY   = '#003262';
const BG     = '#070b11';
const SURF   = '#0d1520';
const SURF2  = '#111a27';
const BORDER = 'rgba(253,181,21,0.12)';
const BORDER2 = 'rgba(253,181,21,0.22)';
const TXT    = '#e6ecf4';
const TXT2   = '#8892A4';
const GREEN  = '#22c55e';
const BLUE   = '#3A7BD5';
const RED    = '#f43f5e';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const axisTick = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 9, fill: TXT2 };

// Model provider colours
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: GOLD,
  amazon: '#06b6d4',
  meta: '#a78bfa',
  deepseek: '#f97316',
  mistral: '#22c55e',
  qwen: '#ec4899',
};

function providerColor(modelKey: string): string {
  const m = AVAILABLE_MODELS.find(x => x.key === modelKey);
  return m ? (PROVIDER_COLORS[m.provider] ?? GOLD) : GOLD;
}

// ── Utility helpers ───────────────────────────────────────────────────────────
function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
      <span style={{ ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD }}>
        {label}
      </span>
      {sub && (
        <span style={{ ...mono, fontSize: 10, color: TXT2 }}>{sub}</span>
      )}
    </div>
  );
}

// ── Value Summary Hero ────────────────────────────────────────────────────────
const heroCardOuter: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 180,
  background: SURF,
  border: `1px solid ${BORDER}`,
  borderLeft: `4px solid ${GOLD}`,
  borderRadius: 6,
  padding: '16px 18px',
};
const heroStat: React.CSSProperties = {
  fontFamily: "'Source Serif 4',Georgia,serif",
  fontSize: 26,
  fontWeight: 700,
  color: TXT,
  lineHeight: 1.1,
  marginBottom: 6,
};
const heroLabel: React.CSSProperties = {
  ...mono,
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: GOLD,
  marginBottom: 10,
  fontWeight: 600,
};
const heroSub: React.CSSProperties = {
  fontFamily: "'Inter Tight', sans-serif",
  fontSize: 11.5,
  color: TXT2,
  lineHeight: 1.45,
};

function ValueSummaryHero() {
  const S = BOOST_V2_SUMMARY;
  return (
    <div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 6 }}>
        CONTEXT HARNESS — VALUE SUMMARY
      </div>
      <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 18, fontWeight: 600, color: TXT, marginBottom: 16 }}>
        {S.totalRuns} runs · {S.models} models · {S.cases} cases
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {/* Card 1 — Discovery Burn */}
        <div style={heroCardOuter}>
          <div style={heroLabel}>DISCOVERY BURN</div>
          <div style={heroStat}>up to {S.discoveryBurnMax.toFixed(0)}x</div>
          <div style={heroSub}>
            SQL-only burns 3–{S.discoveryBurnMax.toFixed(0)}x more tokens on schema discovery. Harness discovery calls = {S.ctxDiscoveryCalls}.
          </div>
        </div>

        {/* Card 2 — Time to Answer */}
        <div style={heroCardOuter}>
          <div style={heroLabel}>TIME TO ANSWER</div>
          <div style={heroStat}>{S.callsToFirstQuery.ctx} calls</div>
          <div style={heroSub}>
            Harness reaches the first real query in {S.callsToFirstQuery.ctx} calls vs {S.callsToFirstQuery.sql} for SQL-only.
          </div>
        </div>

        {/* Card 3 — Completion Rate */}
        <div style={heroCardOuter}>
          <div style={heroLabel}>COMPLETION RATE</div>
          <div style={heroStat}>+56–66 pp</div>
          <div style={heroSub}>
            Higher completion at every difficulty tier. {S.cases} of 10 cases discriminate strongly.
          </div>
        </div>

        {/* Card 4 — Model Inversion */}
        <div style={heroCardOuter}>
          <div style={heroLabel}>MODEL INVERSION</div>
          <div style={heroStat}>value &gt; frontier</div>
          <div style={heroSub}>
            A value-tier model + harness completes {S.inversion.valueHardCtx} hard cases. A frontier model + tools: {S.inversion.frontierHardSql}.
          </div>
        </div>
      </div>

      {/* Takeaway line */}
      <div style={{ marginTop: 16, padding: '14px 18px', borderLeft: `3px solid ${GOLD}`, background: SURF }}>
        <span style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginRight: 8 }}>TAKEAWAY</span>
        <span style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 13.5, color: TXT, lineHeight: 1.55 }}>
          The harness solves discovery access, not reasoning — answer quality is at parity when both complete (semantic {S.semanticParity.ctxHard.toFixed(2)} vs {S.semanticParity.sqlHard.toFixed(2)} on the hard tier). The advantage is that the harness lets answers exist at all.
        </span>
      </div>
    </div>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, color = TXT }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: SURF2,
      border: `1px solid ${BORDER}`,
      borderRadius: 6,
      padding: '10px 14px',
      minWidth: 110,
    }}>
      <div style={{ ...mono, fontSize: 9, color: TXT2, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ ...mono, fontSize: 18, color, fontWeight: 600, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ ...mono, fontSize: 10, color: TXT2, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Boost badge ───────────────────────────────────────────────────────────────
function BoostBadge({ pct, label }: { pct: number; label: string }) {
  const positive = pct > 0;
  const Icon = positive ? TrendingDown : pct < 0 ? TrendingUp : Minus;
  const color = positive ? GREEN : pct < 0 ? RED : TXT2;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: positive ? 'rgba(34,197,94,0.08)' : 'rgba(74,96,128,0.1)',
      border: `1px solid ${positive ? 'rgba(34,197,94,0.25)' : BORDER}`,
      borderRadius: 6, padding: '8px 14px',
    }}>
      <Icon size={15} style={{ color, flexShrink: 0 }} />
      <div>
        <div style={{ ...mono, fontSize: 18, color, fontWeight: 700, lineHeight: 1 }}>
          {positive ? '+' : ''}{fmt(pct, 1)}%
        </div>
        <div style={{ ...mono, fontSize: 10, color: TXT2, marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Tooltip for recharts ──────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: SURF, border: `1px solid ${BORDER2}`, borderRadius: 6, padding: '8px 12px', ...mono, fontSize: 11 }}>
      {label && <div style={{ color: TXT2, marginBottom: 6 }}>Turn {label}</div>}
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{typeof p.value === 'number' && p.value > 999 ? fmt(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

// ── Per-group aggregation ─────────────────────────────────────────────────────
interface GroupKey { modelKey: string; contextMode: 'harvested' | 'warehouse_only' }
interface GroupStats {
  key: string;
  modelKey: string;
  modelLabel: string;
  contextMode: 'harvested' | 'warehouse_only';
  count: number;
  avgTokens: number;
  avgInput: number;
  avgOutput: number;
  avgLatency: number;
  avgTTFT: number | null;
  avgLoops: number;
  totalDescribeSchema: number;
  totalExecuteTool: number;
  totalWarehouseCalls: number;
  color: string;
}

function buildGroupStats(metrics: RunMetric[]): GroupStats[] {
  const map = new Map<string, RunMetric[]>();
  for (const m of metrics) {
    const k = `${m.modelKey}::${m.contextMode}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(m);
  }
  const result: GroupStats[] = [];
  for (const [k, items] of map) {
    const [modelKey, ctxMode] = k.split('::') as [string, 'harvested' | 'warehouse_only'];
    const modelLabel = AVAILABLE_MODELS.find(x => x.key === modelKey)?.label ?? modelKey;
    const ttfts = items.map(i => i.firstTokenMs).filter((x): x is number => x !== null);
    const dsCount = items.reduce((acc, i) => acc + i.toolCalls.filter(t => t.name === 'describe_schema').length, 0);
    const exCount = items.reduce((acc, i) => acc + i.toolCalls.filter(t => t.name === 'execute_tool').length, 0);
    result.push({
      key: k,
      modelKey,
      modelLabel,
      contextMode: ctxMode,
      count: items.length,
      avgTokens: avg(items.map(i => i.tokenCount)),
      avgInput:  avg(items.map(i => i.inputTokens)),
      avgOutput: avg(items.map(i => i.outputTokens)),
      avgLatency: avg(items.map(i => i.durationMs)),
      avgTTFT: ttfts.length ? avg(ttfts) : null,
      avgLoops: avg(items.map(i => i.loopCount)),
      totalDescribeSchema: dsCount,
      totalExecuteTool: exCount,
      totalWarehouseCalls: exCount,
      color: providerColor(modelKey),
    });
  }
  return result;
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface ModelPerformanceLabProps {
  open: boolean;
  onClose: () => void;
  runMetrics: Record<string, RunMetric>;
  historicalStats?: HistoricalStat[];
}

export interface HistoricalStat {
  modelKey: string;
  modelLabel: string;
  contextMode: 'harvested' | 'warehouse_only';
  sessions: number;
  avgTokens: number;
  avgLatencyMs: number;
  avgLoops: number;
  avgWarehouseCalls: number;
}

// ── Section B: Comparative charts ────────────────────────────────────────────
function ComparativeCharts({ groups, metrics }: { groups: GroupStats[]; metrics: RunMetric[] }) {
  // Token breakdown bar chart data
  const tokenData = groups.map(g => ({
    name: `${g.modelLabel}\n${g.contextMode === 'harvested' ? 'CTX' : 'SQL'}`,
    Input: Math.round(g.avgInput),
    Output: Math.round(g.avgOutput),
    fill: g.color,
  }));

  // Latency over turns line chart data — one series per model+ctx group
  const sortedMetrics = [...metrics].sort((a, b) => a.turnIndex - b.turnIndex);
  const latencyData = sortedMetrics.map(m => {
    const key = `${m.modelKey}::${m.contextMode}`;
    const label = `${AVAILABLE_MODELS.find(x => x.key === m.modelKey)?.label ?? m.modelKey} ${m.contextMode === 'harvested' ? '(CTX)' : '(SQL)'}`;
    return { turn: m.turnIndex, [label]: Math.round(m.durationMs) };
  });

  // Tool call distribution data
  const toolData = groups.map(g => ({
    name: `${g.modelLabel} ${g.contextMode === 'harvested' ? '(CTX)' : '(SQL)'}`,
    'Catalog Hits': g.totalDescribeSchema,
    'Warehouse Calls': g.totalWarehouseCalls,
  }));

  const seriesColors = groups.map(g => g.color);

  if (!metrics.length) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Token breakdown */}
      <div style={{ background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
        <div style={{ ...mono, fontSize: 9, color: TXT2, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Avg Token Breakdown
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={tokenData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={axisTick} interval={0} />
            <YAxis tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="Input" fill={GOLD} opacity={0.7} radius={[2, 2, 0, 0]} />
            <Bar dataKey="Output" fill={BLUE} opacity={0.85} radius={[2, 2, 0, 0]} />
            <Legend wrapperStyle={{ ...mono, fontSize: 10, color: TXT2 }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Latency over turns */}
      <div style={{ background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
        <div style={{ ...mono, fontSize: 9, color: TXT2, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Latency Over Turns (ms)
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={latencyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="turn" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            {groups.map((g, i) => {
              const label = `${g.modelLabel} ${g.contextMode === 'harvested' ? '(CTX)' : '(SQL)'}`;
              return (
                <Line key={g.key} type="monotone" dataKey={label} stroke={seriesColors[i]} dot={{ r: 3 }} strokeWidth={2} />
              );
            })}
            <Legend wrapperStyle={{ ...mono, fontSize: 10, color: TXT2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tool call distribution */}
      <div style={{ background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, gridColumn: '1 / -1' }}>
        <div style={{ ...mono, fontSize: 9, color: TXT2, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Tool Call Distribution — Catalog Hits vs Warehouse Calls
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={toolData} layout="vertical" barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" tick={axisTick} />
            <YAxis dataKey="name" type="category" tick={axisTick} width={140} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="Catalog Hits" fill={GOLD} opacity={0.85} radius={[0, 2, 2, 0]} />
            <Bar dataKey="Warehouse Calls" fill={RED} opacity={0.75} radius={[0, 2, 2, 0]} />
            <Legend wrapperStyle={{ ...mono, fontSize: 10, color: TXT2 }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function SummaryTable({ groups }: { groups: GroupStats[] }) {
  if (!groups.length) {
    return (
      <div style={{ ...mono, fontSize: 12, color: TXT2, padding: '24px 0', textAlign: 'center' }}>
        No data yet — send a message to start collecting metrics.
      </div>
    );
  }

  const rows = [
    { label: 'Turns', fn: (g: GroupStats) => String(g.count) },
    { label: 'Avg Tokens', fn: (g: GroupStats) => fmt(g.avgTokens) },
    { label: 'Avg Input', fn: (g: GroupStats) => fmt(g.avgInput) },
    { label: 'Avg Output', fn: (g: GroupStats) => fmt(g.avgOutput) },
    { label: 'Avg Latency', fn: (g: GroupStats) => fmtMs(g.avgLatency) },
    { label: 'Avg TTFT', fn: (g: GroupStats) => g.avgTTFT !== null ? fmtMs(g.avgTTFT) : '—' },
    { label: 'Avg Loops', fn: (g: GroupStats) => fmt(g.avgLoops, 1) },
    { label: 'Catalog Hits', fn: (g: GroupStats) => fmt(g.totalDescribeSchema) },
    { label: 'Warehouse Calls', fn: (g: GroupStats) => fmt(g.totalWarehouseCalls) },
  ];

  const colW = `${Math.floor(70 / groups.length)}%`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: '30%', textAlign: 'left', padding: '6px 10px', color: TXT2, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}` }}>Metric</th>
            {groups.map(g => (
              <th key={g.key} style={{ width: colW, textAlign: 'right', padding: '6px 10px', borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ color: g.color, fontWeight: 600, fontSize: 11 }}>{g.modelLabel}</div>
                <div style={{ fontSize: 9, color: TXT2, marginTop: 2 }}>
                  {g.contextMode === 'harvested' ? 'CTX + SQL' : 'SQL ONLY'}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.label} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
              <td style={{ padding: '7px 10px', color: TXT2, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                {row.label}
              </td>
              {groups.map(g => (
                <td key={g.key} style={{ padding: '7px 10px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  {row.fn(g)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section C: Context Boost Score ───────────────────────────────────────────
function ContextBoostScore({ groups }: { groups: GroupStats[] }) {
  const byModel = new Map<string, { harvested?: GroupStats; warehouse?: GroupStats }>();
  for (const g of groups) {
    if (!byModel.has(g.modelKey)) byModel.set(g.modelKey, {});
    if (g.contextMode === 'harvested') byModel.get(g.modelKey)!.harvested = g;
    else byModel.get(g.modelKey)!.warehouse = g;
  }

  const comparisons: { modelKey: string; modelLabel: string; color: string; tokenBoost: number; latencyBoost: number; warehouseBoost: number; hasBoth: boolean }[] = [];
  for (const [modelKey, pair] of byModel) {
    const modelLabel = AVAILABLE_MODELS.find(x => x.key === modelKey)?.label ?? modelKey;
    const color = providerColor(modelKey);
    if (pair.harvested && pair.warehouse) {
      const tb = pair.warehouse.avgTokens > 0
        ? ((pair.warehouse.avgTokens - pair.harvested.avgTokens) / pair.warehouse.avgTokens) * 100 : 0;
      const lb = pair.warehouse.avgLatency > 0
        ? ((pair.warehouse.avgLatency - pair.harvested.avgLatency) / pair.warehouse.avgLatency) * 100 : 0;
      const wb = pair.warehouse.totalWarehouseCalls > 0
        ? ((pair.warehouse.totalWarehouseCalls - pair.harvested.totalWarehouseCalls) / pair.warehouse.totalWarehouseCalls) * 100 : 0;
      comparisons.push({ modelKey, modelLabel, color, tokenBoost: tb, latencyBoost: lb, warehouseBoost: wb, hasBoth: true });
    } else {
      comparisons.push({ modelKey, modelLabel, color, tokenBoost: 0, latencyBoost: 0, warehouseBoost: 0, hasBoth: false });
    }
  }

  if (!comparisons.length) return null;
  const withBoth = comparisons.filter(c => c.hasBoth);
  const withoutBoth = comparisons.filter(c => !c.hasBoth);

  return (
    <div>
      {withBoth.map(c => (
        <div key={c.modelKey} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color }} />
            <span style={{ ...mono, fontSize: 12, color: c.color, fontWeight: 600 }}>{c.modelLabel}</span>
            <span style={{ ...mono, fontSize: 10, color: TXT2 }}>— context harness impact</span>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
            <BoostBadge pct={c.tokenBoost} label="Token Reduction" />
            <BoostBadge pct={c.latencyBoost} label="Latency Reduction" />
            <BoostBadge pct={c.warehouseBoost} label="Warehouse Calls Reduced" />
          </div>
        </div>
      ))}
      {withoutBoth.length > 0 && (
        <div style={{ ...mono, fontSize: 10, color: TXT2, padding: '10px 0', borderTop: `1px solid ${BORDER}` }}>
          Run same model with both CTX and SQL-only modes to see boost scores for:
          {withoutBoth.map(c => (
            <span key={c.modelKey} style={{ color: c.color, marginLeft: 8 }}>{c.modelLabel}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section D: Per-turn detail table ─────────────────────────────────────────
function PerTurnDetail({ metrics }: { metrics: RunMetric[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...metrics].sort((a, b) => a.turnIndex - b.turnIndex);
  const shown = expanded ? sorted : sorted.slice(0, 8);
  if (!sorted.length) return null;

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 11 }}>
          <thead>
            <tr>
              {['#', 'Model', 'Mode', 'In Tok', 'Out Tok', 'Total', 'Latency', 'TTFT', 'Loops', 'Tools'].map(h => (
                <th key={h} style={{
                  textAlign: 'right',
                  padding: '5px 8px',
                  color: TXT2, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                  borderBottom: `1px solid ${BORDER}`,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((m, i) => {
              const color = providerColor(m.modelKey);
              const isCtx = m.contextMode === 'harvested';
              const dsCount = m.toolCalls.filter(t => t.name === 'describe_schema').length;
              const exCount = m.toolCalls.filter(t => t.name === 'execute_tool').length;
              return (
                <tr key={`${m.modelKey}-${m.turnIndex}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: TXT2, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{m.turnIndex}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                    {AVAILABLE_MODELS.find(x => x.key === m.modelKey)?.label ?? m.modelKey}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                    <span style={{
                      display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9,
                      background: isCtx ? 'rgba(253,181,21,0.1)' : 'rgba(58,123,213,0.12)',
                      color: isCtx ? GOLD : BLUE,
                      border: `1px solid ${isCtx ? 'rgba(253,181,21,0.25)' : 'rgba(58,123,213,0.3)'}`,
                    }}>
                      {isCtx ? 'CTX' : 'SQL'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmt(m.inputTokens)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmt(m.outputTokens)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, fontWeight: 600, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmt(m.tokenCount)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmtMs(m.durationMs)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{m.firstTokenMs !== null ? fmtMs(m.firstTokenMs) : '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{m.loopCount}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                    {m.toolCalls.length > 0 ? `${dsCount}ctx / ${exCount}sql` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > 8 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 8, display: 'flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer',
            ...mono, fontSize: 10, color: TXT2,
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Show less' : `Show ${sorted.length - 8} more turns`}
        </button>
      )}
    </div>
  );
}

// ── Historical stats section ──────────────────────────────────────────────────
function HistoricalSection({ stats }: { stats: HistoricalStat[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 11 }}>
        <thead>
          <tr>
            {['Model', 'Mode', 'Sessions', 'Avg Tokens', 'Avg Latency', 'Avg Loops', 'Avg WH Calls'].map(h => (
              <th key={h} style={{
                textAlign: 'right', padding: '5px 8px',
                color: TXT2, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                borderBottom: `1px solid ${BORDER}`,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => {
            const color = providerColor(s.modelKey);
            const isCtx = s.contextMode === 'harvested';
            return (
              <tr key={`${s.modelKey}-${s.contextMode}`} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                <td style={{ padding: '5px 8px', textAlign: 'right', color, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{s.modelLabel}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9,
                    background: isCtx ? 'rgba(253,181,21,0.1)' : 'rgba(58,123,213,0.12)',
                    color: isCtx ? GOLD : BLUE,
                    border: `1px solid ${isCtx ? 'rgba(253,181,21,0.25)' : 'rgba(58,123,213,0.3)'}`,
                  }}>
                    {isCtx ? 'CTX' : 'SQL'}
                  </span>
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{s.sessions}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmt(s.avgTokens)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmtMs(s.avgLatencyMs)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmt(s.avgLoops, 1)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid rgba(255,255,255,0.04)` }}>{fmt(s.avgWarehouseCalls, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section E: Tool Trajectory ────────────────────────────────────────────────
const KIND_STYLES: Record<ToolKind, { color: string; bg: string; border: string; label: string }> = {
  catalog:   { color: GOLD,  bg: 'rgba(253,181,21,0.10)', border: 'rgba(253,181,21,0.3)', label: 'CATALOG' },
  data:      { color: GREEN, bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.3)',  label: 'DATA' },
  discovery: { color: RED,   bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.3)',  label: 'DISCOVERY' },
  error:     { color: RED,   bg: 'transparent',           border: 'rgba(244,63,94,0.5)',  label: 'ERROR' },
};

function KindBadge({ kind }: { kind: ToolKind }) {
  const s = KIND_STYLES[kind];
  return (
    <span style={{
      ...mono,
      fontSize: 9,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      borderRadius: 3,
      padding: '2px 6px',
      width: 78,
      textAlign: 'center',
      display: 'inline-block',
      color: s.color,
      background: s.bg,
      border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}

function OutcomeChip({ outcome }: { outcome: TurnOutcome }) {
  const map: Record<TurnOutcome, { color: string; dotColor: string }> = {
    completed: { color: GREEN, dotColor: GREEN },
    truncated: { color: RED,   dotColor: RED },
    errored:   { color: RED,   dotColor: RED },
  };
  const { color, dotColor } = map[outcome];
  return (
    <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6, color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
      {outcome}
    </span>
  );
}

function ToolTrajectoryTab({ metrics }: { metrics: RunMetric[] }) {
  const sorted = [...metrics].sort((a, b) => a.turnIndex - b.turnIndex);
  const latest = sorted[sorted.length - 1];

  if (!latest || latest.toolCalls.length === 0) {
    return (
      <div style={{ ...mono, fontSize: 12, color: TXT2, textAlign: 'center', padding: '32px 0' }}>
        No tool calls recorded yet — send a message to start.
      </div>
    );
  }

  const calls = latest.toolCalls;
  const counts: Record<ToolKind, number> = { catalog: 0, data: 0, discovery: 0, error: 0 };
  for (const c of calls) counts[c.kind]++;

  return (
    <div>
      <div style={{ ...mono, fontSize: 10, color: TXT2, marginBottom: 14 }}>
        Turn {latest.turnIndex} · {latest.contextMode === 'harvested' ? 'CTX' : 'SQL'} ·{' '}
        {AVAILABLE_MODELS.find(m => m.key === latest.modelKey)?.label ?? latest.modelKey}
      </div>

      <div style={{ border: `1px solid rgba(28,44,63,1)`, borderRadius: 6, background: SURF, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '12px 15px',
          borderBottom: '1px solid rgba(28,44,63,1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ ...mono, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: latest.contextMode === 'harvested' ? GOLD : BLUE }}>
            {latest.contextMode === 'harvested' ? 'CTX · Harvested' : 'SQL · Warehouse-only'}
          </span>
          <OutcomeChip outcome={latest.outcome} />
        </div>

        {/* Per-call rows */}
        {calls.map((c, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 11,
            padding: '9px 15px',
            borderBottom: i < calls.length - 1 ? '1px solid rgba(28,44,63,0.5)' : 'none',
            alignItems: 'center',
          }}>
            <span style={{ ...mono, fontSize: 10, color: TXT2, width: 18, flexShrink: 0, textAlign: 'right' }}>
              {i + 1}
            </span>
            <KindBadge kind={c.kind} />
            <span style={{ ...mono, fontSize: 11, color: TXT2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.name}{c.sqlExcerpt ? ` · ${c.sqlExcerpt}` : ''}
            </span>
            <span style={{ ...mono, fontSize: 10, color: TXT2, flexShrink: 0 }}>
              {c.durationMs >= 1000 ? `${(c.durationMs / 1000).toFixed(1)}s` : `${c.durationMs}ms`}
            </span>
          </div>
        ))}

        {/* Summary footer */}
        <div style={{
          padding: '11px 15px',
          ...mono,
          fontSize: 10.5,
          letterSpacing: '0.04em',
          color: latest.outcome === 'completed' ? GREEN : RED,
          background: latest.outcome === 'completed' ? 'rgba(34,197,94,0.08)' : 'rgba(244,63,94,0.08)',
        }}>
          {calls.length} call{calls.length !== 1 ? 's' : ''}
          {counts.catalog > 0 && ` · ${counts.catalog} catalog`}
          {counts.data > 0 && ` · ${counts.data} data`}
          {counts.discovery > 0 && ` · ${counts.discovery} discovery`}
          {counts.error > 0 && ` · ${counts.error} error`}
          {' · '}{latest.outcome}
        </div>
      </div>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────
export default function ModelPerformanceLab({ open, onClose, runMetrics, historicalStats = [] }: ModelPerformanceLabProps) {
  const [activeTab, setActiveTab] = useState<'session' | 'historical' | 'trajectory' | 'boost' | 'matrix' | 'benchmark' | 'methodology'>('boost');

  const { data: boostData, loading: boostLoading, fetchBoostResults } = useBoostResults();

  // Default tab is 'boost', so eagerly fetch on open
  React.useEffect(() => { if (open) fetchBoostResults(); }, [open, fetchBoostResults]);

  const metrics = useMemo(() => Object.values(runMetrics), [runMetrics]);
  const groups = useMemo(() => buildGroupStats(metrics), [metrics]);

  const totalTurns = metrics.length;
  const totalTokens = metrics.reduce((a, m) => a + m.tokenCount, 0);
  const avgLatencyVal = metrics.length ? avg(metrics.map(m => m.durationMs)) : 0;
  const ctxTurns = metrics.filter(m => m.contextMode === 'harvested').length;
  const sqlTurns = metrics.filter(m => m.contextMode === 'warehouse_only').length;

  if (!open) return null;

  const tabs: { id: 'session' | 'historical' | 'trajectory' | 'boost' | 'matrix' | 'benchmark' | 'methodology'; label: string }[] = [
    { id: 'boost', label: 'CONTEXT BOOST A/B' },
    { id: 'matrix', label: 'MODEL × CONTEXT' },
    { id: 'trajectory', label: 'TOOL TRAJECTORY' },
    { id: 'benchmark', label: 'BENCHMARK SUITE' },
    { id: 'methodology', label: 'SCORING METHODOLOGY' },
    { id: 'session', label: 'CURRENT SESSION' },
    { id: 'historical', label: 'HISTORICAL' },
  ];

  function handleTabClick(id: typeof activeTab) {
    setActiveTab(id);
    if (id === 'boost' || id === 'matrix' || id === 'benchmark' || id === 'methodology') {
      fetchBoostResults();
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: BG, display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      animation: 'lab-fade-in 0.18s ease-out',
    }}>
      {/* Top nav bar */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', height: 56, flexShrink: 0,
        borderBottom: `1px solid ${BORDER}`, background: SURF,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: `1px solid ${BORDER}`,
              borderRadius: 6, padding: '6px 12px',
              color: TXT2, cursor: 'pointer', transition: 'all 0.15s',
              ...mono, fontSize: 11, letterSpacing: '0.04em',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TXT2; }}
          >
            <ArrowLeft size={14} />
            Back to Inspector
          </button>
          <div style={{ width: 1, height: 24, background: BORDER, marginLeft: 4 }} />
          <FlaskConical size={16} style={{ color: GOLD }} />
          <span style={{ ...mono, fontSize: 13, color: GOLD, fontWeight: 700, letterSpacing: '0.08em' }}>
            PERFORMANCE LAB
          </span>
          <span style={{ ...mono, fontSize: 10, color: TXT2 }}>
            — context harness research
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 6,
            background: 'transparent', border: `1px solid ${BORDER}`,
            color: TXT2, cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TXT2; }}
        >
          <X size={14} />
        </button>
      </header>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Hero section — full width */}
        <section style={{
          padding: '36px 48px 28px',
          borderBottom: `1px solid ${BORDER}`,
          maxWidth: 1400, margin: '0 auto', width: '100%',
        }}>
          <ValueSummaryHero />
        </section>

        {/* Session stats row */}
        <section style={{
          display: 'flex', gap: 12, padding: '18px 48px', flexShrink: 0,
          borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' as const,
          maxWidth: 1400, margin: '0 auto', width: '100%',
        }}>
          <StatTile label="Turns" value={String(totalTurns)} sub="assistant responses" />
          <StatTile label="Total Tokens" value={fmt(totalTokens)} sub="this session" color={GOLD} />
          <StatTile label="Avg Latency" value={fmtMs(avgLatencyVal)} sub="end-to-end" />
          <StatTile label="CTX Turns" value={String(ctxTurns)} sub="with catalog" color={GOLD} />
          <StatTile label="SQL Turns" value={String(sqlTurns)} sub="warehouse only" color={BLUE} />
          <StatTile label="Models" value={String(new Set(metrics.map(m => m.modelKey)).size)} sub="distinct" />
        </section>

        {/* Tab bar — sticky within scroll */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: BG, borderBottom: `1px solid ${BORDER}`,
          padding: '0 48px',
          maxWidth: 1400, margin: '0 auto', width: '100%',
        }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => handleTabClick(t.id)} style={{
                padding: '12px 18px', background: 'transparent', border: 'none',
                borderBottom: `2px solid ${activeTab === t.id ? GOLD : 'transparent'}`,
                cursor: 'pointer', ...mono, fontSize: 10.5, letterSpacing: '0.08em',
                color: activeTab === t.id ? GOLD : TXT2, transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <main style={{
          padding: '28px 48px 48px',
          maxWidth: 1400, margin: '0 auto', width: '100%',
          display: 'flex', flexDirection: 'column', gap: 32,
        }}>
          {activeTab === 'session' && (
            <>
              <div>
                <SectionHeader label="A. Comparative Summary" sub={`${totalTurns} turn${totalTurns !== 1 ? 's' : ''} · grouped by model + context mode`} />
                <SummaryTable groups={groups} />
              </div>
              {groups.length >= 1 && (
                <div>
                  <SectionHeader label="C. Context Boost Score" sub="token / latency / warehouse call reduction vs SQL-only baseline" />
                  <ContextBoostScore groups={groups} />
                </div>
              )}
              {metrics.length >= 1 && (
                <div>
                  <SectionHeader label="B. Comparative Charts" />
                  <ComparativeCharts groups={groups} metrics={metrics} />
                </div>
              )}
              {metrics.length >= 1 && (
                <div>
                  <SectionHeader label="D. Per-Turn Detail" sub="raw run data — every assistant response" />
                  <PerTurnDetail metrics={metrics} />
                </div>
              )}
            </>
          )}
          {activeTab === 'boost' && (
            <div>
              <ContextBoostTab data={boostData} loading={boostLoading} />
            </div>
          )}
          {activeTab === 'matrix' && (
            <div>
              <ModelMatrixTab data={boostData} loading={boostLoading} />
            </div>
          )}
          {activeTab === 'benchmark' && (
            <div>
              <BenchmarkSuiteTab data={boostData} loading={boostLoading} />
            </div>
          )}
          {activeTab === 'methodology' && (
            <div>
              <ScoringMethodologyTab data={boostData} loading={boostLoading} />
            </div>
          )}
          {activeTab === 'historical' && (
            <div>
              <SectionHeader label="Historical Benchmarks" sub="aggregated across all inspector sessions" />
              {historicalStats.length > 0 ? (
                <HistoricalSection stats={historicalStats} />
              ) : (
                <div style={{ ...mono, fontSize: 12, color: TXT2, textAlign: 'center', padding: '32px 0' }}>
                  No historical data yet. Complete inspector sessions to populate this view.
                </div>
              )}
            </div>
          )}
          {activeTab === 'trajectory' && (
            <div>
              <SectionHeader label="E. Tool Trajectory" sub="classified tool calls — latest turn" />
              <ToolTrajectoryTab metrics={metrics} />
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer style={{
        padding: '8px 32px', flexShrink: 0, borderTop: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: SURF,
      }}>
        <span style={{ ...mono, fontSize: 9, color: TXT2, letterSpacing: '0.06em' }}>
          ALOFT PERFORMANCE LAB · v0.1 · metrics are session-local unless marked historical
        </span>
        <span style={{ ...mono, fontSize: 9, color: 'rgba(253,181,21,0.35)', letterSpacing: '0.06em' }}>
          POWERED BY ALOFT · v0.4
        </span>
      </footer>

      <style>{`
        @keyframes lab-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
