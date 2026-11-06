'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Coins, Database, Download, Gauge, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePathname, useRouter, useSearchParams } from '@/lib/navigation';
import {
  budgetView,
  fmtCount,
  fmtUsd,
  parseBudgetScope,
  pctChange,
  projectPeriodSpend,
  trailingAverage,
} from '@/lib/spend/cost-derive';
import type { BudgetStatus, CostSummaryWithBudgets } from '@/lib/spend/cost-types';
import styles from '@/components/cost/cost.module.css';
import { useSectionLevel } from '@/lib/sections/useSectionLevels';
import { Card, Delta, KpiTile, Segmented, Shimmer, SplitBar, SeriesSwatch } from '@/components/cost/ui';
import { OverviewPanel, InteractivePanel, HarvestPanel } from '@/components/cost/OverviewPanels';
import { PeoplePanel, PersonDrawer } from '@/components/cost/PeoplePanel';
import { BudgetsPanel, policyTitle, type BudgetsState, type DirectoryUser } from '@/components/cost/BudgetsPanel';
import { EMPTY_FILTERS, LedgerPanel, csvHref, type LedgerFilters } from '@/components/cost/LedgerPanel';

type Tab = 'overview' | 'interactive' | 'harvest' | 'people' | 'budgets' | 'ledger';
const TABS: Tab[] = ['overview', 'interactive', 'harvest', 'people', 'budgets', 'ledger'];
const WINDOWS = [7, 14, 30, 90] as const;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${url.split('?')[0]} returned ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export default function CostMonitorPage() {
  // Manage on Govern → Cost monitor sets budgets (platform admins by default, or a bundle).
  const canEditBudgets = useSectionLevel('govern.cost') === 'manage';
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview';
  const daysParam = Number(params.get('days'));
  const days = (WINDOWS as readonly number[]).includes(daysParam) ? daysParam : 30;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const setTab = useCallback((t: Tab) => setParam({ tab: t === 'overview' ? null : t }), [setParam]);
  const setDays = useCallback((d: number) => setParam({ days: d === 30 ? null : String(d) }), [setParam]);

  const [summary, setSummary] = useState<CostSummaryWithBudgets | null>(null);
  const [budgets, setBudgets] = useState<BudgetsState | null>(null);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // Loading is derived: pending until a response for this window + refresh has settled.
  const requestKey = `${days}#${reloadKey}`;
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const loading = settled?.key !== requestKey;
  const error = loading ? null : (settled?.error ?? null);

  const [filters, setFilters] = useState<LedgerFilters>(EMPTY_FILTERS);
  const [personId, setPersonId] = useState<string | null>(null);
  const [capFor, setCapFor] = useState<{ userId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJson<CostSummaryWithBudgets>(`/api/admin/cost/summary?days=${days}`),
      getJson<BudgetsState>('/api/admin/cost/budgets').catch(() => null),
    ])
      .then(([s, b]) => {
        if (cancelled) return;
        setSummary(s);
        setBudgets(b ?? { policies: [], statuses: s.budgets ?? [] });
        setUpdatedAt(new Date());
        setSettled({ key: requestKey, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setSettled({ key: requestKey, error: e instanceof Error ? e.message : 'Failed to load cost data' });
      });
    return () => {
      cancelled = true;
    };
  }, [days, requestKey]);

  // Names for budget overrides on people with no spend in this window. Best effort.
  useEffect(() => {
    let cancelled = false;
    getJson<{ users?: DirectoryUser[] }>('/api/users')
      .then((d) => {
        if (!cancelled) setDirectory(d.users ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const userName = useCallback(
    (id: string) => {
      const s = summary?.byUser.find((u) => u.userId === id);
      if (s) return s.name ?? s.email;
      const d = directory.find((u) => u.id === id);
      return d ? (d.name ?? d.email) : null;
    },
    [summary, directory],
  );

  const drill = useCallback(
    (patch: Partial<LedgerFilters>) => {
      setFilters({ ...EMPTY_FILTERS, ...patch });
      setTab('ledger');
    },
    [setTab],
  );

  const policies = useMemo(() => budgets?.policies ?? [], [budgets]);
  const statuses = useMemo(() => budgets?.statuses ?? summary?.budgets ?? [], [budgets, summary]);

  const attention = useMemo(() => {
    const byScope = new Map(statuses.map((s) => [s.scope, s]));
    return policies
      .map((p) => ({ p, ...budgetView(p, byScope.get(p.scope)) }))
      .filter((r) => r.health === 'exceeded' || r.health === 'alert')
      .sort((a, b) => (a.health === 'exceeded' ? -1 : 0) - (b.health === 'exceeded' ? -1 : 0));
  }, [policies, statuses]);

  const person = personId ? (summary?.byUser.find((u) => u.userId === personId) ?? null) : null;

  const tabLabels: Record<Tab, { label: string; badge?: string; alert?: boolean }> = {
    overview: { label: 'Overview' },
    interactive: { label: 'Interactive AI' },
    harvest: { label: 'Harvest' },
    people: { label: 'People', badge: summary ? fmtCount(summary.byUser.length) : undefined },
    budgets: { label: 'Budgets', badge: attention.length ? String(attention.length) : undefined, alert: attention.length > 0 },
    ledger: { label: 'Ledger' },
  };

  const exportHref = csvHref(days, tab === 'ledger' ? filters : tab === 'interactive' ? { bucket: 'interactive' } : tab === 'harvest' ? { bucket: 'harvest' } : {});

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-1 flex items-center gap-2 text-eyebrow uppercase text-[var(--ink-3)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-a)]" />
              Govern · Spend
            </div>
            <h1 className="text-title-section text-[var(--ink-1)]">Cost monitor</h1>
            <p className="mt-1 text-size-ui text-[var(--ink-3)]">
              What the platform spends on AI and harvest jobs, who drives it, and how it tracks against budget.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Time window"
              value={days}
              onChange={setDays}
              options={WINDOWS.map((d) => ({ value: d, label: `${d}d` }))}
            />
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              aria-label="Refresh"
              title={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Refresh'}
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-1)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'motion-safe:animate-spin')} aria-hidden />
            </button>
            <a
              href={exportHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-1)] px-3 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
              title={tab === 'ledger' ? 'Export the filtered ledger' : 'Export events for this window'}
            >
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          </div>
        </header>

        {error ? (
          <div role="alert" className="mt-5 rounded-[var(--radius-card)] border border-[var(--bad)] bg-[var(--bad-bg)] px-5 py-4 text-size-ui text-[var(--bad)]">
            <p className="font-medium">Cost data could not be loaded.</p>
            <p className="mt-0.5">{error}</p>
            {error.includes('platform_spend') || error.includes('does not exist') ? (
              <p className="mt-1 text-caption">
                Run the migration <code className="font-mono">20261103_platform_spend_events</code> and <code className="font-mono">prisma generate</code>.
              </p>
            ) : null}
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mt-2 text-caption font-semibold underline">
              Try again
            </button>
          </div>
        ) : null}

        {attention.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[color:var(--warn)] bg-[var(--warn-bg)] px-5 py-3 text-size-ui text-[var(--warn)]">
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">
                  {attention.length === 1 ? '1 budget needs attention' : `${attention.length} budgets need attention`}:
                </span>{' '}
                {attention
                  .slice(0, 3)
                  .map((a) =>
                    a.kind === 'role' && a.group
                      ? `${policyTitle(a.p, userName)} (${a.group.overCount ? `${a.group.overCount} over cap` : `${a.group.alertCount} past alert`})`
                      : `${policyTitle(a.p, userName)} ${a.pctUsed.toFixed(0)}%`,
                  )
                  .join(' · ')}
              </span>
            </p>
            {tab !== 'budgets' ? (
              <button type="button" onClick={() => setTab('budgets')} className="font-semibold underline-offset-2 hover:underline">
                Review budgets
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={cn(styles.kpiGrid, 'mt-5')}>
          {summary ? <KpiRow summary={summary} statuses={statuses} policies={policies} /> : Array.from({ length: 4 }, (_, i) => <Shimmer key={i} className="h-[148px] rounded-[var(--radius-card)]" />)}
        </div>

        <nav className={cn(styles.tabs, 'mt-6')} role="tablist" aria-label="Cost monitor sections">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`cost-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="cost-tabpanel"
              onClick={() => setTab(t)}
              className={cn(styles.tab, 'text-size-ui font-medium')}
            >
              {tabLabels[t].label}
              {tabLabels[t].badge ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-caption tabular-nums',
                    tabLabels[t].alert ? 'bg-[var(--warn-bg)] text-[var(--warn)]' : 'bg-[var(--surface-3)] text-[var(--ink-2)]',
                  )}
                >
                  {tabLabels[t].badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div id="cost-tabpanel" role="tabpanel" aria-labelledby={`cost-tab-${tab}`} className="mt-5">
          {!summary ? (
            loading ? (
              <Card className="p-5">
                <Shimmer className="mb-4 h-5 w-48" />
                <Shimmer className="h-[240px] w-full" />
              </Card>
            ) : null
          ) : (
            <div className={cn('transition-opacity duration-hover', loading && 'opacity-60')}>
              {tab === 'overview' ? (
                <OverviewPanel
                  summary={summary}
                  policies={policies}
                  statuses={statuses}
                  onDrill={drill}
                  onOpenPerson={setPersonId}
                  onTab={setTab}
                  userName={userName}
                />
              ) : null}
              {tab === 'interactive' ? <InteractivePanel summary={summary} days={days} onDrill={drill} /> : null}
              {tab === 'harvest' ? <HarvestPanel summary={summary} days={days} onDrill={drill} /> : null}
              {tab === 'people' ? <PeoplePanel rows={summary.byUser} policies={policies} onOpen={setPersonId} /> : null}
              {tab === 'budgets' ? (
                <BudgetsPanel
                  state={budgets}
                  onChange={(s) => {
                    setBudgets(s);
                    setSummary((prev) => (prev ? { ...prev, budgets: s.statuses } : prev));
                  }}
                  userName={userName}
                  createFor={capFor}
                  readOnly={!canEditBudgets}
                />
              ) : null}
              {tab === 'ledger' ? <LedgerPanel days={days} filters={filters} onFiltersChange={setFilters} reloadKey={reloadKey} /> : null}
            </div>
          )}
        </div>
      </div>

      <PersonDrawer
        user={person}
        days={days}
        policies={policies}
        statuses={statuses}
        onClose={() => setPersonId(null)}
        onSetCap={!canEditBudgets ? undefined : (id) => {
          setPersonId(null);
          const hasCap = policies.some((p) => p.scope === `user:${id}:interactive`);
          setCapFor(hasCap ? null : { userId: id });
          setTab('budgets');
        }}
        onOpenLedger={(id, label) => {
          setPersonId(null);
          drill({ userId: id, userLabel: label });
        }}
      />
    </div>
  );
}

function KpiRow({
  summary,
  statuses,
  policies,
}: {
  summary: CostSummaryWithBudgets;
  statuses: BudgetStatus[];
  policies: BudgetsState['policies'];
}) {
  const ai = summary.interactive;
  const hv = summary.harvest;
  const total = ai.totalUsd + hv.totalUsd;
  const prevTotal = summary.previous.interactiveUsd + summary.previous.harvestUsd;
  const daily = ai.dailyUsd.map((v, i) => v + (hv.dailyUsd[i] ?? 0));
  const avg7 = trailingAverage(daily, 7);
  const prior = `vs prior ${summary.days}d`;

  // Month-to-date pace across the monthly org budgets.
  const orgMonthly = policies.filter((p) => parseBudgetScope(p.scope).kind === 'org' && p.period === 'monthly');
  const mtdSpent = orgMonthly.reduce((s, p) => s + (statuses.find((x) => x.scope === p.scope)?.spentUsd ?? 0), 0);
  const mtdCap = orgMonthly.reduce((s, p) => s + p.amountUsd, 0);
  const mtdProjected = orgMonthly.length ? projectPeriodSpend(mtdSpent, 'monthly') : null;

  return (
    <>
      <KpiTile
        label="Total spend"
        icon={<Coins className="h-4 w-4" aria-hidden />}
        value={fmtUsd(total)}
        delta={<Delta value={pctChange(total, prevTotal)} label={prior} />}
      >
        <Sparkline values={daily} />
      </KpiTile>
      <KpiTile
        label="Interactive AI"
        icon={<Bot className="h-4 w-4" aria-hidden />}
        value={fmtUsd(ai.totalUsd)}
        delta={<Delta value={pctChange(ai.totalUsd, summary.previous.interactiveUsd)} label={prior} />}
        footer={
          <span className="flex items-center gap-1.5">
            <SeriesSwatch series="ai" />
            {fmtCount(ai.eventCount)} turns · {fmtUsd(ai.eventCount ? ai.totalUsd / ai.eventCount : 0)} per turn
          </span>
        }
      />
      <KpiTile
        label="Harvest & platform jobs"
        icon={<Database className="h-4 w-4" aria-hidden />}
        value={fmtUsd(hv.totalUsd)}
        delta={<Delta value={pctChange(hv.totalUsd, summary.previous.harvestUsd)} label={prior} />}
        footer={
          <span className="flex items-center gap-1.5">
            <SeriesSwatch series="harvest" />
            LLM {fmtUsd(hv.llmUsd)} · compute {fmtUsd(hv.infraUsd)}
          </span>
        }
      />
      <KpiTile
        label="Run rate"
        icon={<Gauge className="h-4 w-4" aria-hidden />}
        value={
          <>
            {fmtUsd(avg7)}
            <span className="ml-1 text-size-ui font-normal text-[var(--ink-3)]">/ day</span>
          </>
        }
        delta={<span className="text-caption text-[var(--ink-3)]">7-day average · about {fmtUsd(avg7 * 30)} per 30 days</span>}
      >
        {mtdCap > 0 ? (
          <div>
            <SplitBar ai={Math.min(mtdSpent, mtdCap)} harvest={0} max={mtdCap} />
            <p className="mt-1.5 text-caption text-[var(--ink-3)]">
              Month to date <span className="tabular-nums text-[var(--ink-2)]">{fmtUsd(mtdSpent)}</span> of {fmtUsd(mtdCap)} org budget
              {mtdProjected != null ? (
                <>
                  {' '}· on pace for <span className="tabular-nums text-[var(--ink-2)]">{fmtUsd(mtdProjected)}</span>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </KpiTile>
    </>
  );
}

/** Total spend per day. Shape only; exact values are in the trend chart and its table view. */
function Sparkline({ values }: { values: number[] }) {
  const w = 240;
  const h = 36;
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.0001);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-9 w-full" role="img" aria-label="Daily total spend trend">
      <path d={area} style={{ fill: 'var(--brand-a)', opacity: 0.1 }} />
      <path d={line} style={{ fill: 'none', stroke: 'var(--brand-a)' }} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
