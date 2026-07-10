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
      <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2d333b] flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Leaderboard
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
          {models.length} arms
        </span>
      </div>

      <div className="overflow-x-auto bandit-scrollbar">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 dark:border-[#2d333b]">
              <th className="px-4 py-2.5 text-left font-medium text-slate-400 dark:text-slate-500 w-10">#</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400 dark:text-slate-500">Model</th>
              <th className="px-4 py-2.5 text-left font-medium text-slate-400 dark:text-slate-500">Provider</th>
              <th className="px-4 py-2.5 text-right font-medium text-slate-400 dark:text-slate-500">Pulls</th>
              <th className="px-4 py-2.5 text-right font-medium text-slate-400 dark:text-slate-500 min-w-[140px]">Success Rate</th>
              <th className="px-4 py-2.5 text-right font-medium text-slate-400 dark:text-slate-500 min-w-[100px]">Avg Quality</th>
              <th className="px-4 py-2.5 text-right font-medium text-slate-400 dark:text-slate-500">Avg Duration</th>
              <th className="px-4 py-2.5 text-right font-medium text-slate-400 dark:text-slate-500">Phase</th>
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
                      'border-b border-slate-50 dark:border-[#1c2128] cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-[#1c2128]/50',
                      isExpanded && 'bg-slate-50 dark:bg-[#1c2128]/50'
                    )}
                    onClick={() => setExpandedModel(isExpanded ? null : model.model_name)}
                  >
                    <td className="px-4 py-3">
                      <span className={cn('text-sm font-bold', medalClass || 'text-slate-400 dark:text-slate-500')}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getModelColor(model.model_name) }}
                        />
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {getModelShortName(model.model_name)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border', provColors.bg, provColors.text, provColors.border)}>
                        {model.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {model.total_pulls}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-[#2d333b] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${model.success_rate * 100}%`,
                              backgroundColor: getModelColor(model.model_name),
                            }}
                          />
                        </div>
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-200 min-w-[40px] text-right">
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
                        <span className="text-slate-300 dark:text-slate-600">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {formatMs(model.avg_duration_ms)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        'inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium',
                        model.phase === 'exploring'
                          ? 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400'
                          : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                      )}>
                        {model.phase}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
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
                              className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#161b22] border border-slate-100 dark:border-[#2d333b]"
                            >
                              <span className="font-medium text-slate-700 dark:text-slate-300">{sb.sheet_type}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400">{sb.total}x</span>
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
