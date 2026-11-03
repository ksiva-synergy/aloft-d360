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
import { type, inkOf } from '@/lib/typography/tokens';

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
        borderRadius: 'var(--born-r-card)', padding: '20px 24px',
      }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--type-ui-regular-size)', color: TEXT_MUT }}>No data.</div>
      </div>
    );
  }

  return (
    <div style={{
      background: CARD_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: 'var(--born-r-card)',
      boxShadow: 'var(--shadow-xs)',
      padding: '20px 24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 'var(--type-title-section-size)', fontWeight: 600, color: TEXT_PRI }}>
            The Born Distribution
          </div>
          <div style={{ ...type.caption, color: TEXT_MUT, marginTop: 2 }}>
            Probability matching · P(selected on next draw)
          </div>
        </div>
        <span style={{
          ...type.label, flexShrink: 0, whiteSpace: 'nowrap',
          padding: '2px 8px', borderRadius: 999,
          border: `1px solid ${tally || measuring ? `color-mix(in srgb, ${GOLD} 45%, transparent)` : BORDER}`,
          color: tally || measuring ? inkOf(GOLD, 60) : TEXT_SEC,
          background: tally || measuring ? `color-mix(in srgb, ${GOLD} 10%, transparent)` : 'var(--born-overlay)',
        }}>
          {measuring ? 'Sampling…' : tally ? 'Measured' : 'Estimated'}
        </span>
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((row, rank) => {
          const isFav = row.modelId === favId;
          const color = isFav ? GOLD : BORN_COLORS[row.colorIndex % BORN_COLORS.length];
          const widthPct = maxP > 0 ? (row.p / maxP) * 100 : 0;

          return (
            <div key={row.modelId}>
              {/* Label + value row — name truncates so it never runs into the value */}
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 12,
                marginBottom: 6,
              }}>
                <span title={row.modelId} style={{
                  fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)',
                  color: isFav ? inkOf(GOLD, 70) : TEXT_SEC,
                  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                }}>
                  <span style={{ color: TEXT_MUT, minWidth: 22, flexShrink: 0 }}>#{rank + 1}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {shortName(row.modelId)}
                  </span>
                </span>
                <span style={{
                  fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)', fontWeight: 600,
                  color: isFav ? inkOf(GOLD, 70) : TEXT_PRI,
                  flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                }}>
                  {(row.p * 100).toFixed(1)}%
                </span>
              </div>

              {/* Bar track */}
              <div style={{
                height: 8,
                background: 'var(--born-overlay-2)',
                borderRadius: 999,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${widthPct}%`,
                  background: color,
                  borderRadius: 999,
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
