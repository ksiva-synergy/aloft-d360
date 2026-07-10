'use client';

import React from 'react';
import { CTSGV_COLORS, BASE_WEIGHTS } from '@/lib/bandits/born-tokens';

const AXES = ['C', 'T', 'S', 'G', 'V'] as const;
type Axis = typeof AXES[number];

export interface CtsgvScores {
  score_c?: number | null;
  score_t?: number | null;
  score_s?: number | null;
  score_g?: number | null;
}

interface CtsgvMicroBarProps {
  scores: CtsgvScores;
  totalWidth?: number;
  height?: number;
}

/**
 * Compact 5-segment CTSGV quality bar.
 * Each segment width is proportional to BASE_WEIGHTS.
 * Unjudged axes render as a diagonal hatch at low opacity.
 */
export function CtsgvMicroBar({ scores, totalWidth = 60, height = 10 }: CtsgvMicroBarProps) {
  const axisScores: Record<Axis, number | null | undefined> = {
    C: scores.score_c,
    T: scores.score_t,
    S: scores.score_s,
    G: scores.score_g,
    V: null, // V not yet active
  };

  return (
    <div style={{ display: 'flex', gap: 1, height, width: totalWidth, flexShrink: 0 }}>
      {AXES.map(axis => {
        const score = axisScores[axis];
        const isNull = score == null;
        const segWidth = Math.round(BASE_WEIGHTS[axis] * totalWidth);
        const fillOpacity = isNull ? 0 : score!;

        return (
          <div
            key={axis}
            title={`${axis}: ${isNull ? 'unjudged' : `${(score! * 100).toFixed(0)}%`}`}
            style={{
              width: segWidth,
              height,
              borderRadius: 1,
              flexShrink: 0,
              background: isNull
                ? `repeating-linear-gradient(45deg, ${CTSGV_COLORS[axis]} 0px, ${CTSGV_COLORS[axis]} 1px, transparent 1px, transparent 4px)`
                : CTSGV_COLORS[axis],
              opacity: isNull ? 0.15 : Math.max(0.15, fillOpacity),
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </div>
  );
}
