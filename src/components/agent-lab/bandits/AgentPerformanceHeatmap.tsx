'use client';

import React, { useState, useMemo } from 'react';
import { Grid3X3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentStat } from './types';
import { formatMs, formatPct, formatTokens } from './types';

interface Metric {
  key: keyof AgentStat;
  label: string;
  format: (v: number) => string;
  higherIsBetter: boolean;
}

const METRICS: Metric[] = [
  { key: 'success_rate', label: 'Success', format: formatPct, higherIsBetter: true },
  { key: 'validation_rate', label: 'Validation', format: formatPct, higherIsBetter: true },
  { key: 'avg_duration_ms', label: 'Avg Duration', format: formatMs, higherIsBetter: false },
  { key: 'avg_tokens', label: 'Avg Tokens', format: formatTokens, higherIsBetter: false },
  { key: 'avg_retries', label: 'Avg Retries', format: (v: number) => v.toFixed(1), higherIsBetter: false },
  { key: 'total_runs', label: 'Runs', format: (v: number) => String(v), higherIsBetter: true },
];

function getPercentile(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 0.5;
  const sorted = [...allValues].sort((a, b) => a - b);
  const idx = sorted.findIndex(v => v >= value);
  return idx === -1 ? 1 : idx / Math.max(sorted.length - 1, 1);
}

function getCellColor(percentile: number, higherIsBetter: boolean): string {
  const p = higherIsBetter ? percentile : 1 - percentile;
  if (p >= 0.8) return 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300';
  if (p >= 0.6) return 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400';
  if (p >= 0.4) return 'bg-slate-50 dark:bg-slate-800/30 text-slate-600 dark:text-slate-400';
  if (p >= 0.2) return 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400';
  return 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400';
}

export function AgentPerformanceHeatmap({ agents }: { agents: AgentStat[] }) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  const metricValues = useMemo(() => {
    const result: Record<string, number[]> = {};
    for (const m of METRICS) {
      result[m.key] = agents.map(a => a[m.key] as number);
    }
    return result;
  }, [agents]);

  return (
    <div className="bandit-card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2d333b] flex items-center gap-2">
        <Grid3X3 className="h-4 w-4 text-indigo-500" />
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Agent Performance Heatmap
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
          {agents.length} agents
        </span>
      </div>

      <div className="overflow-x-auto bandit-scrollbar p-4">
        <div className="min-w-[600px]">
          {/* Header row */}
          <div className="grid gap-1" style={{ gridTemplateColumns: `120px repeat(${METRICS.length}, 1fr)` }}>
            <div className="px-2 py-1.5" />
            {METRICS.map(m => (
              <div key={m.key} className="px-2 py-1.5 text-center">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">
                  {m.label}
                </span>
              </div>
            ))}

            {/* Data rows */}
            {agents.map((agent, rowIdx) => (
              <React.Fragment key={agent.sheet_id}>
                <div className="px-2 py-2 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                    {agent.sheet_id}
                  </span>
                  {agent.trend > 0.05 && <TrendingUp className="h-3 w-3 text-emerald-500 shrink-0" />}
                  {agent.trend < -0.05 && <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />}
                  {agent.trend >= -0.05 && agent.trend <= 0.05 && <Minus className="h-3 w-3 text-slate-300 shrink-0" />}
                </div>
                {METRICS.map((m, colIdx) => {
                  const val = agent[m.key] as number;
                  const percentile = getPercentile(val, metricValues[m.key]);
                  const isHovered = hoveredCell?.row === rowIdx && hoveredCell?.col === colIdx;

                  return (
                    <div
                      key={m.key}
                      className={cn(
                        'px-2 py-2 rounded-md text-center transition-all duration-150 cursor-default',
                        getCellColor(percentile, m.higherIsBetter),
                        isHovered && 'ring-2 ring-indigo-400 dark:ring-indigo-500 scale-105 z-10'
                      )}
                      onMouseEnter={() => setHoveredCell({ row: rowIdx, col: colIdx })}
                      onMouseLeave={() => setHoveredCell(null)}
                      title={`${agent.sheet_id} - ${m.label}: ${m.format(val)}`}
                    >
                      <span className="text-xs font-mono font-medium">
                        {m.format(val)}
                      </span>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-2 border-t border-slate-100 dark:border-[#2d333b] flex items-center gap-4">
        <span className="text-[10px] text-slate-400 dark:text-slate-500">Performance:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-red-100 dark:bg-red-950/30" />
          <span className="text-[10px] text-slate-400">Low</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-amber-50 dark:bg-amber-950/20" />
          <span className="text-[10px] text-slate-400">Mid</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-950/40" />
          <span className="text-[10px] text-slate-400">High</span>
        </div>
      </div>
    </div>
  );
}
