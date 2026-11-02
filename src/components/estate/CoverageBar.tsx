'use client';

import React from 'react';
import { formatCount, percentOf } from '@/lib/estate/stages';

interface CoverageBarProps {
  label: string;
  count: number;
  /** What the percentage is measured against. */
  total: number;
  color: string;
  help?: string;
  /** e.g. "of 1,240 in source" — shown under the label. */
  totalLabel?: string;
}

export default function CoverageBar({ label, count, total, color, help, totalLabel }: CoverageBarProps) {
  const percentage = percentOf(count, total);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5" title={help}>
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-ui text-[var(--estate-ink)]">{label}</span>
        {totalLabel && (
          <span className="hidden truncate text-caption text-[var(--estate-text-muted)] sm:inline">{totalLabel}</span>
        )}
      </div>
      <span className="text-ui-regular tabular-nums text-[var(--estate-text-secondary)]">
        {formatCount(count)}
        <span className="ml-1.5 inline-block w-10 text-right text-[var(--estate-text-muted)]">{percentage}%</span>
      </span>
      <div
        className="col-span-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--estate-ink)_8%,transparent)]"
        role="progressbar"
        aria-label={`${label}: ${percentage}%`}
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out-strong"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
