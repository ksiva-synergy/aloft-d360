'use client';

import { FlaskConical } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  useBoostResults,
  ContextBoostTab,
  ModelMatrixTab,
  BenchmarkSuiteTab,
  ScoringMethodologyTab,
} from '@/components/inspector/BoostTabs';
import { BOOST_V2_SUMMARY } from '@/lib/boost/v2-summary';

// ── Brand tokens ─────────────────────────────────────────────────────────────
// Accent colors are literal (they're concatenated with hex-opacity suffixes and
// read on both themes). Surface/text/border tokens resolve from the `--pl-*` CSS
// custom properties defined in globals.css (`:root` light + `.dark` override),
// so they flip with the global light/dark toggle — no per-component theme hook.
const GOLD   = '#FDB515';
const NAVY   = '#003262';
const BG     = 'var(--pl-bg)';
const SURF   = 'var(--pl-surf)';
const SURF2  = 'var(--pl-surf2)';
const BORDER = 'var(--pl-border)';
const TXT    = 'var(--pl-txt)';
const TXT2   = 'var(--pl-txt2)';
const GREEN  = '#22c55e';
const BLUE   = '#3A7BD5';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

// ── Value Summary Hero ────────────────────────────────────────────────────────
const heroCardOuter: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 180,
  background: SURF,
  border: `1px solid ${BORDER}`,
  borderLeft: `4px solid ${GOLD}`,
  borderRadius: 6,
  padding: '16px 18px',
};
const heroStat: React.CSSProperties = {
  fontFamily: "'Source Serif 4',Georgia,serif",
  fontSize: 26,
  fontWeight: 700,
  color: TXT,
  lineHeight: 1.1,
  marginBottom: 6,
};
const heroLabel: React.CSSProperties = {
  ...mono,
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: GOLD,
  marginBottom: 10,
  fontWeight: 600,
};
const heroSub: React.CSSProperties = {
  fontFamily: "'Inter Tight', sans-serif",
  fontSize: 11.5,
  color: TXT2,
  lineHeight: 1.45,
};

function ValueSummaryHero() {
  const S = BOOST_V2_SUMMARY;
  return (
    <div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 6 }}>
        CONTEXT HARNESS — VALUE SUMMARY
      </div>
      <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 18, fontWeight: 600, color: TXT, marginBottom: 16 }}>
        {S.totalRuns} runs · {S.models} models · {S.cases} cases
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={heroCardOuter}>
          <div style={heroLabel}>DISCOVERY BURN</div>
          <div style={heroStat}>up to {S.discoveryBurnMax.toFixed(0)}x</div>
          <div style={heroSub}>
            SQL-only burns 3–{S.discoveryBurnMax.toFixed(0)}x more tokens on schema discovery.
            Harness discovery calls = {S.ctxDiscoveryCalls}.
          </div>
        </div>
        <div style={heroCardOuter}>
          <div style={heroLabel}>TIME TO ANSWER</div>
          <div style={heroStat}>{S.callsToFirstQuery.ctx} calls</div>
          <div style={heroSub}>
            Harness reaches the first real query in {S.callsToFirstQuery.ctx} calls vs {S.callsToFirstQuery.sql} for SQL-only.
          </div>
        </div>
        <div style={heroCardOuter}>
          <div style={heroLabel}>COMPLETION RATE</div>
          <div style={heroStat}>+56–66 pp</div>
          <div style={heroSub}>
            Higher completion at every difficulty tier. {S.cases} of 10 cases discriminate strongly.
          </div>
        </div>
        <div style={heroCardOuter}>
          <div style={heroLabel}>MODEL INVERSION</div>
          <div style={heroStat}>value &gt; frontier</div>
          <div style={heroSub}>
            A value-tier model + harness completes {S.inversion.valueHardCtx} hard cases.
            A frontier model + tools: {S.inversion.frontierHardSql}.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: '14px 18px', borderLeft: `3px solid ${GOLD}`, background: SURF }}>
        <span style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginRight: 8 }}>TAKEAWAY</span>
        <span style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 13.5, color: TXT, lineHeight: 1.55 }}>
          The harness solves discovery access, not reasoning — answer quality is at parity when both complete
          (semantic {S.semanticParity.ctxHard.toFixed(2)} vs {S.semanticParity.sqlHard.toFixed(2)} on the hard tier).
          The advantage is that the harness lets answers exist at all.
        </span>
      </div>
    </div>
  );
}

// ── Historical stats (from /api/inspector/performance) ────────────────────────
interface HistoricalStat {
  modelKey: string;
  modelLabel: string;
  contextMode: 'harvested' | 'warehouse_only';
  sessions: number;
  avgTokens: number;
  avgLatencyMs: number;
  avgLoops: number;
  avgWarehouseCalls: number;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function HistoricalSection({ stats }: { stats: HistoricalStat[] }) {
  if (!stats.length) {
    return (
      <div style={{ ...mono, fontSize: 12, color: TXT2, textAlign: 'center', padding: '32px 0' }}>
        No historical data yet. Complete inspector sessions to populate this view.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 11 }}>
        <thead>
          <tr>
            {['Model', 'Mode', 'Sessions', 'Avg Tokens', 'Avg Latency', 'Avg Loops', 'Avg WH Calls'].map(h => (
              <th key={h} style={{
                textAlign: 'right', padding: '5px 8px',
                color: TXT2, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                borderBottom: `1px solid ${BORDER}`,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => {
            const isCtx = s.contextMode === 'harvested';
            return (
              <tr key={`${s.modelKey}-${s.contextMode}`} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--pl-stripe)' }}>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: GOLD, borderBottom: `1px solid var(--pl-hair2)` }}>{s.modelLabel}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid var(--pl-hair2)` }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9,
                    background: isCtx ? 'rgba(253,181,21,0.1)' : 'rgba(58,123,213,0.12)',
                    color: isCtx ? GOLD : BLUE,
                    border: `1px solid ${isCtx ? 'rgba(253,181,21,0.25)' : 'rgba(58,123,213,0.3)'}`,
                  }}>
                    {isCtx ? 'CTX' : 'SQL'}
                  </span>
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid var(--pl-hair2)` }}>{s.sessions}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid var(--pl-hair2)` }}>{fmt(s.avgTokens)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT, borderBottom: `1px solid var(--pl-hair2)` }}>{fmtMs(s.avgLatencyMs)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid var(--pl-hair2)` }}>{fmt(s.avgLoops, 1)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: TXT2, borderBottom: `1px solid var(--pl-hair2)` }}>{fmt(s.avgWarehouseCalls, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type TabId = 'boost' | 'matrix' | 'benchmark' | 'methodology' | 'historical';

const TABS: { id: TabId; label: string }[] = [
  { id: 'boost',       label: 'CONTEXT BOOST A/B' },
  { id: 'matrix',      label: 'MODEL × CONTEXT' },
  { id: 'benchmark',   label: 'BENCHMARK SUITE' },
  { id: 'methodology', label: 'SCORING METHODOLOGY' },
  { id: 'historical',  label: 'HISTORICAL' },
];

export default function PerformanceLabPage() {
  const [activeTab, setActiveTab] = useState<TabId>('boost');
  const { data: boostData, loading: boostLoading, fetchBoostResults } = useBoostResults();
  const [historicalStats, setHistoricalStats] = useState<HistoricalStat[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => {
    fetchBoostResults();
  }, [fetchBoostResults]);

  useEffect(() => {
    if (activeTab === 'historical' && !histLoading && !historicalStats.length) {
      setHistLoading(true);
      fetch('/api/inspector/performance')
        .then(r => r.ok ? r.json() : { stats: [] })
        .then(d => setHistoricalStats(d.stats ?? []))
        .catch(() => {})
        .finally(() => setHistLoading(false));
    }
  }, [activeTab, histLoading, historicalStats.length]);

  function handleTabClick(id: TabId) {
    setActiveTab(id);
    if (id !== 'historical') fetchBoostResults();
  }

  return (
    <div style={{ minHeight: '100%', background: BG, display: 'flex', flexDirection: 'column' }}>
      {/* Page header */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '20px 48px 16px',
        borderBottom: `1px solid ${BORDER}`,
        background: SURF,
        flexShrink: 0,
      }}>
        <FlaskConical size={20} style={{ color: GOLD }} />
        <div>
          <div style={{ ...mono, fontSize: 15, color: GOLD, fontWeight: 700, letterSpacing: '0.08em' }}>
            PERFORMANCE LAB
          </div>
          <div style={{ ...mono, fontSize: 10, color: TXT2, marginTop: 2 }}>
            context harness research · benchmark suite · scoring methodology
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span style={{
            ...mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
            borderRadius: 4, padding: '4px 10px', border: `1px solid ${BORDER}`,
            color: TXT2, background: 'transparent',
          }}>
            v0.2
          </span>
        </div>
      </header>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Hero section */}
        <section style={{
          padding: '36px 48px 28px',
          borderBottom: `1px solid ${BORDER}`,
          maxWidth: 1400, margin: '0 auto', width: '100%',
        }}>
          <ValueSummaryHero />
        </section>

        {/* Sticky tab bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: BG, borderBottom: `1px solid ${BORDER}`,
          padding: '0 48px',
          maxWidth: 1400, margin: '0 auto', width: '100%',
        }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => handleTabClick(t.id)}
                style={{
                  padding: '12px 18px', background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${activeTab === t.id ? GOLD : 'transparent'}`,
                  cursor: 'pointer', ...mono, fontSize: 10.5, letterSpacing: '0.08em',
                  color: activeTab === t.id ? GOLD : TXT2, transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <main style={{
          padding: '28px 48px 64px',
          maxWidth: 1400, margin: '0 auto', width: '100%',
          display: 'flex', flexDirection: 'column', gap: 32,
        }}>
          {activeTab === 'boost' && (
            <ContextBoostTab data={boostData} loading={boostLoading} />
          )}
          {activeTab === 'matrix' && (
            <ModelMatrixTab data={boostData} loading={boostLoading} />
          )}
          {activeTab === 'benchmark' && (
            <BenchmarkSuiteTab data={boostData} loading={boostLoading} />
          )}
          {activeTab === 'methodology' && (
            <ScoringMethodologyTab data={boostData} loading={boostLoading} />
          )}
          {activeTab === 'historical' && (
            <div>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 8 }}>
                Aggregated across all inspector sessions
              </div>
              <h2 style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 600, fontSize: 21, margin: '0 0 4px', color: TXT }}>
                Historical Benchmarks
              </h2>
              <p style={{ color: TXT2, fontSize: 13.5, maxWidth: '70ch', margin: '0 0 24px' }}>
                Per-model, per-context-mode averages across all Inspector sessions pulled from the database.
              </p>
              {histLoading ? (
                <div style={{ ...mono, fontSize: 12, color: TXT2, textAlign: 'center', padding: '32px' }}>
                  Loading historical data…
                </div>
              ) : (
                <HistoricalSection stats={historicalStats} />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer style={{
        padding: '8px 32px', flexShrink: 0, borderTop: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: SURF,
      }}>
        <span style={{ ...mono, fontSize: 9, color: TXT2, letterSpacing: '0.06em' }}>
          ALOFT PERFORMANCE LAB · v0.2 · context harness research
        </span>
        <span style={{ ...mono, fontSize: 9, color: 'rgba(253,181,21,0.35)', letterSpacing: '0.06em' }}>
          POWERED BY ALOFT · v0.4
        </span>
      </footer>
    </div>
  );
}
