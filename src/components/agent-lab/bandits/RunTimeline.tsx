'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  Radio, CheckCircle2, XCircle, Clock, Cpu, Hash, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RecentRun } from './types';
import { formatMs, formatTokens, timeAgo, getModelColor, PROVIDER_COLORS, SOURCE_LABELS, SOURCE_COLORS } from './types';
import type { RunSource } from './types';

export function RunTimeline({ runs }: { runs: RecentRun[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [runs, isPaused]);

  return (
    <div className="bandit-card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-[#2d333b] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-rose-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Live Feed
          </h2>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
          </span>
        </div>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          Last {runs.length} runs &middot; {isPaused ? 'paused' : 'auto-scroll'}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[320px] overflow-y-auto bandit-scrollbar"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="divide-y divide-slate-50 dark:divide-[#1c2128]">
          {runs.map((run, idx) => {
            const isSuccess = run.status === 'success' || run.status === 'completed';

            return (
              <div
                key={run.id}
                className={cn(
                  'flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-[#1c2128]/50',
                  idx === 0 && 'animate-bandit-fade-in-up'
                )}
              >
                {/* Status */}
                {isSuccess
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                }

                {/* Sheet ID badge */}
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 shrink-0">
                  {run.sheet_id}
                </span>

                {/* Source badge */}
                {run.source && run.source !== 'pipeline' && (() => {
                  const sc = SOURCE_COLORS[run.source as RunSource] || SOURCE_COLORS.pipeline;
                  return (
                    <span className={cn(
                      'inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium border shrink-0',
                      sc.bg, sc.text, sc.border,
                    )}>
                      {SOURCE_LABELS[run.source as RunSource] || run.source}
                    </span>
                  );
                })()}

                {/* Timestamp */}
                <span className="text-[10px] text-slate-400 dark:text-slate-500 min-w-[50px] shrink-0">
                  {timeAgo(run.created_at)}
                </span>

                {/* Metrics */}
                <div className="flex items-center gap-3 ml-auto text-[10px]">
                  {run.retry_count > 0 && (
                    <span className="flex items-center gap-0.5 text-amber-500">
                      <RotateCcw className="h-3 w-3" />
                      {run.retry_count}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
                    <Clock className="h-3 w-3" />
                    {formatMs(run.total_duration_ms)}
                  </span>
                  <span className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
                    <Cpu className="h-3 w-3" />
                    {formatTokens(run.total_tokens ?? 0)}
                  </span>
                  {(run.output_row_count ?? 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
                      <Hash className="h-3 w-3" />
                      {run.output_row_count}
                    </span>
                  )}
                  {run.validation_passed && (
                    <span className="inline-flex px-1 py-0.5 rounded text-[9px] font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                      valid
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
