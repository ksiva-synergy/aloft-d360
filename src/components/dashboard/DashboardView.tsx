'use client';

/**
 * Platform home dashboard: a read-only briefing of Data Estate, Memory, people (sign-ins)
 * and Inspector, rendered from a server-aggregated snapshot (src/lib/dashboard/summary.ts).
 *
 * Layout: workspace briefing → key metrics → prioritized actions and explained data readiness →
 * memory, AI spend and team (admins only) → memory cred. All actions navigate to existing workflows.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import {
  ArrowRight, ChevronRight, Database, Activity, Brain, MessagesSquare, AlertCircle, ArrowUpRight, CheckCircle2, Clock3,
} from 'lucide-react';
import type {
  DashboardSummary, EstateSummary, MemorySummary, LoginsSummary, JobsSummary,
  GovernanceSummary, SpendSummary,
} from '@/lib/dashboard/summary';
import { MemoryCredCard } from '@/components/dashboard/MemoryCredCard';
import { ESTATE_STAGE } from '@/lib/estate/stages';
import { cn } from '@/lib/utils';
import styles from './DashboardView.module.css';

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
  if (!k.lastFinishedAt) return { tone: 'idle', text: 'Never finished' };
  if (!['completed', 'succeeded', 'success', 'done'].includes(k.lastStatus ?? '')) return { tone: 'idle', text: `${k.lastStatus ?? 'Unknown status'} · ${relativeTime(k.lastFinishedAt)}` };
  return { tone: 'ok', text: `Ran ${relativeTime(k.lastFinishedAt)}` };
}

const JOB_DOT: Record<ReturnType<typeof jobState>['tone'], string> = {
  ok: 'var(--ok)', bad: 'var(--bad)', warn: 'var(--warn)', live: 'var(--brand-a)', idle: 'var(--line-2)',
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
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="shrink-0 text-base font-semibold text-[var(--ink-1)]">{title}</h2>
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
      className={cn(styles.metric, 'dash-press group')}
    >
      <span className="flex items-center gap-1 text-caption font-medium text-[var(--ink-2)]">
        <span className={styles.metricIcon}>{label === 'Searchable tables' ? <Database size={16} /> : label === 'Job success' ? <Activity size={16} /> : label === 'Active memories' ? <Brain size={16} /> : <MessagesSquare size={16} />}</span>
        {label}
        <ArrowRight className="size-3 -translate-x-1 text-[var(--ink-3)] opacity-0 transition duration-hover group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
      </span>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={cn(NUM, 'text-kpi-lg leading-none')}>{value}</span>
            {of && <span className={cn('truncate text-size-ui tabular-nums', MUTED)}>{of}</span>}
          </div>
          <div className={cn('mt-2 text-caption tabular-nums', MUTED)}>{sub}</div>
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

const SEVERITY: Record<Tone, string> = { bad: 'Needs action', warn: 'Review', info: 'Follow up' };
function attentionDetail(item: Attention) {
  if (item.key.startsWith('job-')) return 'Inspect the failed run and its error before retrying.';
  if (item.key === 'pii') return 'Confirm or dismiss detected personal data in the catalog.';
  if (item.key === 'stale') return 'Review changed tables to keep agent context current.';
  if (item.key === 'semantic') return 'Check proposed business definitions before approving them.';
  if (item.key === 'memjob' || item.key === 'unprocessed') return 'Review memory processing so agents can learn from recent work.';
  if (item.key === 'queued') return 'Check which jobs are queued and what is running.';
  if (item.key === 'failed') return 'Review sign-in activity for access problems.';
  return 'Open the related workspace to review the details.';
}

function Briefing({ items, unavailable }: { items: Attention[]; unavailable?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<Tone | 'all'>('all');
  const filtered = filter === 'all' ? items : items.filter(item => item.tone === filter);
  const shown = showAll ? filtered : filtered.slice(0, 3);
  return <section className={styles.attention} id="dashboard-attention" aria-label="Your action list">
    <div className={styles.sectionHeading}>
      <div><span className={styles.eyebrow}>START HERE</span><h2>Your action list <span className={styles.count}>{items.length}</span></h2></div>
      <AlertCircle size={19} aria-hidden />
    </div>
    <p className={styles.sectionDescription}>Issues to resolve and reviews to complete, ordered by priority.</p>
    {!unavailable && items.length > 0 && <div className={styles.filters} aria-label="Filter action list">
      {(['all', 'bad', 'warn', 'info'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value}
        onClick={() => { setFilter(value); setShowAll(false); }}>
        {value === 'all' ? 'All' : value === 'bad' ? 'Failures' : value === 'warn' ? 'Reviews' : 'Follow-ups'}
        <span>{value === 'all' ? items.length : items.filter(item => item.tone === value).length}</span>
      </button>)}
    </div>}
    {unavailable ? <Unavailable what="The action list" /> : items.length === 0 ? <div className={styles.empty}>
      <CheckCircle2 size={24} /><strong>No issues reported</strong><p>Available data has no pending alerts. Check unavailable sections separately.</p>
    </div> : <>
      <ul className={styles.actions}>{shown.map(item => <li key={item.key}>
        <Link href={item.href} className={styles.action}>
          <span className={styles.severity} data-tone={item.tone}>{SEVERITY[item.tone]}</span>
          <strong>{item.text}</strong><p>{attentionDetail(item)}</p>
          <span className={styles.actionLink}>{item.action === 'Open' ? 'Inspect job' : item.action === 'Review' ? 'Review details' : `Open ${item.action.toLowerCase()}`} <ArrowUpRight size={14} aria-hidden /></span>
        </Link>
      </li>)}</ul>
      {filtered.length === 0 && <p className={styles.sectionDescription}>No items in this category.</p>}
      {filtered.length > 3 && <button className={styles.showMore} type="button" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer items' : `View all ${filtered.length} items`} <ChevronRight size={15} /></button>}
    </>}
  </section>;
}

// ── Data estate flow ─────────────────────────────────────────────────────────

function EstateFlow({ e, jobs }: { e: EstateSummary | null; jobs: JobsSummary | null }) {
  if (!e) return <section className={styles.readiness}><h2>Data readiness</h2><Unavailable what="Estate coverage" /></section>;
  const found = Math.max(e.estateTotal, e.harvested);
  const stages = [
    { stage: ESTATE_STAGE.discovered, count: found, label: 'Discovered', detail: 'Tables found across connected sources' },
    { stage: ESTATE_STAGE.scanned, count: e.harvested, label: 'Structure scanned', detail: 'Columns and schema captured · T0' },
    { stage: ESTATE_STAGE.profiled, count: e.profiled, label: 'Data profiled', detail: 'Data characteristics collected · T1' },
    { stage: ESTATE_STAGE.enriched, count: e.enriched, label: 'Business context added', detail: 'Meaning and descriptions prepared · T2' },
    { stage: ESTATE_STAGE.searchable, count: e.embedded, label: 'Searchable by agents', detail: 'Descriptions indexed for retrieval · Embed' },
  ];
  const gaps = stages.slice(1).map((stage, i) => Math.max(0, stages[i].count - stage.count));
  const biggest = Math.max(...gaps);
  const gapIndex = gaps.indexOf(biggest);
  const stageKinds = new Set(Object.values(STAGE_JOB));
  const otherJobs = (jobs?.kinds ?? []).filter(k => !stageKinds.has(k.kind) && JOB_LABELS[k.kind]);
  return <section className={styles.readiness} aria-label="Data readiness">
    <div className={styles.sectionHeading}>
      <div><span className={styles.eyebrow}>FROM SOURCE TO ANSWER</span><h2>Data readiness</h2></div>
      <Link href="/agent-lab/estate" className={styles.textLink}>Explore estate <ArrowUpRight size={15} /></Link>
    </div>
    <p className={styles.sectionDescription}>{e.sources} connected {plural(e.sources, 'source')} · Last scan {relativeTime(e.lastSweepAt)}</p>
    <div className={styles.coverage}>
      <div><strong>{found ? `${pct(e.embedded, found)}%` : '—'}</strong><span>of discovered tables are searchable</span></div>
      <p>{e.embedded.toLocaleString()} of {found.toLocaleString()} tables</p>
      <div className={styles.coverageTrack} role="img" aria-label={`${e.embedded} of ${found} discovered tables are searchable`}><span style={{ width: `${pct(e.embedded, found)}%` }} /></div>
    </div>
    <ol className={styles.pipeline}>
      {stages.map((item, i) => {
        const kind = STAGE_JOB[item.stage.key];
        const status = jobs ? jobState(jobs.kinds.find(k => k.kind === kind)) : null;
        return <li key={item.stage.key}>
          <span className={styles.stepNumber}>{String(i + 1).padStart(2, '0')}</span>
          <div className={styles.stageLabel}><strong>{item.label}</strong><span>{item.detail}</span></div>
          <div className={styles.stageValue}><strong>{item.count.toLocaleString()}</strong>
            <div className={styles.stageTrack}><span style={{ width: `${pct(item.count, found)}%`, background: item.stage.color }} /></div>
          </div>
          <Link href={jobHref(kind)} className={styles.stageStatus} style={{ color: status ? JOB_DOT[status.tone] : undefined }}>
            {status?.text ?? 'Job status unavailable'} <ChevronRight size={12} aria-hidden />
          </Link>
        </li>;
      })}
    </ol>
    <p className={styles.stageNote}>Stages show cumulative coverage, not separate groups of tables.</p>
    {biggest > 0 && <div className={styles.nextStep}>
      <ArrowRight size={18} aria-hidden /><div><strong>Largest coverage gap: {stages[gapIndex + 1].label.toLowerCase()}</strong>
      <p>{biggest.toLocaleString()} fewer tables than the preceding stage. Review scope and job results before continuing.</p></div>
      <Link href={jobHref(STAGE_JOB[stages[gapIndex + 1].stage.key])}>Review <ArrowUpRight size={14} /></Link>
    </div>}
    {!found && <p className={styles.sectionDescription}>No tables discovered yet. Open the estate to review your connected sources.</p>}
    {otherJobs.length > 0 && <details className={styles.otherJobs}><summary>Supporting jobs <span>{otherJobs.length}</span></summary>
      <ul>{otherJobs.map(k => { const status = jobState(k); return <li key={k.kind}><Link href={jobHref(k.kind)}><span>{jobLabel(k.kind)}</span><span style={{ color: JOB_DOT[status.tone] }}>{status.text} <ChevronRight size={12} /></span></Link></li>; })}</ul>
    </details>}
  </section>;
}

// ── Memory ───────────────────────────────────────────────────────────────────

function MemoryPanel({ m }: { m: MemorySummary | null }) {
  return (
    <Section title="What your agents are learning" meta={m ? (m.injectEnabled ? 'In use by agents' : 'Not in use') : undefined} href="/agent-lab/memory" className="lg:col-span-12">
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
                    <div className="text-caption text-[var(--ink-2)]">Memory helpfulness</div>
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
                <h3 className={cn('mb-2 text-caption', MUTED)}>Most remembered topics</h3>
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
  const memGrowth = memory && memory.storeSeries.length > 1 ? memory.storeSeries[memory.storeSeries.length - 1] - memory.storeSeries[0] : null;
  const found = estate ? Math.max(estate.estateTotal, estate.harvested) : 0;
  const runs = jobs?.kinds.reduce((a, k) => ({
    total: a.total + k.runs7d, ok: a.ok + k.succeeded7d, failed: a.failed + k.failed7d, running: a.running + k.running,
  }), { total: 0, ok: 0, failed: 0, running: 0 });
  const finished = runs ? runs.ok + runs.failed : 0;

  return (
    <div className={cn(styles.page, 'h-full overflow-y-auto scrollbar-thin')}>
      <style>{MOTION_CSS}</style>
      <div className={styles.container}>
        <header className={styles.hero}>
          <div>
            <div className={styles.heroMeta}><span className={styles.eyebrow}>WORKSPACE OVERVIEW</span><span>{roleLabel}</span></div>
            <p className={styles.greeting}>{greeting}, {displayName}.</p>
            <h1>Your platform, today.</h1>
            <p className={styles.heroDescription}>Your data, agent activity, and operational priorities in one place.</p>
            <div className={styles.heroLinks}><Link href="/inspector">Ask Inspector <ArrowUpRight size={16} /></Link><a href="#dashboard-attention">Review action list <ArrowRight size={15} /></a></div>
          </div>
          <div className={styles.heroBrief}>
            <div className={styles.briefHeading}><Clock3 size={15} /><span>{mounted ? dateStr : 'Today’s briefing'}</span></div>
            <strong>{noData ? 'Snapshot unavailable' : urgent > 0 ? `${urgent} items need attention` : 'No urgent issues reported'}</strong>
            <p>{noData ? 'Some services could not be reached. Unavailable metrics are marked below.' : urgent > 0 ? 'Start with failed jobs, then review data quality and overdue work.' : 'Review follow-ups and data coverage to plan your next step.'}</p>
            {runs && runs.running > 0 && <Link href="/agent-lab/estate/jobs?tab=active" className={styles.running}><span />{runs.running} {plural(runs.running, 'job')} running <ArrowUpRight size={13} /></Link>}
            {mounted && <span className={styles.updated} title={new Date(summary.generatedAt).toLocaleString()}>Snapshot updated {relativeTime(summary.generatedAt)}</span>}
          </div>
        </header>

        <div className={styles.metrics} aria-label="Key metrics">
          <Metric
            label="Searchable tables"
            href="/agent-lab/estate"
            value={estate ? fmt(estate.embedded) : '—'}
            of={estate ? `of ${fmt(found)}` : undefined}
            sub={estate ? `${pct(estate.embedded, found)}% coverage · ready for retrieval` : 'Not available'}
          />
          <Metric
            label="Job success"
            href="/agent-lab/estate/jobs"
            value={runs && finished > 0 ? `${pct(runs.ok, finished)}%` : '—'}
            of={runs && finished > 0 ? 'last 7 days' : undefined}
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
            of={inspector ? 'last 7 days' : undefined}
            sub={inspector ? (
              <span title={`All time: ${inspector.totalSessions.toLocaleString()} sessions, ${inspector.totalMessages.toLocaleString()} messages`}>
                {inspector.totalMessages >= 1_000 && inspector.totalMessages < 10_000 ? `${(inspector.totalMessages / 1_000).toFixed(1)}K` : fmt(inspector.totalMessages)} {plural(inspector.totalMessages, 'message')} all time{canReadUsers ? ` · ${inspector.activeUsers} ${plural(inspector.activeUsers, 'person', 'people')}` : ''}
              </span>
            ) : 'Not available'}
            chart={inspector ? <DayBars data={inspector.dailyCounts} /> : undefined}
          />
        </div>

        <div className={styles.mainGrid}>
          <Briefing items={attention} unavailable={noData} />
          <EstateFlow e={estate} jobs={jobs} />
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
