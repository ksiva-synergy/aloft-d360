'use client';

/**
 * Platform home dashboard: a read-only briefing of Data Estate, Memory, people (sign-ins)
 * and Inspector, rendered from a server-aggregated snapshot (src/lib/dashboard/summary.ts).
 *
 * Layout: headline that states what needs you → metrics strip (coverage, job success, memory,
 * Inspector) → estate flow with the job behind each stage + briefing (failed jobs first) →
 * memory (+ AI spend and team for admins) → memory cred. Each number appears once; colour is reserved
 * for status (ok / warn / bad) and the estate stages.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import {
  ArrowRight, ChevronRight,
} from 'lucide-react';
import type {
  DashboardSummary, EstateSummary, MemorySummary, LoginsSummary, JobsSummary,
  GovernanceSummary, SpendSummary,
} from '@/lib/dashboard/summary';
import { MemoryCredCard } from '@/components/dashboard/MemoryCredCard';
import { ESTATE_STAGE, estateStageDisplayLabel } from '@/lib/estate/stages';
import { cn } from '@/lib/utils';

// ── Formatting ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((n / total) * 100));
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

// ── Jobs ─────────────────────────────────────────────────────────────────────

type JobKind = JobsSummary['kinds'][number];

const JOB_LABELS: Record<string, string> = {
  estate_inventory: 'Discover',
  t0_structural: 'Scan',
  change_detect: 'Change detection',
  t1_profile: 'Profile',
  t2_semantic: 'Describe',
  embed: 'Index',
  t3_usage: 'Usage & lineage',
  t4_scan: 'Business model',
  knowledge_sync: 'Publish to Knowledge',
  silo_scan: 'Similar-data scan',
  mapping: 'Schema mapping',
};
const MEMORY_JOB_LABELS: Record<string, string> = {
  synthesize: 'Memory learning',
  grow_refine: 'Memory refinement',
  reclassify: 'Memory reclassification',
};
const jobLabel = (k: string) => JOB_LABELS[k] ?? k.replace(/_/g, ' ');
const jobHref = (k: string) => `/agent-lab/estate/jobs?kind=${encodeURIComponent(k)}`;
const isFailed = (s: string | null) => s === 'failed' || s === 'error';

/** The job that moves tables into each estate stage. */
const STAGE_JOB: Record<string, string> = {
  discovered: 'estate_inventory',
  scanned: 't0_structural',
  profiled: 't1_profile',
  enriched: 't2_semantic',
  searchable: 'embed',
};

function jobState(k: JobKind | undefined): { tone: 'ok' | 'bad' | 'warn' | 'live' | 'idle'; text: string } {
  if (!k) return { tone: 'idle', text: 'Never run' };
  if (k.running > 0) return { tone: 'live', text: 'Running now' };
  if (isFailed(k.lastStatus)) return { tone: 'bad', text: `Failed ${relativeTime(k.lastFinishedAt)}` };
  if (k.overdue) return { tone: 'warn', text: k.lastFinishedAt ? `Overdue · ran ${relativeTime(k.lastFinishedAt)}` : 'Overdue · never ran' };
  if (k.queued > 0) return { tone: 'live', text: 'Queued' };
  return { tone: 'ok', text: k.lastFinishedAt ? `Ran ${relativeTime(k.lastFinishedAt)}` : 'Never finished' };
}

const JOB_DOT: Record<ReturnType<typeof jobState>['tone'], string> = {
  ok: 'var(--ok)', bad: 'var(--bad)', warn: 'var(--warn)', live: 'var(--brand-a)', idle: 'var(--line-2)',
};
const JOB_TEXT: Partial<Record<ReturnType<typeof jobState>['tone'], string>> = {
  bad: 'text-[var(--bad)]', warn: 'text-[var(--warn)]',
};

// ── Shared pieces ────────────────────────────────────────────────────────────

const PANEL = 'rounded-card border border-[var(--line-1)] bg-[var(--surface-1)]';
const MUTED = 'text-[var(--ink-3)]';
const NUM = 'font-semibold tabular-nums tracking-[-0.02em] text-[var(--ink-1)]';

/** Section heading that sits above a panel, editorial-style, with an optional link. */
function Section({
  title, meta, href, linkLabel = 'Open', className, children,
}: {
  title: string; meta?: React.ReactNode; href?: string; linkLabel?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-2.5', className)} aria-label={title}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="shrink-0 text-size-ui font-semibold text-[var(--ink-1)]">{title}</h2>
          {meta && <span className={cn('min-w-0 truncate text-caption', MUTED)}>{meta}</span>}
        </div>
        {href && (
          <Link
            href={href}
            className="group inline-flex shrink-0 items-center gap-0.5 text-caption font-medium text-[var(--ink-2)] no-underline transition-colors duration-hover hover:text-[var(--brand-a-ink)]"
          >
            {linkLabel}
            <ChevronRight className="size-3.5 transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return <p className={cn('px-5 py-8 text-center text-size-ui', MUTED)}>{what} is not available right now.</p>;
}

/** Thin area sparkline. */
function Sparkline({ data }: { data: number[] }) {
  const width = 120;
  const height = 32;
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const range = Math.max(...data) - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 6)).toFixed(1)}`).join(' ');
  const last = pts.split(' ').pop()!.split(',');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-8 w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="dash-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--brand-a)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--brand-a)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill="url(#dash-spark)" />
      <polyline points={pts} fill="none" stroke="var(--brand-a)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--brand-a)" />
    </svg>
  );
}

/** Seven day bars, today emphasised. */
function DayBars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
      {data.map((v, i) => {
        const today = i === data.length - 1;
        const d = new Date(Date.now() - (data.length - 1 - i) * 86_400_000);
        return (
          <div
            key={i}
            title={`${today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long' })}: ${v}`}
            className="dash-grow-y flex-1 rounded-[2px]"
            style={{
              height: `${Math.max(8, (v / max) * 100)}%`,
              background: today ? 'var(--brand-a)' : 'color-mix(in srgb, var(--brand-a) 28%, var(--surface-3))',
              animationDelay: `${i * 30}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Metrics strip ────────────────────────────────────────────────────────────

function Metric({
  label, value, of, sub, href, chart,
}: {
  label: string; value: string; of?: string; sub: React.ReactNode; href: string; chart?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="dash-press group relative flex min-w-0 flex-col gap-3 bg-[var(--surface-1)] px-5 py-4 no-underline transition-colors duration-hover hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <span className="flex items-center gap-1 text-caption font-medium text-[var(--ink-2)]">
        {label}
        <ArrowRight className="size-3 -translate-x-1 text-[var(--ink-3)] opacity-0 transition duration-hover group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
      </span>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={cn(NUM, 'text-kpi-lg leading-none')}>{value}</span>
            {of && <span className={cn('truncate text-size-ui tabular-nums', MUTED)}>{of}</span>}
          </div>
          <div className={cn('mt-2 truncate text-caption tabular-nums', MUTED)}>{sub}</div>
        </div>
        {chart && <div className="w-[84px] shrink-0 pb-0.5">{chart}</div>}
      </div>
    </Link>
  );
}

// ── Briefing (needs attention) ───────────────────────────────────────────────

type Tone = 'bad' | 'warn' | 'info';
interface Attention { key: string; tone: Tone; text: string; action: string; href: string }

function buildAttention(
  e: EstateSummary | null, m: MemorySummary | null, l: LoginsSummary | null, j: JobsSummary | null,
  g: GovernanceSummary | null, canReadUsers: boolean,
): Attention[] {
  const out: Attention[] = [];
  j?.kinds.filter(k => isFailed(k.lastStatus) && k.running === 0).forEach(k => {
    out.push({ key: `job-${k.kind}`, tone: 'bad', text: `${jobLabel(k.kind)} job failed ${relativeTime(k.lastFinishedAt)}`, action: 'Open', href: jobHref(k.kind) });
  });
  j?.kinds.filter(k => k.overdue && !isFailed(k.lastStatus) && k.running === 0).forEach(k => {
    out.push({ key: `late-${k.kind}`, tone: 'warn', text: `${jobLabel(k.kind)} job missed its schedule`, action: 'Open', href: jobHref(k.kind) });
  });
  if (g && g.piiPending > 0) {
    out.push({ key: 'pii', tone: 'warn', text: `${g.piiPending.toLocaleString()} ${plural(g.piiPending, 'table has', 'tables have')} personal data to review`, action: 'Review', href: '/agent-lab/estate/catalog' });
  }
  if (g?.review) {
    const n = g.review.entities + g.review.dimensions + g.review.measures;
    out.push({ key: 'semantic', tone: 'info', text: `${n.toLocaleString()} business ${plural(n, 'definition')} waiting for review`, action: 'Review', href: '/inspector?panel=semantic' });
  }
  const lateMemory = j?.memoryJobs.filter(x => x.status === 'red') ?? [];
  if (lateMemory.length === 1) {
    const x = lateMemory[0];
    const label = MEMORY_JOB_LABELS[x.jobKey] ?? x.jobKey;
    out.push({ key: 'memjob', tone: 'warn', text: x.ageHours === null ? `${label} has never run` : `${label} has not run for ${Math.floor(x.ageHours / 24)} days`, action: 'Memory', href: '/agent-lab/memory' });
  } else if (lateMemory.length > 1) {
    out.push({ key: 'memjob', tone: 'warn', text: `${lateMemory.length} memory jobs are overdue`, action: 'Memory', href: '/agent-lab/memory' });
  }
  if (e) {
    const sweepAge = daysSince(e.lastSweepAt);
    if (sweepAge > 7) {
      out.push({ key: 'sweep', tone: 'warn', text: e.lastSweepAt ? `Data estate not scanned for ${Math.floor(sweepAge)} days` : 'Data estate has never been scanned', action: 'Jobs', href: '/agent-lab/estate/jobs' });
    }
    if (e.staleCount > 0) {
      out.push({ key: 'stale', tone: 'warn', text: `${e.staleCount.toLocaleString()} ${plural(e.staleCount, 'table is', 'tables are')} out of date`, action: 'Review', href: '/agent-lab/estate/catalog' });
    }
    if (e.queuedJobs > 0) {
      out.push({ key: 'queued', tone: 'info', text: `${e.queuedJobs} ${plural(e.queuedJobs, 'job')} waiting to run`, action: 'View', href: '/agent-lab/estate/jobs?tab=active' });
    }
  }
  if (l && canReadUsers && l.failed7d > 0) {
    out.push({ key: 'failed', tone: l.failed7d >= 10 ? 'bad' : 'warn', text: `${l.failed7d} failed ${plural(l.failed7d, 'sign-in')} this week`, action: 'Users', href: '/agent-staging/users' });
  }
  if (m) {
    if (!m.injectEnabled) {
      out.push({ key: 'inject', tone: 'warn', text: 'Agents are not using memory', action: 'Memory', href: '/agent-lab/memory' });
    }
    const rated = m.helpfulTotal + m.harmfulTotal;
    if (rated >= 20 && m.helpfulRatio < 0.6) {
      out.push({ key: 'helpful', tone: 'warn', text: `Only ${Math.round(m.helpfulRatio * 100)}% of used memories were helpful`, action: 'Review', href: '/agent-lab/memory' });
    }
    if (m.unprocessedSessions > 0) {
      out.push({ key: 'unprocessed', tone: 'info', text: `${m.unprocessedSessions} ${plural(m.unprocessedSessions, 'session')} not yet learned from`, action: 'Memory', href: '/agent-lab/memory' });
    }
  }
  const rank: Record<Tone, number> = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

const TONE_COLOR: Record<Tone, string> = { bad: 'var(--bad)', warn: 'var(--warn)', info: 'var(--line-2)' };

function Briefing({ items, unavailable }: { items: Attention[]; unavailable?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 5);
  return (
    <Section title="Briefing" meta={items.length ? `${items.length} ${plural(items.length, 'item')}` : undefined} className="lg:col-span-4">
      <div className={cn(PANEL, 'flex flex-1 flex-col overflow-hidden')}>
        {unavailable ? <Unavailable what="The briefing" /> : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-5 py-10 text-center">
            <span aria-hidden className="mb-2 size-2 rounded-full bg-[var(--ok)] shadow-[0_0_0_4px_var(--ok-bg)]" />
            <p className="text-size-ui font-medium text-[var(--ink-1)]">Nothing needs you</p>
            <p className={cn('text-caption', MUTED)}>No failed jobs, stale data, PII to review or sign-in problems.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--line-1)]">
            {shown.map(i => (
              <li key={i.key}>
                <Link
                  href={i.href}
                  className="group flex items-center gap-3 px-4 py-3 no-underline transition-colors duration-hover hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                >
                  <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: TONE_COLOR[i.tone] }} />
                  <span className="min-w-0 flex-1 text-size-ui text-[var(--ink-1)]">{i.text}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-caption text-[var(--ink-3)] transition-colors duration-hover group-hover:text-[var(--brand-a-ink)]">
                    {i.action}
                    <ChevronRight className="size-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
            {items.length > 5 && (
              <li>
                <button type="button" onClick={() => setShowAll(v => !v)} className="w-full px-4 py-2.5 text-left text-caption font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
                  {showAll ? 'Show less' : `Show all ${items.length}`}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ── Data estate flow ─────────────────────────────────────────────────────────

function EstateFlow({ e, jobs }: { e: EstateSummary | null; jobs: JobsSummary | null }) {
  if (!e) {
    return (
      <Section title="Data estate" href="/agent-lab/estate" className="lg:col-span-8">
        <div className={PANEL}><Unavailable what="Estate coverage" /></div>
      </Section>
    );
  }
  const found = Math.max(e.estateTotal, e.harvested);
  const stages = [
    { s: ESTATE_STAGE.discovered, n: found },
    { s: ESTATE_STAGE.scanned, n: e.harvested },
    { s: ESTATE_STAGE.profiled, n: e.profiled },
    { s: ESTATE_STAGE.enriched, n: e.enriched },
    { s: ESTATE_STAGE.searchable, n: e.embedded },
  ];
  // Step-to-step conversion, so each connector reads as "of the previous stage".
  const conv = stages.slice(1).map((st, i) => pct(st.n, stages[i].n));
  const worst = found > 0 ? conv.indexOf(Math.min(...conv)) : -1;

  // Where every discovered table sits today (exclusive buckets, furthest stage wins).
  const searchable = Math.min(e.embedded, found);
  const described = Math.max(0, Math.min(e.enriched, found) - searchable);
  const profiled = Math.max(0, Math.min(e.profiled, found) - searchable - described);
  const scanned = Math.max(0, e.harvested - searchable - described - profiled);
  const waiting = Math.max(0, found - e.harvested);
  const buckets = [
    { label: estateStageDisplayLabel(ESTATE_STAGE.searchable), n: searchable, color: ESTATE_STAGE.searchable.color },
    { label: estateStageDisplayLabel(ESTATE_STAGE.enriched), n: described, color: ESTATE_STAGE.enriched.color },
    { label: estateStageDisplayLabel(ESTATE_STAGE.profiled), n: profiled, color: ESTATE_STAGE.profiled.color },
    { label: 'Scanned only', n: scanned, color: ESTATE_STAGE.scanned.color },
    { label: 'Not scanned', n: waiting, color: 'var(--surface-3)' },
  ].filter(b => b.n > 0);

  const stageKinds = new Set(Object.values(STAGE_JOB));
  const order = Object.keys(JOB_LABELS);
  const otherJobs = (jobs?.kinds ?? [])
    .filter(k => !stageKinds.has(k.kind) && JOB_LABELS[k.kind])
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return (
    <Section
      title="Data estate"
      meta={`${e.sources} ${plural(e.sources, 'source')} · last scan ${relativeTime(e.lastSweepAt)}`}
      href="/agent-lab/estate"
      className="lg:col-span-8"
    >
      <div className={cn(PANEL, 'flex flex-1 flex-col')}>
        <ol className="grid grid-cols-2 gap-y-5 px-5 pb-5 pt-5 sm:grid-cols-5 xl:flex xl:items-stretch">
          {stages.map((st, i) => (
            <React.Fragment key={st.s.key}>
              {i > 0 && (
                <li
                  className="hidden shrink-0 items-center gap-0.5 self-end px-2 pb-[3px] xl:flex"
                  title={`${conv[i - 1]}% of ${stages[i - 1].s.label.toLowerCase()} tables reach ${st.s.label.toLowerCase()}`}
                >
                  <ChevronRight aria-hidden className={cn('size-3.5', i - 1 === worst ? 'text-[var(--warn)]' : 'text-[var(--line-2)]')} />
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-caption font-medium tabular-nums',
                      i - 1 === worst ? 'bg-[var(--warn-bg)] text-[var(--warn)]' : 'bg-[var(--surface-2)] text-[var(--ink-3)]',
                    )}
                  >
                    {conv[i - 1]}%
                  </span>
                </li>
              )}
              <li className="flex min-w-0 flex-1 flex-col gap-1.5" title={st.s.help}>
                <span className="flex items-center gap-1.5 text-caption text-[var(--ink-2)]">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: st.s.color }} />
                  {st.s.label}
                </span>
                <span className={cn(NUM, 'text-kpi-md leading-none')}>{st.n.toLocaleString()}</span>
                {jobs && (() => {
                  const kind = STAGE_JOB[st.s.key];
                  const js = jobState(jobs.kinds.find(k => k.kind === kind));
                  return (
                    <Link
                      href={jobHref(kind)}
                      title={`${jobLabel(kind)} job`}
                      className={cn(
                        'mt-0.5 inline-flex w-fit max-w-full items-center gap-1.5 truncate text-caption tabular-nums no-underline transition-colors duration-hover hover:text-[var(--brand-a-ink)]',
                        js.tone === 'bad' || js.tone === 'warn' ? JOB_TEXT[js.tone] : MUTED,
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn('size-1.5 shrink-0 rounded-full', js.tone === 'live' && 'animate-pulse')}
                        style={{ background: JOB_DOT[js.tone] }}
                      />
                      <span className="truncate">{js.text}</span>
                    </Link>
                  );
                })()}
              </li>
            </React.Fragment>
          ))}
        </ol>

        <div className="border-t border-[var(--line-1)] px-5 pb-4 pt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-caption text-[var(--ink-2)]">Where your {fmt(found)} tables are</span>
            {worst >= 0 && (
              <Link href="/agent-lab/estate/jobs" className="text-caption text-[var(--ink-3)] no-underline hover:text-[var(--brand-a-ink)]">
                Biggest drop: <span className="text-[var(--warn)]">{stages[worst].s.label} → {stages[worst + 1].s.label}</span>
              </Link>
            )}
          </div>
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={buckets.map(b => `${b.label} ${b.n}`).join(', ')}>
            {buckets.map((b, i) => (
              <div
                key={b.label}
                title={`${b.label}: ${b.n.toLocaleString()} (${pct(b.n, found)}%)`}
                className="dash-grow-x h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(b.n / found) * 100}%`, minWidth: 3, background: b.color, animationDelay: `${i * 50}ms` }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {buckets.map(b => (
              <span key={b.label} className={cn('inline-flex items-center gap-1.5 text-caption', MUTED)}>
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: b.color, boxShadow: b.label === 'Not scanned' ? 'inset 0 0 0 1px var(--line-2)' : undefined }} />
                {b.label}
                <span className="tabular-nums text-[var(--ink-2)]">{pct(b.n, found)}%</span>
              </span>
            ))}
          </div>
        </div>

        {otherJobs.length > 0 && (
          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--line-1)] px-5 py-3">
            <span className={cn('text-caption', MUTED)}>Other jobs</span>
            {otherJobs.map(k => {
              const js = jobState(k);
              return (
                <Link
                  key={k.kind}
                  href={jobHref(k.kind)}
                  className="group inline-flex items-center gap-1.5 text-caption no-underline"
                >
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', js.tone === 'live' && 'animate-pulse')} style={{ background: JOB_DOT[js.tone] }} />
                  <span className="text-[var(--ink-1)] transition-colors duration-hover group-hover:text-[var(--brand-a-ink)]">{jobLabel(k.kind)}</span>
                  <span className={cn('tabular-nums', JOB_TEXT[js.tone] ?? MUTED)}>{js.text.toLowerCase()}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Memory ───────────────────────────────────────────────────────────────────

function MemoryPanel({ m }: { m: MemorySummary | null }) {
  return (
    <Section title="Memory" meta={m ? (m.injectEnabled ? 'In use by agents' : 'Not in use') : undefined} href="/agent-lab/memory" className="lg:col-span-12">
      <div className={cn(PANEL, 'flex flex-1 flex-col')}>
        {!m ? <Unavailable what="Memory" /> : (() => {
          const rated = m.helpfulTotal + m.harmfulTotal;
          const helpfulPct = Math.round(m.helpfulRatio * 100);
          const topMax = Math.max(...m.topTopics.map(t => t.count), 1);
          return (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="flex flex-col border-b border-[var(--line-1)] md:border-b-0 md:border-r">
                <div className="flex items-end justify-between gap-4 px-5 pt-5">
                  <div>
                    <div className="text-caption text-[var(--ink-2)]">Helpful when used</div>
                    <div className={cn(NUM, 'mt-1.5 text-kpi-lg leading-none')}>{rated ? `${helpfulPct}%` : '—'}</div>
                  </div>
                  <div className={cn('pb-0.5 text-right text-caption tabular-nums', MUTED)}>
                    {rated ? <>{m.helpfulTotal} helpful<br />{m.harmfulTotal} not helpful</> : 'No ratings yet'}
                  </div>
                </div>
                <div className="mx-5 mt-3 flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                  {rated > 0 && <div className="dash-grow-x rounded-l-full" style={{ width: `${helpfulPct}%`, background: 'var(--ok)' }} />}
                  {rated > 0 && helpfulPct < 100 && <div className="dash-grow-x rounded-r-full" style={{ width: `${100 - helpfulPct}%`, background: 'color-mix(in srgb, var(--bad) 55%, transparent)', animationDelay: '80ms' }} />}
                </div>
                <p className={cn('mx-5 mb-5 mt-2.5 text-caption tabular-nums', MUTED)}>
                  {fmt(m.activeMemories)} active · {fmt(m.coreMemories)} core · learned from {fmt(m.tracedSessions)} {plural(m.tracedSessions, 'session')}
                </p>
                <dl className="mt-auto grid grid-cols-3 divide-x divide-[var(--line-1)] border-t border-[var(--line-1)]">
                  {[
                    { k: 'Used today', v: fmt(m.injectedLast24h) },
                    { k: 'Blocked this week', v: fmt(m.phantomsBlocked7d), title: 'Low-quality memories kept away from agents' },
                    { k: 'Last learned', v: relativeTime(m.lastSynthesisAt) },
                  ].map(x => (
                    <div key={x.k} className="px-4 py-3" title={x.title}>
                      <dt className={cn('truncate text-caption', MUTED)}>{x.k}</dt>
                      <dd className="mt-0.5 truncate text-size-ui font-medium tabular-nums text-[var(--ink-1)]">{x.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="px-5 py-5">
                <h3 className={cn('mb-2 text-caption', MUTED)}>What agents remember most</h3>
                {m.topTopics.length === 0 ? (
                  <p className={cn('text-size-ui', MUTED)}>No topics yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {m.topTopics.slice(0, 6).map((t, i) => (
                      <li key={t.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2rem] items-center gap-3 text-size-ui">
                        <span className="truncate text-[var(--ink-1)]">{t.name}</span>
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div className="dash-grow-x h-full rounded-full" style={{ width: `${(t.count / topMax) * 100}%`, background: 'color-mix(in srgb, var(--brand-a) 60%, var(--surface-3))', animationDelay: `${i * 40}ms` }} />
                        </div>
                        <span className={cn('text-right text-caption tabular-nums', MUTED)}>{t.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </Section>
  );
}

// ── AI spend ─────────────────────────────────────────────────────────────────

function usd(n: number): string {
  if (n >= 10_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

function SpendPanel({ s }: { s: SpendSummary | null }) {
  const change = s && s.prev7d > 0 ? Math.round(((s.last7d - s.prev7d) / s.prev7d) * 100) : null;
  const max = s ? Math.max(...s.daily, 0.0001) : 1;
  return (
    <Section title="AI spend" meta="Last 7 days" className="lg:col-span-7">
      <div className={cn(PANEL, 'flex flex-1 flex-col')}>
        {!s ? <Unavailable what="Spend" /> : s.last7d === 0 && s.prev7d === 0 ? (
          <p className={cn('px-5 py-8 text-center text-size-ui', MUTED)}>No model spend recorded in the last two weeks.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-6 px-5 pt-5">
              <div className="min-w-0">
                <div className={cn(NUM, 'text-kpi-lg leading-none')}>{usd(s.last7d)}</div>
                <div className={cn('mt-2 text-caption tabular-nums', MUTED)}>
                  {change === null ? 'Nothing to compare with last week' : (
                    <><span className="text-[var(--ink-2)]">{change > 0 ? '↑' : change < 0 ? '↓' : ''} {Math.abs(change)}%</span> vs {usd(s.prev7d)} the week before</>
                  )}
                </div>
              </div>
              <div className="flex h-14 w-[min(55%,260px)] items-end gap-1" aria-hidden>
                {s.daily.map((v, i) => {
                  const today = i === s.daily.length - 1;
                  const d = new Date(Date.now() - (s.daily.length - 1 - i) * 86_400_000);
                  return (
                    <div
                      key={i}
                      title={`${today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long' })}: ${usd(v)}`}
                      className="dash-grow-y flex-1 rounded-[3px]"
                      style={{
                        height: `${Math.max(4, (v / max) * 100)}%`,
                        background: today ? 'var(--brand-a)' : 'color-mix(in srgb, var(--brand-a) 28%, var(--surface-3))',
                        animationDelay: `${i * 30}ms`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <ul className="mt-5 flex flex-col gap-2 border-t border-[var(--line-1)] px-5 py-4">
              {s.byArea.map((a, i) => (
                <li key={a.area} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_3.5rem_2.5rem] items-center gap-3 text-size-ui">
                  <span className="truncate text-[var(--ink-1)]">{a.area}</span>
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div className="dash-grow-x h-full rounded-full" style={{ width: `${pct(a.usd, s.last7d)}%`, background: 'color-mix(in srgb, var(--brand-a) 60%, var(--surface-3))', animationDelay: `${i * 40}ms` }} />
                  </div>
                  <span className="text-right tabular-nums text-[var(--ink-1)]">{usd(a.usd)}</span>
                  <span className={cn('text-right text-caption tabular-nums', MUTED)}>{pct(a.usd, s.last7d)}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Section>
  );
}

// ── Team ─────────────────────────────────────────────────────────────────────

function TeamPanel({ l }: { l: LoginsSummary | null }) {
  const roles = l ? [...l.roleDistribution].sort((a, b) => b.count - a.count) : [];
  const max = Math.max(...roles.map(r => r.count), 1);
  return (
    <Section
      title="Team"
      meta={l ? `${fmt(l.activeUsers)} of ${fmt(l.totalUsers)} active` : undefined}
      href="/agent-staging/users"
      linkLabel="Users"
      className="lg:col-span-5"
    >
      <div className={cn(PANEL, 'flex flex-1 flex-col')}>
        {!l ? <Unavailable what="Team" /> : (
          <>
            <div className="px-5 pb-4 pt-5">
              <h3 className={cn('mb-2 text-caption', MUTED)}>People by role</h3>
              {roles.length === 0 ? <p className={cn('text-size-ui', MUTED)}>No roles assigned yet.</p> : (
                <ul className="flex flex-col gap-2">
                  {roles.slice(0, 6).map((r, i) => (
                    <li key={r.role} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_2rem] items-center gap-3 text-size-ui">
                      <span className="truncate text-[var(--ink-1)]">{r.role.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</span>
                      <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div className="dash-grow-x h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: 'color-mix(in srgb, var(--ink-3) 70%, var(--surface-3))', animationDelay: `${i * 40}ms` }} />
                      </div>
                      <span className={cn('text-right text-caption tabular-nums', MUTED)}>{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="mt-auto grid grid-cols-3 divide-x divide-[var(--line-1)] border-t border-[var(--line-1)]">
              {[
                { k: 'Sign-ins today', v: fmt(l.logins24h) },
                { k: 'This week', v: fmt(l.logins7d) },
                { k: 'Failed this week', v: fmt(l.failed7d), warn: l.failed7d > 0 },
              ].map(x => (
                <div key={x.k} className="px-4 py-3">
                  <dt className={cn('truncate text-caption', MUTED)}>{x.k}</dt>
                  <dd className={cn('mt-0.5 truncate text-size-ui font-medium tabular-nums', x.warn ? 'text-[var(--warn)]' : 'text-[var(--ink-1)]')}>{x.v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const MOTION_CSS = `
@keyframes dash-grow-x { from { transform: scaleX(0.02); } to { transform: scaleX(1); } }
@keyframes dash-grow-y { from { transform: scaleY(0.05); } to { transform: scaleY(1); } }
.dash-grow-x { transform-origin: left center; animation: dash-grow-x 600ms cubic-bezier(0.23, 1, 0.32, 1) both; }
.dash-grow-y { transform-origin: bottom center; animation: dash-grow-y 500ms cubic-bezier(0.23, 1, 0.32, 1) both; }
.dash-press { transition-property: background-color, transform; transition-duration: 160ms; transition-timing-function: ease-out; }
.dash-press:active { transform: scale(0.985); }
.dash-page { background:
  radial-gradient(640px 260px at 20% 0, color-mix(in srgb, var(--brand-a) 20%, transparent), transparent 72%); }
@media (prefers-reduced-motion: reduce) { .dash-grow-x, .dash-grow-y { animation: none; } .dash-press:active { transform: none; } }
`;

export function DashboardView({
  summary,
  displayName,
  roleLabel,
  canReadUsers,
}: {
  summary: DashboardSummary;
  displayName: string;
  roleLabel: string;
  canReadUsers: boolean;
}) {
  const { estate, memory, logins, inspector } = summary;
  const jobs = summary.jobs ?? null;
  const governance = summary.governance ?? null;
  const spend = summary.spend ?? null;

  // Greeting and date are client-derived to avoid SSR/timezone drift.
  const [mounted, setMounted] = useState(false);
  const [greeting, setGreeting] = useState('Welcome back');
  const [dateStr, setDateStr] = useState('');
  useEffect(() => {
    setMounted(true);
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
    setDateStr(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  }, []);

  const attention = buildAttention(estate, memory, logins, jobs, governance, canReadUsers);
  const urgent = attention.filter(a => a.tone !== 'info').length;
  const noData = !estate && !memory && !logins && !inspector && !jobs && !governance;
  const headline = noData
    ? 'Platform data is not available right now.'
    : urgent > 0
    ? `${urgent} ${plural(urgent, 'thing needs', 'things need')} your attention.`
    : attention.length > 0 ? 'Nothing urgent today.' : 'Everything is running smoothly.';
  const memGrowth = memory && memory.storeSeries.length > 1 ? memory.storeSeries[memory.storeSeries.length - 1] - memory.storeSeries[0] : null;
  const found = estate ? Math.max(estate.estateTotal, estate.harvested) : 0;
  const runs = jobs?.kinds.reduce((a, k) => ({
    total: a.total + k.runs7d, ok: a.ok + k.succeeded7d, failed: a.failed + k.failed7d, running: a.running + k.running,
  }), { total: 0, ok: 0, failed: 0, running: 0 });
  const finished = runs ? runs.ok + runs.failed : 0;

  return (
    <div className="dash-page h-full overflow-y-auto scrollbar-thin">
      <style>{MOTION_CSS}</style>
      <div className="relative mx-auto flex max-w-[1240px] flex-col gap-8 px-5 pb-16 pt-8 sm:px-8">
        <header className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className={cn('mb-2 text-caption', MUTED)}>
              {[mounted ? dateStr : null, roleLabel].filter(Boolean).join(' · ')}
            </p>
            <h1 className="text-title-page">
              <span className="wl-title">{greeting}, {displayName}.</span>
              <span className="block text-[var(--ink-3)]">{headline}</span>
            </h1>
          </div>
          {mounted && (
            <div className={cn('flex items-center gap-4 text-caption', MUTED)}>
              {runs && runs.running > 0 && (
                <Link href="/agent-lab/estate/jobs?tab=active" className="inline-flex items-center gap-1.5 text-[var(--ink-2)] no-underline hover:text-[var(--brand-a-ink)]">
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-[var(--brand-a)]" />
                  {runs.running} {plural(runs.running, 'job')} running
                </Link>
              )}
              <span className="inline-flex items-center gap-1.5" title={new Date(summary.generatedAt).toLocaleString()}>
                <span aria-hidden className="size-1.5 rounded-full bg-[var(--ok)]" />
                Updated {relativeTime(summary.generatedAt)}
              </span>
            </div>
          )}
        </header>

        <div className={cn(PANEL, 'grid grid-cols-1 gap-px overflow-hidden bg-[var(--line-1)] sm:grid-cols-2 lg:grid-cols-4')}>
          <Metric
            label="Searchable tables"
            href="/agent-lab/estate"
            value={estate ? fmt(estate.embedded) : '—'}
            of={estate ? `of ${fmt(found)}` : undefined}
            sub={estate ? `${pct(estate.embedded, found)}% of everything discovered` : 'Not available'}
          />
          <Metric
            label="Job success"
            href="/agent-lab/estate/jobs"
            value={runs && finished > 0 ? `${pct(runs.ok, finished)}%` : '—'}
            of={runs && finished > 0 ? 'this week' : undefined}
            sub={!jobs ? 'Not available' : runs && runs.total > 0
              ? <>{fmt(runs.total)} {plural(runs.total, 'run')}{runs.failed > 0 && <> · <span className="text-[var(--bad)]">{runs.failed} failed</span></>}</>
              : 'No runs this week'}
          />
          <Metric
            label="Active memories"
            href="/agent-lab/memory"
            value={memory ? fmt(memory.activeMemories) : '—'}
            sub={memory ? (memGrowth !== null ? `${memGrowth >= 0 ? '+' : ''}${fmt(memGrowth)} in ${memory.storeSeries.length} days · ${memory.topicCount} topics` : `${memory.topicCount} topics`) : 'Not available'}
            chart={memory ? <Sparkline data={memory.storeSeries} /> : undefined}
          />
          <Metric
            label={canReadUsers ? 'Inspector sessions' : 'My sessions'}
            href="/inspector"
            value={inspector ? fmt(inspector.sessions7d) : '—'}
            of={inspector ? 'this week' : undefined}
            sub={inspector ? (
              <span title={`All time: ${inspector.totalSessions.toLocaleString()} sessions, ${inspector.totalMessages.toLocaleString()} messages`}>
                {inspector.totalMessages >= 1_000 && inspector.totalMessages < 10_000 ? `${(inspector.totalMessages / 1_000).toFixed(1)}K` : fmt(inspector.totalMessages)} {plural(inspector.totalMessages, 'message')}{canReadUsers ? ` · ${inspector.activeUsers} ${plural(inspector.activeUsers, 'person', 'people')}` : ' all time'}
              </span>
            ) : 'Not available'}
            chart={inspector ? <DayBars data={inspector.dailyCounts} /> : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-6">
          <EstateFlow e={estate} jobs={jobs} />
          <Briefing items={attention} unavailable={noData} />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-6">
          <MemoryPanel m={memory} />
          {canReadUsers && !noData && (
            <>
              <SpendPanel s={spend} />
              <TeamPanel l={logins} />
            </>
          )}
        </div>

        <MemoryCredCard index={0} />
      </div>
    </div>
  );
}
