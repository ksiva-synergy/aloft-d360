'use client';

import React, { useMemo, useState } from 'react';
import type { CtsgvModelStat } from './types';
import {
  CARD_BG, BORDER, GOLD,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  SERIF, MONO,
} from '@/lib/bandits/born-tokens';
import { shortName } from '@/lib/bandits/born-tokens';

const REFINED_PALETTE = [
  '#6C9BD2',
  '#E8A838',
  '#D4605A',
  '#6BC5B0',
  '#7EC46A',
  '#C4A44E',
  '#A77FC4',
  '#E8889A',
  '#A68E7A',
  '#8E9FAA',
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(s: string): string {
  const d = new Date(s);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

type BucketGranularity = 'day' | 'week' | 'biweek' | 'month';

interface BucketedColumn {
  label: string;       // e.g. "Jun 15", "Jun 15–21", "Jun 15–28", "Jun"
  sublabel: string;    // e.g. "7 days", "2 weeks", "1 month"
  fracs: Record<string, number>;
  total: number;
  key: string;
}

function chooseBucketSize(numDays: number): BucketGranularity {
  if (numDays <= 6)   return 'day';
  if (numDays <= 42)  return 'week';
  if (numDays <= 90)  return 'biweek';
  return 'month';
}

function bucketKey(dateStr: string, granularity: BucketGranularity): string {
  const d = new Date(dateStr);
  if (granularity === 'day') return dateStr;
  if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
  const bucketSize = granularity === 'week' ? 7 : 14;
  const bucketNum = Math.floor(dayOfYear / bucketSize);
  return `${d.getFullYear()}-${String(bucketNum).padStart(3, '0')}`;
}

function buildBuckets(
  normalised: { date: string; fracs: Record<string, number>; total: number }[],
  modelOrder: string[],
  granularity: BucketGranularity,
): BucketedColumn[] {
  const groups = new Map<string, { date: string; fracs: Record<string, number>; total: number }[]>();
  for (const row of normalised) {
    const k = bucketKey(row.date, granularity);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row);
  }

  const columns: BucketedColumn[] = [];
  for (const [key, rows] of groups) {
    const bucketTotal = rows.reduce((s, r) => s + r.total, 0);
    const fracs: Record<string, number> = {};
    for (const id of modelOrder) {
      const weightedSum = rows.reduce((s, r) => s + (r.fracs[id] ?? 0) * r.total, 0);
      fracs[id] = bucketTotal > 0 ? weightedSum / bucketTotal : 0;
    }

    const sortedDates = rows.map(r => r.date).sort();
    const first = new Date(sortedDates[0]);
    const last  = new Date(sortedDates[sortedDates.length - 1]);

    let label: string;
    let sublabel: string;
    if (granularity === 'day') {
      label = fmtDate(sortedDates[0]);
      sublabel = '';
    } else if (granularity === 'month') {
      label = `${MONTHS[first.getMonth()]} ${first.getFullYear()}`;
      sublabel = `${rows.length}d`;
    } else {
      const sameMonth = first.getMonth() === last.getMonth();
      label = sameMonth
        ? `${MONTHS[first.getMonth()]} ${first.getDate()}–${last.getDate()}`
        : `${MONTHS[first.getMonth()]} ${first.getDate()}–${MONTHS[last.getMonth()]} ${last.getDate()}`;
      sublabel = `${rows.length}d`;
    }

    columns.push({ label, sublabel, fracs, total: bucketTotal, key });
  }

  columns.sort((a, b) => a.key.localeCompare(b.key));
  return columns;
}

interface Props {
  allocationSeries: Record<string, unknown>[];
  stats: CtsgvModelStat[];
  favId: string;
}

export function PosteriorTimelinePanel({ allocationSeries, stats, favId }: Props) {
  const modelOrder = useMemo(() => {
    const allIds = new Set<string>();
    for (const row of allocationSeries) {
      for (const k of Object.keys(row)) {
        if (k !== 'date') allIds.add(k);
      }
    }
    const fromStats = stats.map(s => s.model_id).filter(id => allIds.has(id));
    const rest = [...allIds].filter(id => !fromStats.includes(id));
    const all = [...fromStats, ...rest];
    return [...all.filter(id => id !== favId), ...(all.includes(favId) ? [favId] : [])];
  }, [allocationSeries, stats, favId]);

  const days = useMemo(() =>
    [...allocationSeries]
      .filter(r => typeof r.date === 'string')
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [allocationSeries]
  );

  const normalised = useMemo(() => {
    return days.map(row => {
      const total = modelOrder.reduce((s, id) => s + (Number(row[id]) || 0), 0);
      const fracs: Record<string, number> = {};
      for (const id of modelOrder) {
        fracs[id] = total > 0 ? (Number(row[id]) || 0) / total : 0;
      }
      return { date: String(row.date), fracs, total };
    });
  }, [days, modelOrder]);

  const autoGranularity = useMemo(() => chooseBucketSize(normalised.length), [normalised.length]);
  const [granularity, setGranularity] = useState<BucketGranularity | 'auto'>('auto');

  const activeGranularity: BucketGranularity = granularity === 'auto' ? autoGranularity : granularity;

  // Only show options that produce ≥ 2 and ≤ reasonable columns
  const availableOptions: { value: BucketGranularity | 'auto'; label: string }[] = useMemo(() => {
    const n = normalised.length;
    const opts: { value: BucketGranularity | 'auto'; label: string }[] = [
      { value: 'auto', label: 'Auto' },
    ];
    if (n >= 1)  opts.push({ value: 'day',     label: 'Day' });
    if (n >= 7)  opts.push({ value: 'week',    label: 'Week' });
    if (n >= 14) opts.push({ value: 'biweek',  label: '2 Wk' });
    if (n >= 28) opts.push({ value: 'month',   label: 'Month' });
    return opts;
  }, [normalised.length]);

  const modelColor = (id: string, idx: number): string => {
    if (id === favId) return GOLD;
    return REFINED_PALETTE[idx % REFINED_PALETTE.length];
  };

  const columns = useMemo(() => {
    if (normalised.length === 0) return [];
    return buildBuckets(normalised, modelOrder, activeGranularity);
  }, [normalised, modelOrder, activeGranularity]);

  const granularityLabel: Record<BucketGranularity, string> = {
    day: 'daily',
    week: 'weekly',
    biweek: 'bi-weekly',
    month: 'monthly',
  };

  const emptyState = normalised.length < 2;

  return (
    <div style={{
      background: CARD_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: 6,
      padding: '24px 28px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: TEXT_PRI }}>
              Posterior Evolution
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: TEXT_MUT, letterSpacing: '0.04em' }}>
              {normalised.length} DAYS
            </span>
          </div>

          {/* Granularity pill selector */}
          {!emptyState && (
            <div style={{
              display: 'flex',
              gap: 2,
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              padding: 2,
            }}>
              {availableOptions.map(opt => {
                const isActive = granularity === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setGranularity(opt.value)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: '0.04em',
                      padding: '3px 9px',
                      borderRadius: 3,
                      border: 'none',
                      cursor: 'pointer',
                      background: isActive ? GOLD : 'transparent',
                      color: isActive ? '#0D1B2A' : TEXT_MUT,
                      fontWeight: isActive ? 600 : 400,
                      transition: 'background 0.12s, color 0.12s',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, marginTop: 4 }}>
          Model allocation share over time · {granularityLabel[activeGranularity]} buckets
          {granularity === 'auto' && (
            <span style={{ opacity: 0.5 }}> (auto)</span>
          )}
        </div>
      </div>

      {emptyState ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 100, fontFamily: MONO, fontSize: 12, color: TEXT_MUT, opacity: 0.5,
        }}>
          Insufficient data for timeline — need ≥ 2 days of observations.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: MONO,
            fontSize: 11,
          }}>
            <thead>
              <tr>
                {/* Model name column */}
                <th style={{
                  textAlign: 'left',
                  padding: '0 16px 10px 0',
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 500,
                  color: TEXT_MUT,
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                  borderBottom: `1px solid ${BORDER}`,
                  minWidth: 120,
                }}>
                  MODEL
                </th>
                {columns.map(col => (
                  <th key={col.key} style={{
                    textAlign: 'right',
                    padding: '0 0 10px 12px',
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    color: TEXT_MUT,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                    borderBottom: `1px solid ${BORDER}`,
                    minWidth: 80,
                  }}>
                    <div>{col.label}</div>
                    {col.sublabel && (
                      <div style={{ fontSize: 9, opacity: 0.5, marginTop: 1 }}>{col.sublabel}</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelOrder.map((id, idx) => {
                const color = modelColor(id, idx);
                const isFav = id === favId;
                return (
                  <tr key={id} style={{
                    background: isFav ? 'rgba(253,181,21,0.04)' : 'transparent',
                  }}>
                    {/* Model label */}
                    <td style={{
                      padding: '8px 16px 8px 0',
                      borderBottom: `1px solid rgba(255,255,255,0.04)`,
                      whiteSpace: 'nowrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: 2,
                          background: color, flexShrink: 0,
                        }} />
                        <span style={{
                          color: isFav ? GOLD : TEXT_SEC,
                          fontWeight: isFav ? 600 : 400,
                          fontSize: 11,
                        }}>
                          {shortName(id)}
                        </span>
                        {isFav && (
                          <span style={{
                            fontSize: 9, color: GOLD, opacity: 0.7,
                            letterSpacing: '0.06em', marginLeft: 2,
                          }}>
                            ★
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Share cells */}
                    {columns.map(col => {
                      const share = col.fracs[id] ?? 0;
                      const pct = (share * 100).toFixed(share >= 0.001 ? 1 : 0);
                      const isLeader = modelOrder.every(
                        other => other === id || (col.fracs[other] ?? 0) <= share
                      );
                      return (
                        <td key={col.key} style={{
                          padding: '8px 0 8px 12px',
                          textAlign: 'right',
                          verticalAlign: 'middle',
                          borderBottom: `1px solid rgba(255,255,255,0.04)`,
                        }}>
                          {share > 0.002 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                              <span style={{
                                color: isLeader ? (isFav ? GOLD : TEXT_PRI) : TEXT_MUT,
                                fontWeight: isLeader ? 600 : 400,
                                fontSize: 11,
                              }}>
                                {pct}%
                              </span>
                              {/* Inline bar */}
                              <div style={{
                                width: 48, height: 3, borderRadius: 1.5,
                                background: 'rgba(255,255,255,0.07)',
                                overflow: 'hidden',
                              }}>
                                <div style={{
                                  width: `${Math.round(share * 100)}%`,
                                  height: '100%',
                                  background: color,
                                  opacity: isFav ? 0.9 : 0.65,
                                  borderRadius: 1.5,
                                }} />
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: TEXT_MUT, opacity: 0.3, fontSize: 10 }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr>
                <td style={{
                  padding: '10px 16px 0 0',
                  fontFamily: MONO, fontSize: 10,
                  color: TEXT_MUT, letterSpacing: '0.05em',
                }}>
                  TOTAL CALLS
                </td>
                {columns.map(col => (
                  <td key={col.key} style={{
                    padding: '10px 0 0 12px',
                    textAlign: 'right',
                    fontFamily: MONO, fontSize: 10,
                    color: TEXT_MUT,
                  }}>
                    {col.total > 0 ? col.total.toLocaleString() : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
