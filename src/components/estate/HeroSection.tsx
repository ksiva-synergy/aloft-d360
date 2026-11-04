'use client';

// HeroSection — page header + fact strip for the Estate object page.
//
//   HeroSection (default): breadcrumb, title + actions, path (copyable),
//     status chips, summary, keywords, native comment. Flat on the page
//     background — the cards below carry the detail.
//   ObjectFacts (named): six fact tiles — rows, size, columns, period,
//     usage, freshness.
//
// Every fact is read from the object aggregate already returned by
// GET /api/agent-lab/context/objects/[id] — no extra requests.

import React from 'react';
import { toast } from 'sonner';
import KindBadge from './KindBadge';
import FreshnessDot from './FreshnessDot';
import LifecycleBadge from './HeroLifecycleBadge';
import HarvestActionBar from './HarvestActionBar';
import type { FreshnessBlock } from './FreshnessCard';
import type { UsageSnapshot } from './UsagePanel';
import { type, inkOf } from '@/lib/typography/tokens';

// ── Shared shapes ────────────────────────────────────────────────────────────

export interface HeroObject {
  id: string;
  source_id: string;
  object_kind: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  native_comment: string | null;
  row_count_est: any;
  size_bytes_est: any;
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_t2_at: string | null;
  last_t3_at: string | null;
  last_t4_at: string | null;
  last_knowledge_sync_at: string | null;
  domain_keywords?: string[] | null;
}

export interface HeroColumn {
  name: string;
  profile?: { min?: unknown; max?: unknown } | null;
  semantic?: { role?: string; pii_flag?: boolean } | null;
}

export interface HeroProfileStats {
  row_count?: number | null;
  /** Exact Delta COUNT(*) from T1 (absent for views / non-Delta / older profiles). */
  row_count_exact?: number | null;
  size_bytes?: number | null;
  is_sampled?: boolean;
  profile_window_rows?: number | null;
  table_detail?: {
    num_files?: number | null;
    format?: string | null;
    partition_columns?: string[];
    clustering_columns?: string[];
  } | null;
}

export interface HeroSemanticCard {
  summary?: string;
  time_columns?: { event?: string | null; ingest?: string | null };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatBytes(bytes: any): string {
  if (bytes === null || bytes === undefined) return '—';
  const val = Number(bytes);
  if (isNaN(val)) return '—';
  if (val < 1024) return `${val} B`;
  if (val < 1048576) return `${(val / 1024).toFixed(1)} KB`;
  if (val < 1073741824) return `${(val / 1048576).toFixed(1)} MB`;
  return `${(val / 1073741824).toFixed(1)} GB`;
}

function compactNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A sampled profile counts rows inside its LIMIT window, so a count that fills
 * the window is a lower bound ("5,000+"), not the table size. Older harvests
 * stored that window count in row_count_est; detect it here too.
 */
function rowCount(rowCountEst: any, stats: HeroProfileStats | null): { value: string; sub: string; exact: boolean } {
  // Exact Delta COUNT(*) captured by T1 — show the full number, not a compact one.
  if (typeof stats?.row_count_exact === 'number') {
    return { value: stats.row_count_exact.toLocaleString(), sub: 'row_count_exact · Delta COUNT(*)', exact: true };
  }
  const est = rowCountEst !== null && rowCountEst !== undefined ? Number(rowCountEst) : null;
  const window = stats?.is_sampled && typeof stats.profile_window_rows === 'number' ? stats.profile_window_rows : null;
  // Older harvests saved the sample window itself as row_count_est (est === window).
  if (window !== null && (est === null || est === window)) {
    return { value: `${compactNumber(window)}+`, sub: `row_count not measured · sampled LIMIT ${window.toLocaleString()}`, exact: false };
  }
  if (est === null || Number.isNaN(est)) return { value: '—', sub: 'Not profiled yet', exact: false };
  // A sampled profile can't produce more rows than its window — a larger value
  // came from an exact COUNT(*) ("Count exact rows").
  if (window !== null && est > window) return { value: est.toLocaleString(), sub: 'row_count_est · exact COUNT(*)', exact: true };
  return {
    value: est.toLocaleString(),
    sub: stats?.is_sampled === false ? 'row_count (full scan)' : 'row_count_est',
    exact: stats?.is_sampled === false,
  };
}

/** "Count exact rows" — one Delta COUNT(*) via POST …/objects/[id]/row-count. */
function CountRowsButton({ objectId, onCounted }: { objectId: string; onCounted: (rows: number) => void }) {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/agent-lab/context/objects/${objectId}/row-count`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && typeof json.data?.rows === 'number') {
        onCounted(json.data.rows);
        toast.success(`row_count: ${json.data.rows.toLocaleString()}`);
      } else {
        toast.error(json.message ?? json.error ?? 'Count failed');
      }
    } catch {
      toast.error('Count failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title="Runs SELECT COUNT(*) on Databricks (Delta: answered from table metadata) and saves the result"
      className="hover:underline disabled:opacity-60"
      style={{ ...type.caption, fontWeight: 600, color: 'var(--brand-a-ink)', background: 'none', border: 'none', padding: 0, cursor: busy ? 'wait' : 'pointer', textAlign: 'left' }}
    >
      {busy ? 'Counting…' : 'Count exact rows →'}
    </button>
  );
}

function formatBound(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (date) {
    const d = new Date(`${date[1]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
  }
  return s.length > 16 ? `${s.slice(0, 16)}…` : s;
}

/** Period covered: min/max of the event-time column (or ingest / first timestamp column). */
function dataPeriod(card: HeroSemanticCard | null, columns: HeroColumn[]): { column: string; from: string; to: string } | null {
  const candidates = [
    card?.time_columns?.event,
    card?.time_columns?.ingest,
    ...columns.filter((c) => c.semantic?.role === 'timestamp').map((c) => c.name),
  ].filter((n): n is string => typeof n === 'string' && n.length > 0);

  for (const name of candidates) {
    const col = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const from = formatBound(col?.profile?.min);
    const to = formatBound(col?.profile?.max);
    if (col && from && to) return { column: col.name, from, to };
  }
  return null;
}

// ── Chips ────────────────────────────────────────────────────────────────────

const TRUST_CHIP: Record<string, { color: string; label: string; title: string }> = {
  assumed:   { color: '#B4801A', label: 'semantic: assumed',   title: 'LLM-generated — not yet human-validated' },
  confirmed: { color: '#2F6DB0', label: 'semantic: confirmed', title: 'Reviewed and confirmed by a steward' },
  certified: { color: '#3B7A4B', label: 'semantic: certified', title: 'Certified for use' },
};

function Chip({ color, children, title, href }: { color: string; children: React.ReactNode; title?: string; href?: string }) {
  const style: React.CSSProperties = {
    ...type.caption,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    padding: '0 10px',
    borderRadius: 999,
    color: inkOf(color),
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  };
  return href
    ? <a href={href} style={style} title={title}>{children}</a>
    : <span style={style} title={title}>{children}</span>;
}

const KEYWORDS_VISIBLE = 6;

function KeywordRow({ keywords }: { keywords: string[] }) {
  const [open, setOpen] = React.useState(false);
  const shown = open ? keywords : keywords.slice(0, KEYWORDS_VISIBLE);
  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
      title="domain_keywords — used to route agent questions to this table"
    >
      <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)', marginRight: 2 }}>domain_keywords</span>
      {shown.map((k) => (
        <span key={k} style={{ ...type.caption, color: 'var(--estate-text-secondary)', border: '1px solid var(--estate-border)', borderRadius: 999, padding: '0 8px' }}>
          {k}
        </span>
      ))}
      {keywords.length > KEYWORDS_VISIBLE && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ ...type.caption, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
        >
          {open ? 'less' : `+${keywords.length - KEYWORDS_VISIBLE} more`}
        </button>
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

interface HeroSectionProps {
  object: HeroObject;
  freshness: FreshnessBlock;
  hasEmbedding: boolean;
  columns: HeroColumn[];
  semanticCard: HeroSemanticCard | null;
  semanticStatus: string | null;
  latestProfileStats: HeroProfileStats | null;
  activeJobKinds: string[];
  /** Re-fetch the page after a harvest action is queued. */
  onRefresh?: () => void;
}

export default function HeroSection({
  object,
  freshness,
  hasEmbedding,
  columns,
  semanticCard,
  semanticStatus,
  latestProfileStats,
  activeJobKinds,
  onRefresh,
}: HeroSectionProps) {
  const piiCount = columns.filter((c) => c.semantic?.pii_flag === true).length;
  const trust = semanticStatus ? TRUST_CHIP[semanticStatus] : null;
  const keywords = (object.domain_keywords ?? []).filter(Boolean);
  const detail = latestProfileStats?.table_detail ?? null;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(object.full_path);
      toast.success('Path copied');
    } catch {
      toast.error('Could not copy the path');
    }
  };

  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 28 }}>
      {/* Title row + actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px 24px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 420px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <KindBadge kind={object.object_kind} />
            <h1 style={{ ...type['title-page'], color: 'var(--estate-ink)', margin: 0, overflowWrap: 'anywhere' }}>
              {object.object_name || object.full_path}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <code style={{ ...type.code, color: 'var(--estate-text-muted)', overflowWrap: 'anywhere' }}>{object.full_path}</code>
            <button
              type="button"
              onClick={copyPath}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--estate-active-bg)] transition-colors"
              style={{ color: 'var(--estate-text-muted)', border: 'none', background: 'transparent', cursor: 'pointer' }}
              title="Copy full path"
              aria-label="Copy full path"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>
        <HarvestActionBar
          objectId={object.id}
          sourceId={object.source_id}
          fullPath={object.full_path}
          last_t0_at={object.last_t0_at}
          last_t1_at={object.last_t1_at}
          last_t2_at={object.last_t2_at}
          last_t3_at={object.last_t3_at}
          last_t4_at={object.last_t4_at}
          onActionComplete={onRefresh}
        />
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <LifecycleBadge
          last_t0_at={object.last_t0_at}
          last_t2_at={object.last_t2_at}
          last_knowledge_sync_at={object.last_knowledge_sync_at}
          freshnessStale={freshness.stale}
          hasEmbedding={hasEmbedding}
        />
        {trust && <Chip color={trust.color} title={trust.title} href="#semantic-card">{trust.label}</Chip>}
        {piiCount > 0 && (
          <Chip color="#B23A32" title="Columns with semantic.pii_flag = true" href="#columns">
            PII · {piiCount} column{piiCount === 1 ? '' : 's'}
          </Chip>
        )}
        {detail?.format && <Chip color="#6B7280" title="DESCRIBE DETAIL format">{detail.format}</Chip>}
        {activeJobKinds.length > 0 && (
          <Chip color="#2F6DB0" title="A harvest job for this object is in progress — this page refreshes automatically" href="#operations">
            <span className="animate-pulse" aria-hidden="true">●</span>
            {[...new Set(activeJobKinds)].join(', ')} running
          </Chip>
        )}
      </div>

      {/* Summary */}
      {semanticCard?.summary && (
        <p style={{ ...type['body-lg'], color: 'var(--estate-text-secondary)', margin: 0, maxWidth: '80ch' }}>
          {semanticCard.summary}
        </p>
      )}

      {/* Native comment from the source system */}
      {object.native_comment && object.native_comment !== semanticCard?.summary && (
        <p style={{ ...type.ui, color: 'var(--estate-text-muted)', margin: 0, maxWidth: '80ch' }}>
          <span style={{ fontWeight: 600, color: 'var(--estate-text-secondary)' }}>Source comment: </span>
          {object.native_comment}
        </p>
      )}

      {/* domain_keywords (T2 — used to route agent questions to this table) */}
      {keywords.length > 0 && <KeywordRow keywords={keywords} />}
    </header>
  );
}

// ── Fact strip ───────────────────────────────────────────────────────────────

interface FactProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  title?: string;
  href?: string;
}

function Fact({ label, value, sub, title, href }: FactProps) {
  const body = (
    <>
      <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>{label}</span>
      <span style={{ ...type['kpi-md'], color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{value}</span>
      {sub && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{sub}</span>}
    </>
  );
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '14px 16px',
    background: 'var(--estate-raised)',
    minWidth: 0,
    textDecoration: 'none',
  };
  return href
    ? <a href={href} title={title} style={style} className="hover:bg-[var(--estate-hover)] transition-colors">{body}</a>
    : <div title={title} style={style}>{body}</div>;
}

interface ObjectFactsProps {
  object: HeroObject;
  freshness: FreshnessBlock;
  columns: HeroColumn[];
  semanticCard: HeroSemanticCard | null;
  latestProfileStats: HeroProfileStats | null;
  usage: UsageSnapshot | null;
}

export function ObjectFacts({ object, freshness, columns, semanticCard, latestProfileStats, usage }: ObjectFactsProps) {
  const [countedRows, setCountedRows] = React.useState<number | null>(null);
  const rows = countedRows !== null
    ? { value: countedRows.toLocaleString(), sub: 'row_count · exact COUNT(*) just now', exact: true }
    : rowCount(object.row_count_est, latestProfileStats);
  const canCount = !rows.exact && object.object_kind !== 'view';
  const piiCount = columns.filter((c) => c.semantic?.pii_flag === true).length;
  const period = dataPeriod(semanticCard, columns);
  const detail = latestProfileStats?.table_detail ?? null;
  const partitions = detail?.partition_columns ?? [];
  const clustering = detail?.clustering_columns ?? [];
  const layoutCols = partitions.length > 0 ? partitions : clustering;

  const totalQueries = Number(usage?.access_stats?.total_queries ?? usage?.access_stats?.n_queries ?? 0);
  const executors = Number(usage?.access_stats?.distinct_executors ?? usage?.access_stats?.n_distinct_executors ?? 0);
  const windowDays = usage?.freshness?.window_days ?? 30;

  const harvested = relativeTime(
    [object.last_t2_at, object.last_t1_at, object.last_t0_at].filter((t): t is string => !!t).sort().pop() ?? null,
  );
  const sourceChanged = relativeTime(freshness.source_altered_at);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
        gap: 1,
        background: 'var(--estate-border)',
        border: '1px solid var(--estate-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <Fact
        label="Rows"
        value={rows.value}
        sub={canCount ? (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>{rows.sub}</span>
            <CountRowsButton objectId={object.id} onCounted={setCountedRows} />
          </span>
        ) : rows.sub}
      />
      <Fact
        label="Size"
        value={formatBytes(object.size_bytes_est)}
        sub={layoutCols.length > 0
          ? <>{partitions.length > 0 ? 'partitionColumns ' : 'clusteringColumns '}<code style={type['code-inline']}>{layoutCols.join(', ')}</code></>
          : [detail?.format, typeof detail?.num_files === 'number' ? `${detail.num_files.toLocaleString()} files` : null, 'sizeInBytes']
              .filter(Boolean).join(' · ')}
        title={[
          object.size_bytes_est != null ? `sizeInBytes: ${Number(object.size_bytes_est).toLocaleString()} bytes` : null,
          typeof detail?.num_files === 'number' ? `numFiles: ${detail.num_files.toLocaleString()}` : null,
          layoutCols.length > 0 ? 'Filter on these columns to read less data' : null,
        ].filter(Boolean).join('\n') || undefined}
      />
      <Fact
        label="Columns"
        value={columns.length}
        sub={piiCount > 0 ? `${piiCount} pii_flag` : 'no pii_flag'}
        href="#columns"
      />
      <Fact
        label="Covers"
        value={period ? `${period.from} – ${period.to}` : '—'}
        sub={period ? <>min/max of <code style={type['code-inline']}>{period.column}</code></> : 'No time column profiled'}
      />
      <Fact
        label="Usage"
        value={usage && totalQueries > 0 ? `${compactNumber(totalQueries)} queries` : '—'}
        sub={usage
          ? (executors > 0 ? `${executors} user${executors === 1 ? '' : 's'} · last ${windowDays} days` : `Last ${windowDays} days`)
          : 'Usage not harvested'}
        href="#usage"
      />
      <Fact
        label="Freshness"
        value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <FreshnessDot stale={freshness.stale} size={8} />
            {freshness.stale ? 'Stale' : 'Current'}
          </span>
        }
        sub={[harvested && `Harvested ${harvested}`, sourceChanged && `source changed ${sourceChanged}`].filter(Boolean).join(' · ') || undefined}
        href="#operations"
      />
    </div>
  );
}
