'use client';

// UsagePanel — reimagined as a dashboard card grid (UX pass).
//
// Layout:
//   1. Headline stats row: total queries (large), executors, date range, top source
//   2. Usage narrative (blockquote) if present
//   3. Two-column grid:
//      Left:  Source breakdown (tall stacked bar with % labels)
//      Right: Key columns ranked bar chart (top 8)
//   4. Filter patterns — top 5 inline, expandable
//
// Co-objects removed from Usage (now shown in RelationshipGraph sidebar).

import React, { useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SourceBreakdown {
  scheduled?: number;
  adhoc?: number;
  dashboard?: number;
  genie?: number;
  alert?: number;
  [key: string]: number | undefined;
}

interface KeyColumn {
  column: string;
  score: number;
  filtered_n?: number;
  joined_n?: number;
  lineage_out_n?: number;
  projected_n?: number;
  [key: string]: unknown;
}

interface FilterPattern {
  template: string;
  n: number;
  op?: string;
}

interface CoObject {
  full_path: string;
  kind?: string;
  n?: number;
  [key: string]: unknown;
}

export interface UsageSnapshot {
  full_path: string;
  last_t3_at: string | null;
  window_start: string | null;
  window_end: string | null;
  access_stats: {
    total_queries?: number;
    n_queries?: number;
    distinct_executors?: number;
    n_distinct_executors?: number;
    first_seen?: string;
    last_seen?: string;
    [key: string]: unknown;
  } | null;
  source_breakdown: SourceBreakdown | null;
  key_columns: KeyColumn[] | null;
  filter_patterns: FilterPattern[] | null;
  co_objects: CoObject[] | null;
  narratives_applied: boolean;
  usage_narrative?: string | null;
  freshness: {
    usage_as_of: string | null;
    window_days: number;
    stale: boolean;
    guidance: string;
  };
  co_object_id_map: Record<string, string>;
}

interface UsagePanelProps {
  usage: UsageSnapshot;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

// ── Color tokens ─────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  scheduled:  '#FDB515',
  adhoc:      '#8892A4',
  dashboard:  '#60A5FA',
  genie:      '#86EFAC',
  alert:      '#F87171',
};

const SOURCE_ORDER = ['scheduled', 'adhoc', 'dashboard', 'genie', 'alert'] as const;

const SIGNAL_COLORS = {
  filtered:  '#FDB515',
  joined:    '#60A5FA',
  lineage:   '#86EFAC',
  projected: '#C084FC',
} as const;

const SIGNAL_WEIGHTS = { filtered: 3, joined: 2, lineage: 2, projected: 1 };

// ── Headline stat card ────────────────────────────────────────────────────────

function HeadlineStat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '14px 18px',
      borderRadius: 6,
      background: 'var(--estate-raised, rgba(13,27,42,0.5))',
      border: '1px solid var(--estate-border-gold, rgba(253,181,21,0.12))',
      flex: '1 1 0',
      minWidth: 100,
    }}>
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--estate-text-muted, #8892A4)',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 22,
        fontWeight: 700,
        color: color ?? '#FDB515',
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
      }}>
        {value}
      </span>
      {sub && (
        <span style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 11,
          color: 'var(--estate-text-muted, #8892A4)',
        }}>
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Source breakdown panel ────────────────────────────────────────────────────

function SourceBreakdownPanel({ breakdown }: { breakdown: SourceBreakdown }) {
  const activeSegments = SOURCE_ORDER.filter(k => (breakdown[k] ?? 0) > 0);
  const total = activeSegments.reduce((s, k) => s + (breakdown[k] ?? 0), 0);

  if (total === 0 || activeSegments.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Section label */}
      <div style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--estate-text-secondary, #8892A4)',
      }}>
        Source Breakdown
      </div>

      {/* Stacked bar — taller (12px) */}
      <div style={{
        height: 12,
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        border: '1px solid rgba(253,181,21,0.1)',
      }}>
        {activeSegments.map((key, i) => {
          const val = breakdown[key] ?? 0;
          const w = pct(val, total);
          return (
            <div
              key={key}
              title={`${key}: ${val} queries (${w}%)`}
              style={{
                width: `${w}%`,
                background: SOURCE_COLORS[key] ?? '#8892A4',
                opacity: 0.9,
                marginRight: i < activeSegments.length - 1 ? 1 : 0,
              }}
            />
          );
        })}
      </div>

      {/* Legend rows with bar + % */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {activeSegments.map(key => {
          const val = breakdown[key] ?? 0;
          const w = pct(val, total);
          const color = SOURCE_COLORS[key] ?? '#8892A4';
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: color,
                flexShrink: 0,
                display: 'inline-block',
              }} />
              <span style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 12,
                color: 'var(--estate-ink, #E8E6E1)',
                flex: 1,
                textTransform: 'capitalize',
              }}>
                {key}
              </span>
              <div style={{ width: 80, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 2 }} />
              </div>
              <span style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 12,
                color,
                width: 34,
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {w}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Key columns bar chart ─────────────────────────────────────────────────────

function KeyColumnsChart({ columns }: { columns: KeyColumn[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const TOP_N = 8;
  const displayCols = columns.slice(0, TOP_N);
  const maxScore = Math.max(...displayCols.map(c => c.score), 1);

  if (displayCols.length === 0) return (
    <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: 'var(--estate-text-muted)' }}>
      No key columns recorded.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Section label */}
      <div style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--estate-text-secondary, #8892A4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span>Key Columns</span>
        <span style={{ fontWeight: 400, opacity: 0.6 }}>top {displayCols.length}</span>
      </div>

      {/* Column rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {displayCols.map((col, idx) => {
          const f = (col.filtered_n ?? 0) * SIGNAL_WEIGHTS.filtered;
          const j = (col.joined_n ?? 0) * SIGNAL_WEIGHTS.joined;
          const l = (col.lineage_out_n ?? 0) * SIGNAL_WEIGHTS.lineage;
          const p = (col.projected_n ?? 0) * SIGNAL_WEIGHTS.projected;
          const segTotal = f + j + l + p;
          const barPct = Math.round((col.score / maxScore) * 100);
          const isExpanded = expandedIdx === idx;

          return (
            <div key={col.column}>
              <button
                type="button"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
                className="hover:bg-white/[0.02] transition-colors"
              >
                <span style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 12,
                  color: 'var(--estate-ink)',
                  width: 140,
                  textAlign: 'left',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  {col.column}
                </span>

                {/* Segmented bar */}
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', display: 'flex' }}>
                  {segTotal > 0 ? (
                    <>
                      {f > 0 && <div style={{ width: `${(f / segTotal) * barPct}%`, height: '100%', background: SIGNAL_COLORS.filtered }} />}
                      {j > 0 && <div style={{ width: `${(j / segTotal) * barPct}%`, height: '100%', background: SIGNAL_COLORS.joined }} />}
                      {l > 0 && <div style={{ width: `${(l / segTotal) * barPct}%`, height: '100%', background: SIGNAL_COLORS.lineage }} />}
                      {p > 0 && <div style={{ width: `${(p / segTotal) * barPct}%`, height: '100%', background: SIGNAL_COLORS.projected }} />}
                    </>
                  ) : (
                    <div style={{ width: `${barPct}%`, height: '100%', background: '#FDB515' }} />
                  )}
                </div>

                <span style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 12,
                  color: '#FDB515',
                  width: 40,
                  textAlign: 'right',
                  flexShrink: 0,
                }}>
                  {col.score.toFixed(0)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--estate-text-muted)', flexShrink: 0 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
              </button>

              {isExpanded && (
                <div style={{
                  paddingLeft: 148,
                  paddingBottom: 8,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '3px 12px',
                }}>
                  {f > 0 && (
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: SIGNAL_COLORS.filtered }}>
                      ● Filter ×{col.filtered_n}
                    </span>
                  )}
                  {j > 0 && (
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: SIGNAL_COLORS.joined }}>
                      ● Join ×{col.joined_n}
                    </span>
                  )}
                  {l > 0 && (
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: SIGNAL_COLORS.lineage }}>
                      ● Lineage ×{col.lineage_out_n}
                    </span>
                  )}
                  {p > 0 && (
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: SIGNAL_COLORS.projected }}>
                      ● Select ×{col.projected_n}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Signal legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
        {Object.entries(SIGNAL_COLORS).map(([key, color]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
            <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 10, color: 'var(--estate-text-muted)' }}>
              {key}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Filter patterns panel ─────────────────────────────────────────────────────

function FilterPatternsPanel({ patterns }: { patterns: FilterPattern[] }) {
  const [expanded, setExpanded] = useState(false);
  const SHOW_N = 5;
  const displayPatterns = expanded ? patterns : patterns.slice(0, SHOW_N);

  if (patterns.length === 0) return (
    <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: 'var(--estate-text-muted)' }}>
      No filter patterns recorded.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--estate-text-secondary, #8892A4)',
      }}>
        Filter Patterns
        <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.6 }}>
          {patterns.length} total
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {displayPatterns.map((p, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid rgba(253,181,21,0.12)',
              background: 'rgba(253,181,21,0.03)',
            }}
          >
            <code style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 12,
              color: 'var(--estate-ink)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {p.template}
            </code>
            {p.op && (
              <span style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                color: 'var(--estate-text-muted)',
                background: 'rgba(255,255,255,0.04)',
                padding: '1px 4px',
                borderRadius: 2,
                flexShrink: 0,
              }}>
                {p.op}
              </span>
            )}
            <span style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 12,
              color: '#FDB515',
              flexShrink: 0,
            }}>
              {p.n}×
            </span>
          </div>
        ))}
      </div>

      {patterns.length > SHOW_N && (
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: '#FDB515', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
          className="hover:underline"
        >
          {expanded ? '↑ Show fewer' : `↓ Show ${patterns.length - SHOW_N} more patterns`}
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UsagePanel({ usage }: UsagePanelProps) {
  const { freshness, source_breakdown, key_columns, filter_patterns, access_stats } = usage;

  const stale = freshness.stale;
  const totalQ = access_stats?.total_queries ?? access_stats?.n_queries ?? 0;
  const executors = access_stats?.distinct_executors ?? access_stats?.n_distinct_executors ?? 0;
  const firstSeen = access_stats?.first_seen as string | null ?? null;
  const lastSeen = access_stats?.last_seen as string | null ?? null;

  const sourceEntries = source_breakdown
    ? Object.entries(source_breakdown).filter(([, v]) => v && v > 0)
    : [];
  const topSource = sourceEntries.length > 0
    ? sourceEntries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]
    : null;

  const dateRange = firstSeen && lastSeen
    ? `${new Date(firstSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(lastSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : null;

  const hasKeyColumns = (key_columns ?? []).length > 0;
  const hasFilterPatterns = (filter_patterns ?? []).length > 0;
  const hasSourceBreakdown = source_breakdown && Object.values(source_breakdown).some(v => v && v > 0);
  const isAllZero = totalQ === 0 && !hasKeyColumns && !hasFilterPatterns && !hasSourceBreakdown;

  if (isAllZero) {
    return (
      <div
        className="border border-dashed rounded-lg p-6 text-center"
        style={{
          borderColor: 'var(--estate-border-gold)',
          background: 'var(--estate-raised)',
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 12,
          color: 'var(--estate-text-muted)',
        }}
      >
        T3 harvest returned zero usage — no queries recorded in the observation window
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Header: harvested time + stale badge ──── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            color: 'var(--estate-text-muted)',
          }}>
            last harvested {relativeTime(usage.last_t3_at)}
          </span>
          {freshness.window_days > 0 && (
            <span style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11,
              color: 'var(--estate-text-muted)',
            }}>
              · {freshness.window_days}d window
            </span>
          )}
        </div>
        {stale && (
          <span style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: '#FDB515',
            border: '1px solid #FDB515',
            borderRadius: 4,
            padding: '2px 7px',
          }}>
            STALE
          </span>
        )}
      </div>

      {/* ── Stale guidance ─────────────────────────── */}
      {stale && (
        <p style={{
          fontFamily: '"Inter Tight", sans-serif',
          fontSize: 13,
          color: 'var(--estate-text-muted)',
          lineHeight: 1.5,
          margin: 0,
        }}>
          {freshness.guidance}
        </p>
      )}

      {/* ── Usage narrative ────────────────────────── */}
      {usage.usage_narrative && (
        <blockquote style={{
          margin: 0,
          padding: '12px 16px',
          borderLeft: '3px solid rgba(253,181,21,0.4)',
          borderRadius: '0 6px 6px 0',
          background: 'rgba(253,181,21,0.04)',
          fontFamily: '"Inter Tight", sans-serif',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--estate-text-secondary)',
        }}>
          {usage.usage_narrative}
        </blockquote>
      )}

      {/* ── Headline stat cards ─────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <HeadlineStat
          label="Queries"
          value={fmt(totalQ)}
          sub={dateRange ?? undefined}
        />
        {executors > 0 && (
          <HeadlineStat
            label="Executors"
            value={fmt(executors)}
            sub="distinct"
            color="var(--estate-ink, #E8E6E1)"
          />
        )}
        {topSource && (
          <HeadlineStat
            label="Top Source"
            value={topSource[0]}
            sub={`${topSource[1]?.toLocaleString()} queries`}
            color={SOURCE_COLORS[topSource[0]] ?? 'var(--estate-ink)'}
          />
        )}
      </div>

      {/* ── Two-column grid: source breakdown + key columns ── */}
      {(hasSourceBreakdown || hasKeyColumns) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: hasSourceBreakdown && hasKeyColumns ? '1fr 1fr' : '1fr',
          gap: 24,
        }}>
          {hasSourceBreakdown && source_breakdown && (
            <div style={{
              padding: '18px 20px',
              borderRadius: 8,
              border: '1px solid var(--estate-border-gold, rgba(253,181,21,0.12))',
              background: 'var(--estate-raised)',
            }}>
              <SourceBreakdownPanel breakdown={source_breakdown} />
            </div>
          )}
          {hasKeyColumns && (
            <div style={{
              padding: '18px 20px',
              borderRadius: 8,
              border: '1px solid var(--estate-border-gold, rgba(253,181,21,0.12))',
              background: 'var(--estate-raised)',
            }}>
              <KeyColumnsChart columns={key_columns ?? []} />
            </div>
          )}
        </div>
      )}

      {/* ── Filter patterns ─────────────────────────── */}
      {hasFilterPatterns && (
        <div style={{
          padding: '18px 20px',
          borderRadius: 8,
          border: '1px solid var(--estate-border-gold, rgba(253,181,21,0.12))',
          background: 'var(--estate-raised)',
        }}>
          <FilterPatternsPanel patterns={filter_patterns ?? []} />
        </div>
      )}
    </div>
  );
}
