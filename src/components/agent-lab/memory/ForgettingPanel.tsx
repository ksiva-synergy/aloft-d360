'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  GOLD,
  NAVY,
  TOOLTIP_BG,
  TOOLTIP_TEXT,
  SERIF,
  MONO,
  RULE_TYPE_COLORS,
} from '@/lib/foer/foer-tokens';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface ForgettingPanelProps {
  statusBuckets: {
    ACTIVE: number;
    SUPERSEDED: number;
    EXPIRED: number;
  };
  storeSizeSeries: {
    date: string;
    active: number;
  }[];
}

export function ForgettingPanel({ statusBuckets, storeSizeSeries }: ForgettingPanelProps) {
  // Seed-based pseudo-random for stable orb positions across renders
  const RULE_TYPES = Object.keys(RULE_TYPE_COLORS) as Array<keyof typeof RULE_TYPE_COLORS>;
  
  const MEMORY_SNIPPETS = [
    'Always map vessel_id → IMO number first',
    'Prefer LEFT JOIN for wage_accounts lookup',
    'Crew rank normalization uses STCW codes',
    'portage_bill_headers.voyage_id → voyages.id',
    'Use payroll_db over legacy_wages for CTM',
    'Avoid SUM on nullable deduction columns',
    'Cache exchange rates per voyage period',
    'Join on vessel_code not vessel_name',
    'crew_change needs ON_BOARD status filter',
    'Deductions are always negative in source',
    'Overtime = hours × rate × multiplier only',
    'Use UTC for all voyage date comparisons',
    'Port state maps to country via UN/LOCODE',
    'Allotment type A = fixed, B = percentage',
    'Wage period closes at 00:00 ship local time',
    'Never aggregate across different currencies',
    'Medical deductions exempt from tax calc',
    'Rest hours stored in 15-min increments',
    'Principal must match vessel owner entity',
    'Navigation area maps to ITF zone',
    'Embark/disembark dates are inclusive',
    'Basic wage scales by rank + vessel type',
    'Cash advance reduces net pay same period',
    'Leave balance accrues at 2.5d/month',
    'Tax residence determined by flag state',
    'EOV settlement = earned − paid − deducted',
    'Bonus only applies when contract > 9 months',
    'P&I insurance per-head not per-voyage',
    'Crew nationality determines pension scheme',
    'Training costs amortised over contract term',
    'Manning agent fee capped at 1 month basic',
    'Seniority date distinct from join date',
    'Hazard pay only in designated war zones',
    'Currency conversion at booking date rate',
    'Night differential = base × 1.1 (22:00-06:00)',
    'Union dues flat rate per collective agreement',
    'Repatriation cost split: 70% owner 30% P&I',
    'Certificate expiry triggers manning alert',
    'Rank-up effective from promotion order date',
    'Consolidated pay = basic + fixed allowances',
    'Payslip generation batches by vessel group',
    'Retention bonus accrues monthly, paid at EOC',
    'Garnishment priority: tax > child > civil',
    'Vessel class A/B/C maps to insurance tier',
    'Sign-off reason codes align with MLC 2006',
    'Budget variance flags at ±5% of PCA estimate',
    'FX gain/loss posted to separate GL account',
    'Multi-currency: display in USD, store original',
    'ITF compliance check on every port call',
    'Backpay calculation uses original rate table',
  ];

  const orbs = useMemo(() => {
    function seededRandom(seed: number) {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
      };
    }

    const rng = seededRandom(42);
    const activeCount = 28;
    const archivedCount = 20;
    const result: Array<{
      cx: number;
      cy: number;
      r: number;
      type: string;
      opacity: number;
      zone: 'active' | 'archived';
      animClass: string;
      snippet: string;
    }> = [];

    for (let i = 0; i < activeCount; i++) {
      const type = RULE_TYPES[Math.floor(rng() * RULE_TYPES.length)];
      const isRising = rng() > 0.65;
      result.push({
        cx: 30 + rng() * 940,
        cy: 25 + rng() * 110,
        r: 7 + rng() * 7,
        type,
        opacity: 0.75 + rng() * 0.25,
        zone: 'active',
        animClass: isRising ? `orb-rise-${(i % 3) + 1}` : `orb-active-${(i % 3) + 1}`,
        snippet: MEMORY_SNIPPETS[i % MEMORY_SNIPPETS.length],
      });
    }

    for (let i = 0; i < archivedCount; i++) {
      const type = RULE_TYPES[Math.floor(rng() * RULE_TYPES.length)];
      const depthFactor = rng();
      const isResurfacing = rng() > 0.8;
      result.push({
        cx: 20 + rng() * 960,
        cy: 170 + depthFactor * 90,
        r: 3 + rng() * 4,
        type,
        opacity: 0.08 + (1 - depthFactor) * 0.18,
        zone: 'archived',
        animClass: isResurfacing ? `orb-rise-${(i % 3) + 1}` : `orb-sink-${(i % 3) + 1}`,
        snippet: MEMORY_SNIPPETS[(activeCount + i) % MEMORY_SNIPPETS.length],
      });
    }

    return result;
  }, []);

  // Spike easter egg: rare random zig-zag events
  const [spike, setSpike] = useState<{
    orbIndex: number;
    direction: 'up' | 'down';
    key: number;
  } | null>(null);

  const triggerSpike = useCallback(() => {
    const direction = Math.random() > 0.5 ? 'up' : 'down';
    const candidates = direction === 'down'
      ? orbs.reduce<number[]>((acc, o, i) => { if (o.zone === 'active') acc.push(i); return acc; }, [])
      : orbs.reduce<number[]>((acc, o, i) => { if (o.zone === 'archived') acc.push(i); return acc; }, []);
    
    if (candidates.length === 0) return;
    const orbIndex = candidates[Math.floor(Math.random() * candidates.length)];
    setSpike({ orbIndex, direction, key: Date.now() });

    setTimeout(() => setSpike(null), 3500);
  }, [orbs]);

  useEffect(() => {
    const scheduleNext = () => {
      const delay = 6000 + Math.random() * 12000;
      return setTimeout(() => {
        triggerSpike();
        timerRef = scheduleNext();
      }, delay);
    };
    let timerRef = scheduleNext();
    return () => clearTimeout(timerRef);
  }, [triggerSpike]);

  // Config for ECharts sparkline
  const chartOption = {
    grid: {
      left: 0,
      right: 0,
      top: 5,
      bottom: 5,
    },
    xAxis: {
      type: 'category',
      show: false,
      data: storeSizeSeries.map((s) => s.date),
    },
    yAxis: {
      type: 'value',
      show: false,
      min: 'dataMin',
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: TOOLTIP_BG,
      borderColor: GOLD,
      borderWidth: 1,
      textStyle: {
        color: TOOLTIP_TEXT,
        fontFamily: MONO,
        fontSize: 10,
      },
      formatter: (params: any) => {
        if (!params || params.length === 0) return '';
        const p = params[0];
        const d = new Date(p.name);
        const dateStr = d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        return `${dateStr}: ${p.value} active`;
      },
    },
    series: [
      {
        data: storeSizeSeries.map((s) => s.active),
        type: 'line',
        symbol: 'none',
        lineStyle: {
          color: GOLD,
          width: 1.5,
        },
        areaStyle: {
          color: 'none',
        },
      },
    ],
  };

  return (
    <section className="flex flex-col gap-6 pt-14" style={{ borderTop: '1px solid var(--foer-border)' }}>
      {/* ── STYLE BLOCK FOR CUSTOM TRANSITIONS / MICRO-ANIMATIONS ── */}
      <style>{`
        .foer-card-glow:hover {
          border-color: ${GOLD}50 !important;
          transform: translateY(-1px);
        }
        
        .circle-collapse-1 {
          transition: transform 0.3s ease;
        }
        .foer-card-glow:hover .circle-collapse-1 {
          transform: translateX(3px);
        }
        .circle-collapse-2 {
          transition: transform 0.3s ease;
        }
        .foer-card-glow:hover .circle-collapse-2 {
          transform: translateX(-3px);
        }

        .clock-spin {
          transform-origin: 12px 12px;
          transition: transform 0.5s ease;
        }
        .foer-card-glow:hover .clock-spin {
          transform: rotate(30deg);
        }

        .shield-shake {
          transform-origin: 12px 12px;
        }
        .foer-card-glow:hover .shield-shake {
          animation: shield-wiggle 0.3s ease-in-out;
        }

        @keyframes shield-wiggle {
          0%, 100% { transform: rotate(0); }
          25% { transform: rotate(-5deg); }
          75% { transform: rotate(5deg); }
        }

        /* Forgotten Orbs Drift keyframe animations — slower sinking below waterline */
        @keyframes orb-drift-active-1 {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(2px, -3px); }
          50% { transform: translate(-1px, 2px); }
          75% { transform: translate(3px, -1px); }
        }
        @keyframes orb-drift-active-2 {
          0%, 100% { transform: translate(0, 0); }
          30% { transform: translate(-3px, 2px); }
          60% { transform: translate(2px, -2px); }
          90% { transform: translate(-1px, 1px); }
        }
        @keyframes orb-drift-active-3 {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(1px, -2px); }
          50% { transform: translate(-2px, 3px); }
          80% { transform: translate(2px, -1px); }
        }

        /* Upward drift — memories being strengthened / resurfacing */
        @keyframes orb-rise-1 {
          0%, 100% { transform: translate(0, 0); }
          30% { transform: translate(1px, -5px); }
          60% { transform: translate(-2px, -3px); }
          80% { transform: translate(1px, -6px); }
        }
        @keyframes orb-rise-2 {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(-1px, -4px); }
          50% { transform: translate(2px, -7px); }
          75% { transform: translate(-1px, -5px); }
        }
        @keyframes orb-rise-3 {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(2px, -6px); }
          50% { transform: translate(-1px, -3px); }
          80% { transform: translate(1px, -8px); }
        }

        @keyframes orb-sink-1 {
          0%, 100% { transform: translate(0, 0); opacity: 0.3; }
          50% { transform: translate(1px, 4px); opacity: 0.18; }
        }
        @keyframes orb-sink-2 {
          0%, 100% { transform: translate(0, 0); opacity: 0.25; }
          50% { transform: translate(-1px, 5px); opacity: 0.12; }
        }
        @keyframes orb-sink-3 {
          0%, 100% { transform: translate(0, 0); opacity: 0.2; }
          50% { transform: translate(2px, 6px); opacity: 0.08; }
        }

        /* Spike: fast zig-zag upward — "new memory" crosses waterline */
        @keyframes orb-spike-up {
          0% { transform: translate(0, 0); opacity: 0.3; }
          8% { transform: translate(6px, -20px); opacity: 0.5; }
          16% { transform: translate(-8px, -40px); opacity: 0.6; }
          24% { transform: translate(10px, -60px); opacity: 0.7; }
          32% { transform: translate(-6px, -80px); opacity: 0.8; }
          42% { transform: translate(8px, -100px); opacity: 0.9; }
          55% { transform: translate(-4px, -115px); opacity: 0.95; }
          70% { transform: translate(3px, -110px); opacity: 1; }
          85% { transform: translate(-2px, -108px); opacity: 1; }
          100% { transform: translate(0, -105px); opacity: 1; }
        }

        /* Spike: fast zig-zag downward — "forgotten" crosses waterline */
        @keyframes orb-spike-down {
          0% { transform: translate(0, 0); opacity: 1; }
          8% { transform: translate(-6px, 20px); opacity: 0.9; }
          16% { transform: translate(8px, 40px); opacity: 0.8; }
          24% { transform: translate(-10px, 60px); opacity: 0.7; }
          32% { transform: translate(6px, 80px); opacity: 0.5; }
          42% { transform: translate(-8px, 100px); opacity: 0.4; }
          55% { transform: translate(4px, 115px); opacity: 0.3; }
          70% { transform: translate(-3px, 110px); opacity: 0.25; }
          85% { transform: translate(2px, 108px); opacity: 0.2; }
          100% { transform: translate(0, 105px); opacity: 0.18; }
        }

        /* Spike popup label animations — large and visible */
        @keyframes spike-label-up {
          0% { opacity: 0; transform: translate(-50%, 8px); }
          12% { opacity: 1; transform: translate(-50%, -20px); }
          65% { opacity: 1; transform: translate(-50%, -30px); }
          100% { opacity: 0; transform: translate(-50%, -50px); }
        }
        @keyframes spike-label-down {
          0% { opacity: 0; transform: translate(-50%, -8px); }
          12% { opacity: 1; transform: translate(-50%, 20px); }
          65% { opacity: 1; transform: translate(-50%, 30px); }
          100% { opacity: 0; transform: translate(-50%, 50px); }
        }

        .orb-active-1 { animation: orb-drift-active-1 8s ease-in-out infinite; }
        .orb-active-2 { animation: orb-drift-active-2 10s ease-in-out infinite; animation-delay: 1s; }
        .orb-active-3 { animation: orb-drift-active-3 12s ease-in-out infinite; animation-delay: 2s; }
        .orb-rise-1 { animation: orb-rise-1 14s ease-in-out infinite; }
        .orb-rise-2 { animation: orb-rise-2 16s ease-in-out infinite; animation-delay: 3s; }
        .orb-rise-3 { animation: orb-rise-3 18s ease-in-out infinite; animation-delay: 5s; }
        .orb-sink-1 { animation: orb-sink-1 10s ease-in-out infinite; }
        .orb-sink-2 { animation: orb-sink-2 12s ease-in-out infinite; animation-delay: 2s; }
        .orb-sink-3 { animation: orb-sink-3 15s ease-in-out infinite; animation-delay: 4s; }

        .orb-spiking-up {
          animation: orb-spike-up 1.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards !important;
        }
        .orb-spiking-down {
          animation: orb-spike-down 1.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards !important;
        }

        .spike-label {
          position: absolute;
          font-family: 'IBM Plex Mono';
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          white-space: nowrap;
          pointer-events: none;
          border-radius: 4px;
          padding: 4px 10px;
          z-index: 20;
        }
        .spike-label-up {
          animation: spike-label-up 2.8s ease-out forwards;
          color: ${GOLD};
          background: rgba(253, 181, 21, 0.18);
          border: 1px solid rgba(253, 181, 21, 0.5);
          box-shadow: 0 0 12px rgba(253, 181, 21, 0.25);
        }
        .spike-label-down {
          animation: spike-label-down 2.8s ease-out forwards;
          color: #a0aec0;
          background: rgba(0, 50, 98, 0.3);
          border: 1px solid rgba(0, 50, 98, 0.5);
          box-shadow: 0 0 12px rgba(0, 50, 98, 0.2);
        }

        .foer-waterline-orb {
          cursor: pointer;
          transition: filter 0.2s ease;
        }
        .foer-waterline-orb:hover {
          filter: brightness(1.3);
        }

        .foer-orb-tooltip {
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .foer-waterline-orb:hover + .foer-orb-tooltip,
        .foer-waterline-orb:hover ~ .foer-orb-tooltip {
          opacity: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .foer-waterline-orb,
          .orb-active-1, .orb-active-2, .orb-active-3,
          .orb-rise-1, .orb-rise-2, .orb-rise-3,
          .orb-sink-1, .orb-sink-2, .orb-sink-3,
          .orb-spiking-up, .orb-spiking-down,
          .spike-label-up, .spike-label-down {
            animation: none !important;
            transform: none !important;
          }
          .foer-card-glow {
            transform: none !important;
          }
          .foer-card-glow:hover .clock-spin,
          .foer-card-glow:hover .shield-shake,
          .foer-card-glow:hover .circle-collapse-1,
          .foer-card-glow:hover .circle-collapse-2 {
            transform: none !important;
            animation: none !important;
          }
        }
      `}</style>

      {/* ── A. HEADER ROW ── */}
      <div className="flex flex-col gap-3 pb-4 border-b border-[var(--foer-border-dim)] md:flex-row md:items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold" style={{ fontFamily: SERIF, color: 'var(--foer-text-pri)' }}>
            Grow & Refine
          </h2>
          <p className="text-xs italic" style={{ fontFamily: SERIF, color: 'var(--foer-text-sec)' }}>
            The weekly pass — what stays, what fades, what is never deleted
          </p>
        </div>
        
        <div>
          <span
            className="rounded border px-2.5 py-1 text-[9px] font-semibold tracking-wider uppercase"
            style={{
              fontFamily: MONO,
              borderColor: `${GOLD}60`,
              backgroundColor: `${GOLD}15`,
              color: GOLD,
            }}
          >
            refine job: AM3.1 · pending schedule
          </span>
        </div>
      </div>

      {/* ── B. LIFECYCLE RULES (3 cards) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: DEDUP */}
        <div className="foer-card-glow flex flex-col gap-3 rounded border border-[var(--foer-border-dim)] bg-[var(--foer-surface2)] p-4 transition-all duration-200">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--foer-border-dim)] text-[var(--foer-gold)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="12" r="5" className="circle-collapse-1" stroke={GOLD} />
                <circle cx="15" cy="12" r="5" className="circle-collapse-2" stroke="var(--foer-text-sec)" opacity="0.6" />
              </svg>
            </div>
            <h3 className="font-semibold tracking-wider uppercase text-[10px]" style={{ fontFamily: MONO, color: 'var(--foer-text-pri)' }}>
              DEDUP
            </h3>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--foer-text-sec)' }}>
            Cosine similarity &gt; 0.93 within the same task signature → fold counters into the higher-confidence bullet. The duplicate is marked SUPERSEDED.
          </p>
        </div>

        {/* Card 2: DECAY TTL */}
        <div className="foer-card-glow flex flex-col gap-3 rounded border border-[var(--foer-border-dim)] bg-[var(--foer-surface2)] p-4 transition-all duration-200">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--foer-border-dim)] text-[var(--foer-gold)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <defs>
                  <linearGradient id="decay-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={GOLD} />
                    <stop offset="100%" stopColor="var(--foer-bg)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <circle cx="12" cy="12" r="10" stroke="url(#decay-grad)" />
                <polyline points="12 6 12 12 16 14" stroke={GOLD} className="clock-spin" />
              </svg>
            </div>
            <h3 className="font-semibold tracking-wider uppercase text-[10px]" style={{ fontFamily: MONO, color: 'var(--foer-text-pri)' }}>
              DECAY TTL
            </h3>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--foer-text-sec)' }}>
            Rules fade by type: HARD_RULE ∞ · SCHEMA_MAP long · HEURISTIC 30–90d · SOURCE_PREF 14–30d · FAILURE_MODE 7–30d. Lower confidence decays faster.
          </p>
        </div>

        {/* Card 3: CONFLICT GC */}
        <div className="foer-card-glow flex flex-col gap-3 rounded border border-[var(--foer-border-dim)] bg-[var(--foer-surface2)] p-4 transition-all duration-200">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--foer-border-dim)] text-[var(--foer-gold)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shield-shake">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={GOLD} />
                <path d="m9 9 6 6" stroke="var(--foer-text-sec)" opacity="0.7" />
                <path d="m15 9-6 6" stroke="var(--foer-text-sec)" opacity="0.7" />
              </svg>
            </div>
            <h3 className="font-semibold tracking-wider uppercase text-[10px]" style={{ fontFamily: MONO, color: 'var(--foer-text-pri)' }}>
              CONFLICT GC
            </h3>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--foer-text-sec)' }}>
            If harmful_count &ge; helpful_count AND harmful_count &ge; 3 → SUPERSEDED. The store self-corrects against rules that caused harm.
          </p>
        </div>
      </div>

      {/* ── C & D. STATUS BUCKETS + STORE-SIZE SPARKLINE ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Status Buckets (Left, span 2 columns) */}
        <div className="flex flex-col gap-3 lg:col-span-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--foer-text-mut)]">
            Bi-Temporal Memory Partition Status
          </span>
          <div className="grid grid-cols-3 gap-3">
            {/* ACTIVE Bucket */}
            <div
              className="rounded p-4 flex flex-col gap-1 border"
              style={{
                borderColor: `${GOLD}40`,
                backgroundColor: 'var(--foer-surface2)',
              }}
            >
              <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ fontFamily: MONO, color: 'var(--foer-text-mut)' }}>
                ACTIVE
              </span>
              <span className="text-2xl font-bold font-mono" style={{ color: GOLD }}>
                {statusBuckets.ACTIVE.toLocaleString()}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--foer-text-sec)' }}>
                currently in prompt
              </span>
            </div>

            {/* SUPERSEDED Bucket */}
            <div className="rounded border border-[var(--foer-border-dim)] bg-[var(--foer-surface2)] p-4 flex flex-col gap-1 opacity-80">
              <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ fontFamily: MONO, color: 'var(--foer-text-mut)' }}>
                SUPERSEDED
              </span>
              <span className="text-2xl font-bold font-mono" style={{ color: 'var(--foer-text-pri)' }}>
                {statusBuckets.SUPERSEDED.toLocaleString()}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--foer-text-mut)' }}>
                bi-temporal: retained, not deleted
              </span>
            </div>

            {/* EXPIRED Bucket */}
            <div className="rounded border border-[var(--foer-border-dim)] bg-[var(--foer-surface2)] p-4 flex flex-col gap-1 opacity-60">
              <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ fontFamily: MONO, color: 'var(--foer-text-mut)' }}>
                EXPIRED
              </span>
              <span className="text-2xl font-bold font-mono" style={{ color: 'var(--foer-text-mut)' }}>
                {statusBuckets.EXPIRED.toLocaleString()}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--foer-text-mut)' }}>
                {statusBuckets.EXPIRED === 0 ? 'pending AM3.1' : 'faded but present'}
              </span>
            </div>
          </div>
        </div>

        {/* Store-Size Sparkline (Right, span 1 column) */}
        <div className="flex flex-col gap-2 lg:col-span-1 border border-[var(--foer-border-dim)] bg-[var(--foer-surface2)] rounded p-4 h-full min-h-[140px] justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--foer-text-mut)]">
              Store Growth Series (30d)
            </span>
            <span className="font-mono text-[10px] text-[var(--foer-text-sec)]">
              {storeSizeSeries.length >= 2 ? `${storeSizeSeries[storeSizeSeries.length - 1].active} active bullets` : 'history pending'}
            </span>
          </div>

          <div className="relative w-full h-[80px]">
            {storeSizeSeries.length >= 2 ? (
              <ReactECharts
                option={chartOption}
                style={{ height: '80px', width: '100%' }}
                opts={{ renderer: 'canvas' }}
              />
            ) : (
              <div className="flex items-center justify-center h-full border border-dashed border-[var(--foer-border-dim)] rounded bg-[var(--foer-bg)] p-2">
                <span className="font-mono text-[9px] text-center tracking-wide" style={{ color: 'var(--foer-text-mut)' }}>
                  store history available after 2+ days of data
                </span>
              </div>
            )}
          </div>

          <p className="text-[9px] leading-normal" style={{ color: 'var(--foer-text-mut)' }}>
            Growth ≈ decay when the refine job runs. Store size stays bounded.
          </p>
        </div>
      </div>

      {/* ── E. RULE LIFECYCLE WATERLINE ── */}
      <div className="flex flex-col gap-4 border-t border-[var(--foer-border-dim)] pt-5 -mx-6 px-6">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--foer-text-mut)]">
            Rule Lifecycle — Retention Waterline
          </span>
          <div className="flex items-center gap-3">
            {Object.entries(RULE_TYPE_COLORS).map(([key, color]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="font-mono text-[8px] uppercase tracking-wide" style={{ color: 'var(--foer-text-mut)' }}>
                  {key.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative w-full overflow-hidden rounded border border-[var(--foer-border-dim)]" style={{ height: '280px' }}>
          <svg className="w-full h-full" viewBox="0 0 1000 280" preserveAspectRatio="xMidYMid meet" fill="none">
            <defs>
              <linearGradient id="active-zone-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GOLD} stopOpacity="0.05" />
                <stop offset="100%" stopColor={GOLD} stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="archive-zone-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={NAVY} stopOpacity="0.08" />
                <stop offset="100%" stopColor={NAVY} stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id="waterline-glow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GOLD} stopOpacity="0" />
                <stop offset="40%" stopColor={GOLD} stopOpacity="0.25" />
                <stop offset="50%" stopColor={GOLD} stopOpacity="0.4" />
                <stop offset="60%" stopColor={GOLD} stopOpacity="0.25" />
                <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
              </linearGradient>
              <filter id="orb-glow">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="orb-dim">
                <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Active zone background */}
            <rect x="0" y="0" width="1000" height="150" fill="url(#active-zone-grad)" />
            {/* Archive zone background — distinctly darker */}
            <rect x="0" y="150" width="1000" height="130" fill="url(#archive-zone-grad)" />

            {/* Active zone label */}
            <text x="16" y="28" fontSize="9" fontFamily="var(--font-mono, 'IBM Plex Mono')" fill="var(--foer-text-mut)" opacity="0.7" letterSpacing="0.8">
              ACTIVE
            </text>
            <text x="16" y="258" fontSize="9" fontFamily="var(--font-mono, 'IBM Plex Mono')" fill="var(--foer-text-mut)" opacity="0.3" letterSpacing="0.8">
              ARCHIVE
            </text>

            {/* Waterline — high contrast band */}
            <rect x="0" y="140" width="1000" height="20" fill="url(#waterline-glow)" />
            <line x1="0" y1="150" x2="1000" y2="150" stroke={GOLD} strokeWidth="1.5" strokeDasharray="10,6" opacity="0.7" />
            <line x1="0" y1="150" x2="1000" y2="150" stroke={GOLD} strokeWidth="0.5" opacity="0.3" />
            <text x="960" y="143" fontSize="9" fontFamily="var(--font-mono, 'IBM Plex Mono')" fill={GOLD} opacity="0.85" textAnchor="end" fontWeight="600">
              waterline
            </text>

            {/* ─── GENERATED ORBS ─── */}
            {orbs.map((orb, i) => {
              const isSpiking = spike && spike.orbIndex === i;
              const spikeClass = isSpiking
                ? (spike.direction === 'up' ? 'orb-spiking-up' : 'orb-spiking-down')
                : '';
              return (
                <g
                  key={i}
                  className={`foer-waterline-orb ${isSpiking ? spikeClass : orb.animClass}`}
                  filter={orb.zone === 'active' ? 'url(#orb-glow)' : 'url(#orb-dim)'}
                  style={{ animationDelay: isSpiking ? '0s' : `${(i * 0.7) % 8}s` }}
                >
                  <circle
                    cx={orb.cx}
                    cy={orb.cy}
                    r={isSpiking ? orb.r + 4 : orb.r}
                    fill={RULE_TYPE_COLORS[orb.type]}
                    opacity={isSpiking ? 1 : orb.opacity}
                  />
                  {isSpiking && (
                    <circle
                      cx={orb.cx}
                      cy={orb.cy}
                      r={orb.r + 8}
                      fill="none"
                      stroke={RULE_TYPE_COLORS[orb.type]}
                      strokeWidth="1"
                      opacity="0.4"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Spike popup label */}
          {spike && (
            <div
              key={spike.key}
              className={`spike-label ${spike.direction === 'up' ? 'spike-label-up' : 'spike-label-down'}`}
              style={{
                left: `${(orbs[spike.orbIndex].cx / 1000) * 100}%`,
                top: spike.direction === 'up'
                  ? `${(orbs[spike.orbIndex].cy / 280) * 100 - 5}%`
                  : `${(orbs[spike.orbIndex].cy / 280) * 100 + 5}%`,
              }}
            >
              {spike.direction === 'up' ? '↑ new memory' : '↓ forgotten'}
            </div>
          )}

          {/* HTML tooltip overlay — positioned absolutely over the SVG */}
          <div className="absolute inset-0 pointer-events-none" style={{ height: '280px' }}>
            {orbs.map((orb, i) => (
              <div
                key={i}
                className="absolute pointer-events-auto group"
                style={{
                  left: `${(orb.cx / 1000) * 100}%`,
                  top: `${(orb.cy / 280) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: `${orb.r * 2 + 8}px`,
                  height: `${orb.r * 2 + 8}px`,
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              >
                <div
                  className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10"
                  style={{
                    minWidth: '150px',
                    maxWidth: '220px',
                    whiteSpace: 'normal',
                  }}
                >
                  <div
                    className="rounded px-2.5 py-1.5 shadow-md"
                    style={{
                      backgroundColor: TOOLTIP_BG,
                      border: `1px solid ${RULE_TYPE_COLORS[orb.type]}${orb.zone === 'active' ? '60' : '40'}`,
                    }}
                  >
                    <span
                      className="block text-[8px] uppercase tracking-wider font-semibold mb-0.5"
                      style={{
                        fontFamily: MONO,
                        color: orb.zone === 'active' ? RULE_TYPE_COLORS[orb.type] : `${RULE_TYPE_COLORS[orb.type]}90`,
                      }}
                    >
                      {orb.type.replace(/_/g, ' ')}{orb.zone === 'archived' ? ' · archived' : ''}
                    </span>
                    <span
                      className="block text-[10px] leading-tight"
                      style={{
                        fontFamily: MONO,
                        color: orb.zone === 'active' ? TOOLTIP_TEXT : `${TOOLTIP_TEXT}AA`,
                      }}
                    >
                      {orb.snippet}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] leading-normal" style={{ fontFamily: SERIF, color: 'var(--foer-text-sec)' }}>
            Rules above the waterline are <strong style={{ color: GOLD }}>active in prompt</strong>. Superseded and expired rules sink below — retained for audit, never deleted.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GOLD, opacity: 0.9 }} />
              <span className="font-mono text-[8px]" style={{ color: 'var(--foer-text-mut)' }}>bright = active</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: NAVY, opacity: 0.3 }} />
              <span className="font-mono text-[8px]" style={{ color: 'var(--foer-text-mut)' }}>dim = archived</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
