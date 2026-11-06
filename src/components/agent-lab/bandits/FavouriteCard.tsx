'use client';

import React, { useMemo } from 'react';
import {
  BORDER, GOLD, TEAL,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  MONO,
  shortName,
} from '@/lib/bandits/born-tokens';
import { betaPDF, ci95 } from '@/lib/bandits/born-math';
import { type, inkOf } from '@/lib/typography/tokens';
import type { CtsgvModelStat } from './types';
import { formatPct } from './types';

const CURVE_W = 400;
const CURVE_H = 56;
const CURVE_N = 90;

/** Posterior curve for the favourite with its 95% CI band and mean marker. */
function PosteriorCurve({ alpha, beta }: { alpha: number; beta: number }) {
  const { line, area, lo, hi, mean } = useMemo(() => {
    const ys: number[] = [];
    for (let i = 0; i <= CURVE_N; i++) {
      const x = 0.005 + (i / CURVE_N) * 0.99;
      const y = betaPDF(x, alpha, beta);
      ys.push(Number.isFinite(y) ? y : 0);
    }
    const max = Math.max(...ys, 1e-9);
    const pts = ys.map((y, i) => [
      (i / CURVE_N) * CURVE_W,
      CURVE_H - 2 - (y / max) * (CURVE_H - 6),
    ] as const);
    const lineD = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const [l, h] = ci95(alpha, beta);
    return {
      line: lineD,
      area: `${lineD} L${CURVE_W},${CURVE_H} L0,${CURVE_H} Z`,
      lo: l, hi: h, mean: alpha / (alpha + beta),
    };
  }, [alpha, beta]);

  return (
    <svg
      viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Posterior belief: mean ${formatPct(mean)}, 95% CI ${formatPct(lo)} to ${formatPct(hi)}`}
      style={{ width: '100%', height: CURVE_H, display: 'block' }}
    >
      <rect x={lo * CURVE_W} y={0} width={Math.max(1, (hi - lo) * CURVE_W)} height={CURVE_H}
        fill={GOLD} fillOpacity={0.07} />
      <path d={area} fill={GOLD} fillOpacity={0.16} />
      <path d={line} fill="none" stroke={GOLD} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={mean * CURVE_W} x2={mean * CURVE_W} y1={0} y2={CURVE_H}
        stroke={GOLD} strokeOpacity={0.7} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <line x1={0} x2={CURVE_W} y1={CURVE_H - 0.5} y2={CURVE_H - 0.5}
        style={{ stroke: BORDER }} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface FavouriteCardProps {
  stat: CtsgvModelStat | undefined;
  favId: string;
  favProb: number;
  runnerUp: { modelId: string; p: number } | null;
}

/**
 * Hero card: which arm BORN currently routes to, how sure it is, and by how much it leads.
 * Every text row truncates so long provider/model ids never collide with neighbours.
 */
export function FavouriteCard({ stat, favId, favProb, runnerUp }: FavouriteCardProps) {
  const name = shortName(favId);
  const alpha = stat?.posterior_alpha ?? 2;
  const beta = stat?.posterior_beta ?? 2;
  const [lo, hi] = ci95(alpha, beta);
  const lead = runnerUp ? (favProb - runnerUp.p) * 100 : null;
  const exploiting = stat?.phase === 'exploiting';

  const ellipsis: React.CSSProperties = {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  };

  return (
    <section
      className="born-card"
      aria-label="Measured favourite"
      style={{
        padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 16,
        borderColor: `color-mix(in srgb, ${GOLD} 35%, var(--born-border))`,
        boxShadow: `0 0 0 1px color-mix(in srgb, ${GOLD} 6%, transparent), 0 18px 40px -28px color-mix(in srgb, ${GOLD} 45%, transparent)`,
        minWidth: 0,
      }}
    >
      {/* Header: eyebrow, name, meta | phase */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...type.eyebrow, color: TEXT_MUT }}>Measured favourite</div>
          <div title={favId} style={{ ...type['title-section'], ...ellipsis, color: inkOf(GOLD, 70), marginTop: 6 }}>
            {name}
          </div>
          {stat && (
            <div style={{ ...type.caption, ...ellipsis, color: TEXT_MUT, marginTop: 2 }}>
              {stat.provider} · {stat.total_pulls} {stat.total_pulls === 1 ? 'pull' : 'pulls'}
              {stat.avg_composite != null && <> · quality {formatPct(stat.avg_composite)}</>}
            </div>
          )}
        </div>
        {stat && (
          <span style={{
            ...type.label,
            padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
            color: exploiting ? inkOf(TEAL, 70) : TEXT_SEC,
            background: exploiting ? `color-mix(in srgb, ${TEAL} 14%, transparent)` : 'var(--born-overlay-2)',
            border: `1px solid ${exploiting ? `color-mix(in srgb, ${TEAL} 35%, transparent)` : BORDER}`,
          }}>
            {stat.phase}
          </span>
        )}
      </div>

      {/* Body: probability + lead | posterior curve */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: 20, alignItems: 'end' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...type.label, color: TEXT_SEC }}>P(next draw)</div>
          <div style={{ ...type['kpi-lg'], color: TEXT_PRI, marginTop: 2 }}>{formatPct(favProb)}</div>
          <div style={{ position: 'relative', height: 6, borderRadius: 999, background: 'var(--born-overlay-2)', marginTop: 10 }}>
            <div style={{
              width: `${Math.min(100, favProb * 100)}%`, height: '100%', borderRadius: 999,
              background: GOLD, transition: 'width 300ms ease',
            }} />
            {runnerUp && (
              <div
                title={`#2 ${shortName(runnerUp.modelId)} · ${formatPct(runnerUp.p)}`}
                style={{
                  position: 'absolute', top: -3, bottom: -3, width: 2, borderRadius: 1,
                  left: `calc(${Math.min(100, runnerUp.p * 100)}% - 1px)`,
                  background: TEXT_SEC,
                }}
              />
            )}
          </div>
          {runnerUp && lead != null && (
            <div title={`over #2 ${runnerUp.modelId}`} style={{ ...type.caption, ...ellipsis, color: TEXT_MUT, marginTop: 8 }}>
              <span style={{ color: TEXT_SEC, fontVariantNumeric: 'tabular-nums' }}>
                +{lead.toFixed(1)} pts
              </span>{' '}
              over #2 {shortName(runnerUp.modelId)}
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{
            borderRadius: 'var(--born-r-inner)', background: 'var(--born-overlay)',
            padding: '8px 10px 0', overflow: 'hidden',
          }}>
            <PosteriorCurve alpha={alpha} beta={beta} />
          </div>
          <div style={{
            ...type.caption, fontFamily: MONO, color: TEXT_MUT, marginTop: 6,
            display: 'flex', justifyContent: 'space-between', gap: 8, whiteSpace: 'nowrap',
          }}>
            <span>α {alpha.toFixed(1)} · β {beta.toFixed(1)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>CI {formatPct(lo)}–{formatPct(hi)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
