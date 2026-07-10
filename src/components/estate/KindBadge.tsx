'use client';

import React from 'react';

interface KindBadgeProps {
  kind: string;
}

export default function KindBadge({ kind }: KindBadgeProps) {
  return (
    <span
      className="inline-block font-mono text-[9px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded border transition-all duration-200"
      style={{
        borderColor: 'var(--estate-border-gold)',
        color: 'var(--estate-text-secondary)',
        backgroundColor: 'var(--estate-hover)',
      }}
    >
      {kind}
    </span>
  );
}
