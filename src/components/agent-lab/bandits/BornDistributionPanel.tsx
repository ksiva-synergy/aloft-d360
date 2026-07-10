'use client';

import React, { useMemo } from 'react';
import {
  BORN_COLORS,
  GOLD,
  CARD_BG,
  BORDER,
  TEXT_PRI,
  TEXT_SEC,
  TEXT_MUT,
  SERIF,
  MONO,
  shortName,
} from '@/lib/bandits/born-tokens';
import type { CtsgvModelStat } from './types';

// ── Props ──────────────────────────────────────────────────────────────────

export interface BornDistributionPanelProps {
  /** Stats array in original composite-sorted order (index = color index). */
  stats: CtsgvModelStat[];
  favId: string;
  /** Static born_probs keyed by model_id. */
  bornProbs: Map<string, number>;
  /** Live MEASURE tally keyed by model_id. When non-null, overrides bornProbs. */
  tally: Map<string, number> | null;
  measuring: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function BornDistributionPanel({
  stats,
  favId,
  bornProbs,
  tally,
  measuring,
}: BornDistributionPanelProps) {

  // Build display rows — resolved by model_id regardless of sort
  const rows = useMemo(() => {
    const totalDraws = tally
      ? Array.from(tally.values()).reduce((s, v) => s + v, 0)
      : 0;

    // Build a stable colorIndex map from original stats order
    const colorIndexMap = new Map<string, number>();
    stats.forEach((s, i) => colorIndexMap.set(s.model_id, i));

    return stats.map(stat => {
      const p = tally && totalDraws > 0
        ? (tally.get(stat.model_id) ?? 0) / totalDraws
        : (bornProbs.get(stat.model_id) ?? 0);
      return {
        modelId: stat.model_id,
        p,
        colorIndex: colorIndexMap.get(stat.model_id) ?? 0,
      };
    }).sort((a, b) => b.p - a.p);
  }, [stats, bornProbs, tally]);

  const maxP = rows.length > 0 ? rows[0].p : 1;

  if (stats.length === 0) {
    return (
      <div style={{
        background: CARD_BG, border: `1px solid ${BORDER}`,
        borderRadius: 6, padding: '20px 24px',
      }}>
        <div style={{ fontFamily: MONO, fontSize: 12, color: TEXT_MUT }}>No data.</div>
      </div>
    );
  }

  return (
    <div style={{
      background: CARD_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: 6,
      padding: '20px 24px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: TEXT_PRI }}>
          The Born Distribution
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>
          {measuring ? 'Sampling…' : 'Probability matching · P(selected on next draw)'}
        </div>
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {rows.map((row, rank) => {
          const isFav = row.modelId === favId;
          const color = isFav ? GOLD : BORN_COLORS[row.colorIndex % BORN_COLORS.length];
          const widthPct = maxP > 0 ? (row.p / maxP) * 100 : 0;

          return (
            <div key={row.modelId}>
              {/* Label + value row */}
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}>
                <span style={{
                  fontFamily: MONO, fontSize: 12,
                  color: isFav ? GOLD : TEXT_SEC,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ color: TEXT_MUT, minWidth: 18 }}>#{rank + 1}</span>
                  {shortName(row.modelId)}
                </span>
                <span style={{
                  fontFamily: MONO, fontSize: 12, fontWeight: 700,
                  color: isFav ? GOLD : TEXT_PRI,
                }}>
                  {(row.p * 100).toFixed(1)}%
                </span>
              </div>

              {/* Bar track */}
              <div style={{
                height: 10,
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${widthPct}%`,
                  background: color,
                  borderRadius: 3,
                  transition: 'width 300ms ease',
                  opacity: isFav ? 1 : 0.75,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
