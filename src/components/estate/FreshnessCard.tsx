'use client';

import React from 'react';
import FreshnessDot from './FreshnessDot';

export interface FreshnessBlock {
  structural_as_of: string | null;
  profile_as_of: string | null;
  source_altered_at: string | null;
  stale: boolean;
  guidance: string;
}

interface FreshnessCardProps {
  freshness: FreshnessBlock;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'NEVER';
  const d = new Date(iso);
  return d.toLocaleString().toUpperCase();
}

export default function FreshnessCard({ freshness }: FreshnessCardProps) {
  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const cardBg = 'var(--estate-raised)';

  const borderCol = freshness.stale
    ? 'rgba(245, 158, 11, 0.4)'
    : 'var(--estate-border-gold)';

  return (
    <div
      className="border rounded p-5 space-y-4 shadow-sm transition-all duration-200"
      style={{
        backgroundColor: cardBg,
        borderColor: borderCol,
        borderWidth: freshness.stale ? '1.5px' : '1px'
      }}
    >
      <div className="font-mono text-[10px] tracking-wider uppercase" style={{ color: labelColor }}>
        Freshness Contract
      </div>

      <div className="space-y-2.5 font-mono text-xs select-none">
        {/* STRUCTURAL */}
        <div className="flex items-center justify-between">
          <span style={{ color: mutedColor }}>STRUCTURAL</span>
          <div className="flex items-center gap-2">
            <span style={{ color: inkColor }}>{formatDate(freshness.structural_as_of)}</span>
            <FreshnessDot stale={freshness.stale} size={7} />
          </div>
        </div>

        {/* PROFILE */}
        <div className="flex items-center justify-between">
          <span style={{ color: mutedColor }}>PROFILE</span>
          <div className="flex items-center gap-2">
            <span style={{ color: inkColor }}>{formatDate(freshness.profile_as_of)}</span>
            <FreshnessDot stale={freshness.profile_as_of === null} size={7} />
          </div>
        </div>

        {/* SOURCE */}
        <div className="flex items-center justify-between">
          <span style={{ color: mutedColor }}>SOURCE</span>
          <span style={{ color: inkColor }} className="pr-3.5">
            {formatDate(freshness.source_altered_at)}
          </span>
        </div>
      </div>

      {/* Guidance */}
      <p
        className="text-xs leading-relaxed border-t pt-3"
        style={{
          color: labelColor,
          fontFamily: "'Inter Tight', sans-serif",
          borderColor: 'var(--estate-border-gold)'
        }}
      >
        {freshness.guidance}
      </p>
    </div>
  );
}
