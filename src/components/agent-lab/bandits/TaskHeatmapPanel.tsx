'use client';

import React, { useMemo, useState } from 'react';
import type { CtsgvModelStat } from './types';
import {
  CARD_BG, BORDER, GOLD, TEAL,
  TEXT_PRI, TEXT_MUT,
  SERIF, MONO, BODY,
  BORN_COLORS,
} from '@/lib/bandits/born-tokens';
import { shortName } from '@/lib/bandits/born-tokens';

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripPrefix(s: string): string {
  if (s === 'inspector_chat') return 'inspector';
  if (s.startsWith('boost_')) return 'boost:' + s.slice(6);
  if (s.startsWith('workbench_')) return 'wb:' + s.slice(10);
  return s;
}

/** Interpolate two hex colours by t ∈ [0,1]. */
function hexLerp(a: string, b: string, t: number): string {
  const pr = parseInt(a.slice(1, 3), 16);
  const pg = parseInt(a.slice(3, 5), 16);
  const pb = parseInt(a.slice(5, 7), 16);
  const qr = parseInt(b.slice(1, 3), 16);
  const qg = parseInt(b.slice(3, 5), 16);
  const qb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(pr + (qr - pr) * t);
  const g = Math.round(pg + (qg - pg) * t);
  const bv = Math.round(pb + (qb - pb) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`;
}

/** Colour scale: #1a1a2e (0%) → TEAL (50%) → GOLD (100%) */
function rateToColor(rate: number): string {
  if (rate <= 0.5) return hexLerp('#1a1a2e', TEAL, rate * 2);
  return hexLerp(TEAL, GOLD, (rate - 0.5) * 2);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  stats: CtsgvModelStat[];
  favId: string;
}

interface TooltipState {
  x: number;
  y: number;
  modelId: string;
  sheetType: string;
  total: number;
  successes: number;
  rate: number;
}

export function TaskHeatmapPanel({ stats, favId }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // All unique sheet_types across all models, sorted alphabetically
  const sheetTypes = useMemo(() => {
    const set = new Set<string>();
    for (const stat of stats) {
      for (const bd of stat.sheet_breakdown) {
        if (bd.sheet_type) set.add(bd.sheet_type);
      }
    }
    return [...set].sort();
  }, [stats]);

  // Build lookup: model_id → sheet_type → SheetBreakdown
  const lookup = useMemo(() => {
    const map = new Map<string, Map<string, { total: number; success_rate: number }>>();
    for (const stat of stats) {
      const inner = new Map<string, { total: number; success_rate: number }>();
      for (const bd of stat.sheet_breakdown) {
        inner.set(bd.sheet_type, { total: bd.total, success_rate: bd.success_rate });
      }
      map.set(stat.model_id, inner);
    }
    return map;
  }, [stats]);

  // Per-column winner (model_id with highest success_rate in each column)
  const columnWinner = useMemo(() => {
    const winners = new Map<string, { modelId: string; rate: number }>();
    for (const st of sheetTypes) {
      let best: { modelId: string; rate: number } | null = null;
      for (const stat of stats) {
        const cell = lookup.get(stat.model_id)?.get(st);
        if (cell && cell.total > 0 && (best == null || cell.success_rate > best.rate)) {
          best = { modelId: stat.model_id, rate: cell.success_rate };
        }
      }
      if (best) winners.set(st, best);
    }
    return winners;
  }, [stats, sheetTypes, lookup]);

  if (stats.length === 0) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '20px 24px' }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: TEXT_PRI }}>Where Each Arm Wins</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, marginTop: 8 }}>No data</div>
      </div>
    );
  }

  const CELL_W = 36;
  const CELL_H = 28;
  const CELL_GAP = 2;
  const ROW_LABEL_W = 110;
  const COL_HEADER_H = 80; // room for rotated labels

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: TEXT_PRI }}>
          Where Each Arm Wins
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, marginTop: 4 }}>
          Task-type × model · success rate
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'inline-block', minWidth: ROW_LABEL_W + sheetTypes.length * (CELL_W + CELL_GAP) }}>

          {/* Column headers row */}
          <div style={{ display: 'flex', marginLeft: ROW_LABEL_W, marginBottom: 4 }}>
            {sheetTypes.map(st => (
              <div
                key={st}
                style={{
                  width: CELL_W,
                  marginRight: CELL_GAP,
                  height: COL_HEADER_H,
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  overflow: 'visible',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    color: TEXT_MUT,
                    display: 'inline-block',
                    transform: 'rotate(-45deg)',
                    transformOrigin: 'bottom center',
                    whiteSpace: 'nowrap',
                    maxWidth: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={st}
                >
                  {stripPrefix(st)}
                </span>
              </div>
            ))}
          </div>

          {/* Rows */}
          {stats.map((stat, rowIdx) => {
            const modelColor = BORN_COLORS[rowIdx % BORN_COLORS.length];
            const isFav = stat.model_id === favId;
            return (
              <div
                key={stat.model_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: CELL_GAP,
                }}
              >
                {/* Row label */}
                <div
                  style={{
                    width: ROW_LABEL_W,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    paddingRight: 8,
                  }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: isFav ? GOLD : modelColor, flexShrink: 0,
                  }} />
                  <span style={{
                    fontFamily: MONO, fontSize: 11,
                    color: isFav ? GOLD : TEXT_PRI,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {shortName(stat.model_id)}
                  </span>
                </div>

                {/* Cells */}
                {sheetTypes.map(st => {
                  const cell = lookup.get(stat.model_id)?.get(st);
                  const hasData = cell && cell.total > 0;
                  const winner = columnWinner.get(st);
                  const isWinner = winner?.modelId === stat.model_id;

                  return (
                    <div
                      key={st}
                      onMouseEnter={e => {
                        if (!hasData) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const successes = Math.round(cell!.total * cell!.success_rate);
                        setTooltip({
                          x: rect.left + CELL_W / 2,
                          y: rect.top - 8,
                          modelId: stat.model_id,
                          sheetType: st,
                          total: cell!.total,
                          successes,
                          rate: cell!.success_rate,
                        });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        width: CELL_W,
                        height: CELL_H,
                        marginRight: CELL_GAP,
                        flexShrink: 0,
                        borderRadius: 2,
                        cursor: hasData ? 'default' : 'default',
                        background: hasData ? rateToColor(cell!.success_rate) : 'transparent',
                        border: isWinner && hasData
                          ? `1px solid ${GOLD}`
                          : hasData
                            ? '1px solid transparent'
                            : `1px dashed ${BORDER}`,
                        boxSizing: 'border-box',
                      }}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* Colour scale legend */}
          <div style={{
            marginTop: 14,
            marginLeft: ROW_LABEL_W,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT }}>0%</span>
            <div style={{
              height: 6,
              width: 160,
              borderRadius: 3,
              background: `linear-gradient(to right, #1a1a2e, ${TEAL}, ${GOLD})`,
            }} />
            <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT }}>100%</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT, marginLeft: 12 }}>
              gold border = column winner
            </span>
          </div>

        </div>
      </div>

      {/* Floating tooltip — rendered as fixed to escape overflow:hidden */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
            background: CARD_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: '8px 12px',
            pointerEvents: 'none',
            zIndex: 9999,
            fontFamily: MONO,
            fontSize: 11,
            color: TEXT_PRI,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ color: TEXT_MUT, marginBottom: 4 }}>
            {shortName(tooltip.modelId)} × {stripPrefix(tooltip.sheetType)}
          </div>
          <div>
            {tooltip.successes}/{tooltip.total} success
            &nbsp;
            <span style={{ color: rateToColor(tooltip.rate), fontWeight: 600 }}>
              ({(tooltip.rate * 100).toFixed(1)}%)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
