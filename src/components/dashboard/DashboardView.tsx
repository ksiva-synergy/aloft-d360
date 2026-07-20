'use client';

/**
 * Platform overview dashboard. A read-only, at-a-glance summary of the four core
 * modules — Data Estate, Memory (FOER), User Logins, and Inspector — rendered from
 * a server-aggregated snapshot (see src/lib/dashboard/summary.ts).
 *
 * Purely presentational: all data arrives via props. Styling follows the estate
 * design tokens (Source Serif headings, IBM Plex Mono numerals, --estate-* vars)
 * so it reads as one system in both light and dark themes.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Database, Lightbulb, Users, LayoutDashboard, ArrowRight, ArrowUpRight,
  ShieldCheck, ShieldAlert, Sparkles, Layers, Activity, Ban, Clock,
  MessageSquare, TrendingUp, CircleDot,
} from 'lucide-react';
import type {
  DashboardSummary, EstateSummary, MemorySummary, LoginsSummary, InspectorSummary,
} from '@/lib/dashboard/summary';
import { MemoryCredCard } from '@/components/dashboard/MemoryCredCard';

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

const SERIF = "'Source Serif 4', Georgia, serif";
const SANS = "'Inter Tight', sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const ACCENT = {
  estate: '#FDB515',
  memory: '#A78BFA',
  logins: '#2DD4A0',
  inspector: '#5B9DFF',
} as const;

const COVERAGE_COLORS = {
  harvested: '#2DD4A0',
  profiled: '#5B9DFF',
  enriched: '#A78BFA',
  embedded: '#FDB515',
} as const;

const cardClass =
  'rounded-xl border shadow-card transition-shadow duration-200 hover:shadow-lg';
const cardStyle: React.CSSProperties = {
  background: 'var(--estate-raised)',
  borderColor: 'var(--estate-border-gold)',
};

// ── Micro components ─────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.11em',
        textTransform: 'uppercase',
        color: 'var(--estate-text-muted)',
      }}
    >
      {children}
    </span>
  );
}

/** A small in-card metric: big mono number + label. */
function MiniStat({
  value,
  label,
  color,
  sub,
}: {
  value: React.ReactNode;
  label: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: color ?? 'var(--estate-ink)',
        }}
      >
        {value}
      </span>
      <Label>{label}</Label>
      {sub && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-dim)' }}>{sub}</span>
      )}
    </div>
  );
}

/** SVG area sparkline for a numeric series. */
function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  const width = 220;
  if (!data || data.length < 2) {
    return <div style={{ height, opacity: 0.4, fontFamily: MONO, fontSize: 11, color: 'var(--estate-text-dim)', display: 'flex', alignItems: 'center' }}>not enough history</div>;
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
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

/** Small vertical bars (e.g. sessions/day). */
function MiniBars({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
          <div
            style={{
              height: `${Math.max(6, (v / max) * 100)}%`,
              background: v > 0 ? color : 'var(--estate-border)',
              opacity: v > 0 ? 0.85 : 0.5,
              borderRadius: 3,
              transition: 'height 0.3s ease',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 66, fontFamily: MONO, fontSize: 11, color: 'var(--estate-text-secondary)' }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--estate-hover)', overflow: 'hidden', border: '1px solid var(--estate-border)' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ width: 58, textAlign: 'right', fontFamily: MONO, fontSize: 11, color: 'var(--estate-ink)' }}>
        {fmt(count)}
      </span>
      <span style={{ width: 34, textAlign: 'right', fontFamily: MONO, fontSize: 11, color }}>{p}%</span>
    </div>
  );
}

/** Card shell: icon + title + subtitle header with a "View" link, then body. */
function ModuleCard({
  title,
  subtitle,
  icon: Icon,
  accent,
  href,
  linkLabel,
  index,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
  href: string;
  linkLabel: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 * index, ease: 'easeOut' }}
      className={cardClass}
      style={{ ...cardStyle, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <span
            style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
            }}
          >
            <Icon size={18} style={{ color: accent }} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: 'var(--estate-ink)', margin: 0, lineHeight: 1.2 }}>
              {title}
            </h2>
            <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--estate-text-muted)', margin: '2px 0 0' }}>{subtitle}</p>
          </div>
        </div>
        <Link
          href={href}
          className="group"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
            fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
            borderRadius: 7, padding: '5px 10px', textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >
          {linkLabel}
          <ArrowRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
      {children}
    </motion.section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        border: '1px dashed var(--estate-border-gold)', borderRadius: 8, padding: '20px 16px',
        textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--estate-text-muted)',
      }}
    >
      {text}
    </div>
  );
}

// ── Module bodies ────────────────────────────────────────────────────────────

function EstateBody({ e }: { e: EstateSummary | null }) {
  if (!e) return <EmptyState text="Estate metrics unavailable — no data source configured" />;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <MiniStat value={fmt(e.estateTotal)} label="Objects" color={ACCENT.estate} />
        <MiniStat value={fmt(e.harvested)} label="Harvested" />
        <MiniStat value={e.sources} label={e.sources === 1 ? 'Source' : 'Sources'} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CoverageRow label="Harvested" count={e.harvested} total={e.estateTotal || e.harvested} color={COVERAGE_COLORS.harvested} />
        <CoverageRow label="Profiled" count={e.profiled} total={e.harvested} color={COVERAGE_COLORS.profiled} />
        <CoverageRow label="Enriched" count={e.enriched} total={e.harvested} color={COVERAGE_COLORS.enriched} />
        <CoverageRow label="Embedded" count={e.embedded} total={e.harvested} color={COVERAGE_COLORS.embedded} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
        <FootStat icon={Clock} text={`Swept ${relativeTime(e.lastSweepAt)}`} />
        <FootStat icon={Activity} text={`${fmt(e.queuedJobs)} queued`} tone={e.queuedJobs > 0 ? ACCENT.estate : undefined} />
        <FootStat icon={CircleDot} text={`${fmt(e.staleCount)} stale`} tone={e.staleCount > 0 ? '#F97316' : undefined} />
      </div>
    </>
  );
}

function MemoryBody({ m }: { m: MemorySummary | null }) {
  if (!m) return <EmptyState text="Memory metrics unavailable" />;
  const ratioPct = Math.round(m.helpfulRatio * 100);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <MiniStat value={fmt(m.activeMemories)} label="Active memories" color={ACCENT.memory} />
        <MiniStat value={fmt(m.coreMemories)} label="Core rules" />
        <MiniStat value={fmt(m.topicCount)} label="Topics" />
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Label>Store growth · 30d</Label>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-dim)' }}>
            {m.injectEnabled ? 'injection on' : 'injection off'}
          </span>
        </div>
        <Sparkline data={m.storeSeries} color={ACCENT.memory} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
        <FootStat icon={TrendingUp} text={`${ratioPct}% helpful`} tone={ratioPct >= 60 ? ACCENT.logins : ratioPct > 0 ? '#F97316' : undefined} />
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
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <MiniStat value={fmt(l.totalUsers)} label="Users" color={ACCENT.logins} />
        <MiniStat value={fmt(l.activeUsers)} label="Active" />
        <MiniStat value={fmt(l.logins24h)} label="Logins 24h" />
        <MiniStat value={fmt(l.failed7d)} label="Failed 7d" color={l.failed7d > 0 ? '#F97316' : undefined} />
      </div>

      {roleTotal > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label>Roles</Label>
          <div style={{ height: 8, borderRadius: 5, overflow: 'hidden', display: 'flex', border: '1px solid var(--estate-border)' }}>
            {l.roleDistribution.map((r, i) => (
              <div
                key={r.role}
                title={`${roleLabelFor(r.role)}: ${r.count}`}
                style={{ width: `${pct(r.count, roleTotal)}%`, background: ROLE_COLORS[i % ROLE_COLORS.length] }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {l.roleDistribution.map((r, i) => (
              <span key={r.role} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                {roleLabelFor(r.role)} · {r.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {canReadUsers ? (
        l.recent.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
            <Label>Recent sign-ins</Label>
            {l.recent.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.success ? <ShieldCheck size={13} style={{ color: ACCENT.logins, flexShrink: 0 }} /> : <ShieldAlert size={13} style={{ color: '#F97316', flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 12.5, color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name || r.email}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--estate-text-dim)', textTransform: 'uppercase' }}>{r.provider}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-muted)', width: 62, textAlign: 'right' }}>{relativeTime(r.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
            <FootStat icon={Clock} text={`${fmt(l.logins7d)} sign-ins in the last 7 days`} />
          </div>
        )
      ) : (
        <div style={{ borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
          <FootStat icon={Clock} text={`${fmt(l.logins7d)} sign-ins in the last 7 days`} />
        </div>
      )}
    </>
  );
}

function InspectorBody({ s, canReadUsers }: { s: InspectorSummary | null; canReadUsers: boolean }) {
  if (!s) return <EmptyState text="Inspector metrics unavailable" />;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <MiniStat value={fmt(s.totalSessions)} label={canReadUsers ? 'Sessions' : 'My sessions'} color={ACCENT.inspector} />
        <MiniStat value={fmt(s.totalMessages)} label="Messages" />
        <MiniStat value={canReadUsers ? fmt(s.activeUsers) : fmt(s.sessions7d)} label={canReadUsers ? 'Active users' : 'Last 7d'} />
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Label>Sessions · 7d</Label>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-dim)' }}>{fmt(s.sessions7d)} total</span>
        </div>
        <MiniBars data={s.dailyCounts} color={ACCENT.inspector} />
      </div>

      {s.recent.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
          <Label>Recent sessions</Label>
          {s.recent.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageSquare size={13} style={{ color: 'var(--estate-text-muted)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 12.5, color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title}
              </span>
              {canReadUsers && r.user && (
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--estate-text-dim)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.user}</span>
              )}
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-muted)' }}>{r.messageCount} msg</span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-dim)', width: 54, textAlign: 'right' }}>{relativeTime(r.at)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--estate-border)', paddingTop: 12 }}>
          <FootStat icon={MessageSquare} text="No inspector sessions yet — start one" />
        </div>
      )}
    </>
  );
}

const ROLE_COLORS = ['#003262', '#5B9DFF', '#2DD4A0', '#A78BFA', '#FDB515'];

function FootStat({ icon: Icon, text, tone }: { icon: React.ElementType; text: string; tone?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11, color: tone ?? 'var(--estate-text-secondary)' }}>
      <Icon size={13} style={{ color: tone ?? 'var(--estate-text-muted)' }} />
      {text}
    </span>
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
        className={`group block ${cardClass}`}
        style={{ ...cardStyle, padding: '16px 18px', textDecoration: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>{label}</Label>
          <span style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${accent} 14%, transparent)` }}>
            <Icon size={14} style={{ color: accent }} />
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--estate-ink)', lineHeight: 1.1, marginTop: 8 }}>
          {value}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--estate-text-muted)' }}>{sub}</span>
          <ArrowUpRight size={14} className="opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-60 group-hover:translate-x-0" style={{ color: accent }} />
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
    <div className="h-full overflow-y-auto scrollbar-thin" style={{ background: 'var(--background)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 28px 56px' }}>
        {/* ── Header ─────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}
        >
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--estate-ink)', margin: 0, lineHeight: 1.15 }}>
              {greeting}, {displayName}
            </h1>
            <p style={{ fontFamily: SANS, fontSize: 14, color: 'var(--estate-text-secondary)', margin: '6px 0 0' }}>
              Here&rsquo;s what&rsquo;s happening across your ALOFT platform.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--estate-role-badge-text)', background: 'color-mix(in srgb, #FDB515 16%, transparent)',
                border: '1px solid color-mix(in srgb, #FDB515 40%, transparent)', borderRadius: 20, padding: '4px 12px',
              }}
            >
              {roleLabel}
            </span>
            {mounted && (
              <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--estate-text-muted)' }}>{dateStr}</span>
            )}
          </div>
        </motion.header>

        {/* ── Hero KPI strip ─────────────────────────── */}
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 22 }}
        >
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: 18 }}>
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
        <div style={{ marginTop: 18 }}>
          <MemoryCredCard index={4} />
        </div>

        {/* ── Footer ─────────────────────────────────── */}
        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Layers size={12} style={{ color: 'var(--estate-text-dim)' }} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--estate-text-dim)' }}>
            ALOFT platform overview{mounted ? ` · refreshed ${relativeTime(summary.generatedAt)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
