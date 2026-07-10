'use client';

import React, { useState } from 'react';
import {
  CARD_BG, BORDER, GOLD,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  MONO, BODY,
  modelColor,
  shortName,
} from '@/lib/bandits/born-tokens';
import { betaPDF } from '@/lib/bandits/born-math';
import { CtsgvMicroBar } from './CtsgvMicroBar';

// ── Beta CI (normal approximation) ───────────────────────────────────────────

function betaCI(a: number, b: number): { mean: number; ciLow: number; ciHigh: number } {
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const sd = Math.sqrt(variance);
  return {
    mean,
    ciLow: Math.max(0, mean - 1.96 * sd),
    ciHigh: Math.min(1, mean + 1.96 * sd),
  };
}

// ── Posterior sparkline SVG ───────────────────────────────────────────────────

function PosteriorSparkline({
  alpha,
  beta: betaParam,
  color,
  width = 48,
  height = 16,
}: {
  alpha: number;
  beta: number;
  color: string;
  width?: number;
  height?: number;
}) {
  const N = 30;
  const points: [number, number][] = [];
  let maxY = 0;

  for (let i = 0; i <= N; i++) {
    const x = 0.01 + (i / N) * 0.98;
    const y = betaPDF(x, alpha, betaParam);
    if (isFinite(y)) points.push([x, y]);
    if (isFinite(y) && y > maxY) maxY = y;
  }

  if (points.length < 2 || maxY === 0) return null;

  const toSvg = (px: number, py: number) => ({
    sx: (px - 0.01) / 0.98 * width,
    sy: height - (py / maxY) * (height - 1),
  });

  const pathD =
    points
      .map(([px, py], i) => {
        const { sx, sy } = toSvg(px, py);
        return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(' ');

  const fillD =
    pathD +
    ` L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d={fillD} fill={color} fillOpacity={0.25} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={1} />
    </svg>
  );
}

// ── Strip sheet_type prefix ───────────────────────────────────────────────────

function stripSheetType(s: string): string {
  if (!s) return s;
  if (s === 'inspector_chat') return 'inspector';
  if (s.startsWith('boost_')) return 'boost:' + s.slice(6);
  if (s.startsWith('workbench_')) return 'wb:' + s.slice(10);
  if (s === 'all_tasks') return 'all tasks';
  return s;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BornVerdictProps {
  selectedModelId: string;
  sheetType: string;
  bornProb: number;
  phase: 'exploring' | 'exploiting';
  posteriorAlpha: number;
  posteriorBeta: number;
  composite: number | null;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BornVerdict({
  selectedModelId,
  sheetType,
  bornProb,
  phase,
  posteriorAlpha,
  posteriorBeta,
  composite,
  className,
}: BornVerdictProps) {
  const [hovered, setHovered] = useState(false);

  const color = modelColor(selectedModelId);
  const name = shortName(selectedModelId);
  const { ciLow, ciHigh } = betaCI(posteriorAlpha, posteriorBeta);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  // Synthetic scores object for CtsgvMicroBar (composite only — no per-axis here)
  const microScores = composite != null
    ? { score_c: composite, score_t: composite, score_s: composite, score_g: composite }
    : null;

  return (
    <div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        maxWidth: 520,
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        padding: '8px 14px',
        overflow: 'hidden',
        transition: 'max-height 200ms ease, border-color 200ms ease',
        borderColor: hovered ? color : BORDER,
        cursor: 'default',
      }}
    >
      {/* ── Main row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 24 }}>

        {/* LEFT: label + model name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: TEXT_MUT, letterSpacing: '0.04em' }}>
            BORN measured →
          </span>
          <span style={{
            fontFamily: BODY, fontSize: 12, fontWeight: 600,
            color: GOLD,
            letterSpacing: '0.01em',
          }}>
            {name}
          </span>
        </div>

        {/* MIDDLE: P=x% · phase */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 auto', minWidth: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: TEXT_SEC, whiteSpace: 'nowrap' }}>
            P={pct(bornProb)} best for {stripSheetType(sheetType)}
          </span>
          <span style={{
            fontFamily: MONO, fontSize: 9,
            color: phase === 'exploiting' ? TEXT_SEC : TEXT_MUT,
            opacity: 0.8,
            whiteSpace: 'nowrap',
          }}>
            {phase}
          </span>
        </div>

        {/* RIGHT: posterior sparkline */}
        <PosteriorSparkline
          alpha={posteriorAlpha}
          beta={posteriorBeta}
          color={color}
        />

        {/* FAR RIGHT: CTSGV micro-bar (if composite present) */}
        {microScores && (
          <CtsgvMicroBar scores={microScores} totalWidth={40} height={8} />
        )}
      </div>

      {/* ── Hover detail row ── */}
      <div style={{
        maxHeight: hovered ? 24 : 0,
        overflow: 'hidden',
        transition: 'max-height 200ms ease',
        marginTop: hovered ? 4 : 0,
      }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT }}>
          α={posteriorAlpha.toFixed(1)} β={posteriorBeta.toFixed(1)}
          {' · '}95% CI: {pct(ciLow)}–{pct(ciHigh)}
        </span>
      </div>
    </div>
  );
}

export default BornVerdict;
