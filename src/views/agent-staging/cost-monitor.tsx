'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { getJobKindLabel } from '@/lib/estate/job-ui';

type Tab = 'overview' | 'interactive' | 'harvest' | 'users' | 'budgets' | 'ledger';

interface BudgetStatusRow {
  scope: string;
  label: string;
  amountUsd: number;
  spentUsd: number;
  period: string;
  mode: string;
  alertPct: number;
  pctUsed: number;
  alert: boolean;
  exceeded: boolean;
}

interface Summary {
  from: string;
  to: string;
  interactive: {
    totalUsd: number;
    eventCount: number;
    bySurface: { surface: string; usd: number; count: number }[];
    dailyUsd: number[];
  };
  harvest: {
    totalUsd: number;
    eventCount: number;
    llmUsd: number;
    infraUsd: number;
    byKind: { jobKind: string; usd: number; count: number }[];
    dailyUsd: number[];
  };
  byUser: {
    userId: string;
    email: string | null;
    name: string | null;
    interactiveUsd: number;
    harvestUsd: number;
  }[];
  budgets?: BudgetStatusRow[];
}

interface SpendEvent {
  id: string;
  occurredAt: string;
  bucket: string;
  surface: string;
  action: string;
  usd: number;
  userId: string | null;
  userEmail: string | null;
  model: string | null;
  jobKind: string | null;
  agentSlug: string | null;
  sessionId: string | null;
  jobId: string | null;
  status: string | null;
  meta: unknown;
}

function fmtUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'interactive', label: 'Interactive AI' },
  { id: 'harvest', label: 'Harvest' },
  { id: 'users', label: 'By user' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'ledger', label: 'All events' },
];

export default function CostMonitorPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<SpendEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [ledgerBucket, setLedgerBucket] = useState<string>('');
  const [ledgerUserId, setLedgerUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    const r = await fetch(`/api/admin/cost/summary?days=${days}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Summary ${r.status}`);
    return r.json() as Promise<Summary>;
  }, [days]);

  const loadEvents = useCallback(
    async (bucket?: string, userId?: string) => {
      const q = new URLSearchParams({ days: String(days), limit: '80', offset: '0' });
      if (bucket) q.set('bucket', bucket);
      if (userId) q.set('userId', userId);
      const r = await fetch(`/api/admin/cost/events?${q}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Events ${r.status}`);
      const data = (await r.json()) as { total: number; events: SpendEvent[] };
      setEvents(data.events);
      setEventsTotal(data.total);
    },
    [days],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadSummary()
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSummary]);

  useEffect(() => {
    if (tab !== 'ledger' && tab !== 'harvest' && tab !== 'interactive') return;
    const bucket =
      tab === 'harvest' ? 'harvest' : tab === 'interactive' ? 'interactive' : ledgerBucket || undefined;
    const userFilter = tab === 'ledger' && ledgerUserId ? ledgerUserId : undefined;
    loadEvents(bucket, userFilter).catch((e) => setError(e instanceof Error ? e.message : 'Events failed'));
  }, [tab, ledgerBucket, ledgerUserId, loadEvents]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-size-title-page font-semibold text-[var(--ink-1)]">Cost monitor</h1>
          <p className="mt-1 text-size-ui text-[var(--ink-3)]">
            Per-user and per-surface spend. Harvest is tracked separately from interactive AI.
          </p>
        </div>
        <label className="flex items-center gap-2 text-size-ui text-[var(--ink-2)]">
          Window
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <a
          href={`/api/admin/cost/events?days=${days}&limit=2000&format=csv${ledgerBucket ? `&bucket=${ledgerBucket}` : ''}${ledgerUserId ? `&userId=${ledgerUserId}` : ''}`}
          className="rounded-md border border-[var(--border-1)] px-3 py-1.5 text-size-ui text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          Export CSV
        </a>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-[var(--border-1)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-size-ui font-medium transition-colors',
              tab === t.id
                ? 'bg-[var(--brand-a)] text-[var(--brand-a-ink)]'
                : 'text-[var(--ink-3)] hover:bg-[var(--surface-2)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-size-ui text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
          {error.includes('platform_spend') || error.includes('does not exist') ? (
            <span className="block mt-1 text-size-caption">
              Run the migration <code className="font-mono">20261103_platform_spend_events</code> and{' '}
              <code className="font-mono">prisma generate</code>.
            </span>
          ) : null}
        </p>
      )}

      {loading && !summary ? (
        <p className="text-size-ui text-[var(--ink-3)]">Loading…</p>
      ) : summary ? (
        <>
          {tab === 'overview' && <Overview summary={summary} />}
          {tab === 'interactive' && (
            <Breakdown
              title="Interactive AI by surface"
              rows={summary.interactive.bySurface.map((r) => ({
                label: r.surface,
                usd: r.usd,
                count: r.count,
              }))}
              total={summary.interactive.totalUsd}
              events={events}
              showModel
            />
          )}
          {tab === 'harvest' && (
            <Breakdown
              title="Harvest by job kind"
              rows={summary.harvest.byKind.map((r) => ({
                label: getJobKindLabel(r.jobKind),
                sub: r.jobKind,
                usd: r.usd,
                count: r.count,
              }))}
              total={summary.harvest.totalUsd}
              events={events}
              harvest
            />
          )}
          {tab === 'users' && (
            <UsersTable
              rows={summary.byUser}
              onSelectUser={(id) => {
                setLedgerUserId(id);
                setTab('ledger');
              }}
            />
          )}
          {tab === 'budgets' && (
            <BudgetsPanel
              statuses={summary.budgets ?? []}
              onRefresh={() => loadSummary().then(setSummary).catch(() => {})}
            />
          )}
          {tab === 'ledger' && (
            <>
              <div className="mb-3 flex flex-wrap gap-2 items-center">
                {['', 'interactive', 'harvest'].map((b) => (
                  <button
                    key={b || 'all'}
                    type="button"
                    onClick={() => setLedgerBucket(b)}
                    className={cn(
                      'rounded-md px-2 py-1 text-size-caption',
                      ledgerBucket === b ? 'bg-[var(--surface-3)] font-medium' : 'text-[var(--ink-3)]',
                    )}
                  >
                    {b || 'All buckets'}
                  </button>
                ))}
                {ledgerUserId ? (
                  <button
                    type="button"
                    onClick={() => setLedgerUserId('')}
                    className="rounded-md px-2 py-1 text-size-caption text-[var(--brand-a)]"
                  >
                    Clear user filter
                  </button>
                ) : null}
              </div>
              <EventsTable events={events} total={eventsTotal} harvest />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function Overview({ summary }: { summary: Summary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <StatCard
        title="Interactive AI"
        usd={summary.interactive.totalUsd}
        sub={`${summary.interactive.eventCount} logged turns`}
      />
      <StatCard
        title="Harvest & platform jobs"
        usd={summary.harvest.totalUsd}
        sub={`${summary.harvest.eventCount} events · LLM ${fmtUsd(summary.harvest.llmUsd)} · compute ${fmtUsd(summary.harvest.infraUsd)}`}
      />
      <DailySpendChart title="Interactive AI — daily USD" values={summary.interactive.dailyUsd} />
      <DailySpendChart title="Harvest — daily USD" values={summary.harvest.dailyUsd} />
      {(summary.budgets ?? []).some((b) => b.alert) ? (
        <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-size-ui text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          One or more budget policies are at or above their alert threshold. Open the Budgets tab to review.
        </div>
      ) : null}
      <div className="md:col-span-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] p-4">
        <h2 className="text-size-ui font-semibold text-[var(--ink-1)] mb-3">Top users (interactive + harvest attributed)</h2>
        {summary.byUser.length === 0 ? (
          <p className="text-size-ui text-[var(--ink-3)]">No attributed spend in this window yet.</p>
        ) : (
          <ul className="space-y-2">
            {summary.byUser.slice(0, 8).map((u) => (
              <li key={u.userId} className="flex justify-between text-size-ui">
                <span>{u.name ?? u.email ?? u.userId}</span>
                <span className="font-mono">
                  {fmtUsd(u.interactiveUsd + u.harvestUsd)}
                  <span className="text-[var(--ink-3)] ml-2 text-size-caption">
                    (AI {fmtUsd(u.interactiveUsd)} · harvest {fmtUsd(u.harvestUsd)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, usd, sub }: { title: string; usd: number; sub: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] p-5">
      <p className="text-size-caption uppercase tracking-wide text-[var(--ink-3)]">{title}</p>
      <p className="mt-2 font-mono text-size-title-section font-semibold text-[var(--ink-1)]">{fmtUsd(usd)}</p>
      <p className="mt-1 text-size-caption text-[var(--ink-3)]">{sub}</p>
    </div>
  );
}

function DailySpendChart({ title, values }: { title: string; values: number[] }) {
  const max = Math.max(...values, 0.0001);
  return (
    <div className="rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] p-4 md:col-span-1">
      <h2 className="text-size-ui font-semibold text-[var(--ink-1)] mb-3">{title}</h2>
      <div className="flex items-end gap-0.5 h-24" aria-hidden>
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 min-w-[2px] rounded-t bg-[var(--brand-a)] opacity-80"
            style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
            title={`${fmtUsd(v)}`}
          />
        ))}
      </div>
      <p className="mt-2 text-size-caption text-[var(--ink-3)]">{values.length} days in window</p>
    </div>
  );
}

function BudgetsPanel({
  statuses,
  onRefresh,
}: {
  statuses: BudgetStatusRow[];
  onRefresh: () => void;
}) {
  interface PolicyRow {
    id: string;
    scope: string;
    amountUsd: number;
    period: string;
    mode: string;
    alertPct: number;
  }
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { amountUsd: string; mode: string; period: string; alertPct: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/cost/budgets')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { policies: PolicyRow[] }) => {
        if (!cancelled) setPolicies(data.policies ?? []);
      })
      .catch((e) => {
        if (!cancelled) setEditorError(e instanceof Error ? e.message : 'Failed to load policies');
      });
    return () => {
      cancelled = true;
    };
  }, [statuses]);

  const statusByScope = new Map(statuses.map((s) => [s.scope, s]));

  const save = async (p: PolicyRow) => {
    const d = draft[p.id];
    const amountUsd = parseFloat(d?.amountUsd ?? String(p.amountUsd));
    const alertPct = parseInt(d?.alertPct ?? String(p.alertPct), 10);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      setEditorError('Cap must be a non-negative number');
      return;
    }
    setSavingId(p.id);
    setEditorError(null);
    try {
      const r = await fetch('/api/admin/cost/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id,
          scope: p.scope,
          amountUsd,
          period: (d?.period ?? p.period) as 'monthly' | 'daily',
          mode: (d?.mode ?? p.mode) as 'soft' | 'hard',
          alertPct: Number.isFinite(alertPct) ? alertPct : p.alertPct,
        }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Save failed (${r.status})`);
      }
      const data = (await r.json()) as { policies?: PolicyRow[]; statuses?: BudgetStatusRow[] };
      if (data.policies) setPolicies(data.policies);
      onRefresh();
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-1)]">
      <p className="px-4 py-3 text-size-ui text-[var(--ink-3)] border-b border-[var(--border-1)]">
        Soft mode warns only; hard mode blocks new interactive turns or harvest launches when projected spend would exceed the cap.
      </p>
      {editorError ? (
        <p className="px-4 py-2 text-size-ui text-red-700 dark:text-red-300">{editorError}</p>
      ) : null}
      <table className="w-full text-size-ui">
        <thead className="bg-[var(--surface-2)] text-left text-size-caption uppercase text-[var(--ink-3)]">
          <tr>
            <th className="px-4 py-2">Policy</th>
            <th className="px-4 py-2">Period</th>
            <th className="px-4 py-2">Mode</th>
            <th className="px-4 py-2 text-right">Cap (USD)</th>
            <th className="px-4 py-2 text-right">Alert %</th>
            <th className="px-4 py-2 text-right">Spent / used</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {policies.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-[var(--ink-3)]">
                {statuses.length ? 'Loading policies…' : 'No budget policies yet.'}
              </td>
            </tr>
          ) : (
            policies.map((p) => {
              const st = statusByScope.get(p.scope);
              const d = draft[p.id];
              return (
                <tr
                  key={p.id}
                  className={cn(
                    'border-t border-[var(--border-1)]',
                    st?.exceeded && 'bg-red-50/50 dark:bg-red-950/20',
                    !st?.exceeded && st?.alert && 'bg-amber-50/40 dark:bg-amber-950/20',
                  )}
                >
                  <td className="px-4 py-2">{st?.label ?? p.scope}</td>
                  <td className="px-4 py-2">
                    <select
                      className="rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-1 py-0.5 text-size-caption capitalize"
                      value={d?.period ?? p.period}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: { amountUsd: d?.amountUsd ?? String(p.amountUsd), mode: d?.mode ?? p.mode, period: e.target.value, alertPct: d?.alertPct ?? String(p.alertPct) },
                        }))
                      }
                    >
                      <option value="monthly">monthly</option>
                      <option value="daily">daily</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className="rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-1 py-0.5 text-size-caption capitalize"
                      value={d?.mode ?? p.mode}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: { amountUsd: d?.amountUsd ?? String(p.amountUsd), mode: e.target.value, period: d?.period ?? p.period, alertPct: d?.alertPct ?? String(p.alertPct) },
                        }))
                      }
                    >
                      <option value="soft">soft</option>
                      <option value="hard">hard</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="w-24 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-0.5 text-right font-mono text-size-caption"
                      value={d?.amountUsd ?? String(p.amountUsd)}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: { amountUsd: e.target.value, mode: d?.mode ?? p.mode, period: d?.period ?? p.period, alertPct: d?.alertPct ?? String(p.alertPct) },
                        }))
                      }
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className="w-16 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-0.5 text-right font-mono text-size-caption"
                      value={d?.alertPct ?? String(p.alertPct)}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: { amountUsd: d?.amountUsd ?? String(p.amountUsd), mode: d?.mode ?? p.mode, period: d?.period ?? p.period, alertPct: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-size-caption">
                    {st ? (
                      <>
                        {fmtUsd(st.spentUsd)} / {fmtUsd(st.amountUsd)}
                        <span className="block text-[var(--ink-3)]">{st.pctUsed.toFixed(0)}%</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={savingId === p.id}
                      onClick={() => save(p)}
                      className="rounded-md bg-[var(--brand-a)] px-2 py-1 text-size-caption font-medium text-[var(--brand-a-ink)] disabled:opacity-50"
                    >
                      {savingId === p.id ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
  events,
  showModel,
  harvest,
}: {
  title: string;
  rows: { label: string; sub?: string; usd: number; count: number }[];
  total: number;
  events: SpendEvent[];
  showModel?: boolean;
  harvest?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] p-4">
        <div className="flex justify-between mb-3">
          <h2 className="text-size-ui font-semibold">{title}</h2>
          <span className="font-mono font-medium">{fmtUsd(total)}</span>
        </div>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.sub ?? r.label} className="flex justify-between text-size-ui">
              <span>
                {r.label}
                {r.sub ? <span className="ml-2 text-size-caption text-[var(--ink-3)]">{r.sub}</span> : null}
              </span>
              <span className="font-mono">
                {fmtUsd(r.usd)} <span className="text-[var(--ink-3)]">({r.count})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <EventsTable events={events} total={events.length} showModel={showModel} harvest={harvest} />
    </div>
  );
}

function UsersTable({
  rows,
  onSelectUser,
}: {
  rows: Summary['byUser'];
  onSelectUser?: (userId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-1)]">
      <table className="w-full text-size-ui">
        <thead className="bg-[var(--surface-2)] text-left text-size-caption uppercase text-[var(--ink-3)]">
          <tr>
            <th className="px-4 py-2">User</th>
            <th className="px-4 py-2 text-right">Interactive</th>
            <th className="px-4 py-2 text-right">Harvest (launched)</th>
            <th className="px-4 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-[var(--ink-3)]">
                No user-attributed events in this window.
              </td>
            </tr>
          ) : (
            rows.map((u) => (
              <tr
                key={u.userId}
                className={cn(
                  'border-t border-[var(--border-1)]',
                  onSelectUser && 'cursor-pointer hover:bg-[var(--surface-2)]',
                )}
                onClick={() => onSelectUser?.(u.userId)}
              >
                <td className="px-4 py-2">
                  <div>{u.name ?? '—'}</div>
                  <div className="text-size-caption text-[var(--ink-3)]">{u.email}</div>
                </td>
                <td className="px-4 py-2 text-right font-mono">{fmtUsd(u.interactiveUsd)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtUsd(u.harvestUsd)}</td>
                <td className="px-4 py-2 text-right font-mono font-medium">
                  {fmtUsd(u.interactiveUsd + u.harvestUsd)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function EventsTable({
  events,
  total,
  showModel,
  harvest,
}: {
  events: SpendEvent[];
  total: number;
  showModel?: boolean;
  harvest?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-size-caption text-[var(--ink-3)]">
        Recent events {total > events.length ? `(showing ${events.length} of ${total})` : `(${total})`}
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-1)]">
        <table className="w-full text-size-ui">
          <thead className="bg-[var(--surface-2)] text-left text-size-caption uppercase text-[var(--ink-3)]">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">Where</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2 text-right">USD</th>
              {showModel ? <th className="px-3 py-2">Model</th> : null}
              {harvest ? <th className="px-3 py-2">Detail</th> : null}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[var(--ink-3)]">
                  No events yet. Spend is recorded on Inspector turns, agent chat, workbench, and completed harvest jobs.
                </td>
              </tr>
            ) : (
              events.map((e) => {
                const meta = e.meta && typeof e.meta === 'object' ? (e.meta as Record<string, unknown>) : null;
                const detail =
                  harvest && meta
                    ? [
                        e.jobKind,
                        meta.objects_enriched != null ? `${meta.objects_enriched} obj` : null,
                        meta.columns_enriched != null ? `${meta.columns_enriched} cols` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : e.agentSlug ?? e.sessionId?.slice(0, 8);
                return (
                  <tr key={e.id} className="border-t border-[var(--border-1)]">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtWhen(e.occurredAt)}</td>
                    <td className="px-3 py-2">{e.bucket}</td>
                    <td className="px-3 py-2">
                      {e.surface}
                      <span className="text-[var(--ink-3)]"> / {e.action}</span>
                    </td>
                    <td className="px-3 py-2 text-size-caption">{e.userEmail ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtUsd(e.usd)}</td>
                    {showModel ? <td className="px-3 py-2 text-size-caption font-mono">{e.model ?? '—'}</td> : null}
                    {harvest ? (
                      <td className="px-3 py-2 text-size-caption">
                        {detail}
                        {e.jobId ? (
                          <a
                            href={`/agent-lab/estate/jobs/${e.jobId}`}
                            className="ml-2 text-[var(--brand-a)] underline"
                          >
                            Job
                          </a>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
