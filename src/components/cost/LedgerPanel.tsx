'use client';

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Receipt, Search, X } from 'lucide-react';
import Link from '@/lib/navigation/link';
import { cn } from '@/lib/utils';
import { getJobKindLabel } from '@/lib/estate/job-ui';
import { fmtCount, fmtTokens, fmtUsd } from '@/lib/spend/cost-derive';
import type { SpendEventRow, SpendEventsResponse, SpendEventSort } from '@/lib/spend/cost-types';
import { Card, EmptyState, Pill, Segmented, SeriesSwatch, Shimmer } from './ui';

export interface LedgerFilters {
  bucket: '' | 'interactive' | 'harvest';
  userId?: string;
  /** Display name for the user chip. */
  userLabel?: string;
  surface?: string;
  model?: string;
  jobKind?: string;
  q: string;
  sort: SpendEventSort;
}

export const EMPTY_FILTERS: LedgerFilters = { bucket: '', q: '', sort: 'recent' };

export function ledgerParams(days: number, f: Partial<LedgerFilters>, page?: { limit: number; offset: number }): URLSearchParams {
  const q = new URLSearchParams({ days: String(days) });
  if (page) {
    q.set('limit', String(page.limit));
    q.set('offset', String(page.offset));
  }
  if (f.bucket) q.set('bucket', f.bucket);
  if (f.userId) q.set('userId', f.userId);
  if (f.surface) q.set('surface', f.surface);
  if (f.model) q.set('model', f.model);
  if (f.jobKind) q.set('jobKind', f.jobKind);
  if (f.q?.trim()) q.set('q', f.q.trim());
  if (f.sort && f.sort !== 'recent') q.set('sort', f.sort);
  return q;
}

export function csvHref(days: number, f: Partial<LedgerFilters>): string {
  const q = ledgerParams(days, f, { limit: 5000, offset: 0 });
  q.set('format', 'csv');
  return `/api/admin/cost/events?${q}`;
}

export function useSpendEvents(days: number, f: Partial<LedgerFilters>, limit: number, offset: number, reloadKey = 0) {
  const [data, setData] = useState<SpendEventsResponse | null>(null);
  // Loading is derived: the request is pending until a response for this exact key has settled.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const qs = ledgerParams(days, f, { limit, offset }).toString();
  const key = `${qs}#${reloadKey}`;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/admin/cost/events?${qs}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Events ${r.status}`);
        return r.json() as Promise<SpendEventsResponse>;
      })
      .then((d) => {
        setData(d);
        setSettled({ key, error: null });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setSettled({ key, error: e instanceof Error ? e.message : 'Failed to load events' });
      });
    return () => ctrl.abort();
  }, [qs, key]);

  const loading = settled?.key !== key;
  return { data, loading, error: loading ? null : (settled?.error ?? null) };
}

const whenFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function eventSubject(e: SpendEventRow): string {
  if (e.bucket === 'harvest') return e.jobKind ? getJobKindLabel(e.jobKind) : e.action;
  return e.model ?? e.agentSlug ?? '—';
}

export function EventsTable({
  events,
  loading,
  emptyHint,
  hideUser,
  onFilter,
}: {
  events: SpendEventRow[];
  loading?: boolean;
  emptyHint?: string;
  hideUser?: boolean;
  /** Drill into a value from an expanded row. */
  onFilter?: (patch: Partial<LedgerFilters>) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (loading && events.length === 0) {
    return (
      <div className="space-y-2 px-5 pb-5">
        {Array.from({ length: 6 }, (_, i) => <Shimmer key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <EmptyState icon={<Receipt className="h-5 w-5" />} title="No spend events match">
        {emptyHint ?? 'Spend is recorded on Ask Data turns, agent chat, the workbench, and completed harvest jobs.'}
      </EmptyState>
    );
  }

  const cols = hideUser ? 5 : 6;
  return (
    <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
      <table className="w-full min-w-[720px] text-size-ui">
        <thead className="text-left text-caption text-[var(--ink-3)]">
          <tr className="border-y border-[var(--line-1)] bg-[var(--surface-2)]">
            <th className="py-2 pl-5 pr-3 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Source</th>
            {hideUser ? null : <th className="px-3 py-2 font-medium">User</th>}
            <th className="px-3 py-2 font-medium">Model / job</th>
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
            <th className="py-2 pl-3 pr-5 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const isOpen = open === e.id;
            const failed = e.status && e.status !== 'success';
            const tokens = e.inputTokens + e.outputTokens;
            return (
              <Fragment key={e.id}>
                <tr
                  className={cn(
                    'cursor-pointer border-b border-[var(--line-1)] transition-colors duration-hover hover:bg-[var(--surface-2)]',
                    isOpen && 'bg-[var(--surface-2)]',
                  )}
                  onClick={() => setOpen(isOpen ? null : e.id)}
                >
                  <td className="whitespace-nowrap py-2 pl-5 pr-3">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`Details for event at ${whenFmt.format(new Date(e.occurredAt))}`}
                      className="flex items-center gap-2 text-left"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setOpen(isOpen ? null : e.id);
                      }}
                    >
                      <ChevronDown className={cn('h-3.5 w-3.5 text-[var(--ink-3)] transition-transform duration-hover', !isOpen && '-rotate-90')} aria-hidden />
                      <span className="tabular-nums text-[var(--ink-1)]" title={new Date(e.occurredAt).toLocaleString()}>
                        {whenFmt.format(new Date(e.occurredAt))}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <SeriesSwatch series={e.bucket === 'harvest' ? 'harvest' : 'ai'} />
                      <span className="text-[var(--ink-1)]">{e.surface}</span>
                      <span className="text-caption text-[var(--ink-3)]">{e.action}</span>
                      {failed ? <Pill>{e.status}</Pill> : null}
                    </span>
                  </td>
                  {hideUser ? null : (
                    <td className="max-w-[220px] truncate px-3 py-2 text-caption text-[var(--ink-2)]">{e.userEmail ?? 'System'}</td>
                  )}
                  <td className="max-w-[220px] truncate px-3 py-2 text-caption text-[var(--ink-2)]">{eventSubject(e)}</td>
                  <td className="px-3 py-2 text-right text-caption tabular-nums text-[var(--ink-3)]">{tokens > 0 ? fmtTokens(tokens) : '—'}</td>
                  <td className="py-2 pl-3 pr-5 text-right font-medium tabular-nums text-[var(--ink-1)]">{fmtUsd(e.usd)}</td>
                </tr>
                {isOpen ? (
                  <tr className="border-b border-[var(--line-1)] bg-[var(--surface-2)]">
                    <td colSpan={cols} className="px-5 pb-4 pt-1">
                      <EventDetail e={e} onFilter={onFilter} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventDetail({ e, onFilter }: { e: SpendEventRow; onFilter?: (patch: Partial<LedgerFilters>) => void }) {
  const meta = e.meta && typeof e.meta === 'object' && Object.keys(e.meta as object).length > 0 ? e.meta : null;
  const facts: { k: string; v: ReactNode }[] = [
    { k: 'Occurred', v: `${new Date(e.occurredAt).toLocaleString()} (${relTime(e.occurredAt)})` },
    { k: 'Bucket', v: e.bucket },
    { k: 'Status', v: e.status ?? 'success' },
    { k: 'Exact cost', v: <span className="tabular-nums">${e.usd.toFixed(6)}</span> },
  ];
  if (e.model) facts.push({ k: 'Model', v: e.model });
  if (e.agentSlug) facts.push({ k: 'Agent', v: e.agentSlug });
  if (e.jobKind) facts.push({ k: 'Job kind', v: `${getJobKindLabel(e.jobKind)} (${e.jobKind})` });
  if (e.sessionId) facts.push({ k: 'Session', v: <code className="font-mono text-caption">{e.sessionId}</code> });
  if (e.inputTokens || e.outputTokens || e.cacheReadTokens || e.cacheWriteTokens) {
    facts.push({
      k: 'Tokens',
      v: `${fmtCount(e.inputTokens)} in · ${fmtCount(e.outputTokens)} out · ${fmtCount(e.cacheReadTokens)} cache read · ${fmtCount(e.cacheWriteTokens)} cache write`,
    });
  }

  return (
    <div className="rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.k} className="flex min-w-0 gap-3 text-size-ui">
            <dt className="w-24 shrink-0 text-caption text-[var(--ink-3)]">{f.k}</dt>
            <dd className="min-w-0 break-words text-[var(--ink-1)]">{f.v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {onFilter ? (
          <>
            <DrillButton onClick={() => onFilter({ surface: e.surface })}>Only {e.surface}</DrillButton>
            {e.model ? <DrillButton onClick={() => onFilter({ model: e.model ?? undefined })}>Only {e.model}</DrillButton> : null}
            {e.jobKind ? <DrillButton onClick={() => onFilter({ jobKind: e.jobKind ?? undefined })}>Only {getJobKindLabel(e.jobKind)}</DrillButton> : null}
            {e.userId ? (
              <DrillButton onClick={() => onFilter({ userId: e.userId ?? undefined, userLabel: e.userEmail ?? undefined })}>
                Only {e.userEmail ?? 'this user'}
              </DrillButton>
            ) : null}
          </>
        ) : null}
        {e.jobId ? (
          <Link
            href={`/agent-lab/estate/jobs/${e.jobId}`}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--line-1)] px-2 py-1 text-caption font-medium text-[var(--brand-a)] hover:bg-[var(--surface-2)]"
          >
            Open job <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>
      {meta ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-caption text-[var(--ink-3)] hover:text-[var(--ink-1)]">Raw metadata</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-[var(--surface-2)] p-3 font-mono text-caption text-[var(--ink-2)]">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function DrillButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="max-w-[260px] truncate rounded-lg border border-[var(--line-1)] px-2 py-1 text-caption text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
    >
      {children}
    </button>
  );
}

const PAGE_SIZE = 50;

export function LedgerPanel({
  days,
  filters,
  onFiltersChange,
  reloadKey,
}: {
  days: number;
  filters: LedgerFilters;
  onFiltersChange: (f: LedgerFilters) => void;
  reloadKey: number;
}) {
  const [search, setSearch] = useState(filters.q);
  // Follow outside changes to the query (drill-downs, Clear all) without an effect.
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setSearch(filters.q);
  }

  // Debounce typing into the server-side search.
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => onFiltersChange({ ...filters, q: search }), 300);
    return () => clearTimeout(t);
  }, [search, filters, onFiltersChange]);

  // Page resets to 0 whenever the filters or window change.
  const filterKey = JSON.stringify({ ...filters, days });
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;
  const setPage = (fn: (p: number) => number) => setPaging({ key: filterKey, page: fn(page) });

  const { data, loading, error } = useSpendEvents(days, filters, PAGE_SIZE, page * PAGE_SIZE, reloadKey);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const patch = useCallback((p: Partial<LedgerFilters>) => onFiltersChange({ ...filters, ...p }), [filters, onFiltersChange]);

  const chips: { key: string; label: string; clear: Partial<LedgerFilters> }[] = [];
  if (filters.userId) chips.push({ key: 'user', label: `User: ${filters.userLabel ?? filters.userId.slice(0, 8)}`, clear: { userId: undefined, userLabel: undefined } });
  if (filters.surface) chips.push({ key: 'surface', label: `Surface: ${filters.surface}`, clear: { surface: undefined } });
  if (filters.model) chips.push({ key: 'model', label: `Model: ${filters.model}`, clear: { model: undefined } });
  if (filters.jobKind) chips.push({ key: 'kind', label: `Job: ${getJobKindLabel(filters.jobKind)}`, clear: { jobKind: undefined } });

  return (
    <Card aria-labelledby="ledger-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 id="ledger-title" className="text-title-card">Spend ledger</h2>
          <p className="mt-0.5 text-caption text-[var(--ink-3)]" aria-live="polite">
            {data ? (
              <>
                <span className="font-medium tabular-nums text-[var(--ink-2)]">{fmtCount(total)}</span> events ·{' '}
                <span className="font-medium tabular-nums text-[var(--ink-2)]">{fmtUsd(data.totalUsd)}</span> in the last {days} days
              </>
            ) : (
              'Every recorded charge, newest first'
            )}
          </p>
        </div>
        <Segmented
          label="Sort events"
          size="sm"
          value={filters.sort}
          onChange={(sort) => patch({ sort })}
          options={[
            { value: 'recent', label: 'Newest' },
            { value: 'cost', label: 'Highest cost' },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-3)]" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search surface, model, agent, job, session…"
            aria-label="Search spend events"
            className="h-9 w-full rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-1)] pl-9 pr-3 text-size-ui text-[var(--ink-1)] placeholder:text-[var(--ink-3)]"
          />
        </div>
        <Segmented
          label="Bucket"
          size="sm"
          value={filters.bucket}
          onChange={(bucket) => patch({ bucket })}
          options={[
            { value: '', label: 'All' },
            { value: 'interactive', label: 'Interactive AI' },
            { value: 'harvest', label: 'Harvest' },
          ]}
        />
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => patch(c.clear)}
            className="inline-flex max-w-[280px] items-center gap-1 rounded-full bg-[var(--brand-a-soft)] py-1 pl-2.5 pr-1.5 text-caption font-medium text-[var(--brand-a-ink)]"
            aria-label={`Remove filter ${c.label}`}
          >
            <span className="truncate">{c.label}</span>
            <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        ))}
        {chips.length > 0 || filters.q || filters.bucket ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              onFiltersChange({ ...EMPTY_FILTERS, sort: filters.sort });
            }}
            className="text-caption font-medium text-[var(--ink-3)] hover:text-[var(--ink-1)]"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mx-5 mb-3 rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{error}</p>
      ) : null}

      <EventsTable events={data?.events ?? []} loading={loading} onFilter={patch} emptyHint="Try a wider time window or clear some filters." />

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 px-5 py-3 text-caption text-[var(--ink-3)]">
          <span className="tabular-nums">
            {fmtCount(page * PAGE_SIZE + 1)}–{fmtCount(Math.min(total, (page + 1) * PAGE_SIZE))} of {fmtCount(total)}
          </span>
          <div className="flex items-center gap-1">
            <PagerButton disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)} label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </PagerButton>
            <span className="px-2 tabular-nums">
              Page {page + 1} of {pages}
            </span>
            <PagerButton disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)} label="Next page">
              <ChevronRight className="h-4 w-4" />
            </PagerButton>
          </div>
        </div>
      ) : (
        <div className="h-2" />
      )}
    </Card>
  );
}

function PagerButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line-1)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
