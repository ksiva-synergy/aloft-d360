'use client';

import React, { useMemo, useState } from 'react';
import type { CtsgvModelStat } from './types';
import {
  BORDER, GOLD,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  MONO, BORN_COLORS,
} from '@/lib/bandits/born-tokens';
import { shortName } from '@/lib/bandits/born-tokens';
import { type, inkOf } from '@/lib/typography/tokens';
import { PanelHeader, PANEL_PADDING } from './PanelHeader';
import { Segmented } from './Segmented';

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

  // Same hue per model as every other BORN panel: BORN_COLORS by position in `stats`.
  const statIndex = useMemo(() => new Map(stats.map((s, i) => [s.model_id, i])), [stats]);
  const modelColor = (id: string, idx: number): string => {
    if (id === favId) return GOLD;
    const i = statIndex.get(id) ?? stats.length + idx;
    return BORN_COLORS[i % BORN_COLORS.length];
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
    <div className="born-card" style={{ padding: PANEL_PADDING }}>
      <PanelHeader
        title="Posterior Evolution"
        meta={`${normalised.length} days`}
        subtitle={<>
          Model allocation share over time · {granularityLabel[activeGranularity]} buckets
          {granularity === 'auto' && ' (auto)'}
        </>}
        actions={!emptyState && (
          <Segmented options={availableOptions} value={granularity} onChange={setGranularity} />
        )}
      />

      {emptyState ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 100, ...type.caption, color: TEXT_MUT,
        }}>
          Insufficient data for timeline — need ≥ 2 days of observations.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: MONO,
            fontSize: 'var(--type-ui-regular-size)',
          }}>
            <thead>
              <tr>
                {/* Model name column */}
                <th style={{
                  ...type.eyebrow,
                  textAlign: 'left',
                  padding: '0 16px 10px 0',
                  color: TEXT_MUT,
                  whiteSpace: 'nowrap',
                  borderBottom: `1px solid ${BORDER}`,
                  minWidth: 160,
                }}>
                  Model
                </th>
                {columns.map(col => (
                  <th key={col.key} style={{
                    ...type.caption,
                    fontFamily: MONO,
                    textAlign: 'right',
                    padding: '0 0 10px 12px',
                    fontWeight: 500,
                    color: TEXT_MUT,
                    whiteSpace: 'nowrap',
                    borderBottom: `1px solid ${BORDER}`,
                    minWidth: 80,
                  }}>
                    <div>{col.label}</div>
                    {col.sublabel && (
                      <div style={{ opacity: 0.6, marginTop: 1, fontWeight: 400 }}>{col.sublabel}</div>
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
                    background: isFav ? `color-mix(in srgb, ${GOLD} 6%, transparent)` : 'transparent',
                  }}>
                    {/* Model label */}
                    <td style={{
                      padding: '8px 16px 8px 0',
                      borderBottom: `1px solid var(--born-overlay)`,
                      whiteSpace: 'nowrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 260 }} title={id}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: color, flexShrink: 0,
                        }} />
                        <span style={{
                          color: isFav ? inkOf(GOLD, 70) : TEXT_SEC,
                          fontWeight: isFav ? 600 : 400,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {shortName(id)}
                        </span>
                        {isFav && (
                          <span aria-label="favourite" style={{ color: GOLD, opacity: 0.8, flexShrink: 0 }}>★</span>
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
                          borderBottom: `1px solid var(--born-overlay)`,
                        }}>
                          {share > 0.002 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                              <span style={{
                                color: isLeader ? (isFav ? inkOf(GOLD, 70) : TEXT_PRI) : TEXT_MUT,
                                fontWeight: isLeader ? 600 : 400,
                                fontVariantNumeric: 'tabular-nums',
                              }}>
                                {pct}%
                              </span>
                              {/* Inline bar */}
                              <div style={{
                                width: 48, height: 3, borderRadius: 1.5,
                                background: 'var(--born-overlay-2)',
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
                            <span style={{ color: TEXT_MUT, opacity: 0.4 }}>—</span>
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
                  ...type.eyebrow,
                  padding: '10px 16px 0 0',
                  color: TEXT_MUT,
                }}>
                  Total calls
                </td>
                {columns.map(col => (
                  <td key={col.key} style={{
                    padding: '10px 0 0 12px',
                    textAlign: 'right',
                    fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)',
                    color: TEXT_MUT, fontVariantNumeric: 'tabular-nums',
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
