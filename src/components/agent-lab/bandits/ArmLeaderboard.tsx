'use client';

import React, { useState } from 'react';
import {
  Trophy, ChevronDown, ChevronRight, Zap, Clock, Hash,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ModelStat } from './types';
import { formatMs, formatPct, getModelColor, getModelShortName, PROVIDER_COLORS } from './types';

export function ArmLeaderboard({ models }: { models: ModelStat[] }) {
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  return (
    <div className="bandit-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[color:var(--line-1)] dark:border-[var(--line-1)] flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)]">
          Leaderboard
        </h2>
        <span className="text-xs text-[var(--ink-3)] dark:text-[color:var(--ink-3)] ml-1">
          {models.length} arms
        </span>
      </div>

      <div className="overflow-x-auto bandit-scrollbar">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[color:var(--line-1)] dark:border-[var(--line-1)]">
              <th className="px-4 py-2.5 text-left font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)] w-10">#</th>
              <th className="px-4 py-2.5 text-left font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">Model</th>
              <th className="px-4 py-2.5 text-left font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">Provider</th>
              <th className="px-4 py-2.5 text-right font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">Pulls</th>
              <th className="px-4 py-2.5 text-right font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)] min-w-[140px]">Success Rate</th>
              <th className="px-4 py-2.5 text-right font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)] min-w-[100px]">Avg Quality</th>
              <th className="px-4 py-2.5 text-right font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">Avg Duration</th>
              <th className="px-4 py-2.5 text-right font-medium text-[var(--ink-3)] dark:text-[color:var(--ink-3)]">Phase</th>
              <th className="px-4 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {models.map((model, idx) => {
              const isExpanded = expandedModel === model.model_name;
              const medalClass = idx === 0 ? 'bandit-medal-gold' : idx === 1 ? 'bandit-medal-silver' : idx === 2 ? 'bandit-medal-bronze' : '';
              const provColors = PROVIDER_COLORS[model.provider] || PROVIDER_COLORS.azure;

              return (
                <React.Fragment key={model.model_name}>
                  <tr
                    className={cn(
                      'border-b border-[color:var(--line-1)] dark:border-[var(--surface-2)] cursor-pointer transition-colors hover:bg-[color:var(--surface-2)] dark:hover:bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)]',
                      isExpanded && 'bg-[color:var(--surface-2)] dark:bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)]'
                    )}
                    onClick={() => setExpandedModel(isExpanded ? null : model.model_name)}
                  >
                    <td className="px-4 py-3">
                      <span className={cn('text-sm font-semibold', medalClass || 'text-[var(--ink-3)] dark:text-[color:var(--ink-3)]')}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getModelColor(model.model_name) }}
                        />
                        <span className="font-medium text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)]">
                          {getModelShortName(model.model_name)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex px-1.5 py-0.5 rounded text-xs font-medium border', provColors.bg, provColors.text, provColors.border)}>
                        {model.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">
                      {model.total_pulls}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-[color:var(--surface-2)] dark:bg-[var(--line-1)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${model.success_rate * 100}%`,
                              backgroundColor: getModelColor(model.model_name),
                            }}
                          />
                        </div>
                        <span className="font-mono font-medium text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] min-w-[40px] text-right">
                          {formatPct(model.success_rate)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {model.avg_quality_score != null ? (
                        <span className={cn(
                          'font-mono font-medium',
                          model.avg_quality_score >= 0.9 ? 'text-emerald-600 dark:text-emerald-400'
                            : model.avg_quality_score >= 0.7 ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-500'
                        )}>
                          {formatPct(model.avg_quality_score)}
                        </span>
                      ) : (
                        <span className="text-[color:var(--ink-3)] dark:text-[color:var(--ink-2)]">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[color:var(--ink-2)] dark:text-[color:var(--ink-3)]">
                      {formatMs(model.avg_duration_ms)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        'inline-flex px-1.5 py-0.5 rounded text-xs font-medium',
                        model.phase === 'exploring'
                          ? 'bg-[color:var(--brand-a-soft)] text-[color:var(--brand-a-ink)] dark:bg-[color:color-mix(in_srgb,var(--brand-a)_30%,transparent)] dark:text-[color:var(--brand-a-ink)]'
                          : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                      )}>
                        {model.phase}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-[var(--ink-3)]" />
                        : <ChevronRight className="h-3.5 w-3.5 text-[var(--ink-3)]" />
                      }
                    </td>
                  </tr>

                  {isExpanded && model.sheet_breakdown.length > 0 && (
                    <tr className="animate-bandit-fade-in-up">
                      <td colSpan={9} className="px-4 pb-3 pt-1">
                        <div className="ml-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {model.sheet_breakdown.map(sb => (
                            <div
                              key={sb.sheet_type}
                              className="flex items-center justify-between px-3 py-2 rounded-lg bg-[color:var(--surface-2)] dark:bg-[var(--surface-1)] border border-[color:var(--line-1)] dark:border-[var(--line-1)]"
                            >
                              <span className="font-medium text-[color:var(--ink-2)] dark:text-[color:var(--ink-2)]">{sb.sheet_type}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[var(--ink-3)]">{sb.total}x</span>
                                <span className={cn(
                                  'font-mono font-medium',
                                  sb.success_rate >= 0.8 ? 'text-emerald-600 dark:text-emerald-400'
                                    : sb.success_rate >= 0.5 ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-red-500'
                                )}>
                                  {formatPct(sb.success_rate)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
