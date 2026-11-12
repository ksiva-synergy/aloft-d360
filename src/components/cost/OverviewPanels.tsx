'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Receipt, Users, Wallet } from 'lucide-react';
import { getJobKindLabel } from '@/lib/estate/job-ui';
import { budgetView, fmtCount, fmtTokens, fmtUsd } from '@/lib/spend/cost-derive';
import type { BudgetPolicy, BudgetStatus, CostSummaryResponse } from '@/lib/spend/cost-types';
import { Card, CardHeader, EmptyState, HealthBadge, Initials, RankedRow, Segmented, SeriesSwatch, SplitBar } from './ui';
import { SpendTrendChart, TrendLegend, type TrendView } from './SpendTrendChart';
import { BudgetMeter, policyTitle } from './BudgetsPanel';
import { EventsTable, useSpendEvents, type LedgerFilters } from './LedgerPanel';
import { displayName } from './PeoplePanel';

type Drill = (patch: Partial<LedgerFilters>) => void;

const VIEW_OPTIONS: { value: TrendView; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'cumulative', label: 'Cumulative' },
  { value: 'table', label: 'Table' },
];

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-caption font-medium text-[var(--brand-a)] hover:underline">
      {children} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function TrendCard({
  summary,
  show,
  title,
  className,
}: {
  summary: CostSummaryResponse;
  show: 'both' | 'ai' | 'harvest';
  title: string;
  className?: string;
}) {
  const [view, setView] = useState<TrendView>('daily');
  const allZero = summary.interactive.dailyUsd.every((v) => v === 0) && summary.harvest.dailyUsd.every((v) => v === 0);
  return (
    <Card className={className} aria-labelledby={`trend-${show}`}>
      <CardHeader
        id={`trend-${show}`}
        title={title}
        hint={
          show === 'both' ? (
            <TrendLegend aiUsd={summary.interactive.totalUsd} harvestUsd={summary.harvest.totalUsd} />
          ) : (
            `${summary.days} days, one bar per 24 hours`
          )
        }
        actions={<Segmented label="Chart view" size="sm" value={view} onChange={setView} options={VIEW_OPTIONS} />}
      />
      {allZero ? (
        <EmptyState icon={<Receipt className="h-5 w-5" />} title="No spend recorded in this window" />
      ) : (
        <SpendTrendChart fromIso={summary.from} ai={summary.interactive.dailyUsd} harvest={summary.harvest.dailyUsd} show={show} view={view} />
      )}
    </Card>
  );
}

export function OverviewPanel({
  summary,
  policies,
  statuses,
  onDrill,
  onOpenPerson,
  onTab,
  userName,
}: {
  summary: CostSummaryResponse;
  policies: BudgetPolicy[];
  statuses: BudgetStatus[];
  onDrill: Drill;
  onOpenPerson: (userId: string) => void;
  onTab: (t: 'people' | 'budgets') => void;
  userName: (id: string) => string | null;
}) {
  const drivers = useMemo(() => {
    const rows = [
      ...summary.interactive.bySurface.map((r) => ({
        key: `ai:${r.surface}`,
        label: r.surface,
        sub: 'Interactive',
        usd: r.usd,
        count: r.count,
        series: 'ai' as const,
        drill: { bucket: 'interactive' as const, surface: r.surface },
      })),
      ...summary.harvest.byKind.map((r) => ({
        key: `hv:${r.jobKind}`,
        label: getJobKindLabel(r.jobKind),
        sub: 'Harvest',
        usd: r.usd,
        count: r.count,
        series: 'harvest' as const,
        drill: { bucket: 'harvest' as const, jobKind: r.jobKind },
      })),
    ].sort((a, b) => b.usd - a.usd);
    return rows.slice(0, 7);
  }, [summary]);
  const topDriver = drivers[0]?.usd ?? 0;

  const topUsers = summary.byUser.slice(0, 6);
  const maxUser = topUsers.length ? topUsers[0].interactiveUsd + topUsers[0].harvestUsd : 0;

  const budgetRows = useMemo(() => {
    const byScope = new Map(statuses.map((s) => [s.scope, s]));
    return policies
      .map((p) => ({ p, view: budgetView(p, byScope.get(p.scope)) }))
      .filter((r) => r.view.health !== 'not-tracked')
      .sort((a, b) => b.view.pctUsed - a.view.pctUsed)
      .slice(0, 4);
  }, [policies, statuses]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <TrendCard summary={summary} show="both" title="Daily spend" className="xl:col-span-2" />
        <Card aria-labelledby="drivers-title">
          <CardHeader id="drivers-title" title="Top cost drivers" hint="Surfaces and job kinds, ranked. Select one to see its events." />
          {drivers.length === 0 ? (
            <EmptyState title="Nothing to rank yet" />
          ) : (
            <ul className="pb-3">
              {drivers.map((d) => (
                <RankedRow
                  key={d.key}
                  label={d.label}
                  sub={d.sub}
                  usd={d.usd}
                  count={d.count}
                  share={topDriver > 0 ? d.usd / topDriver : 0}
                  series={d.series}
                  onClick={() => onDrill(d.drill)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="top-people">
          <CardHeader id="top-people" title="Top spenders" actions={<LinkButton onClick={() => onTab('people')}>All people</LinkButton>} />
          {topUsers.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No attributed spend yet" />
          ) : (
            <ul className="pb-3">
              {topUsers.map((u) => (
                <li key={u.userId}>
                  <button
                    type="button"
                    onClick={() => onOpenPerson(u.userId)}
                    className="flex w-full items-center gap-3 px-5 py-2 text-left transition-colors duration-hover hover:bg-[var(--surface-2)]"
                  >
                    <Initials name={u.name ?? u.email ?? '?'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-size-ui text-[var(--ink-1)]">{displayName(u)}</span>
                        <span className="shrink-0 text-size-ui font-medium tabular-nums">{fmtUsd(u.interactiveUsd + u.harvestUsd)}</span>
                      </div>
                      <div className="mt-1.5">
                        <SplitBar ai={u.interactiveUsd} harvest={u.harvestUsd} max={maxUser} />
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="budget-health">
          <CardHeader id="budget-health" title="Budget health" hint="Current period, most used first" actions={<LinkButton onClick={() => onTab('budgets')}>Manage budgets</LinkButton>} />
          {budgetRows.length === 0 ? (
            <EmptyState icon={<Wallet className="h-5 w-5" />} title="No budgets configured" />
          ) : (
            <ul className="space-y-4 px-5 pb-5">
              {budgetRows.map(({ p, view }) => {
                const g = view.kind === 'role' ? view.group : null; // per-person role cap: show the highest spender
                return (
                  <li key={p.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-size-ui text-[var(--ink-1)]">
                        {policyTitle(p, userName)}
                        <span className="ml-2 text-caption capitalize text-[var(--ink-3)]">{g ? `${p.period} · per person` : p.period}</span>
                      </span>
                      <HealthBadge health={view.health} />
                    </div>
                    <BudgetMeter
                      spent={g ? g.topUserUsd : view.spentUsd}
                      cap={p.amountUsd}
                      alertPct={p.alertPct}
                      projected={g ? null : view.projectedUsd}
                      label={g ? `Highest person's share of the ${policyTitle(p, userName)} cap` : undefined}
                    />
                    <p className="mt-1 text-caption tabular-nums text-[var(--ink-3)]">
                      {g
                        ? `${fmtUsd(view.spentUsd)} combined · ${g.people === 1 ? '1 person' : `${g.people} people`} · highest ${fmtUsd(g.topUserUsd)} of ${fmtUsd(p.amountUsd)}${g.overCount ? ` · ${g.overCount} over` : ''}`
                        : `${fmtUsd(view.spentUsd)} of ${fmtUsd(p.amountUsd)}${view.projectedUsd != null ? ` · on pace for ${fmtUsd(view.projectedUsd)}` : ''}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-caption text-[var(--ink-3)]">{label}</p>
      <p className="mt-1 text-kpi-sm tabular-nums text-[var(--ink-1)]">{value}</p>
      {sub ? <p className="mt-0.5 text-caption text-[var(--ink-3)]">{sub}</p> : null}
    </div>
  );
}

function StatStrip({ children }: { children: ReactNode }) {
  return (
    <Card as="div" className="grid grid-cols-2 divide-[var(--line-1)] md:grid-cols-4 md:divide-x [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-[var(--line-1)] md:[&>*:nth-child(n+3)]:border-t-0">
      {children}
    </Card>
  );
}

function RankedCard({
  id,
  title,
  hint,
  rows,
  series,
  countLabel,
  className,
}: {
  id: string;
  title: string;
  hint?: string;
  rows: { key: string; label: ReactNode; sub?: ReactNode; usd: number; count: number; onClick?: () => void }[];
  series: 'ai' | 'harvest';
  countLabel?: string;
  className?: string;
}) {
  const top = rows[0]?.usd ?? 0;
  return (
    <Card aria-labelledby={id} className={className}>
      <CardHeader id={id} title={title} hint={hint} />
      {rows.length === 0 ? (
        <EmptyState title="No data in this window" />
      ) : (
        <ul className="pb-3">
          {rows.map((r) => (
            <RankedRow key={r.key} label={r.label} sub={r.sub} usd={r.usd} count={r.count} share={top > 0 ? r.usd / top : 0} series={series} onClick={r.onClick} countLabel={countLabel} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentCard({ days, bucket, onDrill }: { days: number; bucket: 'interactive' | 'harvest'; onDrill: Drill }) {
  const filters = useMemo(() => ({ bucket, sort: 'cost' as const }), [bucket]);
  const { data, loading } = useSpendEvents(days, filters, 8, 0);
  return (
    <Card aria-labelledby={`recent-${bucket}`}>
      <CardHeader
        id={`recent-${bucket}`}
        title="Most expensive events"
        hint={`Largest single charges in the last ${days} days`}
        actions={<LinkButton onClick={() => onDrill({ bucket, sort: 'cost' })}>Open in ledger</LinkButton>}
      />
      <EventsTable events={data?.events ?? []} loading={loading} onFilter={(p) => onDrill({ bucket, ...p })} />
      <div className="h-2" />
    </Card>
  );
}

export function InteractivePanel({ summary, days, onDrill }: { summary: CostSummaryResponse; days: number; onDrill: Drill }) {
  const it = summary.interactive;
  const avg = it.eventCount > 0 ? it.totalUsd / it.eventCount : 0;
  const promptTokens = it.tokens.input + it.tokens.cacheRead;
  const cacheShare = promptTokens > 0 ? it.tokens.cacheRead / promptTokens : 0;

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat
          label="Turns"
          value={fmtCount(it.eventCount)}
          sub={it.failedCount > 0 ? `${fmtCount(it.failedCount)} did not succeed` : 'All succeeded'}
        />
        <MiniStat label="Average per turn" value={fmtUsd(avg)} sub={`${fmtUsd(it.totalUsd)} total`} />
        <MiniStat label="Tokens" value={fmtTokens(it.tokens.input + it.tokens.output)} sub={`${fmtTokens(it.tokens.input)} in · ${fmtTokens(it.tokens.output)} out`} />
        <MiniStat
          label="Prompt cache reads"
          value={`${(cacheShare * 100).toFixed(0)}%`}
          sub={`${fmtTokens(it.tokens.cacheRead)} of ${fmtTokens(promptTokens)} prompt tokens`}
        />
      </StatStrip>

      <TrendCard summary={summary} show="ai" title="Interactive AI per day" />

      <div className="grid gap-4 lg:grid-cols-3">
        <RankedCard
          id="by-surface"
          title="By surface"
          series="ai"
          countLabel="turns"
          rows={it.bySurface.map((r) => ({ key: r.surface, label: r.surface, usd: r.usd, count: r.count, onClick: () => onDrill({ bucket: 'interactive', surface: r.surface }) }))}
        />
        <RankedCard
          id="by-model"
          title="By model"
          series="ai"
          countLabel="turns"
          rows={it.byModel.map((r) => ({ key: r.model, label: r.model === 'unknown' ? 'Not recorded' : r.model, usd: r.usd, count: r.count, onClick: () => onDrill({ bucket: 'interactive', model: r.model }) }))}
        />
        <RankedCard
          id="by-agent"
          title="By agent"
          hint="Top 12 agents with an attributed slug"
          series="ai"
          countLabel="turns"
          rows={it.byAgent.map((r) => ({ key: r.agentSlug, label: r.agentSlug, usd: r.usd, count: r.count, onClick: () => onDrill({ bucket: 'interactive', q: r.agentSlug }) }))}
        />
      </div>

      <RecentCard days={days} bucket="interactive" onDrill={onDrill} />
    </div>
  );
}

export function HarvestPanel({ summary, days, onDrill }: { summary: CostSummaryResponse; days: number; onDrill: Drill }) {
  const hv = summary.harvest;
  const avg = hv.eventCount > 0 ? hv.totalUsd / hv.eventCount : 0;
  const llmShare = hv.totalUsd > 0 ? hv.llmUsd / hv.totalUsd : 0;

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Harvest spend" value={fmtUsd(hv.totalUsd)} sub={`${fmtCount(hv.eventCount)} charges`} />
        <MiniStat label="LLM enrichment" value={fmtUsd(hv.llmUsd)} sub={`${(llmShare * 100).toFixed(0)}% of harvest`} />
        <MiniStat label="Compute" value={fmtUsd(hv.infraUsd)} sub={`${((1 - llmShare) * 100).toFixed(0)}% of harvest`} />
        <MiniStat label="Average per charge" value={fmtUsd(avg)} />
      </StatStrip>

      <TrendCard summary={summary} show="harvest" title="Harvest per day" />

      <div className="grid gap-4 lg:grid-cols-3">
        <RankedCard
          id="by-kind"
          title="By job kind"
          series="harvest"
          className="lg:col-span-2"
          rows={hv.byKind.map((r) => ({
            key: r.jobKind,
            label: getJobKindLabel(r.jobKind),
            sub: r.jobKind,
            usd: r.usd,
            count: r.count,
            onClick: () => onDrill({ bucket: 'harvest', jobKind: r.jobKind }),
          }))}
        />
        <Card aria-labelledby="hv-split">
          <CardHeader id="hv-split" title="LLM vs compute" hint="Compute is the job_infra charge; everything else is model usage." />
          <div className="px-5 pb-5">
            {hv.totalUsd > 0 ? (
              <>
                <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
                  <div className="rounded-full" style={{ width: `${llmShare * 100}%`, background: 'var(--cost-harvest)' }} />
                  <div className="flex-1 rounded-full bg-[var(--ink-3)] opacity-50" />
                </div>
                <dl className="mt-4 space-y-2 text-size-ui">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-[var(--ink-2)]"><SeriesSwatch series="harvest" /> LLM enrichment</dt>
                    <dd className="tabular-nums">{fmtUsd(hv.llmUsd)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-[var(--ink-2)]">
                      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px] bg-[var(--ink-3)] opacity-50" /> Compute
                    </dt>
                    <dd className="tabular-nums">{fmtUsd(hv.infraUsd)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="text-caption text-[var(--ink-3)]">No harvest spend in this window.</p>
            )}
          </div>
        </Card>
      </div>

      <RecentCard days={days} bucket="harvest" onDrill={onDrill} />
    </div>
  );
}
