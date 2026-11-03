'use client';

import React, { useMemo, useState } from 'react';
import {
  BORN_COLORS,
  BORDER,
  TEXT_SEC,
  TEXT_MUT,
  GOLD,
  MONO,
  shortName,
} from '@/lib/bandits/born-tokens';
import { type, inkOf } from '@/lib/typography/tokens';
import type { CtsgvModelStat } from './types';
import { PanelHeader, PANEL_PADDING } from './PanelHeader';

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

/** |belief − allocation| at or below this (in points) counts as "matched". */
const MATCH_TOLERANCE_PTS = 5;

// Grid: model | belief bar | belief % | allocation bar | allocation % | gap
const GRID = 'minmax(140px, 1.1fr) minmax(120px, 2fr) 60px minmax(120px, 2fr) 60px 88px';

// ── Component ──────────────────────────────────────────────────────────────

export function ProbMatchPanel({ stats, favId, bornProbs, tally }: ProbMatchPanelProps) {
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const totalPulls = stats.reduce((s, m) => s + m.total_pulls, 0);
    const totalDraws = tally
      ? Array.from(tally.values()).reduce((s, v) => s + v, 0)
      : 0;

    return stats.map((stat, i) => {
      const belief = tally && totalDraws > 0
        ? (tally.get(stat.model_id) ?? 0) / totalDraws
        : (bornProbs.get(stat.model_id) ?? 0);
      const allocation = totalPulls > 0 ? stat.total_pulls / totalPulls : 0;
      return { modelId: stat.model_id, belief, allocation, colorIndex: i };
    }).sort((a, b) => b.belief - a.belief);
  }, [stats, bornProbs, tally]);

  // One shared scale for both bars so they are directly comparable and never exceed 100%.
  const scaleMax = Math.max(1e-9, ...rows.map(r => Math.max(r.belief, r.allocation)));
  const displayRows = showAll ? rows : rows.slice(0, 5);

  if (stats.length === 0) {
    return (
      <div className="born-card" style={{ padding: PANEL_PADDING }}>
        <div style={{ ...type.caption, color: TEXT_MUT }}>No data.</div>
      </div>
    );
  }

  const headCell: React.CSSProperties = { ...type.eyebrow, color: TEXT_MUT, whiteSpace: 'nowrap' };

  return (
    <div className="born-card" style={{ padding: PANEL_PADDING }}>
      <PanelHeader
        title="Probability Matching Check"
        subtitle={<>Born rule: allocation should track belief · within ±{MATCH_TOLERANCE_PTS} pts counts as matched</>}
        actions={rows.length > 5 && (
          <button type="button" className="born-btn" onClick={() => setShowAll(v => !v)} style={type.ui}>
            {showAll ? 'Show top 5' : `Show all ${rows.length}`}
          </button>
        )}
      />

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 720 }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'end',
            paddingBottom: 8, borderBottom: `1px solid ${BORDER}`,
          }}>
            <span style={headCell}>Model</span>
            <span style={headCell}>Belief</span>
            <span style={{ ...headCell, textAlign: 'right' }}>%</span>
            <span style={headCell}>Allocation</span>
            <span style={{ ...headCell, textAlign: 'right' }}>%</span>
            <span style={{ ...headCell, textAlign: 'right' }}>Gap</span>
          </div>

          {displayRows.map(row => {
            const isFav = row.modelId === favId;
            const color = isFav ? GOLD : BORN_COLORS[row.colorIndex % BORN_COLORS.length];
            const gapPts = (row.allocation - row.belief) * 100;
            const matched = Math.abs(gapPts) <= MATCH_TOLERANCE_PTS;
            const valueStyle: React.CSSProperties = {
              ...type.caption, fontFamily: MONO, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
            };

            return (
              <div key={row.modelId} style={{
                display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid var(--born-overlay-2)',
              }}>
                {/* Model */}
                <span title={row.modelId} style={{
                  ...type.caption, fontFamily: MONO, minWidth: 0,
                  display: 'flex', alignItems: 'center', gap: 8,
                  color: isFav ? inkOf(GOLD, 70) : TEXT_SEC,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {shortName(row.modelId)}
                  </span>
                </span>

                {/* Belief */}
                <Bar value={row.belief / scaleMax} color={color} />
                <span style={{ ...valueStyle, color: isFav ? inkOf(GOLD, 70) : TEXT_SEC }}>
                  {(row.belief * 100).toFixed(1)}%
                </span>

                {/* Allocation */}
                <Bar value={row.allocation / scaleMax} color={color} faded />
                <span style={{ ...valueStyle, color: TEXT_MUT }}>
                  {(row.allocation * 100).toFixed(1)}%
                </span>

                {/* Gap */}
                <span style={{ textAlign: 'right' }}>
                  <span
                    title={matched ? 'Allocation tracks belief' : gapPts > 0 ? 'Pulled more than belief suggests' : 'Pulled less than belief suggests'}
                    style={{
                      ...type.caption, fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                      padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                      color: matched ? TEXT_MUT : inkOf('#E8A838', 70),
                      background: matched ? 'var(--born-overlay)' : 'color-mix(in srgb, #E8A838 12%, transparent)',
                    }}
                  >
                    {gapPts >= 0 ? '+' : '−'}{Math.abs(gapPts).toFixed(1)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Bar({ value, color, faded }: { value: number; color: string; faded?: boolean }) {
  return (
    <div style={{ height: 8, background: 'var(--born-overlay-2)', borderRadius: 999, overflow: 'hidden', minWidth: 0 }}>
      <div style={{
        height: '100%',
        width: `${Math.max(0, Math.min(1, value)) * 100}%`,
        background: faded ? `color-mix(in srgb, ${color} 45%, transparent)` : color,
        borderRadius: 999,
        transition: 'width 300ms ease',
      }} />
    </div>
  );
}
