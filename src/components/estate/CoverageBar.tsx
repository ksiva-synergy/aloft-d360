'use client';

import React from 'react';

interface CoverageBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
  denominator?: number;
}

export default function CoverageBar({ label, count, total, color, denominator }: CoverageBarProps) {
  const denom = denominator ?? total;
  const percentage = denom > 0 ? Math.round((count / denom) * 100) : 0;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium tracking-wide text-[var(--muted-foreground)]">
          {label}
        </span>
        <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
          {count} <span className="opacity-60">({percentage}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-black/[0.08] dark:bg-white/[0.08] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
