'use client';

import React from 'react';
import Link from 'next/link';
import { Dices, ArrowRight } from 'lucide-react';

export function BanditsEmptyState() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] animate-bandit-fade-in-up">
      <div className="bandit-card p-10 text-center max-w-md">
        <div className="mx-auto mb-5 w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-950/40 dark:to-violet-950/40 flex items-center justify-center">
          <Dices className="h-9 w-9 text-indigo-400 dark:text-indigo-500 animate-lab-float" />
        </div>

        {/* Slot machine reels */}
        <div className="flex items-center justify-center gap-2 mb-5">
          {['?', '?', '?'].map((ch, i) => (
            <div
              key={i}
              className="w-10 h-12 rounded-lg border-2 border-dashed border-slate-200 dark:border-[#2d333b] flex items-center justify-center"
              style={{ animationDelay: `${i * 0.15}s` }}
            >
              <span className="text-lg font-bold text-slate-300 dark:text-slate-600 animate-lab-count-pulse">
                {ch}
              </span>
            </div>
          ))}
        </div>

        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-2">
          No pulls yet
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
          Run your first backfill job to start collecting agent performance data.
          Once model stats accumulate, the bandit will show which arms are winning.
        </p>

        <Link
          href="/backfill"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm hover:shadow-md transition-all"
        >
          Go to Backfill
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
