'use client';

// DataReadinessRing — four-segment SVG ring visualizing the DATA readiness score.
//
// Redesigned (UX pass): larger 130px ring, bigger center level + composite text,
// full dimension name labels with scores, per-dimension score bars, and a
// clearer gating callout with improved typography and spacing.

import React from 'react';
import { scoreColor, levelColor, GATING_CHIP_COLOR, GATING_CHIP_BG } from './dataReadinessColors';
import { type } from '@/lib/typography/tokens';

const TRACK_COLOR = 'color-mix(in srgb, var(--ink-1) 7%, transparent)';

const DIMENSION_LABELS: Record<string, string> = {
  discoverable: 'Discoverable',
  accessible:   'Accessible',
  trusted:      'Trusted',
  actionable:   'Actionable',
};

const DIMENSION_SHORT: Record<string, string> = {
  discoverable: 'D',
  accessible:   'A',
  trusted:      'T',
  actionable:   'Ac',
};

const LEVEL_LABELS: Record<string, string> = {
  L1: 'L1 — Inventoried',
  L2: 'L2 — Profiled',
  L3: 'L3 — Understood',
  L4: 'L4 — Curated',
  L5: 'L5 — Operationalized',
};

const SEGMENT_STARTS: Record<string, number> = {
  discoverable: -90,
  accessible:    0,
  trusted:       90,
  actionable:    180,
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  if (sweepDeg <= 0) return '';
  const clampedSweep = Math.min(sweepDeg, 359.99);
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, startDeg + clampedSweep);
  const largeArc = clampedSweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

export interface DataScoreShape {
  discoverable: { score: number; reasons: string[] };
  accessible:   { score: number; reasons: string[] };
  trusted:      { score: number; reasons: string[] };
  actionable:   { score: number; reasons: string[] };
  composite: number;
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  gating_dimension: 'discoverable' | 'accessible' | 'trusted' | 'actionable';
}

interface DataReadinessRingProps {
  dataScore: DataScoreShape | undefined;
  ringRef?: React.RefObject<HTMLDivElement>;
}

// ── Dimension score bar (horizontal fill bar) ─────────────────────────────────
function DimScoreBar({ dim, score, color }: { dim: string; score: number; color: string }) {
  const pct = Math.round(score * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--type-ui-regular-size)',
        fontWeight: 600,
        color,
        width: 20,
        flexShrink: 0,
        letterSpacing: '0.04em',
      }}>
        {DIMENSION_SHORT[dim]}
      </span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: TRACK_COLOR, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--type-ui-regular-size)',
        color,
        width: 32,
        textAlign: 'right',
        flexShrink: 0,
        tabularNums: true,
      } as React.CSSProperties}>
        {pct}%
      </span>
    </div>
  );
}

export default function DataReadinessRing({ dataScore, ringRef }: DataReadinessRingProps) {
  const cx = 65;
  const cy = 65;
  const r = 48;
  const strokeWidth = 9;
  const svgSize = 130;
  const segmentGap = 4;

  if (!dataScore) {
    return (
      <div
        ref={ringRef}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}
        aria-label="DATA readiness score loading"
      >
        <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
          {(['discoverable', 'accessible', 'trusted', 'actionable'] as const).map((dim) => {
            const startDeg = SEGMENT_STARTS[dim] + segmentGap / 2;
            const sweepDeg = 90 - segmentGap;
            const track = arcPath(cx, cy, r, startDeg, sweepDeg);
            return track ? (
              <path key={dim} d={track} fill="none" stroke={TRACK_COLOR} strokeWidth={strokeWidth} strokeLinecap="round" />
            ) : null;
          })}
          <text x={cx} y={cy + 5} textAnchor="middle" dominantBaseline="central"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-title-section-size)', fill: TRACK_COLOR, fontWeight: 600 }}>
            —
          </text>
        </svg>
      </div>
    );
  }

  const dims = ['discoverable', 'accessible', 'trusted', 'actionable'] as const;
  const gatingDim = dataScore.gating_dimension;
  const gatingDimScore = dataScore[gatingDim].score;
  const gatingDimColor = scoreColor(gatingDimScore);
  const gatingReasons = dataScore[gatingDim].reasons;
  const centerColor = levelColor(dataScore.level);

  return (
    <div
      ref={ringRef}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}
      aria-label={`DATA readiness score: ${dataScore.level}`}
    >
      {/* Left: Ring + dimension score bars */}
      <div style={{ flexShrink: 0 }}>
        <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
          {dims.map((dim) => {
            const startDeg = SEGMENT_STARTS[dim] + segmentGap / 2;
            const maxSweep = 90 - segmentGap;
            const score = dataScore[dim].score;
            const color = scoreColor(score);

            const trackPath = arcPath(cx, cy, r, startDeg, maxSweep);
            const fillSweep = score * maxSweep;
            const fillPath = fillSweep > 0 ? arcPath(cx, cy, r, startDeg, fillSweep) : '';

            return (
              <g key={dim}>
                {trackPath && (
                  <path d={trackPath} fill="none" stroke={TRACK_COLOR} strokeWidth={strokeWidth} strokeLinecap="round" />
                )}
                {fillPath && (
                  <path d={fillPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
                )}
              </g>
            );
          })}
          {/* Center level */}
          <text
            x={cx} y={cy - 8}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-title-section-size)', fill: centerColor, fontWeight: 600 }}
          >
            {dataScore.level}
          </text>
          {/* Center composite % */}
          <text
            x={cx} y={cy + 16}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-ui-regular-size)', fill: 'var(--estate-text-muted, var(--ink-3))' }}
          >
            {Math.round(dataScore.composite * 100)}%
          </text>
        </svg>

        {/* Dimension score bars below ring */}
        <div style={{ width: svgSize, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dims.map((dim) => (
            <DimScoreBar
              key={dim}
              dim={dim}
              score={dataScore[dim].score}
              color={scoreColor(dataScore[dim].score)}
            />
          ))}
        </div>
      </div>

      {/* Right: Gating callout */}
      <div style={{ paddingTop: 4, minWidth: 0, flex: 1 }}>
        <div style={{
          ...type.label,
          color: 'var(--estate-text-secondary, var(--ink-3))',
          marginBottom: 8,
        }}>
          DATA Readiness
        </div>

        {/* GATING chip */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 8,
          backgroundColor: GATING_CHIP_BG,
          border: `1px solid ${GATING_CHIP_COLOR}`,
          borderRadius: 3,
          padding: '2px 7px',
        }}>
          <span style={{
            ...type.label,
            color: GATING_CHIP_COLOR,
          }}>
            GATING
          </span>
        </div>

        {/* Gating statement */}
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--type-ui-regular-size)',
          color: gatingDimColor,
          marginBottom: 8,
          lineHeight: 1.5,
        }}>
          <span style={{ marginRight: 5 }}>◆</span>
          <span style={{ fontWeight: 600 }}>{DIMENSION_LABELS[gatingDim]}</span>
          {' '}is holding this object at{' '}
          <span style={{ fontWeight: 600 }}>{dataScore.level}</span>
        </div>

        {/* Gating reasons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {gatingReasons.slice(0, 5).map((reason, i) => (
            <div key={i} style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--type-ui-regular-size)',
              color: 'var(--estate-text-muted, var(--ink-3))',
              lineHeight: 1.5,
              paddingLeft: 14,
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute',
                left: 4,
                color: gatingDimColor,
                opacity: 0.6,
              }}>·</span>
              {reason}
            </div>
          ))}
        </div>

        {/* Level label */}
        <div style={{
          marginTop: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--type-ui-regular-size)',
          color: 'var(--estate-text-muted, var(--ink-3))',
          letterSpacing: '0.04em',
        }}>
          {LEVEL_LABELS[dataScore.level]}
        </div>
      </div>
    </div>
  );
}
