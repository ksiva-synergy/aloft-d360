'use client';

/**
 * FoerOpsDashboard.tsx — FOER-9: Operations page client dashboard.
 * Horizontal 4-stage pipeline (Sense, Distil, Shelve, Mount), SVG sparklines,
 * expandable run-log table.
 * All colors from foer-tokens.ts.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Loader2, ChevronDown, ChevronRight, ArrowLeft, Play } from 'lucide-react';
import type { StatsResponse, LastRunInfo } from '@/lib/foer/types';
import {
  GOLD,
  NAVY,
  MAXWELL_GREEN,
  SERIF,
  BODY,
  MONO,
  RULE_TYPE_COLORS,
  ruleTypeColor,
  TOPIC_ALL_KNOWLEDGE_ACCENT,
} from '@/lib/foer/foer-tokens';
import { ALL_KNOWLEDGE_KEY } from '@/lib/foer/topics';
import { SessionDetailDrawer } from './SessionDetailDrawer';

interface BrowseBullet {
  id: string;
  agentClass?: string;
  taskSignature?: string | null;
  ruleText: string;
  ruleType: string;
  helpfulCount: number;
  harmfulCount?: number;
  confidence?: number;
  status?: string;
  lastUsedAt?: string | null;
}

const PHASE0_BUDGET = 200;
const PHASE1A_BUDGET = 600;
const PHASE1B_BUDGET = 1200;
const TOKEN_CAP = PHASE0_BUDGET + PHASE1A_BUDGET + PHASE1B_BUDGET; // 2000 total
const PHASE0_TYPES = new Set(['HARD_RULE']);
const P1A_TYPES    = new Set(['SCHEMA_MAP']);
const P1B_TYPES    = new Set(['HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE']);
const PHASE0_CONF_FLOOR  = 0.9;
const PHASE0_MIN_HARMFUL = 1;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function bulletRecency(lastUsedAt: string | null | undefined): number {
  if (!lastUsedAt) return 0.4;
  const ageDays = (Date.now() - new Date(lastUsedAt).getTime()) / 86_400_000;
  if (ageDays <= 7)  return 1.0;
  if (ageDays <= 30) return 0.7;
  return 0.4;
}

function bulletScore(b: BrowseBullet): number {
  const conf = b.confidence ?? 0.5;
  const helpful = b.helpfulCount ?? 0;
  const harmful = b.harmfulCount ?? 0;
  return conf * Math.max(0, helpful - harmful) * bulletRecency(b.lastUsedAt);
}

interface RankedBullet extends BrowseBullet {
  tokens:     number;
  score:      number;
  phase:      0 | '1a' | '1b';
  overBudget: boolean;
}

function rankBulletsForSig(bullets: BrowseBullet[], taskSignature: string): RankedBullet[] {
  // Phase 0: fatal HARD_RULEs only (mirrors server confidence/harmful gate).
  const p0Cands = bullets
    .filter(b => PHASE0_TYPES.has(b.ruleType) && (b.confidence ?? 0.5) >= PHASE0_CONF_FLOOR && (b.harmfulCount ?? 0) >= PHASE0_MIN_HARMFUL)
    .sort((a, b) => bulletScore(b) - bulletScore(a));

  // Phase 1a: SCHEMA_MAPs (topic-scoped — show all for this sig's topic group).
  const p1aCands = bullets.filter(b => P1A_TYPES.has(b.ruleType)).sort((a, b) => bulletScore(b) - bulletScore(a));
  // Phase 1b: task-scoped contextual rules.
  const p1bCands = bullets.filter(b => P1B_TYPES.has(b.ruleType) && b.taskSignature === taskSignature).sort((a, b) => bulletScore(b) - bulletScore(a));

  const result: RankedBullet[] = [];
  let p0Budget  = PHASE0_BUDGET;
  const p0Ids   = new Set<string>();
  for (const b of p0Cands) {
    const tokens     = estimateTokens(b.ruleText);
    const overBudget = tokens > p0Budget;
    result.push({ ...b, tokens, score: bulletScore(b), phase: 0, overBudget });
    if (!overBudget) { p0Budget -= tokens; p0Ids.add(b.id); }
  }

  let p1aBudget = PHASE1A_BUDGET;
  for (const b of p1aCands) {
    if (p0Ids.has(b.id)) continue;
    const tokens     = estimateTokens(b.ruleText);
    const overBudget = tokens > p1aBudget;
    result.push({ ...b, tokens, score: bulletScore(b), phase: '1a', overBudget });
    if (!overBudget) p1aBudget -= tokens;
  }

  let p1bBudget = PHASE1B_BUDGET;
  const usedIds = new Set([...p0Ids, ...p1aCands.map(b => b.id)]);
  for (const b of p1bCands) {
    if (usedIds.has(b.id)) continue;
    const tokens     = estimateTokens(b.ruleText);
    const overBudget = tokens > p1bBudget;
    result.push({ ...b, tokens, score: bulletScore(b), phase: '1b', overBudget });
    if (!overBudget) p1bBudget -= tokens;
  }

  return result;
}

interface RunDetail {
  id: string;
  sessionId: string;
  taskSignature: string | null;
  candidatesProduced: number;
  bulletsInserted: number;
  bulletsDeduped: number;
  bulletsSuperseded: number;
  phantomsBlocked: number;
  skippedReason: string | null;
}

// ── One QueryClient per mount (not module-level to avoid SSR issues) ──────────
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } });
}


// ── CSS variable themes ───────────────────────────────────────────────────────
const DARK_THEME = {
  '--foer-bg':          '#05090f',
  '--foer-surface':     '#0a1320',
  '--foer-surface2':    '#0c1828',
  '--foer-border':      '#16273d',
  '--foer-border-dim':  'rgba(255,255,255,0.07)',
  '--foer-text-pri':    '#e8eef5',
  '--foer-text-sec':    '#8a9bb5',
  '--foer-text-mut':    '#5e7790',
  '--foer-gold':        '#FDB515',
  '--foer-wordmark':    '#FDB515',
  '--foer-pill-bg':     'rgba(253,181,21,0.10)',
  '--foer-pill-active': 'rgba(253,181,21,0.20)',
  '--foer-card-bg':     '#0a1320',
  '--foer-green':       '#22c55e',
  '--foer-amber-bg':    'rgba(217,119,75,0.08)',
} as const;

const LIGHT_THEME = {
  '--foer-bg':          '#F6F3EC',
  '--foer-surface':     '#FFFFFF',
  '--foer-surface2':    '#FBF9F3',
  '--foer-border':      '#E4DDCE',
  '--foer-border-dim':  'rgba(0,50,98,0.08)',
  '--foer-text-pri':    '#1B2532',
  '--foer-text-sec':    '#5A6B82',
  '--foer-text-mut':    '#7A8696',
  '--foer-gold':        '#FDB515',
  '--foer-wordmark':    '#003262',
  '--foer-pill-bg':     'rgba(0,50,98,0.08)',
  '--foer-pill-active': 'rgba(0,50,98,0.18)',
  '--foer-card-bg':     '#FFFFFF',
  '--foer-green':       '#15803d',
  '--foer-amber-bg':    'rgba(217,119,75,0.08)',
} as const;

function formatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  return `${hh}:${mm} UTC · ${diffH}h ago`;
}

function formatRelativeHours(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  if (diffH < 1) return '<1h ago';
  return `${diffH}h ago`;
}

function formatTimeOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC today`;
}

interface InnerProps {
  topicMap: Record<string, { topicKey: string; topicName: string; rank: number }>;
}

function FoerOpsInner({ topicMap }: InnerProps) {
  // ── Theme state — synced with global sidebar toggle via next-themes ──────────
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== 'light';

  const theme = dark ? DARK_THEME : LIGHT_THEME;

  // ── React Query ───────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading, dataUpdatedAt } = useQuery<StatsResponse>({
    queryKey: ['foer-memory-stats'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: activeBulletsData } = useQuery<BrowseBullet[]>({
    queryKey: ['foer-active-bullets'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/browse?status=ACTIVE&pageSize=100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.bullets ?? [];
    },
    staleTime: 60_000,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery<{ runs: any[]; total: number }>({
    queryKey: ['foer-memory-runs'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/runs?pageSize=14');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: jobHealthData } = useQuery<{ jobs: Array<{ jobKey: string; lastOkAt: string | null; ageHours: number | null; staleThresholdHours: number; status: 'green' | 'amber' | 'red' }>; computedAt: string }>({
    queryKey: ['foer-job-health'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/job-health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: canaryData } = useQuery<{
    fullPoolEnabled: boolean;
    fullPoolOrgs: string[];
    mmrLambda: number;
    mmrEnabled: boolean;
    totalActiveBullets: number;
    totalHelpfulCount: number;
    totalHarmfulCount: number;
    attributedRuns: number;
    volumeSufficient: boolean;
    computedAt: string;
  }>({
    queryKey: ['foer-canary-status'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/canary-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  // ── Auto-Refresh Ticker ─────────────────────────────────────────────────────
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  useEffect(() => {
    if (!dataUpdatedAt) return;
    setSecondsAgo(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [dataUpdatedAt]);

  // ── Process Now (trigger synthesis sweep) ──────────────────────────────────
  const queryClient = useQueryClient();
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);

  const handleProcessNow = useCallback(async () => {
    setSynthesizing(true);
    setSynthError(null);
    try {
      const res = await fetch('/api/agent-lab/memory/synthesize', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: ['foer-memory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['foer-memory-runs'] });
      queryClient.invalidateQueries({ queryKey: ['foer-active-bullets'] });
    } catch (err) {
      setSynthError(err instanceof Error ? err.message : String(err));
    } finally {
      setSynthesizing(false);
    }
  }, [queryClient]);

  // ── Top 5 Bullets Client-Side Sort ──────────────────────────────────────────
  const topBullets = useMemo(() => {
    if (!activeBulletsData) return [];
    return [...activeBulletsData]
      .sort((a, b) => (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0))
      .slice(0, 5);
  }, [activeBulletsData]);

  // ── Injection block state ────────────────────────────────────────────────────
  const [injSig, setInjSig] = useState<string>('');
  const [injOpen, setInjOpen] = useState<boolean>(true);

  const { data: sigData } = useQuery<{ signatures: { taskSignature: string; topicName: string; memberCount: number }[] }>({
    queryKey: ['foer-ops-signatures'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/signatures');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });

  const signatures = sigData?.signatures ?? [];

  // Auto-pick the highest-membership signature when none selected
  const activeSig = useMemo(() => {
    if (injSig) return injSig;
    if (!signatures.length) return '';
    return [...signatures].sort((a, b) => b.memberCount - a.memberCount)[0]?.taskSignature ?? '';
  }, [injSig, signatures]);

  const rankedForInj = useMemo(() => {
    if (!activeBulletsData || !activeSig) return [];
    return rankBulletsForSig(activeBulletsData, activeSig);
  }, [activeBulletsData, activeSig]);

  // ── Sparkline Runs Oldest -> Newest (Reversed) ──────────────────────────────
  const sparklineRuns = useMemo(() => {
    if (!stats?.lastNRuns) return [];
    return [...stats.lastNRuns].reverse();
  }, [stats?.lastNRuns]);

  // ── Run History Expandable State & Detail Loading ───────────────────────────
  const [historyOpen, setHistoryOpen] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

  // ── Session Detail Drawer ────────────────────────────────────────────────────
  const [drawerSession, setDrawerSession] = useState<{
    sessionId: string;
    topicName?: string;
    candidatesProduced?: number;
    bulletsInserted?: number;
    bulletsDeduped?: number;
    phantomsBlocked?: number;
  } | null>(null);

  const toggleRow = async (runId: string) => {
    setExpanded((prev) => ({ ...prev, [runId]: !prev[runId] }));
    if (!expanded[runId] && !runDetails[runId] && !loadingDetails[runId]) {
      setLoadingDetails((prev) => ({ ...prev, [runId]: true }));
      try {
        const res = await fetch(`/api/agent-lab/memory/runs/${runId}`);
        if (res.ok) {
          const data = await res.json();
          setRunDetails((prev) => ({ ...prev, [runId]: data.details ?? [] }));
        }
      } catch (err) {
        console.error('Failed to load run details:', err);
      } finally {
        setLoadingDetails((prev) => ({ ...prev, [runId]: false }));
      }
    }
  };

  // ── Node Type Bar Computations ──────────────────────────────────────────────
  const nodeSegs = useMemo(() => {
    if (!stats?.nodeTypeDistribution) return [];
    const action = stats.nodeTypeDistribution.ACTION ?? 0;
    const outcome = stats.nodeTypeDistribution.OUTCOME ?? 0;
    const source = stats.nodeTypeDistribution.SOURCE ?? 0;
    const correction = stats.nodeTypeDistribution.CORRECTION ?? 0;
    const deadEnd = stats.nodeTypeDistribution.DEAD_END ?? 0;
    const total = action + outcome + source + correction + deadEnd;

    const pct = (val: number) => (total > 0 ? (val / total) * 100 : 0);

    return [
      { label: 'ACTION', count: action, w: pct(action), c: RULE_TYPE_COLORS.HEURISTIC },
      { label: 'OUTCOME', count: outcome, w: pct(outcome), c: RULE_TYPE_COLORS.SOURCE_PREF },
      { label: 'SOURCE', count: source, w: pct(source), c: MAXWELL_GREEN },
      { label: 'CORRECTION', count: correction, w: pct(correction), c: GOLD },
      { label: 'DEAD_END', count: deadEnd, w: pct(deadEnd), c: RULE_TYPE_COLORS.FAILURE_MODE },
    ];
  }, [stats?.nodeTypeDistribution]);

  // ── Rule Type Pills & Missing Rule Check ────────────────────────────────────
  const ruleTypePills = useMemo(() => {
    if (!stats?.ruleTypeDistribution) return [];
    const types = ['HARD_RULE', 'SCHEMA_MAP', 'HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE'];
    return types.map((t) => ({
      type: t,
      count: stats.ruleTypeDistribution[t] ?? 0,
      color: ruleTypeColor(t),
    }));
  }, [stats?.ruleTypeDistribution]);

  const missingRuleTypes = useMemo(() => {
    if (!stats?.ruleTypeDistribution) return [];
    const types = ['HARD_RULE', 'SCHEMA_MAP', 'HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE'];
    return types.filter((t) => !(stats.ruleTypeDistribution[t] > 0));
  }, [stats?.ruleTypeDistribution]);

  if (statsLoading || runsLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: dark ? DARK_THEME['--foer-bg'] : LIGHT_THEME['--foer-bg'],
          color: dark ? DARK_THEME['--foer-text-sec'] : LIGHT_THEME['--foer-text-sec'],
          fontFamily: MONO,
          fontSize: '0.8rem',
          gap: '0.75rem',
        }}
      >
        <Loader2 size={20} className="animate-spin" />
        Initialising FOER Operations Observer…
      </div>
    );
  }

  if (!stats || !runsData) {
    return (
      <div style={{ color: RULE_TYPE_COLORS.FAILURE_MODE, fontFamily: MONO, padding: '2rem' }}>
        Failed to fetch Operations stats.
      </div>
    );
  }

  return (
    <div
      data-foer-theme={dark ? 'dark' : 'light'}
      style={{
        ...Object.fromEntries(Object.entries(theme)),
        minHeight: '100vh',
        background: 'var(--foer-bg)',
        fontFamily: BODY,
        color: 'var(--foer-text-pri)',
        paddingBottom: '5rem',
        position: 'relative',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;1,400;1,600&family=Inter+Tight:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        [data-foer-theme] * { box-sizing: border-box; }
        @keyframes dashflow { to { stroke-dashoffset: -33; } }
        .foer-flow-line {
          animation: dashflow 3s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .foer-flow-line {
            animation: none !important;
          }
        }
        .foer-card {
          flex: 1;
          min-width: 0;
          background: var(--foer-card-bg);
          border: 1px solid var(--foer-border);
          border-radius: 6px;
          padding: 15px 16px;
          display: flex;
          flex-direction: column;
          gap: 11px;
        }
        .foer-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 6px;
          padding: 3px 7px;
          font-family: ${MONO};
          font-size: 8.5px;
          letter-spacing: 0.04em;
        }
        .foer-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          display: inline-block;
        }
      `}</style>

      <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '30px 32px 60px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* ── HERO ─────────────────────────────────────────────────────────────── */}
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '40px', lineHeight: 1, letterSpacing: '-0.01em', color: 'var(--foer-wordmark)' }}>FOER</span>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: 'var(--foer-gold)', border: '1px solid var(--foer-gold)', borderRadius: '6px', padding: '5px 9px' }}>OPERATIONS</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.22em', color: 'var(--foer-text-mut)' }}>ALOFT · AGENT WORK-MEMORY · OBSERVABILITY</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.06em', color: 'var(--foer-text-mut)', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
              <span className="foer-dot" style={{ background: 'var(--foer-green)' }}></span>
              updated <span style={{ color: 'var(--foer-text-sec)' }}>{secondsAgo}s</span> ago
            </span>
            <Link
              href="/agent-lab/memory"
              aria-label="Back to Memory"
              style={{
                width: '36px',
                height: '36px',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--foer-surface)',
                border: '1px solid var(--foer-border)',
                borderRadius: '6px',
                color: 'var(--foer-text-sec)',
                textDecoration: 'none',
              }}
            >
              <ArrowLeft size={16} />
            </Link>
          </div>
        </header>

        {/* ── KPI CHIPS ────────────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '14px' }}>
          <div style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--foer-text-pri)' }}>{stats.tracedSessions.toLocaleString()}</span>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.13em', color: 'var(--foer-text-mut)' }}>TRACED SESSIONS</span>
          </div>
          <div style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--foer-text-pri)' }}>{stats.activeBullets.toLocaleString()}</span>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.13em', color: 'var(--foer-text-mut)' }}>ACTIVE BULLETS</span>
          </div>
          <div style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--foer-text-pri)', fontFamily: MONO }}>{formatLastRun(stats.lastSynthesisAt)}</span>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.13em', color: 'var(--foer-text-mut)' }}>LAST RUN</span>
          </div>
          <div style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--foer-gold)' }}>{stats.phantomsBlocked7d.toLocaleString()}</span>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.13em', color: 'var(--foer-text-mut)' }}>PHANTOMS BLOCKED · 7D</span>
          </div>
          <div style={{ background: 'var(--foer-surface)', border: `1px solid ${stats.unprocessedSessions > 0 ? 'var(--foer-gold)' : 'var(--foer-border)'}`, borderRadius: '6px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.01em', color: stats.unprocessedSessions > 0 ? 'var(--foer-gold)' : 'var(--foer-text-pri)' }}>{stats.unprocessedSessions.toLocaleString()}</span>
              {stats.unprocessedSessions > 0 && (
                <button
                  type="button"
                  disabled={synthesizing}
                  onClick={handleProcessNow}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: 'var(--foer-gold)',
                    color: '#1B2532',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 9px',
                    fontFamily: MONO,
                    fontSize: '9px',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    cursor: synthesizing ? 'wait' : 'pointer',
                    opacity: synthesizing ? 0.7 : 1,
                  }}
                >
                  {synthesizing ? <Loader2 size={10} className="animate-spin" /> : <Play size={9} />}
                  {synthesizing ? 'RUNNING…' : 'PROCESS NOW'}
                </button>
              )}
            </div>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.13em', color: 'var(--foer-text-mut)' }}>UNPROCESSED SESSIONS</span>
            {synthError && (
              <span style={{ fontFamily: MONO, fontSize: '8.5px', color: RULE_TYPE_COLORS.FAILURE_MODE, marginTop: '2px' }}>{synthError}</span>
            )}
          </div>
        </div>

        {/* ── JOB HEALTH STRIP ────────────────────────────────────────────────── */}
        {jobHealthData && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {jobHealthData.jobs.map((j) => {
              const dotColor = j.status === 'green' ? 'var(--foer-green)' : j.status === 'amber' ? '#d9774b' : '#ef4444';
              return (
                <div key={j.jobKey} style={{ display: 'flex', alignItems: 'center', gap: '7px', background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '8px 12px' }}>
                  <span className="foer-dot" style={{ background: dotColor }}></span>
                  <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.06em', color: 'var(--foer-text-sec)' }}>{j.jobKey}</span>
                  <span style={{ fontFamily: MONO, fontSize: '9.5px', color: 'var(--foer-text-mut)' }}>
                    {j.ageHours !== null ? `${j.ageHours < 1 ? '<1' : Math.round(j.ageHours)}h ago` : 'never'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── MEMORY CANARY PANEL ──────────────────────────────────────────────── */}
        {canaryData && (
          <div style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: 'var(--foer-text-mut)' }}>MEMORY CANARY · FULLPOOL + λ STATUS</span>
              <span style={{ fontFamily: MONO, fontSize: '8.5px', color: canaryData.fullPoolEnabled ? 'var(--foer-green)' : '#d9774b', background: canaryData.fullPoolEnabled ? 'rgba(34,197,94,0.08)' : 'rgba(217,119,75,0.08)', border: `1px solid ${canaryData.fullPoolEnabled ? 'var(--foer-green)' : '#d9774b'}`, borderRadius: '4px', padding: '2px 7px', letterSpacing: '0.06em' }}>
                FULLPOOL {canaryData.fullPoolEnabled ? 'ON' : 'OFF'}
              </span>
              {canaryData.fullPoolOrgs.length > 0 && (
                <span style={{ fontFamily: MONO, fontSize: '8px', color: 'var(--foer-text-mut)', letterSpacing: '0.04em' }}>
                  canary orgs: {canaryData.fullPoolOrgs.map((o) => o.slice(0, 8)).join(', ')}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              {/* Lambda chip */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontFamily: MONO, fontSize: '18px', fontWeight: 600, color: 'var(--foer-gold)', letterSpacing: '-0.01em' }}>
                  λ={canaryData.mmrLambda.toFixed(1)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.1em', color: 'var(--foer-text-mut)' }}>
                  MMR LAMBDA · {canaryData.mmrEnabled ? 'MMR ON' : 'MMR OFF'}
                </span>
              </div>

              {/* Helpful / Harmful ratio */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontFamily: MONO, fontSize: '18px', fontWeight: 600, color: canaryData.totalHarmfulCount === 0 ? 'var(--foer-text-pri)' : canaryData.totalHelpfulCount > canaryData.totalHarmfulCount ? 'var(--foer-green)' : '#ef4444', letterSpacing: '-0.01em' }}>
                  {canaryData.totalHelpfulCount}/{canaryData.totalHarmfulCount}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.1em', color: 'var(--foer-text-mut)' }}>HELPFUL / HARMFUL · ALL ACTIVE</span>
              </div>

              {/* Attributed runs + volume gate */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontFamily: MONO, fontSize: '18px', fontWeight: 600, color: canaryData.volumeSufficient ? 'var(--foer-green)' : '#d9774b', letterSpacing: '-0.01em' }}>
                  {canaryData.attributedRuns}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.1em', color: 'var(--foer-text-mut)' }}>
                  ATTRIBUTED RUNS · {canaryData.volumeSufficient ? 'λ TUNING READY' : 'NEED ≥30 FOR λ TUNE'}
                </span>
              </div>
            </div>

            {!canaryData.volumeSufficient && (
              <div style={{ fontFamily: MONO, fontSize: '9px', color: '#d9774b', letterSpacing: '0.04em' }}>
                Run <span style={{ color: 'var(--foer-text-sec)' }}>scripts/memory/calibrate-lambda.ts</span> once attributed runs ≥ 30 to get a λ recommendation.
              </div>
            )}
          </div>
        )}

        {/* ── THE LOOP PIPELINE ────────────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '16px', color: 'var(--foer-text-pri)' }}>The Loop</span>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: 'var(--foer-text-mut)' }}>SENSE → DISTIL → SHELVE → MOUNT → SENSE</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            {/* STAGE B1: SENSE */}
            <div className="foer-card">
              <div>
                <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '18px', color: 'var(--foer-text-pri)', lineHeight: 1.1 }}>Sense</div>
                <div style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', marginTop: '3px' }}>Trace capture</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: '11px', lineHeight: 1.7, color: 'var(--foer-text-sec)' }}>
                <span style={{ color: 'var(--foer-text-pri)' }}>{stats.tracedSessions.toLocaleString()}</span> sessions · <span style={{ color: 'var(--foer-text-pri)' }}>{stats.totalTraceNodes.toLocaleString()}</span> nodes
                <br />
                last session <span style={{ color: 'var(--foer-text-pri)' }}>{formatRelativeHours(stats.lastTraceAt)}</span>
              </div>
              <div>
                <div style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--foer-border)' }}>
                  <div style={{ display: 'flex', height: '12px', width: '100%' }}>
                    {nodeSegs.map((seg) =>
                      seg.count > 0 ? (
                        <div
                          key={seg.label}
                          style={{
                            width: `${seg.w}%`,
                            backgroundColor: seg.c,
                            height: '100%',
                          }}
                        />
                      ) : null
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '9px' }}>
                  {nodeSegs.map((seg) => (
                    <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: MONO, fontSize: '9.5px' }}>
                      <span className="foer-dot" style={{ background: seg.c, width: '8px', height: '8px', borderRadius: '2px' }}></span>
                      <span style={{ flex: 1, color: 'var(--foer-text-mut)', letterSpacing: '0.04em' }}>{seg.label}</span>
                      <span style={{ color: 'var(--foer-text-sec)' }}>{seg.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* CONNECTOR 1 */}
            <div style={{ flex: 'none', width: '66px', alignSelf: 'flex-start', marginTop: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontFamily: MONO, fontSize: '8px', letterSpacing: '0.05em', color: 'var(--foer-text-mut)', textAlign: 'center', lineHeight: 1.35 }}>nightly<br />04:30 UTC</span>
              <svg width="66" height="13" viewBox="0 0 66 13" style={{ overflow: 'visible' }}>
                <line x1="3" y1="6.5" x2="55" y2="6.5" stroke="var(--foer-border)" strokeWidth="1"></line>
                <line className="foer-flow-line" x1="3" y1="6.5" x2="55" y2="6.5" stroke="var(--foer-gold)" strokeWidth="1.6" strokeDasharray="9 24" opacity="0.6"></line>
                <polygon points="55,2.5 63,6.5 55,10.5" fill="var(--foer-gold)" opacity="0.75"></polygon>
              </svg>
            </div>

            {/* STAGE B2: DISTIL */}
            <div className="foer-card">
              <div>
                <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '18px', color: 'var(--foer-text-pri)', lineHeight: 1.1 }}>Distil</div>
                <div style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', marginTop: '3px' }}>Reflector · Marcus</div>
              </div>
              {stats.lastRun ? (
                <>
                  <div style={{ fontFamily: MONO, fontSize: '11px', lineHeight: 1.7, color: 'var(--foer-text-sec)' }}>
                    ran <span style={{ color: 'var(--foer-text-pri)' }}>{formatTimeOnly(stats.lastRun.completedAt)}</span>
                    <br />
                    scanned <span style={{ color: 'var(--foer-text-pri)' }}>{stats.lastRun.sessionsScanned}</span> · reflected <span style={{ color: 'var(--foer-text-pri)' }}>{stats.lastRun.sessionsReflected}</span> · skipped <span style={{ color: 'var(--foer-text-pri)' }}>{stats.lastRun.sessionsSkipped}</span>
                    <br />
                    <span style={{ color: 'var(--foer-text-mut)' }}>{stats.lastRun.reflectorVersion ?? '—'}</span>
                  </div>
                  {stats.lastRun.phantomsBlocked > 0 && (
                    <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: '6px', border: '1px solid var(--foer-gold)', borderRadius: '6px', padding: '4px 9px', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.06em', color: 'var(--foer-gold)' }}>
                      <span className="foer-dot" style={{ background: 'var(--foer-gold)', width: '5px', height: '5px' }}></span> phantoms blocked: {stats.lastRun.phantomsBlocked}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontFamily: MONO, fontSize: '11px', color: 'var(--foer-text-mut)' }}>No synthesis runs recorded yet.</div>
              )}
              {sparklineRuns.length > 0 && (
                <div>
                  <svg width="100%" height="46" viewBox="0 0 180 46" preserveAspectRatio="none" style={{ display: 'block' }}>
                    {sparklineRuns.map((r, i) => {
                      const ratio = r.sessionsScanned > 0 ? r.sessionsReflected / r.sessionsScanned : 0;
                      const barWidth = 14;
                      const gap = 10;
                      const x = i * (barWidth + gap) + 5;
                      const h = Math.max(ratio * 36, 3);
                      const y = 40 - h;
                      const isLast = i === sparklineRuns.length - 1;
                      const dateStr = new Date(r.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                      const ratioStr = `${r.sessionsReflected}/${r.sessionsScanned}`;

                      return (
                        <g key={r.id}>
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={h}
                            rx="1.5"
                            fill={RULE_TYPE_COLORS.HEURISTIC}
                            opacity={isLast ? 1 : 0.5}
                            stroke={isLast ? GOLD : 'none'}
                            strokeWidth={isLast ? 1.5 : 0}
                          />
                          <title>{`${dateStr}: ${ratioStr} reflected`}</title>
                        </g>
                      );
                    })}
                  </svg>
                  <div style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.05em', color: 'var(--foer-text-mut)', marginTop: '6px' }}>reflected ÷ scanned · last 7 runs</div>
                </div>
              )}
            </div>

            {/* CONNECTOR 2 */}
            <div style={{ flex: 'none', width: '66px', alignSelf: 'flex-start', marginTop: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontFamily: MONO, fontSize: '8px', letterSpacing: '0.05em', color: 'var(--foer-text-mut)', textAlign: 'center', lineHeight: 1.35 }}>delta-only<br />merge</span>
              <svg width="66" height="13" viewBox="0 0 66 13" style={{ overflow: 'visible' }}>
                <line x1="3" y1="6.5" x2="55" y2="6.5" stroke="var(--foer-border)" strokeWidth="1"></line>
                <line className="foer-flow-line" x1="3" y1="6.5" x2="55" y2="6.5" stroke="var(--foer-gold)" strokeWidth="1.6" strokeDasharray="9 24" opacity="0.6" style={{ animationDelay: '-1s' }}></line>
                <polygon points="55,2.5 63,6.5 55,10.5" fill="var(--foer-gold)" opacity="0.75"></polygon>
              </svg>
            </div>

            {/* STAGE B3: SHELVE */}
            <div className="foer-card">
              <div>
                <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '18px', color: 'var(--foer-text-pri)', lineHeight: 1.1 }}>Shelve</div>
                <div style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', marginTop: '3px' }}>Curator · Rama-gated · delta-only</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: '11px', lineHeight: 1.7, color: 'var(--foer-text-sec)' }}>
                {stats.lastRun ? (
                  <>
                    inserted <span style={{ color: 'var(--foer-text-pri)' }}>{stats.lastRun.bulletsInserted}</span> / deduped <span style={{ color: 'var(--foer-text-pri)' }}>{stats.lastRun.bulletsDeduped}</span>
                    <br />
                    superseded <span style={{ color: 'var(--foer-text-pri)' }}>{stats.lastRun.bulletsSuperseded}</span> / phantoms <span style={{ color: 'var(--foer-gold)' }}>{stats.lastRun.phantomsBlocked}</span>
                  </>
                ) : (
                  <span>No nightly run history</span>
                )}
                <br />
                total ACTIVE <span style={{ color: 'var(--foer-text-pri)' }}>{stats.activeBullets}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {ruleTypePills.map((pill) =>
                  pill.count > 0 ? (
                    <span
                      key={pill.type}
                      className="foer-badge"
                      style={{ border: `1px solid ${pill.color}`, color: pill.color }}
                    >
                      {pill.type === 'HARD_RULE' ? 'HARD_RULE' : pill.type}{' '}
                      <span style={{ color: 'var(--foer-text-pri)', fontWeight: 'bold' }}>{pill.count}</span>
                    </span>
                  ) : null
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: '6px', border: '1px solid var(--foer-border)', borderRadius: '6px', padding: '4px 9px', fontFamily: MONO, fontSize: '9.5px', color: stats.activeBullets > 200 ? RULE_TYPE_COLORS.FAILURE_MODE : 'var(--foer-green)' }}>
                  <span className="foer-dot" style={{ background: stats.activeBullets > 200 ? RULE_TYPE_COLORS.FAILURE_MODE : 'var(--foer-green)', width: '6px', height: '6px' }}></span>
                  store health: {stats.activeBullets > 200 ? 'dense store' : 'healthy'}
                </div>
                {missingRuleTypes.length > 0 && (
                  <div style={{ fontSize: '8.5px', fontFamily: MONO, color: 'var(--foer-text-mut)' }}>
                    missing: {missingRuleTypes.join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* CONNECTOR 3 */}
            <div style={{ flex: 'none', width: '66px', alignSelf: 'flex-start', marginTop: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontFamily: MONO, fontSize: '8px', letterSpacing: '0.05em', color: 'var(--foer-text-mut)', textAlign: 'center', lineHeight: 1.35 }}>two-tier<br />retrieval</span>
              <svg width="66" height="13" viewBox="0 0 66 13" style={{ overflow: 'visible' }}>
                <line x1="3" y1="6.5" x2="55" y2="6.5" stroke="var(--foer-border)" strokeWidth="1"></line>
                <line className="foer-flow-line" x1="3" y1="6.5" x2="55" y2="6.5" stroke="var(--foer-gold)" strokeWidth="1.6" strokeDasharray="9 24" opacity="0.6" style={{ animationDelay: '-2s' }}></line>
                <polygon points="55,2.5 63,6.5 55,10.5" fill="var(--foer-gold)" opacity="0.75"></polygon>
              </svg>
            </div>

            {/* STAGE B4: MOUNT */}
            <div className="foer-card">
              <div>
                <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '18px', color: 'var(--foer-text-pri)', lineHeight: 1.1 }}>Mount</div>
                <div style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', marginTop: '3px' }}>Injection at task start · two-tier</div>
              </div>
              <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: '6px', fontFamily: MONO, fontSize: '9.5px', color: 'var(--foer-text-sec)' }}>
                <span className="foer-dot" style={{ background: stats.flagStatus.enabled ? 'var(--foer-green)' : RULE_TYPE_COLORS.FAILURE_MODE, width: '6px', height: '6px' }}></span>
                {stats.flagStatus.enabled ? 'ENABLED' : 'DISABLED'}
              </div>
              <div style={{ fontFamily: MONO, fontSize: '10px', lineHeight: 1.7, color: 'var(--foer-text-sec)' }}>
                budget <span style={{ color: 'var(--foer-text-pri)' }}>400</span> tokens
                <br />
                Tier-1 = <span style={{ color: 'var(--foer-text-pri)' }}>HARD_RULE + SCHEMA_MAP</span>
                <br />
                cosine ≥ <span style={{ color: 'var(--foer-text-pri)' }}>0.78</span> · max <span style={{ color: 'var(--foer-text-pri)' }}>8</span> bullets
                <br />
                injected last 24h: <span style={{ color: 'var(--foer-text-pri)' }}>{stats.flagStatus.enabled ? (stats.injectedLast24h ?? 0) : '— (injection disabled)'}</span>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.06em', color: 'var(--foer-text-mut)', marginBottom: '6px' }}>
                  TOPIC COVERAGE · {stats.flagStatus.topicCoverage}/{stats.topicCount} topics with ACTIVE bullets
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {stats.topics.map((t) => {
                    const hasActive = t.memberCount > 0;
                    return (
                      <span
                        key={t.topicKey}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid var(--foer-border)',
                          borderRadius: '6px',
                          padding: '2px 6px',
                          fontFamily: MONO,
                          fontSize: '8px',
                          letterSpacing: '0.03em',
                          color: 'var(--foer-text-sec)',
                        }}
                      >
                        <span
                          style={{
                            width: '4px',
                            height: '4px',
                            borderRadius: '50%',
                            backgroundColor: hasActive
                              ? (t.topicKey === ALL_KNOWLEDGE_KEY ? TOPIC_ALL_KNOWLEDGE_ACCENT : RULE_TYPE_COLORS.HEURISTIC)
                              : 'transparent',
                            border: hasActive ? 'none' : '1px solid var(--foer-text-mut)',
                          }}
                        />
                        {t.topicName}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.06em', color: 'var(--foer-text-mut)', marginBottom: '7px' }}>TOP 5 MOST-USED BULLETS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {topBullets.map((b) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span
                        style={{
                          flex: 'none',
                          border: `1px solid ${ruleTypeColor(b.ruleType)}`,
                          borderRadius: '4px',
                          padding: '1px 5px',
                          fontFamily: MONO,
                          fontSize: '7.5px',
                          letterSpacing: '0.03em',
                          color: ruleTypeColor(b.ruleType),
                        }}
                      >
                        {b.ruleType === 'HARD_RULE' ? 'HARD_RULE' : b.ruleType}
                      </span>
                      <span style={{ flex: '1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '10.5px', color: 'var(--foer-text-sec)' }}>
                        {b.ruleText}
                      </span>
                      <span style={{ flex: 'none', fontFamily: MONO, fontSize: '10px', color: 'var(--foer-text-pri)' }}>
                        {b.helpfulCount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* RETURN PATH */}
          <div style={{ position: 'relative', height: '42px', marginTop: '2px' }}>
            <svg width="100%" height="42" viewBox="0 0 100 42" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
              <path d="M 88 0 L 88 22 Q 88 32 80 32 L 20 32 Q 12 32 12 22 L 12 9" fill="none" stroke="var(--foer-border)" strokeWidth="1" vectorEffect="non-scaling-stroke"></path>
              <path className="foer-flow-line" d="M 88 0 L 88 22 Q 88 32 80 32 L 20 32 Q 12 32 12 22 L 12 9" fill="none" stroke="var(--foer-gold)" strokeWidth="1.6" strokeDasharray="9 24" opacity="0.55" vectorEffect="non-scaling-stroke"></path>
            </svg>
            <div style={{ position: 'absolute', left: '12%', top: 0, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '7px solid var(--foer-gold)', opacity: 0.8 }}></div>
            <div style={{ position: 'absolute', left: '50%', top: '18px', transform: 'translateX(-50%)', fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', background: 'var(--foer-bg)', padding: '0 10px' }}>
              MOUNT → SENSE · traces from injected sessions
            </div>
          </div>
        </section>

        {/* ── SYNTHESIS RUN HISTORY ────────────────────────────────────────────── */}
        <section style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between', gap: '12px', background: 'transparent', border: 'none', padding: '16px 18px', cursor: 'pointer', textAlign: 'left', outline: 'none' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontFamily: MONO, fontSize: '11px', color: 'var(--foer-text-mut)' }}>
                {historyOpen ? '▾' : '▸'}
              </span>
              <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '17px', color: 'var(--foer-text-pri)' }}>Synthesis run history</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.1em', color: 'var(--foer-text-mut)' }}>LAST 14 NIGHTLY RUNS · NEWEST FIRST</span>
          </button>

          {historyOpen && (
            <div>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '24px minmax(80px, 1.2fr) 70px 80px 120px 70px 50px 130px 80px', gap: '8px', padding: '8px 18px', borderTop: '1px solid var(--foer-border)', borderBottom: '1px solid var(--foer-border)', fontFamily: MONO, fontSize: '8.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)' }}>
                <span></span>
                <span>DATE</span>
                <span style={{ textAlign: 'right' }}>SCANNED</span>
                <span style={{ textAlign: 'right' }}>REFLECTED</span>
                <span style={{ textAlign: 'right' }}>INS / DED / SUP</span>
                <span style={{ textAlign: 'right' }}>PHANTOMS</span>
                <span style={{ textAlign: 'right' }}>ERR</span>
                <span>REFLECTOR VERSION</span>
                <span style={{ textAlign: 'right' }}>DURATION</span>
              </div>

              {/* Rows */}
              {runsData.runs.map((r) => {
                let durStr = '—';
                if (r.completedAt) {
                  const diffMs = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
                  const minutes = Math.floor(diffMs / 60000);
                  const seconds = Math.floor((diffMs % 60000) / 1000);
                  durStr = `${minutes}m ${seconds}s`;
                }

                const isExpanded = !!expanded[r.id];
                const hasPhantom = r.phantomsBlocked > 0;
                const dateSource = r.completedAt ?? r.startedAt;
                const runDate = new Date(dateSource).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                });

                // Tint row if errors > 0
                const rowBg = r.errors > 0 ? 'var(--foer-amber-bg)' : 'transparent';

                return (
                  <div key={r.id} style={{ borderBottom: '1px solid var(--foer-border)' }}>
                    <button
                      type="button"
                      onClick={() => toggleRow(r.id)}
                      style={{ width: '100%', display: 'grid', gridTemplateColumns: '24px minmax(80px, 1.2fr) 70px 80px 120px 70px 50px 130px 80px', gap: '8px', alignItems: 'center', padding: '9px 18px', background: rowBg, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: MONO, fontSize: '11px', color: 'var(--foer-text-sec)', outline: 'none' }}
                    >
                      <span style={{ color: 'var(--foer-text-mut)', fontSize: '10px' }}>{isExpanded ? '▾' : '▸'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--foer-text-pri)' }}>
                        {runDate}
                      </span>
                      <span style={{ textAlign: 'right', color: 'var(--foer-text-pri)' }}>{r.sessionsScanned}</span>
                      <span style={{ textAlign: 'right', color: 'var(--foer-text-pri)' }}>{r.sessionsReflected}</span>
                      <span style={{ textAlign: 'right' }}>{`${r.bulletsInserted} / ${r.bulletsDeduped} / ${r.bulletsSuperseded}`}</span>
                      <span style={{ textAlign: 'right', color: hasPhantom ? 'var(--foer-gold)' : 'var(--foer-text-mut)', display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: '5px' }}>
                        {r.phantomsBlocked}
                        {hasPhantom && (
                          <span style={{ border: '1px solid var(--foer-gold)', borderRadius: '4px', padding: '1px 5px', fontSize: '7.5px', letterSpacing: '0.04em', color: 'var(--foer-gold)' }}>phantom</span>
                        )}
                      </span>
                      <span style={{ textAlign: 'right', color: r.errors > 0 ? 'var(--foer-gold)' : 'var(--foer-text-mut)' }}>{r.errors}</span>
                      <span style={{ color: 'var(--foer-text-sec)' }}>{r.reflectorVersion ?? '—'}</span>
                      <span style={{ textAlign: 'right', color: 'var(--foer-text-pri)' }}>{durStr}</span>
                    </button>

                    {/* Details Sub-Table */}
                    {isExpanded && (
                      <div style={{ padding: '4px 18px 14px 50px', background: 'var(--foer-surface2)' }}>
                        {loadingDetails[r.id] && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 0', fontSize: '10px', color: 'var(--foer-text-mut)' }}>
                            <Loader2 size={12} className="animate-spin" /> Loading run details…
                          </div>
                        )}

                        {!loadingDetails[r.id] && runDetails[r.id] && (
                          <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '100px 140px 80px 120px 100px 1fr', gap: '10px', padding: '7px 0', fontFamily: MONO, fontSize: '8px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', borderBottom: '1px solid var(--foer-border)' }}>
                              <span>SESSION</span>
                              <span>topic (derived)</span>
                              <span style={{ textAlign: 'right' }}>CANDIDATES</span>
                              <span style={{ textAlign: 'right' }}>INS / DED / SUP</span>
                              <span style={{ textAlign: 'right' }}>PHANTOMS</span>
                              <span>SKIP REASON</span>
                            </div>

                            {runDetails[r.id].length === 0 ? (
                              <div style={{ padding: '10px 0', fontSize: '10px', color: 'var(--foer-text-mut)' }}>No session details recorded for this run.</div>
                            ) : (
                              runDetails[r.id].map((detail) => {
                                const topicInfo = detail.taskSignature ? topicMap[detail.taskSignature] : null;
                                const topicDisplay = topicInfo?.topicName ?? '—';
                                const sessTrunc = detail.sessionId ? detail.sessionId.substring(0, 8) : '—';
                                const hasDetailPhantom = detail.phantomsBlocked > 0;

                                return (
                                  <div key={detail.id} style={{ display: 'grid', gridTemplateColumns: '100px 140px 80px 120px 100px 1fr', gap: '10px', padding: '6px 0', fontFamily: MONO, fontSize: '10px', color: 'var(--foer-text-sec)', borderBottom: '1px solid var(--foer-border)' }}>
                                    <button
                                      type="button"
                                      onClick={() => setDrawerSession({
                                        sessionId: detail.sessionId,
                                        topicName: topicInfo?.topicName,
                                        candidatesProduced: detail.candidatesProduced,
                                        bulletsInserted: detail.bulletsInserted,
                                        bulletsDeduped: detail.bulletsDeduped,
                                        phantomsBlocked: detail.phantomsBlocked,
                                      })}
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        fontFamily: MONO,
                                        fontSize: '10px',
                                        color: GOLD,
                                        cursor: 'pointer',
                                        padding: 0,
                                        textAlign: 'left',
                                        textDecoration: 'underline',
                                        textUnderlineOffset: '2px',
                                        outline: 'none',
                                      }}
                                      title={`Open session detail: ${detail.sessionId}`}
                                    >
                                      {sessTrunc}
                                    </button>
                                    <span style={{ color: topicDisplay !== '—' ? 'var(--foer-teal)' : 'var(--foer-text-mut)' }}>{topicDisplay}</span>
                                    <span style={{ textAlign: 'right', color: 'var(--foer-text-pri)' }}>{detail.candidatesProduced}</span>
                                    <span style={{ textAlign: 'right' }}>{`${detail.bulletsInserted} / ${detail.bulletsDeduped} / ${detail.bulletsSuperseded}`}</span>
                                    <span style={{ textAlign: 'right', color: hasDetailPhantom ? 'var(--foer-gold)' : 'var(--foer-text-mut)' }}>
                                      {detail.phantomsBlocked}
                                      {hasDetailPhantom && (
                                        <span style={{ border: '1px solid var(--foer-gold)', borderRadius: '4px', padding: '0 4px', fontSize: '7.5px', marginLeft: '5px', color: 'var(--foer-gold)' }}>phantom</span>
                                      )}
                                    </span>
                                    <span style={{ color: 'var(--foer-text-mut)' }}>{detail.skippedReason || '—'}</span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── INJECTION BLOCK ──────────────────────────────────────────────────── */}
        <section style={{ background: 'var(--foer-surface)', border: '1px solid var(--foer-border)', borderRadius: '6px', overflow: 'hidden' }}>
          {/* Collapsible header — same pattern as synthesis run history */}
          <button
            type="button"
            onClick={() => setInjOpen(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'transparent', border: 'none', padding: '16px 18px', cursor: 'pointer', textAlign: 'left', outline: 'none' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontFamily: MONO, fontSize: '11px', color: 'var(--foer-text-mut)' }}>
                {injOpen ? '▾' : '▸'}
              </span>
              <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '17px', color: 'var(--foer-text-pri)' }}>Operating Memory — Injection Preview</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.1em', color: 'var(--foer-text-mut)' }}>MOUNT · TWO-TIER</span>
          </button>

          {injOpen && (
            <div style={{ borderTop: '1px solid var(--foer-border)', display: 'flex', flexDirection: 'column', gap: '0' }}>
              {/* Task signature selector row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 18px', borderBottom: '1px solid var(--foer-border-dim)' }}>
                <label htmlFor="ops-sig-select" style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', textTransform: 'uppercase', flexShrink: 0 }}>
                  Task Signature
                </label>
                <select
                  id="ops-sig-select"
                  value={activeSig}
                  onChange={e => setInjSig(e.target.value)}
                  style={{
                    background:   'var(--foer-surface2)',
                    border:       '1px solid var(--foer-border)',
                    borderRadius: '4px',
                    padding:      '4px 8px',
                    fontFamily:   MONO,
                    fontSize:     '0.72rem',
                    color:        'var(--foer-text-sec)',
                    cursor:       'pointer',
                    outline:      'none',
                    maxWidth:     '380px',
                  }}
                >
                  {signatures.map(s => (
                    <option key={s.taskSignature} value={s.taskSignature}>
                      {s.topicName} · {s.taskSignature.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <span style={{ fontFamily: MONO, fontSize: '9.5px', color: 'var(--foer-text-mut)' }}>
                  {rankedForInj.length} rule{rankedForInj.length !== 1 ? 's' : ''} · {rankedForInj.filter(b => !b.overBudget).length} within budget (2000t total)
                </span>
              </div>

              {/* Ranked bullets — capped at 75vh, scrollable */}
              {rankedForInj.length > 0 && (
                <div style={{ maxHeight: '75vh', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--foer-border) transparent' }}>
                  {rankedForInj.map((b, idx) => {
                    const prevPhase  = idx > 0 ? rankedForInj[idx - 1].phase : null;
                    const showDivider = prevPhase !== null && b.phase !== prevPhase;
                    const phaseLabel  = b.phase === 0 ? 'Phase 0 · Init' : b.phase === '1a' ? 'Phase 1a · Schema' : 'Phase 1b · Recall';
                    const phaseColor  = b.phase === 0 ? GOLD : b.phase === '1a' ? '#5E7E96' : '#5FA9AE';
                    const accent = ruleTypeColor(b.ruleType);
                    return (
                      <React.Fragment key={b.id}>
                        {(idx === 0 || showDivider) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 18px', borderBottom: '1px solid var(--foer-border)', borderTop: idx > 0 ? '1px solid var(--foer-border)' : 'none', background: 'var(--foer-surface2)', position: 'sticky', top: 0, zIndex: 1 }}>
                            <span style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.1em', color: phaseColor, textTransform: 'uppercase' }}>
                              {phaseLabel}
                            </span>
                            <div style={{ flex: 1, height: '1px', background: `${phaseColor}30` }} />
                          </div>
                        )}
                        <div
                          style={{
                            display:      'flex',
                            alignItems:   'flex-start',
                            gap:          '10px',
                            padding:      '8px 18px',
                            borderBottom: '1px solid var(--foer-border)',
                            opacity:      b.overBudget ? 0.35 : 1,
                            background:   b.overBudget ? 'var(--foer-surface2)' : 'transparent',
                          }}
                        >
                          <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: accent, background: `${accent}14`, border: `1px solid ${accent}35`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0, marginTop: '1px' }}>
                            {b.ruleType.replace('_', ' ')}
                          </span>
                          <span style={{ flex: 1, fontFamily: MONO, fontSize: '0.72rem', color: b.overBudget ? 'var(--foer-text-mut)' : 'var(--foer-text-pri)', lineHeight: 1.5 }}>
                            {b.ruleText}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <span style={{ fontFamily: MONO, fontSize: '9px', color: 'var(--foer-text-mut)' }}>{b.tokens}t</span>
                            {b.overBudget && (
                              <span style={{ fontFamily: MONO, fontSize: '8px', color: RULE_TYPE_COLORS.FAILURE_MODE, background: `${RULE_TYPE_COLORS.FAILURE_MODE}18`, border: `1px solid ${RULE_TYPE_COLORS.FAILURE_MODE}40`, borderRadius: 3, padding: '1px 4px' }}>
                                over budget
                              </span>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.1em', color: 'var(--foer-text-mut)', textAlign: 'center', opacity: 0.7 }}>
          READ-ONLY OBSERVABILITY · FOER · ALOFT WORK-MEMORY
        </div>
      </div>

      {/* Session Detail Drawer */}
      <SessionDetailDrawer
        sessionId={drawerSession?.sessionId ?? null}
        sessionLabel={drawerSession?.sessionId?.slice(0, 8)}
        topicName={drawerSession?.topicName}
        candidatesProduced={drawerSession?.candidatesProduced}
        bulletsInserted={drawerSession?.bulletsInserted}
        bulletsDeduped={drawerSession?.bulletsDeduped}
        phantomsBlocked={drawerSession?.phantomsBlocked}
        onClose={() => setDrawerSession(null)}
      />
    </div>
  );
}

export function FoerOpsDashboard({ topicMap }: InnerProps) {
  const [queryClient] = useState(() => makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <React.Suspense
        fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#4A6080', fontFamily: MONO, fontSize: '0.8rem', gap: '0.5rem' }}>
            <Loader2 size={16} className="animate-spin" />
            Initialising FOER Operations Observer…
          </div>
        }
      >
        <FoerOpsInner topicMap={topicMap} />
      </React.Suspense>
    </QueryClientProvider>
  );
}
