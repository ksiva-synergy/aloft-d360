'use client';

import React, { useMemo, useState } from 'react';
import {
  BORN_COLORS,
  CARD_BG,
  BORDER,
  TEXT_PRI,
  TEXT_SEC,
  TEXT_MUT,
  GOLD,
  SERIF,
  MONO,
  shortName,
} from '@/lib/bandits/born-tokens';
import type { CtsgvModelStat } from './types';

// ── Props ──────────────────────────────────────────────────────────────────

export interface ProbMatchPanelProps {
  /** Stats in original composite-sorted order. */
  stats: CtsgvModelStat[];
  favId: string;
  /** Static born_probs keyed by model_id. */
  bornProbs: Map<string, number>;
  /** Live MEASURE tally keyed by model_id. When non-null, overrides bornProbs for belief. */
  tally: Map<string, number> | null;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ProbMatchPanel({ stats, favId, bornProbs, tally }: ProbMatchPanelProps) {
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const totalPulls = stats.reduce((s, m) => s + m.total_pulls, 0);
    const totalDraws = tally
      ? Array.from(tally.values()).reduce((s, v) => s + v, 0)
      : 0;

    const colorIndexMap = new Map<string, number>();
    stats.forEach((s, i) => colorIndexMap.set(s.model_id, i));

    return stats.map(stat => {
      const belief = tally && totalDraws > 0
        ? (tally.get(stat.model_id) ?? 0) / totalDraws
        : (bornProbs.get(stat.model_id) ?? 0);
      const allocation = totalPulls > 0 ? stat.total_pulls / totalPulls : 0;
      return {
        modelId: stat.model_id,
        belief,
        allocation,
        colorIndex: colorIndexMap.get(stat.model_id) ?? 0,
      };
    }).sort((a, b) => b.belief - a.belief);
  }, [stats, bornProbs, tally]);

  const maxBelief = rows.length > 0 ? rows[0].belief : 1;
  const displayRows = showAll ? rows : rows.slice(0, 5);

  function hex2rgba(hex: string, opacity: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }

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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: TEXT_PRI }}>
            Probability Matching Check
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>
            Born rule: allocation should track belief
          </div>
        </div>
        {rows.length > 5 && (
          <button
            onClick={() => setShowAll(v => !v)}
            style={{
              fontFamily: MONO, fontSize: 10, color: TEXT_MUT,
              background: 'transparent', border: `1px solid ${BORDER}`,
              borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
              letterSpacing: '0.04em', flexShrink: 0,
            }}
          >
            {showAll ? 'Show top 5' : `Show all ${rows.length}`}
          </button>
        )}
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {displayRows.map(row => {
          const isFav = row.modelId === favId;
          const color = isFav ? GOLD : BORN_COLORS[row.colorIndex % BORN_COLORS.length];
          const beliefW = maxBelief > 0 ? (row.belief / maxBelief) * 100 : 0;
          const allocW = maxBelief > 0 ? (row.allocation / maxBelief) * 100 : 0;

          return (
            <div key={row.modelId}>
              {/* Model label */}
              <div style={{
                fontFamily: MONO, fontSize: 11,
                color: isFav ? GOLD : TEXT_SEC,
                marginBottom: 5,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: color, display: 'inline-block', flexShrink: 0,
                }} />
                {shortName(row.modelId)}
              </div>

              {/* Belief bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontFamily: MONO, fontSize: 9,
                  color: TEXT_MUT, width: 52, flexShrink: 0,
                  letterSpacing: '0.04em',
                }}>
                  Belief
                </span>
                <div style={{
                  flex: 1, height: 12,
                  background: 'var(--born-overlay)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${beliefW}%`,
                    background: color,
                    borderRadius: 2,
                    transition: 'width 300ms ease',
                  }} />
                </div>
                <span style={{
                  fontFamily: MONO, fontSize: 10,
                  color: isFav ? GOLD : TEXT_SEC,
                  width: 42, textAlign: 'right', flexShrink: 0,
                }}>
                  {(row.belief * 100).toFixed(1)}%
                </span>
              </div>

              {/* Allocation bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontFamily: MONO, fontSize: 9,
                  color: TEXT_MUT, width: 52, flexShrink: 0,
                  letterSpacing: '0.04em',
                }}>
                  Allocation
                </span>
                <div style={{
                  flex: 1, height: 12,
                  background: 'var(--born-overlay)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${allocW}%`,
                    background: hex2rgba(color, 0.5),
                    borderRadius: 2,
                    transition: 'width 300ms ease',
                  }} />
                </div>
                <span style={{
                  fontFamily: MONO, fontSize: 10,
                  color: TEXT_MUT,
                  width: 42, textAlign: 'right', flexShrink: 0,
                }}>
                  {(row.allocation * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
