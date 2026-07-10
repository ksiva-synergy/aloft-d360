'use client';

import React from 'react';

interface BulkBarProps {
  count: number;
  onHarvest: () => void;
  onClear: () => void;
}

export default function BulkBar({ count, onHarvest, onClear }: BulkBarProps) {
  if (count === 0) return null;

  const goldColor = '#FDB515';
  const goldDim = '#9a7a2a';
  const bgColor = 'rgba(253, 181, 21, 0.08)';
  const textMuted = 'var(--estate-text-muted)';

  return (
    <div
      className="flex items-center gap-4 mx-6 mt-2 px-4 py-2.5 rounded-md"
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${goldDim}`,
      }}
    >
      <span
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: goldColor, letterSpacing: '0.04em' }}
      >
        {count} selected
      </span>

      <button
        type="button"
        onClick={onHarvest}
        className="transition-colors"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '6px 14px',
          backgroundColor: goldColor,
          color: 'var(--estate-bg)',
          borderRadius: '6px',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        ⛏ Harvest selected
      </button>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto transition-colors"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '10.5px',
          color: textMuted,
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          background: 'none',
          border: 'none',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = goldColor; }}
        onMouseLeave={e => { e.currentTarget.style.color = textMuted; }}
      >
        Clear
      </button>
    </div>
  );
}
