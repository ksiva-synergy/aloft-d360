'use client';

// DataReadinessPill — sticky condensed readiness badge that persists when the
// hero ring scrolls out of view. Uses IntersectionObserver on the ring's DOM
// node (passed via ringRef from ObjectKnowledgePage) to show/hide.
//
// Mounted at the top of the scroll container with sticky top-0 z-20.
// When the ring IS visible, the pill is hidden (opacity 0, pointer-events none).
// When the ring scrolls out, the pill appears.

import React, { useEffect, useState } from 'react';
import type { DataScoreShape } from './DataReadinessRing';
import { scoreColor, levelColor } from './dataReadinessColors';

const DIMENSION_LABELS: Record<string, string> = {
  discoverable: 'Discoverable',
  accessible:   'Accessible',
  trusted:      'Trusted',
  actionable:   'Actionable',
};

interface DataReadinessPillProps {
  dataScore: DataScoreShape | undefined;
  /** Ref to the ring component's wrapper div — used to drive show/hide */
  ringRef: React.RefObject<HTMLDivElement | null>;
}

export default function DataReadinessPill({ dataScore, ringRef }: DataReadinessPillProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = ringRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show pill when ring is NOT intersecting (scrolled out of view)
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [ringRef]);

  if (!dataScore) return null;

  const gatingDim = dataScore.gating_dimension;
  // scoreColor: severity-based on the gating dimension's own score (same function as ring)
  const gatingDimColor = scoreColor(dataScore[gatingDim].score);
  // levelColor: composite badge only (same function as ring center)
  const badgeColor = levelColor(dataScore.level);

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.15s ease',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        backgroundColor: 'var(--estate-bg, rgba(13,27,42,0.92))',
        borderBottom: '1px solid var(--estate-border-gold, rgba(253,181,21,0.12))',
        padding: '8px 32px',
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
      aria-hidden={!visible}
    >
      {/* Level badge — levelColor, not scoreColor */}
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 12,
        fontWeight: 700,
        color: badgeColor,
        letterSpacing: '0.06em',
        backgroundColor: 'rgba(253,181,21,0.1)',
        border: `1px solid ${badgeColor}40`,
        borderRadius: 3,
        padding: '2px 8px',
      }}>
        {dataScore.level}
      </span>

      {/* Composite score */}
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        color: 'var(--estate-text-muted, #8892A4)',
      }}>
        {Math.round(dataScore.composite * 100)}%
      </span>

      <span style={{ color: 'rgba(255,255,255,0.12)', fontSize: 12 }}>|</span>

      {/* Gating dimension — scoreColor on its own score */}
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        color: gatingDimColor,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}>
        <span style={{ fontSize: 9 }}>◆</span>
        {DIMENSION_LABELS[gatingDim]} gating
      </span>
    </div>
  );
}
