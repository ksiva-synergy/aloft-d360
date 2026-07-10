'use client';

/**
 * FoerStoryDashboard.tsx — FOER-1: Story page shell, hero, KPIs, filters.
 *
 * Design tokens from foer-tokens.ts (no hardcoded hex).
 * React Query for server state; URL search params for filter/view state.
 * Theme follows global sidebar toggle via next-themes; CSS variables drive styling.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Loader2 } from 'lucide-react';
import type { StatsResponse } from '@/lib/foer/types';
import { DistillationStage } from './DistillationStage';
import { KeeperChoicePanel } from './KeeperChoicePanel';
import { ShelvesPanel } from './ShelvesPanel';
import { MemoryDrawer } from './MemoryDrawer';
import { ForgettingPanel } from './ForgettingPanel';
import { MountPanel } from './MountPanel';
import { EasterEggs } from './EasterEggs';
import { CollapseGuardrail } from './CollapseGuardrail';
import {
  GOLD,
  NAVY,
  SERIF,
  BODY,
  MONO,
  RULE_TYPE_COLORS,
  TOPIC_COLORS,
  topicColor,
} from '@/lib/foer/foer-tokens';

// ── One QueryClient per mount (not module-level to avoid SSR issues) ──────────
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } });
}

// ── Query function ─────────────────────────────────────────────────────────────
async function fetchMemoryStats(): Promise<StatsResponse> {
  const res = await fetch('/api/agent-lab/memory/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<StatsResponse>;
}

// ── Filter constants ───────────────────────────────────────────────────────────
const WINDOWS = [
  { label: '7d',  value: '7'  },
  { label: '14d', value: '14' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
] as const;

const RULE_TYPES = [
  { label: 'All',          value: ''            },
  { label: 'Hard Rule',    value: 'HARD_RULE'   },
  { label: 'Schema Map',   value: 'SCHEMA_MAP'  },
  { label: 'Heuristic',    value: 'HEURISTIC'   },
  { label: 'Source Pref',  value: 'SOURCE_PREF' },
  { label: 'Failure Mode', value: 'FAILURE_MODE'},
] as const;

// ── Section placeholders (distillation replaced by DistillationStage) ─────────
const PLACEHOLDER_SECTIONS = [
  { id: 'shelves', title: 'The Shelves' },
  { id: 'grow-refine', title: 'Grow & Refine' },
] as { id: string; title: string }[];

// ── Utility: format lastSynthesisAt ───────────────────────────────────────────
function formatSynthesisAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const timeStr = `${hh}:${mm} UTC`;
  if (diffH < 1) return `${timeStr} · <1h ago`;
  return `${timeStr} · ${diffH}h ago`;
}

// ── KPI card data builder ─────────────────────────────────────────────────────
interface KpiDef {
  id: string;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

function buildKpis(stats: StatsResponse): KpiDef[] {
  const ratio = typeof stats.helpfulHarmfulRatio === 'number' && !isNaN(stats.helpfulHarmfulRatio)
    ? stats.helpfulHarmfulRatio
    : 0;

  return [
    {
      id:     'core-memories',
      label:  'Core Memories',
      value:  stats.coreMemories.toLocaleString(),
      sub:    'HARD_RULE · always mounted',
      accent: GOLD,
    },
    {
      id:     'shelved',
      label:  'Shelved',
      value:  stats.activeBullets.toLocaleString(),
      sub:    'active bullets total',
      accent: RULE_TYPE_COLORS.HEURISTIC,
    },
    {
      id:     'sessions',
      label:  'Sessions Sensed',
      value:  stats.tracedSessions.toLocaleString(),
      sub:    'traced sessions',
      accent: RULE_TYPE_COLORS.SOURCE_PREF,
    },
    {
      id:     'ratio',
      label:  'Helpful : Harmful',
      value:  ratio.toFixed(2),
      sub:    `${stats.helpfulTotal} helpful · ${stats.harmfulTotal} harmful`,
      accent: ratio >= 0.7
        ? TOPIC_COLORS[3]
        : ratio >= 0.5
        ? TOPIC_COLORS[5]
        : RULE_TYPE_COLORS.FAILURE_MODE,
    },
    {
      id:     'last-distillation',
      label:  'Last Distillation',
      value:  formatSynthesisAt(stats.lastSynthesisAt),
      sub:    stats.lastSynthesisAt ? 'synthesis run' : 'no run yet',
      accent: RULE_TYPE_COLORS.SCHEMA_MAP,
    },
  ];
}

// ── Theme detection helper ─────────────────────────────────────────────────────

// ── CSS variable themes ───────────────────────────────────────────────────────
const DARK_THEME = {
  '--foer-bg':          '#05090f',
  '--foer-surface':     '#0b1017',
  '--foer-surface2':    '#111822',
  '--foer-border':      'rgba(253,181,21,0.12)',
  '--foer-border-dim':  'rgba(255,255,255,0.07)',
  '--foer-text-pri':    '#F0F4F8',
  '--foer-text-sec':    '#8BAFC8',
  '--foer-text-mut':    '#4A6080',
  '--foer-gold':        '#FDB515',
  '--foer-wordmark':    '#FDB515',
  '--foer-pill-bg':     'rgba(253,181,21,0.10)',
  '--foer-pill-active': 'rgba(253,181,21,0.20)',
  '--foer-filter-bg':   'rgba(255,255,255,0.04)',
  '--foer-filter-active':'rgba(253,181,21,0.15)',
  '--foer-card-bg':     '#0d1520',
  '--foer-placeholder-bg': '#0b1017',
} as const;

const LIGHT_THEME = {
  '--foer-bg':          '#F8F5EE',
  '--foer-surface':     '#EFEBE0',
  '--foer-surface2':    '#E7E1D4',
  '--foer-border':      'rgba(0,50,98,0.14)',
  '--foer-border-dim':  'rgba(0,50,98,0.08)',
  '--foer-text-pri':    '#0D1B2A',
  '--foer-text-sec':    '#2C3E50',
  '--foer-text-mut':    '#5A6A7A',
  '--foer-gold':        '#FDB515',
  '--foer-wordmark':    '#003262',
  '--foer-pill-bg':     'rgba(0,50,98,0.08)',
  '--foer-pill-active': 'rgba(0,50,98,0.18)',
  '--foer-filter-bg':   'rgba(0,50,98,0.04)',
  '--foer-filter-active':'rgba(0,50,98,0.12)',
  '--foer-card-bg':     '#FFFFFF',
  '--foer-placeholder-bg': '#EFEBE0',
} as const;

// ── Inner dashboard (needs Suspense for useSearchParams) ──────────────────────
function FoerStoryInner() {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  // ── Theme state — synced with global sidebar toggle via next-themes ──────────
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== 'light';

  const theme = dark ? DARK_THEME : LIGHT_THEME;

  // ── Filter state from URL ─────────────────────────────────────────────────
  const topicParam    = searchParams.get('topic')    ?? '';
  const windowParam   = searchParams.get('window')   ?? '30';
  const ruleTypeParam = searchParams.get('ruleType') ?? '';

  function updateParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  // ── React Query ───────────────────────────────────────────────────────────
  const { data: stats, isLoading, isError } = useQuery<StatsResponse>({
    queryKey:  ['foer-memory-stats'],
    queryFn:   fetchMemoryStats,
    staleTime: 60_000,
  });

  // ── Topic options derived from stats ──────────────────────────────────────
  const topicOptions = useMemo(() => {
    if (!stats) return [{ label: 'All', value: '' }];
    return [
      { label: 'All', value: '' },
      ...stats.topics.map((t) => ({ label: t.topicName, value: t.topicKey })),
    ];
  }, [stats]);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => (stats ? buildKpis(stats) : null), [stats]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const cssVars = Object.entries(theme)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

  return (
    <div
      className="foer"
      data-foer-theme={dark ? 'dark' : 'light'}
      style={{
        // Inline CSS vars so all children inherit via var()
        ...Object.fromEntries(Object.entries(theme)),
        minHeight:   '100vh',
        background:  'var(--foer-bg)',
        fontFamily:  BODY,
        color:       'var(--foer-text-pri)',
        paddingBottom: '6rem',
        position:    'relative',
        WebkitFontSmoothing: 'antialiased',
        textRendering: 'optimizeLegibility',
        lineHeight:  1.5,
      }}
    >
      <EasterEggs />
      {/* Injected CSS for @keyframes and utility classes */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;1,400;1,600&family=Inter+Tight:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        [data-foer-theme] * { box-sizing: border-box; }

        @keyframes foer-pulse-gold {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1.0; }
        }

        @keyframes foer-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }

        .foer-kpi-card {
          background:    var(--foer-card-bg);
          border:        1px solid var(--foer-border);
          border-radius: 6px;
          padding:       16px 16px 14px;
          transition:    border-color 0.2s, transform 0.15s;
          animation:     foer-fade-in 0.35s ease both;
        }
        .foer-kpi-card:hover {
          border-color: var(--foer-gold);
          transform:    translateY(-1px);
        }

        .foer-filter-btn {
          background:    var(--foer-filter-bg);
          border:        1px solid var(--foer-border-dim);
          border-radius: 4px;
          padding:       0.3rem 0.75rem;
          font-size:     0.75rem;
          font-family:   ${MONO};
          color:         var(--foer-text-sec);
          cursor:        pointer;
          transition:    background 0.15s, color 0.15s, border-color 0.15s;
          white-space:   nowrap;
        }
        .foer-filter-btn:hover,
        .foer-filter-btn[data-active='true'] {
          background:    var(--foer-filter-active);
          color:         var(--foer-text-pri);
          border-color:  var(--foer-gold);
        }

        .foer-select {
          background:    var(--foer-filter-bg);
          border:        1px solid var(--foer-border-dim);
          border-radius: 4px;
          padding:       0.3rem 0.65rem;
          font-size:     0.75rem;
          font-family:   ${MONO};
          color:         var(--foer-text-sec);
          cursor:        pointer;
          outline:       none;
          transition:    border-color 0.15s;
          appearance:    none;
          -webkit-appearance: none;
        }
        .foer-select:focus {
          border-color: var(--foer-gold);
          color:        var(--foer-text-pri);
        }

        .foer-section-placeholder {
          background:    var(--foer-placeholder-bg);
          border:        1px dashed var(--foer-border-dim);
          border-radius: 6px;
          padding:       2.5rem 2rem;
          display:       flex;
          align-items:   center;
          gap:           1rem;
        }

        .foer-skeleton {
          background:    var(--foer-surface);
          border-radius: 4px;
          animation:     foer-pulse-gold 1.6s ease-in-out infinite;
        }
      `}</style>

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          position:       'sticky',
          top:            0,
          zIndex:         20,
          display:        'flex',
          justifyContent: 'flex-end',
          alignItems:     'center',
          gap:            '1.25rem',
          padding:        '0.75rem 2rem',
          background:     dark
            ? 'linear-gradient(to bottom, rgba(5,9,15,0.98) 0%, rgba(5,9,15,0.80) 100%)'
            : 'linear-gradient(to bottom, rgba(248,245,238,0.98) 0%, rgba(248,245,238,0.80) 100%)',
          backdropFilter: 'blur(8px)',
          borderBottom:   '1px solid var(--foer-border-dim)',
        }}
      >
        <Link
          href="/agent-lab/memory/ops"
          style={{
            fontFamily:     BODY,
            fontSize:       '13px',
            color:          'var(--foer-text-mut)',
            textDecoration: 'none',
            transition:     'color 0.15s',
            alignSelf:      'center',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--foer-text-pri)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--foer-text-mut)')}
        >
          View nightly run log →
        </Link>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section
        id="foer-hero"
        style={{
          maxWidth:  '1180px',
          margin:    '0 auto',
          padding:   '64px 32px 52px',
          animation: 'foer-fade-in 0.5s ease both',
        }}
      >
        {/* Kicker */}
        <p
          id="foer-kicker"
          style={{
            fontFamily:    MONO,
            fontSize:      '11px',
            letterSpacing: '0.28em',
            color:         'var(--foer-text-mut)',
            textTransform: 'uppercase',
            marginBottom:  '14px',
          }}
        >
          ALOFT · AGENT WORK-MEMORY · FIELD-OPERATIONAL EXPERIENCE RECALL
        </p>

        {/* FOER wordmark */}
        <h1
          id="foer-wordmark"
          style={{
            fontFamily:   SERIF,
            fontSize:     '64px',
            fontWeight:   600,
            color:        'var(--foer-wordmark)',
            letterSpacing: '0.01em',
            lineHeight:   1,
            margin:       '18px 0 0',
          }}
        >
          FOER
        </h1>

        {/* Narrative italic */}
        <p
          id="foer-narrative"
          style={{
            fontFamily:  SERIF,
            fontSize:    '20px',
            fontStyle:   'italic',
            color:       'var(--foer-text-sec)',
            maxWidth:    '640px',
            lineHeight:  1.5,
            fontWeight:  400,
            margin:      '22px 0 0',
          }}
        >
          A day of work arrives as noise. Overnight, Foer keeps only what&apos;s worth
          remembering — distilling sessions into rules that make the next run sharper,
          quieter, and harder to break.
        </p>
      </section>

      {/* ── KPI CARDS ─────────────────────────────────────────────────────────── */}
      <section
        id="foer-kpis"
        style={{
          maxWidth: '1180px',
          margin:   '0 auto',
          padding:  '0 32px 40px',
        }}
      >
        {isLoading && (
          <div
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap:                 '14px',
            }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="foer-skeleton"
                style={{ height: '100px', borderRadius: '6px' }}
              />
            ))}
          </div>
        )}

        {isError && (
          <div
            style={{
              padding:      '1.5rem',
              borderRadius: '6px',
              border:       `1px solid ${RULE_TYPE_COLORS.FAILURE_MODE}30`,
              background:   `${RULE_TYPE_COLORS.FAILURE_MODE}10`,
              color:        RULE_TYPE_COLORS.FAILURE_MODE,
              fontFamily:   MONO,
              fontSize:     '0.8rem',
            }}
          >
            Failed to load FOER stats — check network or API.
          </div>
        )}

        {kpis && (
          <div
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap:                 '14px',
            }}
          >
            {kpis.map((kpi, idx) => (
              <div
                key={kpi.id}
                id={`foer-kpi-${kpi.id}`}
                className="foer-kpi-card"
                style={{ animationDelay: `${idx * 60}ms`, display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                {/* Label */}
                <div
                  style={{
                    fontFamily:    MONO,
                    fontSize:      '9px',
                    letterSpacing: '0.13em',
                    textTransform: 'uppercase',
                    color:         'var(--foer-text-mut)',
                  }}
                >
                  {kpi.label}
                </div>
                {/* Value */}
                <div
                  style={{
                    fontSize:           '26px',
                    fontWeight:         600,
                    fontVariantNumeric: 'tabular-nums',
                    color:              kpi.accent ?? 'var(--foer-text-pri)',
                    lineHeight:         1,
                    letterSpacing:      '-0.01em',
                  }}
                >
                  {kpi.value}
                </div>
                {/* Sub */}
                {kpi.sub && (
                  <div
                    style={{
                      fontFamily:    MONO,
                      fontSize:      '9px',
                      letterSpacing: '0.04em',
                      color:         'var(--foer-text-sec)',
                      lineHeight:    1.3,
                    }}
                  >
                    {kpi.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── FILTERS ───────────────────────────────────────────────────────────── */}
      <section
        id="foer-filters"
        style={{
          maxWidth:   '1180px',
          margin:     '0 auto',
          padding:    '0 32px 26px',
          display:    'flex',
          flexWrap:   'wrap',
          gap:        '22px',
          alignItems: 'center',
        }}
      >
        {/* Topic filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label
            htmlFor="foer-filter-topic"
            style={{
              fontFamily:    MONO,
              fontSize:      '0.65rem',
              letterSpacing: '0.1em',
              color:         'var(--foer-text-mut)',
              textTransform: 'uppercase',
            }}
          >
            Topic
          </label>
          <select
            id="foer-filter-topic"
            className="foer-select"
            value={topicParam}
            onChange={(e) => updateParam('topic', e.target.value)}
          >
            {isLoading ? (
              <option value="">Loading…</option>
            ) : (
              topicOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Window filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label
            style={{
              fontFamily:    MONO,
              fontSize:      '0.65rem',
              letterSpacing: '0.1em',
              color:         'var(--foer-text-mut)',
              textTransform: 'uppercase',
            }}
          >
            Window
          </label>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                id={`foer-filter-window-${w.value}`}
                className="foer-filter-btn"
                data-active={windowParam === w.value ? 'true' : 'false'}
                onClick={() => updateParam('window', w.value)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rule type filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label
            style={{
              fontFamily:    MONO,
              fontSize:      '0.65rem',
              letterSpacing: '0.1em',
              color:         'var(--foer-text-mut)',
              textTransform: 'uppercase',
            }}
          >
            Rule Type
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {RULE_TYPES.map((rt) => (
              <button
                key={rt.value}
                id={`foer-filter-ruletype-${rt.value || 'all'}`}
                className="foer-filter-btn"
                data-active={ruleTypeParam === rt.value ? 'true' : 'false'}
                onClick={() => updateParam('ruleType', rt.value)}
                style={
                  rt.value && ruleTypeParam === rt.value
                    ? {
                        borderColor: RULE_TYPE_COLORS[rt.value] ?? GOLD,
                        color:       RULE_TYPE_COLORS[rt.value] ?? GOLD,
                      }
                    : undefined
                }
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTIONS ─────────────────────────────────────────────────────────── */}
      <div
        id="foer-sections"
        style={{
          maxWidth: '1180px',
          margin:   '0 auto',
          padding:  '0 32px',
          display:  'flex',
          flexDirection: 'column',
          gap:      '0',
        }}
      >
        {/* Nightly Distillation — cinematic animation (FOER-2) */}
        <DistillationStage lastRun={stats?.lastRun ?? null} />

        {/* The Keeper's Choice panel (FOER-3) */}
        <KeeperChoicePanel />

        {/* The Shelves Panel + Memory Drawer (FOER-4) */}
        <ShelvesPanel />
        <MemoryDrawer />

        {/* Grow & Refine / Forgetting Panel (FOER-5) */}
        {stats && (
          <ForgettingPanel
            statusBuckets={stats.statusBuckets}
            storeSizeSeries={stats.storeSizeSeries}
          />
        )}

        {/* Mounted at Task Start — injection preview (FOER-6) */}
        <MountPanel />

        {/* Collapse Guardrail (FOER-7) */}
        <CollapseGuardrail />

        {PLACEHOLDER_SECTIONS.filter((s) => s.id !== 'shelves' && s.id !== 'grow-refine').map((s, idx) => (
          <div
            key={s.id}
            id={`foer-section-${s.id}`}
            className="foer-section-placeholder"
            style={{ animationDelay: `${100 + idx * 80}ms` }}
          >
            {/* Orb placeholder */}
            <div
              style={{
                width:        '10px',
                height:       '10px',
                borderRadius: '50%',
                background:   'var(--foer-border)',
                flexShrink:   0,
                animation:    'foer-pulse-gold 2s ease-in-out infinite',
                animationDelay: `${idx * 300}ms`,
              }}
            />
            <div>
              <div
                style={{
                  fontFamily:  SERIF,
                  fontSize:    '1rem',
                  fontWeight:  600,
                  color:       'var(--foer-text-sec)',
                  marginBottom: '0.2rem',
                }}
              >
                {s.title}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize:   '0.67rem',
                  color:      'var(--foer-text-mut)',
                  letterSpacing: '0.05em',
                }}
              >
                PLACEHOLDER · FOER-2+
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Loading overlay indicator */}
      {isLoading && (
        <div
          style={{
            position:  'fixed',
            bottom:    '1.5rem',
            right:     '1.5rem',
            display:   'flex',
            alignItems:'center',
            gap:       '0.4rem',
            background:'var(--foer-card-bg)',
            border:    '1px solid var(--foer-border)',
            borderRadius: '999px',
            padding:   '0.4rem 0.8rem',
            fontFamily:MONO,
            fontSize:  '0.7rem',
            color:     'var(--foer-text-sec)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            zIndex:    50,
          }}
        >
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          Loading stats…
        </div>
      )}
    </div>
  );
}

// ── Public export — wraps with QueryClientProvider ────────────────────────────
export function FoerStoryDashboard() {
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <React.Suspense
        fallback={
          <div
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              height:         '100%',
              color:          '#4A6080',
              fontFamily:     MONO,
              fontSize:       '0.8rem',
              gap:            '0.5rem',
            }}
          >
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Initialising FOER…
          </div>
        }
      >
        <FoerStoryInner />
      </React.Suspense>
    </QueryClientProvider>
  );
}
