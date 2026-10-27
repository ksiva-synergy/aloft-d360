'use client';

import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { GitBranch } from 'lucide-react';
import { getModelColor, getModelShortName } from './types';
import { CHART_TEXT } from '@/lib/typography/tokens';

interface Props {
  series: Record<string, any>[];
  models: string[];
}

export function AllocationTimeline({ series, models }: Props) {
  const normalizedData = useMemo(() => {
    return series.map(entry => {
      const total = models.reduce((s, m) => s + (entry[m] || 0), 0);
      const normalized: Record<string, any> = { date: entry.date };
      for (const m of models) {
        normalized[m] = total > 0 ? Math.round(((entry[m] || 0) / total) * 1000) / 10 : 0;
      }
      return normalized;
    });
  }, [series, models]);

  return (
    <div className="bandit-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[color:var(--line-1)] dark:border-[var(--line-1)] flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-cyan-500" />
        <h2 className="text-size-body font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)]">
          Selection History
        </h2>
        <span className="text-size-ui text-[var(--ink-3)] dark:text-[color:var(--ink-3)] ml-1">
          Model allocation over time
        </span>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap gap-3 mb-3">
          {models.map(m => (
            <div key={m} className="flex items-center gap-1.5 text-size-ui">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getModelColor(m) }}
              />
              <span className="text-[color:var(--ink-2)] dark:text-[color:var(--ink-3)]">{getModelShortName(m)}</span>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={normalizedData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: CHART_TEXT.tooltip, fill: '#94a3b8' }}
              axisLine={{ stroke: '#334155', strokeWidth: 0.5 }}
              tickLine={false}
              tickFormatter={v => {
                const d = new Date(v);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis
              tick={{ fontSize: CHART_TEXT.tooltip, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={30}
              tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--surface-1)',
                border: '1px solid var(--line-2)',
                borderRadius: 8,
                fontSize: CHART_TEXT.tooltip,
                color: 'var(--ink-1)',
              }}
              formatter={(value: number, name: string) => [
                `${value.toFixed(1)}%`,
                getModelShortName(name),
              ]}
            />
            {models.map(m => (
              <Area
                key={m}
                type="monotone"
                dataKey={m}
                stackId="alloc"
                stroke={getModelColor(m)}
                fill={getModelColor(m)}
                fillOpacity={0.6}
                strokeWidth={1}
                isAnimationActive={true}
                animationDuration={800}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
