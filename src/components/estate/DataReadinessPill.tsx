'use client';

// DataReadinessPill — condensed readiness summary that appears at the right end
// of the sticky InPageNav once the hero ring scrolls out of view. Uses an
// IntersectionObserver on the ring's DOM node (ringRef from ObjectKnowledgePage).
//
// It sits inside the nav bar (rightSlot), so it takes no vertical space. It used
// to be a separate 44px sticky row hidden with opacity 0, which left an empty
// band above the section nav.

import React, { useEffect, useState } from 'react';
import type { DataScoreShape } from './DataReadinessRing';
import { scoreColor, levelColor } from './dataReadinessColors';
import { type, inkOf } from '@/lib/typography/tokens';

const DIMENSION_LABELS: Record<string, string> = {
  discoverable: 'Discoverable',
  accessible:   'Accessible',
  trusted:      'Trusted',
  actionable:   'Actionable',
};

interface DataReadinessPillProps {
  dataScore: DataScoreShape | undefined;
  /** Ref to the ring wrapper — drives show/hide */
  ringRef: React.RefObject<HTMLDivElement | null>;
}

export default function DataReadinessPill({ dataScore, ringRef }: DataReadinessPillProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = ringRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [ringRef]);

  if (!dataScore) return null;

  const gatingDim = dataScore.gating_dimension;
  const gatingColor = scoreColor(dataScore[gatingDim].score);
  const badgeColor = levelColor(dataScore.level);

  return (
    <a
      href="#overview"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      title="DATA readiness — jump to the overview"
      style={{
        marginLeft: 'auto',
        alignSelf: 'center',
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(-4px)',
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.18s ease, transform 0.18s ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 30,
        padding: '0 12px 0 4px',
        borderRadius: 999,
        border: '1px solid var(--estate-border)',
        background: 'var(--estate-raised)',
        whiteSpace: 'nowrap',
        textDecoration: 'none',
      }}
    >
      <span
        style={{
          ...type.caption,
          fontWeight: 600,
          color: '#fff',
          background: badgeColor,
          borderRadius: 999,
          padding: '2px 8px',
        }}
      >
        {dataScore.level}
      </span>
      <span style={{ ...type.caption, color: 'var(--estate-ink)', fontWeight: 600 }}>
        {Math.round(dataScore.composite * 100)}%
      </span>
      <span aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--estate-border)' }} />
      <span style={{ ...type.caption, color: inkOf(gatingColor) }}>
        {DIMENSION_LABELS[gatingDim]} gating
      </span>
    </a>
  );
}
