'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp, ListFilter, Search, Users, Wallet, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildBudgetScope, fmtCount, fmtUsd, projectPeriodSpend, budgetHealth } from '@/lib/spend/cost-derive';
import type { BudgetPolicy, BudgetStatus, CostSummaryResponse } from '@/lib/spend/cost-types';
import { Card, EmptyState, HealthBadge, Initials, Pill, SeriesSwatch, SplitBar } from './ui';
import { EventsTable, useSpendEvents } from './LedgerPanel';
import { BudgetMeter } from './BudgetsPanel';
import styles from './cost.module.css';

type UserRow = CostSummaryResponse['byUser'][number];
type SortKey = 'total' | 'interactive' | 'harvest' | 'events' | 'last';

const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function lastActive(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 60) return relFmt.format(-Math.max(1, Math.round(mins)), 'minute');
  if (mins < 1440) return relFmt.format(-Math.round(mins / 60), 'hour');
  return relFmt.format(-Math.round(mins / 1440), 'day');
}

export function displayName(u: Pick<UserRow, 'name' | 'email' | 'userId'>): string {
  return u.name ?? u.email ?? `User ${u.userId.slice(0, 8)}`;
}

export function PeoplePanel({
  rows,
  policies,
  onOpen,
}: {
  rows: UserRow[];
  policies: BudgetPolicy[];
  onOpen: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' });

  const capByUser = useMemo(() => {
    const m = new Map<string, BudgetPolicy>();
    for (const p of policies) if (p.scope.startsWith('user:')) m.set(p.scope.split(':')[1] ?? '', p);
    return m;
  }, [policies]);

  const max = useMemo(() => Math.max(0, ...rows.map((r) => r.interactiveUsd + r.harvestUsd)), [rows]);
  const grand = useMemo(() => rows.reduce((s, r) => s + r.interactiveUsd + r.harvestUsd, 0), [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (r: UserRow): number => {
      switch (sort.key) {
        case 'interactive': return r.interactiveUsd;
        case 'harvest': return r.harvestUsd;
        case 'events': return r.interactiveCount + r.harvestCount;
        case 'last': return new Date(r.lastAt).getTime();
        default: return r.interactiveUsd + r.harvestUsd;
      }
    };
    return rows
      .filter((r) => !q || (r.name ?? '').toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q))
      .sort((a, b) => (sort.dir === 'desc' ? val(b) - val(a) : val(a) - val(b)));
  }, [rows, query, sort]);

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
        className={cn('px-3 py-2 font-medium', align === 'right' && 'text-right')}
      >
        <button
          type="button"
          onClick={() => setSort({ key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
          className={cn('inline-flex items-center gap-1 hover:text-[var(--ink-1)]', active && 'text-[var(--ink-1)]')}
        >
          {label}
          {active ? (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />) : null}
        </button>
      </th>
    );
  };

  return (
    <Card aria-labelledby="people-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 id="people-title" className="text-title-card">Spend by person</h2>
          <p className="mt-0.5 text-caption text-[var(--ink-3)]">
            {fmtCount(rows.length)} people with attributed spend · harvest is credited to whoever launched the job
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-3)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search people"
            className="h-9 w-full rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-1)] pl-9 pr-3 text-size-ui placeholder:text-[var(--ink-3)]"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="No attributed spend in this window">
          Interactive turns and launched harvest jobs are credited to the signed-in user.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-size-ui">
            <thead className="text-left text-caption text-[var(--ink-3)]">
              <tr className="border-y border-[var(--line-1)] bg-[var(--surface-2)]">
                <th scope="col" className="py-2 pl-5 pr-3 font-medium">Person</th>
                <th scope="col" className="w-[22%] px-3 py-2 font-medium">Share of spend</th>
                {header('interactive', 'Interactive')}
                {header('harvest', 'Harvest')}
                {header('total', 'Total')}
                {header('events', 'Events')}
                {header('last', 'Last active')}
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const total = u.interactiveUsd + u.harvestUsd;
                const cap = capByUser.get(u.userId);
                return (
                  <tr
                    key={u.userId}
                    tabIndex={0}
                    onClick={() => onOpen(u.userId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(u.userId);
                      }
                    }}
                    className="cursor-pointer border-b border-[var(--line-1)] transition-colors duration-hover hover:bg-[var(--surface-2)]"
                    title={`Open ${displayName(u)}`}
                  >
                    <td className="py-2.5 pl-5 pr-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Initials name={u.name ?? u.email ?? '?'} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-[var(--ink-1)]">{u.name ?? u.email ?? '—'}</span>
                            {cap ? <Pill tone="brand">Cap {fmtUsd(cap.amountUsd)}</Pill> : null}
                          </div>
                          {u.name && u.email ? <div className="truncate text-caption text-[var(--ink-3)]">{u.email}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <SplitBar ai={u.interactiveUsd} harvest={u.harvestUsd} max={max} />
                        <span className="w-10 shrink-0 text-right text-caption tabular-nums text-[var(--ink-3)]">
                          {grand > 0 ? `${((total / grand) * 100).toFixed(0)}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-2)]">{fmtUsd(u.interactiveUsd)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-2)]">{fmtUsd(u.harvestUsd)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--ink-1)]">{fmtUsd(total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-3)]">{fmtCount(u.interactiveCount + u.harvestCount)}</td>
                    <td className="px-3 py-2.5 pr-5 text-right text-caption text-[var(--ink-3)]">{lastActive(u.lastAt)}</td>
                  </tr>
                );
              })}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-caption text-[var(--ink-3)]">Nobody matches “{query}”.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-4 px-5 py-3 text-caption text-[var(--ink-3)]">
        <span className="flex items-center gap-1.5"><SeriesSwatch series="ai" /> Interactive AI</span>
        <span className="flex items-center gap-1.5"><SeriesSwatch series="harvest" /> Harvest</span>
      </div>
    </Card>
  );
}

export function PersonDrawer({
  user,
  days,
  policies,
  statuses,
  onClose,
  onSetCap,
  onOpenLedger,
}: {
  user: UserRow | null;
  days: number;
  policies: BudgetPolicy[];
  statuses: BudgetStatus[];
  onClose: () => void;
  /** Absent when the viewer cannot change budgets. */
  onSetCap?: (userId: string) => void;
  onOpenLedger: (userId: string, label: string) => void;
}) {
  const [shownRaw, setShown] = useState(false);
  // Keeps the last person mounted while the panel slides out, then unmounts it.
  const [mounted, setMounted] = useState<UserRow | null>(user);
  if (user && user !== mounted) setMounted(user);
  const shown = !!user && shownRaw;
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (user) {
      returnFocus.current = (document.activeElement as HTMLElement | null) ?? null;
      // Next frame, so the hidden transform is painted first and the slide-in transitions.
      const raf = requestAnimationFrame(() => {
        setShown(true);
        closeRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    }
    returnFocus.current?.focus?.({ preventScroll: true });
    const t = setTimeout(() => {
      setShown(false);
      setMounted(null);
    }, 280);
    return () => clearTimeout(t);
  }, [user]);
  const u = user ?? mounted;

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, close]);

  if (!u) return null;

  return (
    <div className={cn('fixed inset-0 z-50', !user && 'pointer-events-none')}>
      <div className={cn(styles.scrim, 'absolute inset-0 bg-black/30', !shown && styles.scrimHidden)} onClick={close} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-drawer-title"
        className={cn(
          styles.drawer,
          !shown && styles.drawerHidden,
          'absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-[var(--line-1)] bg-[var(--surface-1)] shadow-[var(--shadow-pop)]',
        )}
      >
        {u ? <DrawerBody user={u} days={days} policies={policies} statuses={statuses} closeRef={closeRef} onClose={close} onSetCap={onSetCap} onOpenLedger={onOpenLedger} /> : null}
      </aside>
    </div>
  );
}

function DrawerBody({
  user,
  days,
  policies,
  statuses,
  closeRef,
  onClose,
  onSetCap,
  onOpenLedger,
}: {
  user: UserRow;
  days: number;
  policies: BudgetPolicy[];
  statuses: BudgetStatus[];
  closeRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  /** Absent when the viewer cannot change budgets. */
  onSetCap?: (userId: string) => void;
  onOpenLedger: (userId: string, label: string) => void;
}) {
  const filters = useMemo(() => ({ userId: user.userId }), [user.userId]);
  const { data, loading, error } = useSpendEvents(days, filters, 12, 0);
  const name = displayName(user);
  const total = user.interactiveUsd + user.harvestUsd;

  const scope = buildBudgetScope('user', user.userId);
  const cap = policies.find((p) => p.scope === scope);
  const capStatus = statuses.find((s) => s.scope === scope);
  const spent = capStatus?.spentUsd ?? 0;
  const projected = cap ? projectPeriodSpend(spent, cap.period) : null;

  return (
    <>
      <header className="flex items-start gap-3 border-b border-[var(--line-1)] px-5 py-4">
        <Initials name={user.name ?? user.email ?? '?'} />
        <div className="min-w-0 flex-1">
          <h2 id="person-drawer-title" className="truncate text-title-card text-[var(--ink-1)]">{name}</h2>
          {user.email && user.name ? <p className="truncate text-caption text-[var(--ink-3)]">{user.email}</p> : null}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section aria-label="Totals">
          <p className="text-caption text-[var(--ink-3)]">Last {days} days</p>
          <p className="mt-1 text-kpi-md tabular-nums text-[var(--ink-1)]">{fmtUsd(total)}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--surface-2)] p-3">
              <p className="flex items-center gap-1.5 text-caption text-[var(--ink-2)]"><SeriesSwatch series="ai" /> Interactive AI</p>
              <p className="mt-1 text-size-ui font-semibold tabular-nums">{fmtUsd(user.interactiveUsd)}</p>
              <p className="text-caption text-[var(--ink-3)]">{fmtCount(user.interactiveCount)} turns</p>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] p-3">
              <p className="flex items-center gap-1.5 text-caption text-[var(--ink-2)]"><SeriesSwatch series="harvest" /> Harvest launched</p>
              <p className="mt-1 text-size-ui font-semibold tabular-nums">{fmtUsd(user.harvestUsd)}</p>
              <p className="text-caption text-[var(--ink-3)]">{fmtCount(user.harvestCount)} events</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="drawer-cap" className="rounded-xl border border-[var(--line-1)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id="drawer-cap" className="flex items-center gap-2 text-size-ui font-semibold">
              <Wallet className="h-4 w-4 text-[var(--ink-3)]" aria-hidden /> Personal cap
            </h3>
            {cap ? (
              <HealthBadge health={budgetHealth({ amountUsd: cap.amountUsd, spentUsd: spent, alertPct: cap.alertPct, projectedUsd: projected })} />
            ) : null}
          </div>
          {cap ? (
            <>
              <p className="mt-2 text-size-ui text-[var(--ink-2)]">
                <span className="font-semibold tabular-nums text-[var(--ink-1)]">{fmtUsd(spent)}</span> of {fmtUsd(cap.amountUsd)} this{' '}
                {cap.period === 'daily' ? 'day' : 'month'} · {cap.mode === 'hard' ? 'blocks when reached' : 'flags only'}
              </p>
              <div className="mt-2">
                <BudgetMeter spent={spent} cap={cap.amountUsd} alertPct={cap.alertPct} projected={projected} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-size-ui text-[var(--ink-2)]">No personal cap. Their role default, then the organization budget, applies.</p>
          )}
          {onSetCap ? (
            <button
              type="button"
              onClick={() => onSetCap(user.userId)}
              className="mt-3 text-size-ui font-medium text-[var(--brand-a)] hover:underline"
            >
              {cap ? 'Change in Budgets' : 'Set a personal cap'}
            </button>
          ) : null}
        </section>

        <section aria-labelledby="drawer-events">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="drawer-events" className="text-size-ui font-semibold">Recent activity</h3>
            <button
              type="button"
              onClick={() => onOpenLedger(user.userId, name)}
              className="inline-flex items-center gap-1 text-caption font-medium text-[var(--brand-a)] hover:underline"
            >
              <ListFilter className="h-3.5 w-3.5" aria-hidden /> All in ledger
            </button>
          </div>
          {error ? <p className="text-caption text-[var(--bad)]">{error}</p> : null}
          <div className="-mx-5">
            <EventsTable events={data?.events ?? []} loading={loading} hideUser emptyHint="No events in this window." />
          </div>
        </section>
      </div>
    </>
  );
}
