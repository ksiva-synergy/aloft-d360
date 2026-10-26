'use client';

/**
 * Platform overview dashboard. A read-only, at-a-glance summary of the four core
 * modules — Data Estate, Memory (FOER), User Logins, and Inspector — rendered from
 * a server-aggregated snapshot (see src/lib/dashboard/summary.ts).
 *
 * Purely presentational: all data arrives via props. Styling uses the brand layer
 * (--brand-*, --surface-*, --ink-*) so it reads as one system in light and dark.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { motion } from 'framer-motion';
import {
  Database, Lightbulb, Users, LayoutDashboard, ArrowRight, ArrowUpRight,
  ShieldCheck, ShieldAlert, Sparkles, Activity, Ban, Clock,
  MessageSquare, TrendingUp, CircleDot,
} from 'lucide-react';
import type {
  DashboardSummary, EstateSummary, MemorySummary, LoginsSummary, InspectorSummary,
} from '@/lib/dashboard/summary';
import { MemoryCredCard } from '@/components/dashboard/MemoryCredCard';
import { cn } from '@/lib/utils';

// Local role-name → label map (kept in sync with ROLE_LABELS in src/lib/rbac.ts).
// Inlined rather than imported so this client bundle never pulls in server-only code.
const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Platform Admin',
  admin: 'Admin',
  member: 'Member',
  readonly: 'Read Only',
};
const roleLabelFor = (role: string) => ROLE_LABELS[role] ?? role;

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0 || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const ACCENT = {
  estate: 'var(--brand-a)',
  memory: '#0EA5A4',
  logins: '#F0553F',
  inspector: '#2563EB',
} as const;

const COVERAGE_COLORS = {
  harvested: '#0EA5A4',
  profiled: '#2563EB',
  enriched: 'var(--brand-a-2)',
  embedded: '#F59E0B',
} as const;

const ROLE_COLORS = ['var(--brand-a)', '#0EA5A4', '#F0553F', '#2563EB', '#F59E0B'];

/** Readable ink for a bright accent, in both themes (mixes the accent toward the text colour). */
const inkOf = (accent: string) => `color-mix(in srgb, ${accent} 68%, var(--ink-1))`;
const softOf = (accent: string) => `color-mix(in srgb, ${accent} 14%, transparent)`;

const card = 'rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] shadow-card';

// ── Micro components ─────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[length:var(--type-ui-regular-size)] font-semibold text-[var(--ink-3)]">{children}</span>;
}

/** A small in-card metric: big number + label. */
function MiniStat({
  value, label, color, sub,
}: { value: React.ReactNode; label: string; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[length:var(--type-kpi-lg-size)] font-semibold leading-none tracking-tight tabular-nums text-[var(--ink-1)]"
        style={color ? { color: inkOf(color) } : undefined}
      >
        {value}
      </span>
      <Label>{label}</Label>
      {sub && <span className="text-[length:var(--type-ui-regular-size)] text-[var(--ink-3)]">{sub}</span>}
    </div>
  );
}

/** SVG area sparkline for a numeric series. */
function Sparkline({ data, color, height = 52 }: { data: number[]; color: string; height?: number }) {
  const width = 220;
  if (!data || data.length < 2) {
    return <div className="flex items-center text-size-body text-[var(--ink-3)]" style={{ height }}>Not enough history yet</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const gid = `spark-${color.replace('#', '')}`;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block" role="img" aria-label="Trend over time">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.2" fill={color} />
    </svg>
  );
}

/** Small vertical bars (e.g. sessions/day). */
function MiniBars({ data, color, height = 52 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((v, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-end">
          <div
            className="rounded-md transition-[height] duration-300"
            style={{
              height: `${Math.max(8, (v / max) * 100)}%`,
              background: v > 0 ? color : 'var(--line-1)',
              opacity: v > 0 ? 0.9 : 0.6,
            }}
            title={`${v} session${v === 1 ? '' : 's'}`}
          />
        </div>
      ))}
    </div>
  );
}

/** Estate pipeline coverage row: label + progress bar + count/pct. */
function CoverageRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const p = pct(count, total);
  return (
    <div className="flex items-center gap-3 text-size-body">
      <span className="w-[74px] font-semibold text-[var(--ink-2)]">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p}%`, background: color }} />
      </div>
      <span className="w-[54px] text-right font-semibold tabular-nums text-[var(--ink-1)]">{fmt(count)}</span>
      <span className="w-[42px] text-right font-semibold tabular-nums" style={{ color: inkOf(color) }}>{p}%</span>
    </div>
  );
}

/** Card shell: icon + title + subtitle header with a "View" link, then body. */
function ModuleCard({
  title, subtitle, icon: Icon, accent, href, linkLabel, index, children,
}: {
  title: string; subtitle: string; icon: React.ElementType; accent: string;
  href: string; linkLabel: string; index: number; children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 * index, ease: 'easeOut' }}
      className={cn(card, 'flex flex-col gap-5 p-6')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: softOf(accent), color: inkOf(accent) }}
          >
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-size-title-section font-semibold tracking-tight text-[var(--ink-1)]">{title}</h2>
            <p className="truncate text-size-body text-[var(--ink-3)]">{subtitle}</p>
          </div>
        </div>
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-size-body font-semibold no-underline transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: inkOf(accent), borderColor: `color-mix(in srgb, ${accent} 40%, transparent)` }}
        >
          {linkLabel}
          <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
      {children}
    </motion.section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-[length:var(--type-body-size)] text-[var(--ink-3)]">
      {text}
    </div>
  );
}

function FootStat({ icon: Icon, text, tone }: { icon: React.ElementType; text: string; tone?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-size-body font-semibold text-[var(--ink-2)]"
      style={tone ? { color: tone } : undefined}
    >
      <Icon size={16} className={tone ? undefined : 'text-[var(--ink-3)]'} />
      {text}
    </span>
  );
}

const foot = 'flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--line-1)] pt-4';

// ── Module bodies ────────────────────────────────────────────────────────────

function EstateBody({ e }: { e: EstateSummary | null }) {
  if (!e) return <EmptyState text="Estate metrics unavailable — no data source configured" />;
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <MiniStat value={fmt(e.estateTotal)} label="Objects" color={ACCENT.estate} />
        <MiniStat value={fmt(e.harvested)} label="Harvested" />
        <MiniStat value={e.sources} label={e.sources === 1 ? 'Source' : 'Sources'} />
      </div>
      <div className="flex flex-col gap-2.5">
        <CoverageRow label="Harvested" count={e.harvested} total={e.estateTotal || e.harvested} color={COVERAGE_COLORS.harvested} />
        <CoverageRow label="Profiled" count={e.profiled} total={e.harvested} color={COVERAGE_COLORS.profiled} />
        <CoverageRow label="Enriched" count={e.enriched} total={e.harvested} color={COVERAGE_COLORS.enriched} />
        <CoverageRow label="Embedded" count={e.embedded} total={e.harvested} color={COVERAGE_COLORS.embedded} />
      </div>
      <div className={foot}>
        <FootStat icon={Clock} text={`Swept ${relativeTime(e.lastSweepAt)}`} />
        <FootStat icon={Activity} text={`${fmt(e.queuedJobs)} queued`} tone={e.queuedJobs > 0 ? 'var(--brand-a-ink)' : undefined} />
        <FootStat icon={CircleDot} text={`${fmt(e.staleCount)} stale`} tone={e.staleCount > 0 ? 'var(--warn)' : undefined} />
      </div>
    </>
  );
}

function MemoryBody({ m }: { m: MemorySummary | null }) {
  if (!m) return <EmptyState text="Memory metrics unavailable" />;
  const ratioPct = Math.round(m.helpfulRatio * 100);
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <MiniStat value={fmt(m.activeMemories)} label="Active memories" color={ACCENT.memory} />
        <MiniStat value={fmt(m.coreMemories)} label="Core rules" />
        <MiniStat value={fmt(m.topicCount)} label="Topics" />
      </div>

      <div>
        <div className="mb-2 flex justify-between">
          <Label>Store growth · 30 days</Label>
          <span className="text-size-body text-[var(--ink-3)]">{m.injectEnabled ? 'Injection on' : 'Injection off'}</span>
        </div>
        <Sparkline data={m.storeSeries} color={ACCENT.memory} />
      </div>

      <div className={foot}>
        <FootStat icon={TrendingUp} text={`${ratioPct}% helpful`} tone={ratioPct >= 60 ? 'var(--ok)' : ratioPct > 0 ? 'var(--warn)' : undefined} />
        <FootStat icon={Sparkles} text={`${fmt(m.injectedLast24h)} injected 24h`} />
        <FootStat icon={Ban} text={`${fmt(m.phantomsBlocked7d)} phantoms 7d`} />
        <FootStat icon={Clock} text={`Synth ${relativeTime(m.lastSynthesisAt)}`} />
      </div>
    </>
  );
}

function LoginsBody({ l, canReadUsers }: { l: LoginsSummary | null; canReadUsers: boolean }) {
  if (!l) return <EmptyState text="Login metrics unavailable" />;
  const roleTotal = l.roleDistribution.reduce((s, r) => s + r.count, 0);
  const sevenDay = (
    <div className={foot}>
      <FootStat icon={Clock} text={`${fmt(l.logins7d)} sign-ins in the last 7 days`} />
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat value={fmt(l.totalUsers)} label="Users" color={ACCENT.logins} />
        <MiniStat value={fmt(l.activeUsers)} label="Active" />
        <MiniStat value={fmt(l.logins24h)} label="Logins 24h" />
        <MiniStat value={fmt(l.failed7d)} label="Failed 7d" color={l.failed7d > 0 ? '#D97706' : undefined} />
      </div>

      {roleTotal > 0 && (
        <div className="flex flex-col gap-2.5">
          <Label>Roles</Label>
          <div className="flex h-3 overflow-hidden rounded-full bg-[var(--surface-3)]">
            {l.roleDistribution.map((r, i) => (
              <div
                key={r.role}
                title={`${roleLabelFor(r.role)}: ${r.count}`}
                style={{ width: `${pct(r.count, roleTotal)}%`, background: ROLE_COLORS[i % ROLE_COLORS.length] }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {l.roleDistribution.map((r, i) => (
              <span key={r.role} className="inline-flex items-center gap-1.5 text-size-body font-semibold text-[var(--ink-2)]">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                {roleLabelFor(r.role)} · {r.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {canReadUsers && l.recent.length > 0 ? (
        <div className="flex flex-col gap-2.5 border-t border-[var(--line-1)] pt-4">
          <Label>Recent sign-ins</Label>
          {l.recent.map((r, i) => (
            <div key={i} className="flex items-center gap-3 text-[length:var(--type-body-size)]">
              {r.success
                ? <ShieldCheck size={17} className="shrink-0 text-[var(--ok)]" />
                : <ShieldAlert size={17} className="shrink-0 text-[var(--warn)]" />}
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--ink-1)]">{r.name || r.email}</span>
              <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-size-ui font-semibold uppercase text-[var(--ink-2)]">{r.provider}</span>
              <span className="w-[70px] text-right text-size-body text-[var(--ink-3)]">{relativeTime(r.at)}</span>
            </div>
          ))}
        </div>
      ) : (
        sevenDay
      )}
    </>
  );
}

function InspectorBody({ s, canReadUsers }: { s: InspectorSummary | null; canReadUsers: boolean }) {
  if (!s) return <EmptyState text="Inspector metrics unavailable" />;
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <MiniStat value={fmt(s.totalSessions)} label={canReadUsers ? 'Sessions' : 'My sessions'} color={ACCENT.inspector} />
        <MiniStat value={fmt(s.totalMessages)} label="Messages" />
        <MiniStat value={canReadUsers ? fmt(s.activeUsers) : fmt(s.sessions7d)} label={canReadUsers ? 'Active users' : 'Last 7 days'} />
      </div>

      <div>
        <div className="mb-2 flex justify-between">
          <Label>Sessions · 7 days</Label>
          <span className="text-size-body text-[var(--ink-3)]">{fmt(s.sessions7d)} total</span>
        </div>
        <MiniBars data={s.dailyCounts} color={ACCENT.inspector} />
      </div>

      {s.recent.length > 0 ? (
        <div className="flex flex-col gap-2.5 border-t border-[var(--line-1)] pt-4">
          <Label>Recent sessions</Label>
          {s.recent.map((r, i) => (
            <div key={i} className="flex items-center gap-3 text-[length:var(--type-body-size)]">
              <MessageSquare size={17} className="shrink-0 text-[var(--ink-3)]" />
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--ink-1)]">{r.title}</span>
              {canReadUsers && r.user && (
                <span className="max-w-[110px] truncate text-size-body text-[var(--ink-3)]">{r.user}</span>
              )}
              <span className="text-size-body text-[var(--ink-3)]">{r.messageCount} msg</span>
              <span className="w-[60px] text-right text-size-body text-[var(--ink-3)]">{relativeTime(r.at)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={foot}>
          <FootStat icon={MessageSquare} text="No inspector sessions yet — start one" />
        </div>
      )}
    </>
  );
}

// ── Hero KPI tile ────────────────────────────────────────────────────────────

function KpiTile({
  label, value, sub, icon: Icon, accent, href, index,
}: {
  label: string; value: string; sub: string; icon: React.ElementType; accent: string; href: string; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.04 * index, ease: 'easeOut' }}
    >
      <Link
        href={href}
        className={cn(card, 'group block p-5 no-underline transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--line-2)] hover:shadow-pop')}
      >
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: softOf(accent), color: inkOf(accent) }}
          >
            <Icon size={19} />
          </span>
        </div>
        <div className="mt-3 text-[length:var(--type-display-size)] font-semibold leading-none tracking-tight tabular-nums text-[var(--ink-1)]">
          {value}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-size-body text-[var(--ink-3)]">{sub}</span>
          <ArrowUpRight
            size={17}
            className="shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-70"
            style={{ color: inkOf(accent) }}
          />
        </div>
      </Link>
    </motion.div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

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

  // Time-of-day greeting + dates are client-derived to avoid SSR/timezone drift.
  const [mounted, setMounted] = useState(false);
  const [greeting, setGreeting] = useState('Welcome back');
  const [dateStr, setDateStr] = useState('');
  useEffect(() => {
    setMounted(true);
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
    setDateStr(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  }, []);

  return (
    <div className="relative h-full overflow-y-auto scrollbar-thin">
      {/* Soft brand glow behind the page header */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 h-72 w-[60%] opacity-50 blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side at 70% 30%, var(--brand-a-soft), transparent), radial-gradient(closest-side at 20% 70%, var(--brand-b-soft), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-[1280px] px-5 pb-16 pt-8 sm:px-8">
        {/* ── Header ─────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mb-8 flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <h1 className="text-[length:var(--type-display-size)] font-semibold leading-tight tracking-tight text-[var(--ink-1)] sm:text-size-display">
              {greeting}, {displayName} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-1.5 text-size-body-lg text-[var(--ink-3)]">
              Here&rsquo;s what&rsquo;s happening across your ALOFT platform.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[var(--brand-a-soft)] px-4 py-1.5 text-size-body font-semibold text-[var(--brand-a-ink)]">
              {roleLabel}
            </span>
            {mounted && <span className="text-size-body font-semibold text-[var(--ink-3)]">{dateStr}</span>}
          </div>
        </motion.header>

        {/* ── Hero KPI strip ─────────────────────────── */}
        <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
          <KpiTile index={0} label="Data Estate" icon={Database} accent={ACCENT.estate} href="/agent-lab/estate"
            value={fmt(estate?.estateTotal ?? 0)} sub={`${fmt(estate?.harvested ?? 0)} harvested · ${estate?.sources ?? 0} sources`} />
          <KpiTile index={1} label="Memory" icon={Lightbulb} accent={ACCENT.memory} href="/agent-lab/memory"
            value={fmt(memory?.activeMemories ?? 0)} sub={`${fmt(memory?.coreMemories ?? 0)} core · ${fmt(memory?.topicCount ?? 0)} topics`} />
          <KpiTile index={2} label={canReadUsers ? 'Users' : 'Team'} icon={Users} accent={ACCENT.logins} href="/agent-staging/users"
            value={fmt(logins?.totalUsers ?? 0)} sub={`${fmt(logins?.logins24h ?? 0)} logins today`} />
          <KpiTile index={3} label="Inspector" icon={LayoutDashboard} accent={ACCENT.inspector} href="/inspector"
            value={fmt(inspector?.totalSessions ?? 0)} sub={`${fmt(inspector?.sessions7d ?? 0)} this week`} />
        </div>

        {/* ── Module grid ────────────────────────────── */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-5">
          <ModuleCard index={0} title="Data Estate" subtitle="Mendeleev context coverage" icon={Database} accent={ACCENT.estate} href="/agent-lab/estate" linkLabel="Explore">
            <EstateBody e={estate} />
          </ModuleCard>

          <ModuleCard index={1} title="Memory" subtitle="FOER agent learning" icon={Lightbulb} accent={ACCENT.memory} href="/agent-lab/memory" linkLabel="Inspect">
            <MemoryBody m={memory} />
          </ModuleCard>

          <ModuleCard index={2} title="User Logins" subtitle="Access & authentication" icon={Users} accent={ACCENT.logins} href="/agent-staging/users" linkLabel="Manage">
            <LoginsBody l={logins} canReadUsers={canReadUsers} />
          </ModuleCard>

          <ModuleCard index={3} title="Inspector" subtitle="Analysis workbench activity" icon={LayoutDashboard} accent={ACCENT.inspector} href="/inspector" linkLabel="Open">
            <InspectorBody s={inspector} canReadUsers={canReadUsers} />
          </ModuleCard>
        </div>

        {/* ── Memory cred leaderboard ─────────────────── */}
        <div className="mt-5">
          <MemoryCredCard index={4} />
        </div>

        {/* ── Footer ─────────────────────────────────── */}
        <p className="mt-6 text-size-body text-[var(--ink-3)]">
          ALOFT platform overview{mounted ? ` · refreshed ${relativeTime(summary.generatedAt)}` : ''}
        </p>
      </div>
    </div>
  );
}
