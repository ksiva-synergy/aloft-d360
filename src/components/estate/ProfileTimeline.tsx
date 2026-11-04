'use client';

// ProfileTimeline — "Profile history" card on the Estate object page.
//
// Layout:
//   Summary strip  — latest version, size trend (sparkline + change), how many
//                    versions changed, how the latest profile was taken.
//   Version table  — one row per profile version, newest first: version, when,
//                    how (trigger + sample window), size and its change vs the
//                    previous version, and change chips. Consecutive versions
//                    with no changes collapse into one "N runs, no changes" row.
//                    Clicking a row opens the detail: every change in plain
//                    words, skipped columns, sample facts.
//
// "Changed" means isSignificantDrift (drift-summary.ts): schema change,
// null-rate shift > 10 points, or rows ±10%. Top-value shifts are shown but
// do not count (sampled windows are unordered).

import React, { useMemo, useState } from 'react';
import { describeDrift, isSignificantDrift, type DriftLine } from '@/lib/context/drift-summary';
import { Card, EmptyNote, Tag, TONE_COLOR, relTime, fullTime, type Tone } from './object-ui';
import { type } from '@/lib/typography/tokens';

export interface ProfileHistoryItem {
  id: string;
  version: number;
  captured_at: string;
  trigger: string;
  drift: any | null;
  stats?: {
    row_count?: number | null;
    /** Exact Delta COUNT(*) captured alongside the (possibly sampled) profile. */
    row_count_exact?: number | null;
    size_bytes?: number | null;
    is_sampled?: boolean;
    profile_window_rows?: number | null;
    sample_pct?: number | null;
    query_count?: number | null;
    partial?: boolean;
    skipped_columns?: Record<string, { data_type?: string; reason?: string }>;
    columns?: Record<string, unknown>;
  } | null;
}

interface ProfileTimelineProps {
  profileHistory: ProfileHistoryItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function signedPct(delta: number): string {
  const p = delta * 100;
  if (Math.abs(p) < 0.05) return '±0%';
  return `${p > 0 ? '+' : '−'}${Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))}%`;
}

// Trigger values are shown as stored (on_demand, scheduled, …).
const TRIGGER_LABEL: Record<string, string> = {};

function how(stats: ProfileHistoryItem['stats']): string {
  if (!stats) return 'No stats';
  if (stats.partial) return 'partial (budget hit)';
  if (stats.is_sampled && typeof stats.profile_window_rows === 'number') {
    return `sampled · LIMIT ${stats.profile_window_rows.toLocaleString()}`;
  }
  if (stats.is_sampled === false && typeof stats.row_count === 'number') {
    return `full scan · row_count ${stats.row_count.toLocaleString()}`;
  }
  return 'Profiled';
}

const CHIP_TONE: Record<DriftLine['kind'], Tone> = {
  added: 'blue',
  dropped: 'red',
  type: 'red',
  nulls: 'amber',
  rows: 'amber',
  top_values: 'neutral',
};

/** Short chip text per drift line — DriftResult field names (full line in the detail panel). */
function chipText(line: DriftLine): string {
  switch (line.kind) {
    case 'added':   return line.text.replace(/:.*$/, '');
    case 'dropped': return line.text.replace(/:.*$/, '');
    case 'type':    return 'type_changes';
    case 'nulls':   return 'null_rate_shifts';
    case 'rows':    return line.text;
    default:        return 'top_k_changes';
  }
}

// ── Rows model (collapse runs of unchanged versions) ─────────────────────────

interface VersionEntry {
  kind: 'version';
  item: ProfileHistoryItem;
  prev: ProfileHistoryItem | null;
  lines: DriftLine[];
  changed: boolean;
  isLatest: boolean;
}
interface QuietEntry {
  kind: 'quiet';
  key: string;
  items: VersionEntry[];
}
type Entry = VersionEntry | QuietEntry;

function buildEntries(history: ProfileHistoryItem[]): Entry[] {
  const versions: VersionEntry[] = history.map((item, i) => ({
    kind: 'version',
    item,
    prev: history[i + 1] ?? null,
    lines: describeDrift(item.drift),
    changed: isSignificantDrift(item.drift),
    isLatest: i === 0,
  }));

  const out: Entry[] = [];
  let run: VersionEntry[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: 'quiet', key: `q-${run[0].item.id}`, items: run });
    else out.push(...run);
    run = [];
  };
  for (const v of versions) {
    const quiet = !v.isLatest && !v.changed && v.prev !== null && v.lines.every((l) => !l.significant);
    if (quiet) run.push(v);
    else { flush(); out.push(v); }
  }
  flush();
  return out;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const w = 132;
  const h = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => ({
    x: values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 6) + 3,
    y: h - 4 - ((v - min) / span) * (h - 8),
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={area} fill="color-mix(in srgb, var(--brand-a) 12%, transparent)" />
      <path d={line} fill="none" stroke="var(--brand-a)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={3} fill="var(--brand-a)" stroke="var(--estate-raised)" strokeWidth={1.5} />
    </svg>
  );
}

function SummaryCell({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 18px', background: 'var(--estate-raised)', minWidth: 0 }}>
      <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>{label}</span>
      <div style={{ ...type['kpi-sm'], color: 'var(--estate-ink)', display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
      {sub && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{sub}</span>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', color: 'var(--estate-text-muted)' }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

const GRID = 'minmax(64px, 72px) minmax(120px, 1.1fr) minmax(150px, 1.2fr) minmax(110px, 0.9fr) minmax(160px, 2fr) 20px';

function VersionDetail({ entry }: { entry: VersionEntry }) {
  const { item, lines } = entry;
  const stats = item.stats ?? null;
  const skipped = stats?.skipped_columns ? Object.entries(stats.skipped_columns) : [];
  const colCount = stats?.columns ? Object.keys(stats.columns).length : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
        gap: 20,
        padding: '4px 20px 18px 96px',
        background: 'var(--estate-hover)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>Drift</span>
        {entry.prev === null ? (
          <span style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>First profile — no drift baseline.</span>
        ) : lines.length === 0 ? (
          <span style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>No drift vs v{entry.prev.version}.</span>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lines.map((l, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 6, height: 6, borderRadius: 999, marginTop: 7, flexShrink: 0,
                    background: l.significant ? (CHIP_TONE[l.kind] === 'red' ? TONE_COLOR.red : CHIP_TONE[l.kind] === 'blue' ? TONE_COLOR.blue : TONE_COLOR.amber) : 'var(--estate-text-muted)',
                  }}
                />
                <span style={{ ...type.ui, color: l.significant ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }}>
                  {l.text}
                  {!l.significant && <span style={{ ...type.caption }}> · informational</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>Run</span>
        <dl style={{ ...type.ui, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 14px', color: 'var(--estate-text-secondary)' }}>
          <dt>captured_at</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{fullTime(item.captured_at) ?? '—'}</dd>
          <dt>trigger</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{TRIGGER_LABEL[item.trigger] ?? item.trigger ?? '—'}</dd>
          <dt>method</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{how(stats)}</dd>
          {typeof stats?.row_count_exact === 'number' && (<><dt>row_count_exact</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{stats.row_count_exact.toLocaleString()}</dd></>)}
          {typeof stats?.size_bytes === 'number' && (<><dt>size_bytes</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{stats.size_bytes.toLocaleString()}</dd></>)}
          {colCount !== null && (<><dt>columns</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{colCount} profiled{skipped.length ? `, ${skipped.length} skipped_columns` : ''}</dd></>)}
          {typeof stats?.query_count === 'number' && (<><dt>query_count</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{stats.query_count}</dd></>)}
        </dl>
      </div>

      {skipped.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>skipped_columns</span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {skipped.map(([name, info]) => (
              <li key={name} style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>
                <code style={{ ...type['code-inline'], color: 'var(--estate-ink)' }}>{name}</code>
                {info?.data_type ? <span style={{ color: 'var(--estate-text-muted)' }}> {info.data_type}</span> : null}
                {info?.reason ? <span style={{ color: 'var(--estate-text-muted)' }}> — {info.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VersionRow({ entry, open, onToggle, nested }: { entry: VersionEntry; open: boolean; onToggle: () => void; nested?: boolean }) {
  const { item, prev, lines, changed, isLatest } = entry;
  const size = typeof item.stats?.size_bytes === 'number' ? item.stats.size_bytes : null;
  const prevSize = typeof prev?.stats?.size_bytes === 'number' ? prev.stats.size_bytes : null;
  const sizeDelta = size !== null && prevSize ? (size - prevSize) / prevSize : null;

  const chips = prev === null
    ? [<Tag key="first" tone="neutral">v1 · no drift baseline</Tag>]
    : lines.length === 0
      ? [<span key="none" style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>no drift</span>]
      : lines.slice(0, 3).map((l, i) => <Tag key={i} tone={l.significant ? CHIP_TONE[l.kind] : 'neutral'}>{chipText(l)}</Tag>);

  return (
    <li style={{ borderTop: '1px solid var(--estate-border)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left transition-colors hover:bg-[var(--estate-hover)]"
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          alignItems: 'center',
          gap: 14,
          padding: nested ? '10px 20px 10px 32px' : '12px 20px',
          border: 'none',
          background: open ? 'var(--estate-hover)' : 'transparent',
          cursor: 'pointer',
          boxShadow: changed ? `inset 3px 0 0 ${TONE_COLOR.amber}` : undefined,
        }}
      >
        {/* Version */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              ...type['code-inline'],
              fontWeight: 600,
              color: isLatest ? 'var(--brand-a-ink)' : 'var(--estate-ink)',
              background: isLatest ? 'color-mix(in srgb, var(--brand-a) 12%, transparent)' : 'var(--estate-active-bg)',
              borderRadius: 6,
              padding: '1px 7px',
            }}
          >
            v{item.version}
          </span>
        </span>
        {/* When */}
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} title={fullTime(item.captured_at)}>
          <span style={{ ...type.ui, color: 'var(--estate-ink)' }}>
            {relTime(item.captured_at)}{isLatest && <span style={{ ...type.caption, color: 'var(--brand-a-ink)', fontWeight: 600 }}> · current</span>}
          </span>
          <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>
            {new Date(item.captured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </span>
        {/* How */}
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>{TRIGGER_LABEL[item.trigger] ?? item.trigger ?? '—'}</span>
          <span style={{ ...type.caption, color: 'var(--estate-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{how(item.stats)}</span>
        </span>
        {/* Size */}
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ ...type['code-inline'], color: 'var(--estate-ink)' }}>{size !== null ? formatBytes(size) : '—'}</span>
          {sizeDelta !== null && (
            <span style={{ ...type.caption, color: Math.abs(sizeDelta) >= 0.1 ? inkFor(sizeDelta) : 'var(--estate-text-muted)' }}>
              {signedPct(sizeDelta)} vs v{prev!.version}
            </span>
          )}
        </span>
        {/* Changes */}
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {chips}
          {lines.length > 3 && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>+{lines.length - 3}</span>}
        </span>
        <Chevron open={open} />
      </button>
      {open && <VersionDetail entry={entry} />}
    </li>
  );
}

function inkFor(delta: number): string {
  return delta > 0 ? 'var(--estate-text-secondary)' : TONE_COLOR.red;
}

// ── Component ────────────────────────────────────────────────────────────────

const VISIBLE_ENTRIES = 6;

export default function ProfileTimeline({ profileHistory }: ProfileTimelineProps) {
  const history = useMemo(
    () => [...(profileHistory ?? [])].sort((a, b) => b.version - a.version),
    [profileHistory],
  );
  const entries = useMemo(() => buildEntries(history), [history]);

  const latest = history[0] ?? null;
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const first = history[0];
    return first && isSignificantDrift(first.drift) ? new Set([first.id]) : new Set();
  });
  const [openQuiet, setOpenQuiet] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  if (history.length === 0) {
    return (
      <Card title="Profile history">
        <EmptyNote>Not profiled yet. Run the Profile step to capture counts, empty values and ranges.</EmptyNote>
      </Card>
    );
  }

  const toggle = (id: string) => setOpenIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleQuiet = (key: string) => setOpenQuiet((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const sizes = [...history].reverse()
    .map((h) => (typeof h.stats?.size_bytes === 'number' ? h.stats.size_bytes : null))
    .filter((v): v is number => v !== null);
  const sizeChange = sizes.length >= 2 && sizes[0] > 0 ? (sizes[sizes.length - 1] - sizes[0]) / sizes[0] : null;
  const changedCount = history.filter((h) => isSignificantDrift(h.drift)).length;
  const lastChange = history.find((h) => isSignificantDrift(h.drift)) ?? null;

  const shown = showAll ? entries : entries.slice(0, VISIBLE_ENTRIES);

  return (
    <Card
      title="Profile history"
      meta={`${history.length} version${history.length === 1 ? '' : 's'} · newest first`}
      flush
    >
      {/* Summary strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: 1,
          background: 'var(--estate-border)',
          borderBottom: '1px solid var(--estate-border)',
        }}
      >
        <SummaryCell label="Latest" sub={latest ? `${relTime(latest.captured_at)} · ${TRIGGER_LABEL[latest.trigger] ?? latest.trigger}` : undefined}>
          v{latest?.version}
        </SummaryCell>
        <SummaryCell
          label="size_bytes"
          sub={sizeChange !== null ? `${signedPct(sizeChange)} across ${sizes.length} profiles` : 'Needs two profiles'}
        >
          {sizes.length > 0 ? formatBytes(sizes[sizes.length - 1]) : '—'}
          {sizes.length >= 2 && <Sparkline values={sizes} />}
        </SummaryCell>
        <SummaryCell
          label="Drift"
          sub={lastChange ? `Last drift in v${lastChange.version}, ${relTime(lastChange.captured_at)}` : 'No drift across loaded versions'}
        >
          <span style={{ color: changedCount > 0 ? inkOfAmber : 'var(--estate-ink)' }}>
            {changedCount} of {history.length}
          </span>
        </SummaryCell>
        <SummaryCell label="Method" sub={latest?.stats?.is_sampled ? 'is_sampled = true' : undefined}>
          <span style={{ ...type.ui, fontWeight: 600 }}>{how(latest?.stats)}</span>
        </SummaryCell>
      </div>

      <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 760 }}>
      {/* Column headings */}
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          gap: 14,
          padding: '9px 20px',
          background: 'var(--estate-th-bg, var(--estate-bg))',
          ...type.eyebrow,
          color: 'var(--estate-text-muted)',
        }}
      >
        <span>Version</span><span>captured_at</span><span>trigger · method</span><span>size_bytes</span><span>Drift</span><span />
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((entry) => {
          if (entry.kind === 'version') {
            return <VersionRow key={entry.item.id} entry={entry} open={openIds.has(entry.item.id)} onToggle={() => toggle(entry.item.id)} />;
          }
          const isOpen = openQuiet.has(entry.key);
          const newest = entry.items[0].item;
          const oldest = entry.items[entry.items.length - 1].item;
          return (
            <li key={entry.key} style={{ borderTop: '1px solid var(--estate-border)' }}>
              <button
                type="button"
                onClick={() => toggleQuiet(entry.key)}
                aria-expanded={isOpen}
                className="w-full text-left transition-colors hover:bg-[var(--estate-hover)]"
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  alignItems: 'center',
                  gap: 14,
                  padding: '10px 20px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>v{oldest.version}–{newest.version}</span>
                <span style={{ ...type.ui, color: 'var(--estate-text-muted)', gridColumn: 'span 4' }}>
                  {entry.items.length} runs with no drift · {relTime(oldest.captured_at)} → {relTime(newest.captured_at)}
                </span>
                <Chevron open={isOpen} />
              </button>
              {isOpen && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {entry.items.map((v) => (
                    <VersionRow key={v.item.id} entry={v} nested open={openIds.has(v.item.id)} onToggle={() => toggle(v.item.id)} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      </div>
      </div>

      {entries.length > VISIBLE_ENTRIES && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--estate-border)' }}>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            style={{ ...type.ui, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showAll ? 'Show fewer' : `Show ${entries.length - VISIBLE_ENTRIES} older`}
          </button>
        </div>
      )}
    </Card>
  );
}

const inkOfAmber = `color-mix(in srgb, ${TONE_COLOR.amber} 55%, var(--ink-1))`;
