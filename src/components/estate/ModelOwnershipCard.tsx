'use client';

/**
 * Ownership & refresh card for a Power BI model (Estate → Power BI → model header).
 * Who owns it, who can change it, where its data comes from, and — first — how fresh it is:
 * a stale dataset makes every parity mismatch a freshness question, not a SQL question.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ESTATE_HEADER_CHIP } from '@/components/estate/catalog-ui';
import { useJson } from '@/components/estate/ModelDependencyGraph';
import { Tag, TONE_COLOR, type Tone } from '@/components/estate/object-ui';
import type { PbiOwnership } from '@/lib/powerbi/pbi-ownership';

const DAY = 86_400_000;

type Person = PbiOwnership['access']['workspace'][number];
type RoleFilter = 'all' | Person['right'];
type AccessTab = 'workspace' | 'dataset';

const RIGHT_DOT: Record<string, string> = {
  Admin: TONE_COLOR.red,
  Member: TONE_COLOR.blue,
  Contributor: TONE_COLOR.green,
  Viewer: 'var(--estate-text-muted)',
};

const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Admin', label: 'Admin' },
  { id: 'Member', label: 'Member' },
  { id: 'Contributor', label: 'Contrib.' },
  { id: 'Viewer', label: 'Viewer' },
];

function age(iso: string | null): { text: string; days: number } | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const days = ms / DAY;
  const text =
    days < 1 / 24
      ? 'minutes ago'
      : days < 1
        ? `${Math.round(days * 24)} h ago`
        : days < 60
          ? `${Math.round(days)} days ago`
          : `${Math.round(days / 30.4)} months ago`;
  return { text, days };
}

function freshness(o: PbiOwnership): { tone: Tone; label: string; title: string } {
  const a = age(o.refresh.last_success_at);
  if (!a) return { tone: 'neutral', label: 'Refresh unknown', title: 'No completed refresh in the recent history' };
  if (a.days <= 2) return { tone: 'green', label: `Fresh · ${a.text}`, title: 'Last successful refresh' };
  if (a.days <= 30) return { tone: 'amber', label: `Refreshed ${a.text}`, title: 'Warehouse may hold newer rows than the dataset' };
  return {
    tone: 'red',
    label: `Stale · ${a.text}`,
    title: 'Dataset not refreshed for over a month — parity against current warehouse data measures staleness, not SQL',
  };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function scheduleLabel(sched: PbiOwnership['refresh']['schedule']): string {
  if (!sched) return 'Unknown';
  if (!sched.enabled) return 'Scheduled refresh is off';
  const cadence = sched.days.length === 7 ? 'Daily' : sched.days.join(', ') || 'Daily';
  const at = sched.times.join(', ') || '—';
  const tz = sched.time_zone ? ` (${sched.time_zone})` : '';
  return `${cadence} at ${at}${tz}`;
}

function SubCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-bg)] p-3">
      <h4 className="mb-2 text-caption font-medium text-[var(--estate-ink)]">{title}</h4>
      <div className="space-y-2 text-caption text-[var(--estate-text-secondary)]">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[var(--estate-text-muted)]">{label}</dt>
      <dd className="min-w-0 text-[var(--estate-text-secondary)]">{children}</dd>
    </div>
  );
}

function roleSummary(people: Person[]): string {
  const counts = new Map<string, number>();
  for (const u of people) counts.set(u.right, (counts.get(u.right) ?? 0) + 1);
  const editors = ['Admin', 'Member', 'Contributor']
    .filter((r) => counts.get(r))
    .map((r) => `${counts.get(r)} ${r}`)
    .join(' · ');
  const v = counts.get('Viewer');
  if (!v) return editors;
  return [editors, `${v} Viewer${v === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}

function RoleBar({ people }: { people: Person[] }) {
  if (!people.length) return null;
  const counts = new Map<string, number>();
  for (const u of people) counts.set(u.right, (counts.get(u.right) ?? 0) + 1);
  const total = people.length;
  const order = ['Admin', 'Contributor', 'Member', 'Viewer'] as const;
  return (
    <div className="space-y-1">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-[var(--estate-border)]"
        role="img"
        aria-label={roleSummary(people)}
      >
        {order.map((r) => {
          const n = counts.get(r) ?? 0;
          if (!n) return null;
          return (
            <div
              key={r}
              style={{ width: `${(n / total) * 100}%`, background: RIGHT_DOT[r] }}
              title={`${n} ${r}`}
            />
          );
        })}
      </div>
      <p className="text-size-eyebrow text-[var(--estate-text-muted)]">{roleSummary(people)}</p>
    </div>
  );
}

function RoleBadge({ right }: { right: string }) {
  const color = RIGHT_DOT[right] ?? 'var(--estate-text-muted)';
  const label = right === 'Contributor' ? 'Contrib.' : right;
  return (
    <span className="whitespace-nowrap font-medium" style={{ color }}>
      {label}
    </span>
  );
}

function PeopleRoster({
  people,
  emptyLabel,
  tall = false,
}: {
  people: Person[];
  emptyLabel: string;
  tall?: boolean;
}) {
  if (!people.length) {
    return <p className="py-2 text-[var(--estate-text-muted)]">{emptyLabel}</p>;
  }
  return (
    <div
      className={cn(
        'overflow-auto rounded-md border border-[var(--estate-border)]',
        tall ? 'max-h-[min(50vh,420px)]' : 'max-h-52',
      )}
    >
      <table className="w-full min-w-[280px] border-collapse text-left text-size-eyebrow">
        <thead className="sticky top-0 z-[1] border-b border-[var(--estate-border)] bg-[var(--estate-bg)] text-[var(--estate-text-muted)]">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Name
            </th>
            <th scope="col" className="w-[4.5rem] px-2 py-1.5 font-medium">
              Role
            </th>
            <th scope="col" className="hidden w-16 px-2 py-1.5 font-medium sm:table-cell">
              Kind
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--estate-border)]">
          {people.map((u) => (
            <tr key={`${u.name}-${u.right}-${u.type}`} className="hover:bg-[var(--estate-hover)]">
              <td className="max-w-[14rem] truncate px-2 py-1 text-[var(--estate-ink)]" title={u.name}>
                {u.name}
              </td>
              <td className="px-2 py-1">
                <RoleBadge right={u.right} />
              </td>
              <td className="hidden px-2 py-1 text-[var(--estate-text-dim)] sm:table-cell">
                {u.type === 'User' ? '—' : u.type}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessSection({ editors, viewers, dataset }: { editors: Person[]; viewers: Person[]; dataset: Person[] }) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [tab, setTab] = useState<AccessTab>('workspace');

  const workspace = useMemo(() => [...editors, ...viewers], [editors, viewers]);
  const pool = tab === 'workspace' ? workspace : dataset;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter((u) => {
      if (roleFilter !== 'all' && u.right !== roleFilter) return false;
      if (q && !u.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pool, query, roleFilter]);

  const showRoleFilters = tab === 'workspace';

  return (
    <SubCard title="Access">
      <RoleBar people={workspace} />

      <div className="flex flex-wrap items-center gap-2">
        {dataset.length > 0 && (
          <div
            role="tablist"
            aria-label="Access scope"
            className="inline-flex overflow-hidden rounded-md border border-[var(--estate-border)]"
          >
            {(
              [
                ['workspace', `Workspace (${workspace.length})`],
                ['dataset', `Dataset ACL (${dataset.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setRoleFilter('all');
                }}
                className={
                  'px-2.5 py-1 text-size-eyebrow ' +
                  (tab === id ? 'bg-[var(--estate-active-bg)] text-[var(--estate-ink)]' : 'hover:bg-[var(--estate-hover)]')
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <label className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name…"
            className="w-full rounded-md border border-[var(--estate-border)] bg-[var(--estate-surface)] py-1 pl-7 pr-2 text-size-eyebrow text-[var(--estate-ink)] outline-none placeholder:text-[var(--estate-text-dim)] focus:border-[var(--brand-a)]"
          />
        </label>
      </div>

      {showRoleFilters && (
        <div
          role="group"
          aria-label="Filter by role"
          className="flex flex-wrap gap-1"
        >
          {ROLE_FILTERS.filter((f) => f.id === 'all' || workspace.some((u) => u.right === f.id)).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setRoleFilter(f.id)}
              className={
                'rounded-md border px-2 py-0.5 text-size-eyebrow ' +
                (roleFilter === f.id
                  ? 'border-[var(--brand-a)] bg-[var(--estate-active-bg)] text-[var(--estate-ink)]'
                  : 'border-[var(--estate-border)] text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)]')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-size-eyebrow text-[var(--estate-text-dim)]">
        {filtered.length === pool.length
          ? `${pool.length} people`
          : `${filtered.length} of ${pool.length} match`}
        {editors.length > 0 && tab === 'workspace' && (
          <span>
            {' '}
            · <span className="text-[var(--estate-ink)]">{editors.length}</span> can edit this dataset
          </span>
        )}
      </p>

      <PeopleRoster
        people={filtered}
        emptyLabel={query.trim() ? 'No names match your filter.' : 'No people in this list.'}
        tall
      />
    </SubCard>
  );
}

function DataSources({ sources }: { sources: PbiOwnership['sources'] }) {
  if (!sources.length) return <p>—</p>;
  return (
    <ul className="space-y-2" role="list">
      {sources.map((s, i) => (
        <li
          key={i}
          className="rounded-md border border-[var(--estate-border)] bg-[var(--estate-surface)] px-2.5 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--estate-ink)]">{s.type}</span>
            {s.gateway && <Tag tone="amber">Gateway</Tag>}
          </div>
          {s.server && (
            <p className="mt-1 break-all font-mono text-size-eyebrow leading-relaxed text-[var(--estate-text-muted)]">{s.server}</p>
          )}
          {s.database && <p className="mt-0.5 text-caption text-[var(--estate-text-secondary)]">Database / path: {s.database}</p>}
        </li>
      ))}
    </ul>
  );
}

function OwnershipDetails({
  o,
  editors,
  viewers,
}: {
  o: PbiOwnership;
  editors: Person[];
  viewers: Person[];
}) {
  const last = o.refresh.last;
  const sched = o.refresh.schedule;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SubCard title="Refresh">
          <Field label="Last run">
            {last ? (
              <div className="space-y-1">
                <p>
                  <span
                    className="font-medium"
                    style={{ color: last.status === 'Failed' ? TONE_COLOR.red : 'var(--estate-ink)' }}
                  >
                    {last.status}
                  </span>
                  {last.type && <span className="text-[var(--estate-text-muted)]"> · {last.type}</span>}
                </p>
                <p>{fmtDate(last.end ?? last.start)}</p>
                {last.error && (
                  <p className="rounded-md border border-[var(--estate-status-error-border)] bg-[var(--estate-status-error-bg)] px-2 py-1.5 text-[var(--estate-status-error-text)]">
                    {last.error}
                  </p>
                )}
              </div>
            ) : (
              'No refresh history'
            )}
            {o.refresh.recent_failures > 0 && (
              <p className="mt-1 text-[var(--estate-status-warning-text)]">
                {o.refresh.recent_failures} of the last {o.refresh.recent_count} refreshes failed
              </p>
            )}
          </Field>
          <Field label="Last success">{fmtDate(o.refresh.last_success_at)}</Field>
          <Field label="Schedule">{scheduleLabel(sched)}</Field>
        </SubCard>

        <SubCard title="Dataset">
          <Field label="Configured by">{o.dataset.configured_by ?? 'unknown'}</Field>
          <Field label="Created">{fmtDate(o.dataset.created_date)}</Field>
          <Field label="Storage">{o.dataset.storage_mode ?? '—'}</Field>
          {o.reports.length > 0 && (
            <Field label="Reports">
              <ul className="flex flex-col gap-1.5" role="list">
                {o.reports.map((r) => (
                  <li key={r.name}>
                    {r.web_url ? (
                      <a
                        href={r.web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--estate-ink)] underline-offset-2 hover:underline"
                      >
                        {r.name}
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    ) : (
                      <span>{r.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </SubCard>
      </div>

      <AccessSection editors={editors} viewers={viewers} dataset={o.access.dataset} />

      <SubCard title="Data sources">
        <DataSources sources={o.sources} />
      </SubCard>

      <p className="text-size-eyebrow leading-relaxed text-[var(--estate-text-dim)]">
        Report author (created / last modified by) is only exposed by the Fabric admin scanner API, which needs a tenant
        administrator.
        {o.unavailable.length > 0 && <> Not readable with current permissions: {o.unavailable.join(', ')}.</>}
      </p>
    </div>
  );
}

function OwnershipDialog({
  open,
  onClose,
  title,
  headerTags,
  onRefresh,
  loading,
  fetchedAt,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  headerTags: React.ReactNode;
  onRefresh: () => void;
  loading: boolean;
  fetchedAt: string | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--estate-ink)_42%,transparent)]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ownership-dialog-title"
        className="relative flex max-h-[min(92vh,920px)] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] shadow-[0_24px_48px_color-mix(in_srgb,var(--estate-ink)_18%,transparent)]"
      >
        <header className="flex shrink-0 flex-wrap items-start gap-2 border-b border-[var(--estate-border)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id="ownership-dialog-title" className="text-title-section text-[var(--estate-ink)]">
              {title}
            </h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{headerTags}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--estate-border)] px-2.5 py-1 text-caption text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]"
              title={fetchedAt ? `Fetched ${fmtDate(fetchedAt)} — refetch from Power BI` : 'Refetch from Power BI'}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden /> Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}

function freshToneColor(tone: Tone): string {
  if (tone === 'neutral' || tone === 'brand') return 'var(--estate-text-muted)';
  return TONE_COLOR[tone];
}

function FreshPill({ label, tone, short }: { label: string; tone: Tone; short?: boolean }) {
  const c = freshToneColor(tone);
  const text = short
    ? label
        .replace(/^Fresh · /, '')
        .replace(/^Refreshed /, '')
        .replace(/^Stale · /, 'Stale ')
        .replace(/ ago$/, '')
    : label;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-medium" style={{ color: c }}>
      <span className="size-1.5 rounded-full" style={{ background: c }} aria-hidden />
      <span className="whitespace-nowrap">{text}</span>
    </span>
  );
}

/** Compact corner summary — full detail in a large dialog on click. */
export function ModelOwnershipCard({
  modelId,
  className,
  compact,
}: {
  modelId: string;
  className?: string;
  /** Single-line toolbar chip (truncated owner, short refresh label). */
  compact?: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const url = `/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/ownership${nonce ? `?refresh=1&n=${nonce}` : ''}`;
  const { data, error, loading } = useJson<{ ownership: PbiOwnership }>(url);
  const o = data?.ownership;

  if (loading && !o) {
    return (
      <span
        className={cn(
          'inline-flex h-8 items-center gap-1.5 px-2 text-size-eyebrow text-[var(--estate-text-muted)]',
          className,
        )}
      >
        <Loader2 className="size-3 animate-spin" aria-hidden /> Ownership…
      </span>
    );
  }
  if (error || !o) {
    return (
      <p className={cn('text-caption text-[var(--estate-text-muted)]', className)}>
        Ownership unavailable{error ? `: ${error}` : ''}
      </p>
    );
  }

  const f = freshness(o);
  const editors = o.access.workspace.filter((u) => u.right === 'Admin' || u.right === 'Member' || u.right === 'Contributor');
  const viewers = o.access.workspace.filter((u) => u.right === 'Viewer');
  const last = o.refresh.last;
  const sched = o.refresh.schedule;
  const owner = o.dataset.configured_by ?? 'unknown';

  const headerTags = (
    <>
      <Tag tone={f.tone}>{f.label}</Tag>
      {last?.status === 'Failed' && <Tag tone="red">Last refresh failed</Tag>}
      {sched && !sched.enabled && <Tag tone="amber">No scheduled refresh</Tag>}
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={cn(compact ? ESTATE_HEADER_CHIP : cn(ESTATE_HEADER_CHIP, 'max-w-none flex-wrap whitespace-normal'), className)}
        aria-haspopup="dialog"
        title={[f.title, `Owner: ${owner}`, editors.length ? `${editors.length} can edit` : ''].filter(Boolean).join(' · ')}
      >
        <FreshPill label={f.label} tone={f.tone} short={compact} />
        <span className="h-3 w-px shrink-0 bg-[var(--estate-border)]" aria-hidden />
        <span className="shrink-0 text-[var(--estate-text-dim)]">Owner</span>
        <span
          className={cn(
            'min-w-0 text-[var(--estate-ink)]',
            compact ? 'max-w-[9rem] truncate' : 'break-all sm:break-normal sm:whitespace-nowrap',
          )}
          title={owner}
        >
          {owner}
        </span>
        {editors.length > 0 && (
          <span className="shrink-0 tabular-nums text-[var(--estate-text-dim)]" title={`${editors.length} workspace editors`}>
            {editors.length}
          </span>
        )}
        <ChevronRight className="size-3 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
      </button>

      <OwnershipDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Ownership & refresh"
        headerTags={headerTags}
        onRefresh={() => setNonce((n) => n + 1)}
        loading={loading}
        fetchedAt={o.fetched_at}
      >
        <OwnershipDetails o={o} editors={editors} viewers={viewers} />
      </OwnershipDialog>
    </>
  );
}