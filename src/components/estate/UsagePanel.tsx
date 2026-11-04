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
// Co-objects live in the Relationships section ("Queried together").

import React, { useState } from 'react';
import { type } from '@/lib/typography/tokens';
import { Card, Callout, Tag, EmptyNote, TONE_COLOR, relTime } from './object-ui';

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

/// ── Helpers ──────────────────────────────────────────────────────────────────

function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Colours (readable on light and dark) ─────────────────────────────────────

const SOURCE_META: Record<string, { label: string; color: string; hint: string }> = {
  scheduled: { label: 'scheduled', color: 'var(--brand-a)',   hint: 'Pipelines and scheduled notebooks' },
  adhoc:     { label: 'adhoc',     color: TONE_COLOR.blue,    hint: 'People running SQL by hand' },
  dashboard: { label: 'dashboard', color: TONE_COLOR.green,   hint: 'Dashboard refreshes' },
  genie:     { label: 'genie',     color: TONE_COLOR.violet,  hint: 'Natural-language questions' },
  alert:     { label: 'alert',     color: TONE_COLOR.red,     hint: 'SQL alerts' },
};

const SOURCE_ORDER = ['scheduled', 'adhoc', 'dashboard', 'genie', 'alert'] as const;

const SIGNALS = [
  { key: 'filtered_n',    label: 'filtered_n',    color: 'var(--brand-a)', weight: 3 },
  { key: 'joined_n',      label: 'joined_n',      color: TONE_COLOR.blue,  weight: 2 },
  { key: 'lineage_out_n', label: 'lineage_out_n', color: TONE_COLOR.green, weight: 2 },
  { key: 'projected_n',   label: 'projected_n',   color: TONE_COLOR.violet, weight: 1 },
] as const;

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 18px', background: 'var(--estate-raised)', minWidth: 0 }}>
      <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>{label}</span>
      <span style={{ ...type['kpi-md'], color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{value}</span>
      {sub && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{sub}</span>}
    </div>
  );
}

function SourceBreakdownCard({ breakdown }: { breakdown: SourceBreakdown }) {
  const active = SOURCE_ORDER.filter((k) => (breakdown[k] ?? 0) > 0);
  const total = active.reduce((s, k) => s + (breakdown[k] ?? 0), 0);
  if (total === 0) return null;

  return (
    <Card title="Source breakdown" meta={`${compact(total)} queries`}>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', gap: 2, marginBottom: 16 }} aria-hidden="true">
        {active.map((k) => (
          <div key={k} style={{ width: `${pct(breakdown[k] ?? 0, total)}%`, minWidth: 4, background: SOURCE_META[k]?.color ?? 'var(--estate-text-muted)' }} />
        ))}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {active.map((k) => {
          const n = breakdown[k] ?? 0;
          const meta = SOURCE_META[k] ?? { label: k, color: 'var(--estate-text-muted)', hint: '' };
          return (
            <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={meta.hint}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: meta.color, flexShrink: 0 }} />
              <span style={{ ...type.ui, color: 'var(--estate-ink)', flex: 1 }}>{meta.label}</span>
              <span style={{ ...type.ui, color: 'var(--estate-text-muted)' }}>{n.toLocaleString()}</span>
              <span style={{ ...type['code-inline'], color: 'var(--estate-ink)', width: 40, textAlign: 'right' }}>{pct(n, total)}%</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function KeyColumnsCard({ columns }: { columns: KeyColumn[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? columns : columns.slice(0, 8);
  const max = Math.max(...columns.map((c) => c.score), 1);

  return (
    <Card
      title="Key columns"
      meta="score = 3·filtered + 2·joined + 2·lineage_out + 1·projected"
      actions={columns.length > 8 ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...type.ui, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {showAll ? 'Top 8' : `All ${columns.length}`}
        </button>
      ) : undefined}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map((col) => {
          const parts = SIGNALS.map((s) => ({ ...s, n: Number(col[s.key] ?? 0), w: Number(col[s.key] ?? 0) * s.weight }));
          const weighted = parts.reduce((t, p) => t + p.w, 0);
          const barPct = (col.score / max) * 100;
          const tooltip = parts.filter((p) => p.n > 0).map((p) => `${p.label} ${p.n}×`).join(' · ');
          return (
            <li key={col.column} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 160px) 1fr auto', alignItems: 'center', gap: 12 }} title={tooltip || undefined}>
              <code style={{ ...type['code-inline'], color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.column}</code>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--estate-active-bg)', overflow: 'hidden', display: 'flex' }}>
                {weighted > 0
                  ? parts.filter((p) => p.w > 0).map((p) => (
                      <div key={p.key} style={{ width: `${(p.w / weighted) * barPct}%`, height: '100%', background: p.color }} />
                    ))
                  : <div style={{ width: `${barPct}%`, height: '100%', background: 'var(--brand-a)' }} />}
              </div>
              <span style={{ ...type.caption, color: 'var(--estate-text-muted)', whiteSpace: 'nowrap', minWidth: 110, textAlign: 'right' }}>
                {parts.filter((p) => p.n > 0).slice(0, 2).map((p) => `${p.label.replace(/_n$/, '')} ${p.n}`).join(' · ') || '—'}
              </span>
            </li>
          );
        })}
      </ul>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--estate-border)' }}>
        {SIGNALS.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, ...type.caption, color: 'var(--estate-text-muted)' }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function FilterPatternsCard({ patterns }: { patterns: FilterPattern[] }) {
  const [expanded, setExpanded] = useState(false);
  const SHOW_N = 5;
  const shown = expanded ? patterns : patterns.slice(0, SHOW_N);
  const max = Math.max(...patterns.map((p) => p.n), 1);

  return (
    <Card
      title="Filter patterns"
      meta={`${patterns.length} pattern${patterns.length === 1 ? '' : 's'}`}
      flush
      actions={patterns.length > SHOW_N ? (
        <button type="button" onClick={() => setExpanded((v) => !v)} style={{ ...type.ui, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? 'Show fewer' : `Show all ${patterns.length}`}
        </button>
      ) : undefined}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((p, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderTop: i === 0 ? 'none' : '1px solid var(--estate-border)' }}>
            <code
              title={p.template}
              style={{ ...type['code-inline'], color: 'var(--estate-ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {p.template}
            </code>
            {p.op && <Tag tone="neutral" mono>{p.op}</Tag>}
            <div style={{ width: 80, height: 4, borderRadius: 999, background: 'var(--estate-active-bg)', overflow: 'hidden', flexShrink: 0 }} aria-hidden="true">
              <div style={{ width: `${(p.n / max) * 100}%`, height: '100%', background: 'var(--brand-a)' }} />
            </div>
            <span style={{ ...type.ui, color: 'var(--estate-text-secondary)', width: 64, textAlign: 'right', flexShrink: 0 }}>{p.n.toLocaleString()}×</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function UsagePanel({ usage }: UsagePanelProps) {
  const { freshness, source_breakdown, key_columns, filter_patterns, access_stats } = usage;

  const totalQ = Number(access_stats?.total_queries ?? access_stats?.n_queries ?? 0);
  const executors = Number(access_stats?.distinct_executors ?? access_stats?.n_distinct_executors ?? 0);
  const firstSeen = (access_stats?.first_seen as string | undefined) ?? null;
  const lastSeen = (access_stats?.last_seen as string | undefined) ?? null;

  const sourceEntries = source_breakdown ? Object.entries(source_breakdown).filter(([, v]) => v && v > 0) : [];
  const topSource = sourceEntries.length > 0 ? [...sourceEntries].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0] : null;
  const sourceTotal = sourceEntries.reduce((s, [, v]) => s + (v ?? 0), 0);

  const hasKeyColumns = (key_columns ?? []).length > 0;
  const hasFilterPatterns = (filter_patterns ?? []).length > 0;
  const hasSourceBreakdown = sourceTotal > 0;

  if (totalQ === 0 && !hasKeyColumns && !hasFilterPatterns && !hasSourceBreakdown) {
    return (
      <EmptyNote>
        No queries touched this table in the last {freshness.window_days || 30} days.
      </EmptyNote>
    );
  }

  const from = shortDate(firstSeen);
  const to = shortDate(lastSeen);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {freshness.stale && (
        <Callout tone="amber" title="Usage data is out of date" action={<Tag tone="neutral">harvested {relTime(usage.last_t3_at)}</Tag>}>
          {freshness.guidance}
        </Callout>
      )}

      {/* Headline numbers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
          gap: 1,
          background: 'var(--estate-border)',
          border: '1px solid var(--estate-border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <Stat label="Queries" value={compact(totalQ)} sub={from && to ? `${from} – ${to}` : `Last ${freshness.window_days} days`} />
        <Stat label="Executors" value={executors > 0 ? compact(executors) : '—'} sub="distinct_executors" />
        <Stat
          label="Top source"
          value={topSource ? (SOURCE_META[topSource[0]]?.label ?? topSource[0]) : '—'}
          sub={topSource ? `${pct(topSource[1] ?? 0, sourceTotal)}% of queries` : undefined}
        />
        <Stat label="Last seen" value={lastSeen ? relTime(lastSeen) : '—'} sub={`last_t3_at ${relTime(usage.last_t3_at)}`} />
      </div>

      {/* Narrative */}
      {usage.usage_narrative && (
        <Card title="Usage narrative" meta="usage_narrative (LLM)">
          <p style={{ ...type.body, color: 'var(--estate-text-secondary)', margin: 0, maxWidth: '85ch' }}>{usage.usage_narrative}</p>
        </Card>
      )}

      {(hasSourceBreakdown || hasKeyColumns) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 16, alignItems: 'start' }}>
          {hasSourceBreakdown && source_breakdown && <SourceBreakdownCard breakdown={source_breakdown} />}
          {hasKeyColumns && <KeyColumnsCard columns={key_columns ?? []} />}
        </div>
      )}

      {hasFilterPatterns && <FilterPatternsCard patterns={filter_patterns ?? []} />}
    </div>
  );
}
