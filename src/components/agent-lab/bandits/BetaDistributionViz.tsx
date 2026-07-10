'use client';

import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Activity } from 'lucide-react';
import type { ModelStat } from './types';
import { getModelColor, getModelShortName, formatPct } from './types';

function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const logB = lgamma(a) + lgamma(b) - lgamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logB);
}

function lgamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

const NUM_POINTS = 100;

export function BetaDistributionViz({ models }: { models: ModelStat[] }) {
  const chartData = useMemo(() => {
    const points: Record<string, any>[] = [];
    for (let i = 0; i <= NUM_POINTS; i++) {
      const x = i / NUM_POINTS;
      const point: Record<string, any> = { x: Math.round(x * 100) / 100 };
      for (const m of models) {
        const density = betaPdf(x === 0 ? 0.001 : x === 1 ? 0.999 : x, m.alpha, m.beta);
        point[m.model_name] = Math.round(density * 1000) / 1000;
      }
      points.push(point);
    }
    return points;
  }, [models]);

  const peaks = useMemo(() => {
    return models.map(m => ({
      model: m.model_name,
      mean: (m.alpha) / (m.alpha + m.beta),
    }));
  }, [models]);

  return (
    <div className="bandit-card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2d333b] flex items-center gap-2">
        <Activity className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          The Arms
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
          Beta distribution beliefs
        </span>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap gap-3 mb-3">
          {peaks.map(p => (
            <div key={p.model} className="flex items-center gap-1.5 text-[11px]">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getModelColor(p.model) }}
              />
              <span className="text-slate-600 dark:text-slate-400">
                {getModelShortName(p.model)}
              </span>
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {formatPct(p.mean)}
              </span>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, 1]}
              tickFormatter={v => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#334155', strokeWidth: 0.5 }}
              tickLine={false}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(15, 20, 25, 0.95)',
                border: '1px solid rgba(68, 76, 86, 0.5)',
                borderRadius: 8,
                fontSize: 11,
                color: '#e2e8f0',
              }}
              labelFormatter={v => `P(success) = ${(Number(v) * 100).toFixed(0)}%`}
              formatter={(value: number, name: string) => [
                value.toFixed(2),
                getModelShortName(name),
              ]}
            />
            {models.map(m => (
              <Area
                key={m.model_name}
                type="monotone"
                dataKey={m.model_name}
                stroke={getModelColor(m.model_name)}
                fill={getModelColor(m.model_name)}
                fillOpacity={0.08}
                strokeWidth={2}
                dot={false}
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
