'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { BanditsData, CtsgvModelStat } from './bandits/types';
import { formatMs, formatPct } from './bandits/types';
import {
  BASE, CARD_BG, BORDER, GOLD, TEAL,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  SERIF, BODY, MONO,
  BORN_COLORS, CTSGV_COLORS, BASE_WEIGHTS,
  shortName,
} from '@/lib/bandits/born-tokens';
import { SuperpositionPanel, type KonamiPhase } from './bandits/SuperpositionPanel';
import { BornDistributionPanel } from './bandits/BornDistributionPanel';
import { ProbMatchPanel } from './bandits/ProbMatchPanel';
import { TaskHeatmapPanel } from './bandits/TaskHeatmapPanel';
import { PosteriorTimelinePanel } from './bandits/PosteriorTimelinePanel';
import { LiveFeedPanel } from './bandits/LiveFeedPanel';
import { FavouriteCard } from './bandits/FavouriteCard';
import { Segmented } from './bandits/Segmented';
import { PanelHeader, PANEL_PADDING } from './bandits/PanelHeader';
import { ArmDetailDrawer } from './bandits/ArmDetailDrawer';
import { type, inkOf } from '@/lib/typography/tokens';

// ?? Constants ????????????????????????????????????????????????????????????????

const WINDOWS = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

const SOURCES: { label: string; value: string | null }[] = [
  { label: 'All', value: null },
  { label: 'Ask Data', value: 'inspector' },
  { label: 'Workbench', value: 'workbench' },
  { label: 'Boost', value: 'boost' },
  { label: 'Pipeline', value: 'pipeline' },
];

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

// ?? CTSGV helpers ????????????????????????????????????????????????????????????

function effectiveWeights(model: CtsgvModelStat) {
  const slots: { key: keyof typeof BASE_WEIGHTS; value: number | null }[] = [
    { key: 'C', value: model.avg_c },
    { key: 'T', value: model.avg_t },
    { key: 'S', value: model.avg_s },
    { key: 'G', value: model.avg_g },
    { key: 'V', value: model.avg_v },
  ];
  const total = slots.reduce(
    (sum, s) => sum + (s.value != null ? BASE_WEIGHTS[s.key] : 0),
    0,
  );
  return {
    C: model.avg_c != null && total > 0 ? BASE_WEIGHTS.C / total : null,
    T: model.avg_t != null && total > 0 ? BASE_WEIGHTS.T / total : null,
    S: model.avg_s != null && total > 0 ? BASE_WEIGHTS.S / total : null,
    G: model.avg_g != null && total > 0 ? BASE_WEIGHTS.G / total : null,
    V: model.avg_v != null && total > 0 ? BASE_WEIGHTS.V / total : null,
  };
}

// ?? Formatting helpers ???????????????????????????????????????????????????????

function qualityColor(v: number | null): string {
  if (v == null) return TEXT_MUT;
  if (v > 0.60) return '#6abf8a';
  if (v > 0.50) return '#c9a04e';
  return '#e15759';
}

function providerPillStyle(provider: string): React.CSSProperties {
  if (provider === 'bedrock') {
    return {
      background: 'rgba(95,169,174,0.12)',
      color: TEAL,
      border: `1px solid rgba(95,169,174,0.30)`,
    };
  }
  return {
    background: 'rgba(201,160,78,0.12)',
    color: '#c9a04e',
    border: `1px solid rgba(201,160,78,0.30)`,
  };
}

// ?? Main component ???????????????????????????????????????????????????????????

export function BanditsDashboard() {
  const [data, setData] = useState<BanditsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  // Bumped by Refresh/Retry to refetch the same filters.
  const [reloadNonce, setReloadNonce] = useState(0);
  // `loading` is derived: the request key the UI wants vs the last one that settled.
  const requestKey = `${windowDays}|${sourceFilter ?? ''}|${reloadNonce}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const loading = settledKey !== requestKey;
  const reload = useCallback(() => setReloadNonce(n => n + 1), []);

  // MEASURE state — lifted so Superposition, Born Distribution, and Prob Match share it
  const [measureTally, setMeasureTally] = useState<Map<string, number> | null>(null);
  const [measuring, setMeasuring] = useState(false);

  // ARM DETAIL DRAWER state
  const [drawerModelId, setDrawerModelId] = useState<string | null>(null);

  // EASTER EGG 2: Konami Code — ↑↑↓↓←→←→BA collapses all posteriors
  const [konamiPhase, setKonamiPhase] = useState<KonamiPhase>('idle');
  const konamiSeqRef = useRef<string[]>([]);
  const konamiLastKeyRef = useRef(0);
  const konamiTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // EASTER EGG 3: Born Date — hover "BORN" for 3s reveals Max Born tribute
  const [bornTooltipVisible, setBornTooltipVisible] = useState(false);
  const [bornTooltipFading, setBornTooltipFading] = useState<'in' | 'out' | null>(null);
  const bornHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bornDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // State is only set in async callbacks, and a response for stale filters is dropped
  // (switching 7d → 90d quickly can no longer show the older window's data).
  useEffect(() => {
    const key = requestKey;
    const ctrl = new AbortController();
    const params = new URLSearchParams({ window: String(windowDays) });
    if (sourceFilter) params.set('source', sourceFilter);
    fetch(`/api/backfill/agent-lab/bandits?${params}`, { signal: ctrl.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setData(json);
        setError(null);
        setSettledKey(key);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setSettledKey(key);
      });
    return () => ctrl.abort();
  }, [requestKey, windowDays, sourceFilter]);

  // Clear pending easter-egg timers on unmount.
  useEffect(() => () => {
    konamiTimersRef.current.forEach(clearTimeout);
    if (bornHoverTimerRef.current) clearTimeout(bornHoverTimerRef.current);
    if (bornDismissTimerRef.current) clearTimeout(bornDismissTimerRef.current);
  }, []);

  // EASTER EGG 2: Konami Code — ↑↑↓↓←→←→BA collapses all posteriors
  // Phase timing runs here in the key handler so the panel just renders the phase.
  useEffect(() => {
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    function handleKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      if (now - konamiLastKeyRef.current > 2000) {
        konamiSeqRef.current = [];
      }
      konamiLastKeyRef.current = now;

      const expected = KONAMI[konamiSeqRef.current.length];
      if (e.code === expected) {
        konamiSeqRef.current.push(e.code);
        if (konamiSeqRef.current.length === KONAMI.length) {
          konamiSeqRef.current = [];
          konamiTimersRef.current.forEach(clearTimeout);
          setKonamiPhase('collapsing');
          konamiTimersRef.current = [
            setTimeout(() => setKonamiPhase('expanding'), 3000),
            setTimeout(() => setKonamiPhase('idle'), 4500),
          ];
        }
      } else {
        konamiSeqRef.current = [];
        if (e.code === KONAMI[0]) {
          konamiSeqRef.current.push(e.code);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ?? Derived values ??????????????????????????????????????????????????????

  const ctsgvModels: CtsgvModelStat[] = data?.ctsgvModelStats ?? [];

  const sorted = useMemo(() => [...ctsgvModels].sort((a, b) => {
    const av = a.avg_composite ?? -1;
    const bv = b.avg_composite ?? -1;
    return bv - av;
  }), [ctsgvModels]);

  const favId = data?.favourite_model ?? sorted[0]?.model_id ?? '';
  const favProb = data?.favourite_prob ?? 0;
  const entropy = data?.belief_entropy ?? null;
  const totalObs = (data as unknown as Record<string, unknown>)?.totalObservations as number | undefined
    ?? data?.totalModelPulls
    ?? 0;
  const explorationPct = data?.exploration_pct
    ?? (sorted.length > 0
      ? sorted.filter(m => m.phase === 'exploring').length / sorted.length
      : 0);
  const sgCoverage = sorted.length > 0
    ? sorted.reduce((s, m) => s + (m.sg_coverage ?? 0), 0) / sorted.length
    : 0;

  // Build a model_id-keyed Map from the API's parallel born_probs array.
  // This is the index-stable source for BornDistributionPanel and ProbMatchPanel.
  const bornProbsMap = useMemo(() => {
    const map = new Map<string, number>();
    const probs = data?.born_probs ?? [];
    sorted.forEach((stat, i) => {
      map.set(stat.model_id, probs[i] ?? stat.born_prob ?? 0);
    });
    return map;
  }, [data, sorted]);

  // Favourite is chosen by Born probability, which need not be the top composite row.
  const favStat = sorted.find(s => s.model_id === favId);
  const exploringCount = sorted.filter(m => m.phase === 'exploring').length;
  const runnerUp = useMemo(() => {
    let best: { modelId: string; p: number } | null = null;
    bornProbsMap.forEach((p, modelId) => {
      if (modelId !== favId && (!best || p > best.p)) best = { modelId, p };
    });
    return best as { modelId: string; p: number } | null;
  }, [bornProbsMap, favId]);

  // ?? Loading state ???????????????????????????????????????????????????????

  if (loading && !data) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', background: BASE, fontFamily: BODY,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Loader2 style={{ width: 28, height: 28, color: GOLD }} className="animate-spin" />
          <span style={{ color: TEXT_MUT, fontSize: 'var(--type-ui-regular-size)', fontFamily: 'var(--font-sans)' }}>
            Collapsing belief state?
          </span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', background: BASE, fontFamily: BODY,
      }}>
        <div style={{
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 'var(--born-r-card)',
          padding: '32px 40px', textAlign: 'center', maxWidth: 400,
        }}>
          <p style={{ color: inkOf('#e15759'), fontWeight: 600, marginBottom: 8 }}>Failed to load</p>
          <p style={{ color: TEXT_MUT, fontSize: 'var(--type-ui-regular-size)', marginBottom: 20 }}>{error}</p>
          <button
            onClick={reload}
            style={{
              padding: '8px 20px', borderRadius: 'var(--born-r-control)', border: `1px solid ${GOLD}`,
              background: 'transparent', color: inkOf(GOLD), fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ?? Page ????????????????????????????????????????????????????????????????

  return (
    <div style={{
      background: 'transparent',
      minWidth: 1280,
      fontFamily: BODY,
      color: TEXT_PRI,
      padding: '30px 34px',
    }}>
      <div style={{
        maxWidth: 1380,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}>

        {/* ── 1–2. HERO — title + measured favourite ───────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(460px, 560px)',
          gap: 40,
          alignItems: 'center',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...type.eyebrow, color: TEXT_MUT, marginBottom: 14 }}>
              Agent Lab · Thompson-sampling model router
            </div>

            {/* EASTER EGG 3: Born Date — hover "BORN" for 3s reveals Max Born tribute */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <div
                style={{
                  fontFamily: SERIF, fontSize: 'var(--type-display-size)', fontWeight: 600,
                  color: inkOf(GOLD), lineHeight: 1, marginBottom: 14,
                  cursor: 'default',
                }}
                onMouseEnter={() => {
                  bornHoverTimerRef.current = setTimeout(() => {
                    setBornTooltipVisible(true);
                    setBornTooltipFading('in');
                    bornDismissTimerRef.current = setTimeout(() => {
                      setBornTooltipFading('out');
                      setTimeout(() => {
                        setBornTooltipVisible(false);
                        setBornTooltipFading(null);
                      }, 300);
                    }, 5000);
                  }, 3000);
                }}
                onMouseLeave={() => {
                  if (bornHoverTimerRef.current) {
                    clearTimeout(bornHoverTimerRef.current);
                    bornHoverTimerRef.current = null;
                  }
                }}
              >
                BORN
              </div>
              {bornTooltipVisible && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 'var(--born-r-inner)',
                  padding: '10px 16px',
                  width: 380,
                  zIndex: 30,
                  opacity: bornTooltipFading === 'out' ? 0 : 1,
                  transition: 'opacity 300ms ease',
                }}>
                  <div style={{ ...type.caption, fontFamily: MONO, color: TEXT_SEC, lineHeight: 1.8 }}>
                    <div>Max Born &middot; 1882–1970 &middot; Nobel 1954</div>
                    <div style={{ fontStyle: 'italic' }}>The Born rule: outcomes occur in proportion to |&psi;|&sup2;.</div>
                    <div>This system routes LLMs the same way.</div>
                  </div>
                </div>
              )}
            </div>

            {/* Narrative */}
            <p style={{
              ...type['body-lg'], fontStyle: 'italic',
              color: TEXT_SEC, margin: 0, maxWidth: 620,
            }}>
              {countWord(sorted.length)} model{sorted.length === 1 ? '' : 's'} in superposition. Every run is a
              measurement; every measurement collapses belief. The favourite isn&apos;t chosen — it&apos;s
              measured into being.
            </p>
          </div>

          {favId && (
            <FavouriteCard stat={favStat} favId={favId} favProb={favProb} runnerUp={runnerUp} />
          )}
        </div>

        {/* Toolbar — filters apply to every panel below */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexWrap: 'wrap',
          paddingTop: 16, borderTop: `1px solid ${BORDER}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <Segmented
              label="Window"
              options={WINDOWS}
              value={windowDays}
              onChange={setWindowDays}
            />
            <Segmented
              label="Source"
              options={SOURCES}
              value={sourceFilter}
              onChange={setSourceFilter}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {loading && (
              <span role="status" style={{ ...type.caption, color: TEXT_MUT, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Loader2 style={{ width: 14, height: 14, color: GOLD }} className="animate-spin" />
                Updating…
              </span>
            )}
            {error && data && !loading && (
              <span role="alert" style={{ ...type.caption, color: inkOf('#e15759') }}>
                Refresh failed: {error}
              </span>
            )}
            <button type="button" className="born-btn" onClick={reload} disabled={loading} style={type.ui}>
              <RefreshCw style={{ width: 14, height: 14 }} aria-hidden />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: -12 }}>
          <KpiCard
            label="Observations"
            value={totalObs.toLocaleString()}
            hint={`${sorted.length} arms · last ${windowDays} days`}
          />
          <KpiCard
            label="Exploration"
            value={formatPct(explorationPct)}
            hint={`${exploringCount} of ${sorted.length} arms still exploring`}
            meter={explorationPct}
            meterColor={TEAL}
          />
          <KpiCard
            label="S/G coverage"
            value={formatPct(sgCoverage)}
            hint="Runs with a judged S/G score"
            meter={sgCoverage}
            meterColor={TEAL}
          />
          <KpiCard
            label="Belief entropy"
            value={entropy != null ? entropy.toFixed(3) : '--'}
            hint={entropy == null ? 'No posterior yet'
              : entropy < 0.5 ? 'Converging · 0 = certain, 1 = uniform'
              : 'Still spread · 0 = certain, 1 = uniform'}
            meter={entropy}
            meterColor={entropy != null && entropy < 0.5 ? GOLD : TEAL}
          />
        </div>
        {/* ── 3. SIGNATURE VIZ — Superposition + Born Distribution ──────────── */}
        {sorted.length > 0 && (
          <>
            {/* Row: Superposition (60%) + Born Distribution (40%) */}
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 58%', minWidth: 560 }}>
                <SuperpositionPanel
                  stats={sorted}
                  favId={favId}
                  onMeasureStart={() => {
                    setMeasuring(true);
                    setMeasureTally(null);
                  }}
                  onTallySnapshot={snap => setMeasureTally(snap)}
                  onMeasureComplete={tally => {
                    setMeasureTally(tally);
                    setMeasuring(false);
                  }}
                  onReset={() => {
                    setMeasureTally(null);
                    setMeasuring(false);
                  }}
                  konamiPhase={konamiPhase}
                />
              </div>
              <div style={{ flex: '1 1 38%', minWidth: 320 }}>
                <BornDistributionPanel
                  stats={sorted}
                  favId={favId}
                  bornProbs={bornProbsMap}
                  tally={measureTally}
                  measuring={measuring}
                />
              </div>
            </div>

            {/* Full-width: Probability Matching Check */}
            <ProbMatchPanel
              stats={sorted}
              favId={favId}
              bornProbs={bornProbsMap}
              tally={measureTally}
            />
          </>
        )}

        {/* ── 4. LEADERBOARD ─────────────────────────────────────────────────── */}
        {sorted.length > 0 && (
          <div className="born-card" style={{ padding: PANEL_PADDING }}>
            <PanelHeader
              title="Leaderboard"
              meta={`${sorted.length} arms`}
              subtitle="Ranked by average quality · click or press Enter on a row for arm details"
            />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                <thead>
                  <tr>
                    {LEADERBOARD_COLS.map(h => (
                      <th
                        key={h}
                        style={{
                          ...type.eyebrow, color: TEXT_MUT,
                          padding: '0 12px 10px',
                          textAlign: (h === '#' || h === 'Model') ? 'left' : 'right',
                          borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((model, idx) => {
                    const isFav = model.model_id === favId;
                    const dot = isFav ? GOLD : BORN_COLORS[idx % BORN_COLORS.length];
                    const p = bornProbsMap.get(model.model_id) ?? 0;
                    const num: React.CSSProperties = {
                      ...type.caption, fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                      padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap',
                    };
                    const open = () => setDrawerModelId(model.model_id);
                    return (
                      <tr
                        key={model.model_id}
                        className="born-row"
                        tabIndex={0}
                        aria-label={`${shortName(model.model_id)}, rank ${idx + 1}. Open details`}
                        onClick={open}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                        }}
                        style={{ borderBottom: '1px solid var(--born-overlay-2)' }}
                      >
                        {/* Rank (favourite gets a gold edge) */}
                        <td style={{
                          ...num, textAlign: 'left', width: 44, fontWeight: 600,
                          color: idx === 0 ? inkOf(GOLD, 70) : TEXT_MUT,
                          boxShadow: isFav ? `inset 2px 0 0 ${GOLD}` : undefined,
                        }}>
                          {idx + 1}
                        </td>
                        {/* Model */}
                        <td style={{ padding: '10px 12px', maxWidth: 280 }}>
                          <div title={model.model_id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                            <span style={{
                              ...type.ui, color: isFav ? inkOf(GOLD, 70) : TEXT_PRI,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {shortName(model.model_id)}
                            </span>
                          </div>
                        </td>
                        {/* Provider */}
                        <td style={{ ...num }}>
                          <span style={{
                            ...providerPillStyle(model.provider),
                            padding: '1px 8px', borderRadius: 999, display: 'inline-block',
                          }}>
                            {model.provider}
                          </span>
                        </td>
                        <td style={{ ...num, color: TEXT_SEC }}>{model.total_pulls.toLocaleString()}</td>
                        {/* Success rate */}
                        <td style={{ ...num, minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                            <div style={{ width: 64, height: 4, background: 'var(--born-overlay-2)', borderRadius: 999, overflow: 'hidden' }}>
                              <div style={{ width: `${model.success_rate * 100}%`, height: '100%', background: dot, borderRadius: 999 }} />
                            </div>
                            <span style={{ color: TEXT_PRI, minWidth: 48 }}>{formatPct(model.success_rate)}</span>
                          </div>
                        </td>
                        <td style={{ ...num, color: inkOf(qualityColor(model.avg_composite), 75) }}>
                          {model.avg_composite != null ? formatPct(model.avg_composite) : '--'}
                        </td>
                        <td style={{ ...num, color: TEXT_MUT }}>{formatMs(model.avg_duration_ms)}</td>
                        <td style={{ ...num, color: isFav ? inkOf(GOLD, 70) : TEXT_SEC, fontWeight: isFav ? 600 : 400 }}>
                          {formatPct(p)}
                        </td>
                        {/* Phase */}
                        <td style={{ ...num }}>
                          <PhasePill phase={model.phase} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 5. REWARD ANATOMY (CTSGV) ─────────────────────────────────────── */}
        {/* Shows each arm's average score per axis (bar length = score, column = weight).
            The old view drew only the weight split, which is identical for every fully-judged arm. */}
        {sorted.length > 0 && (
          <div className="born-card" style={{ padding: PANEL_PADDING }}>
            <PanelHeader
              title="Reward Anatomy"
              subtitle="CTSGV · average score per axis (0–100%) · column header shows the axis weight"
            />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                <thead>
                  <tr>
                    <th style={{ ...type.eyebrow, color: TEXT_MUT, textAlign: 'left', padding: '0 12px 10px 0', borderBottom: `1px solid ${BORDER}` }}>
                      Model
                    </th>
                    <th style={{ ...type.eyebrow, color: TEXT_MUT, textAlign: 'right', padding: '0 12px 10px', borderBottom: `1px solid ${BORDER}` }}>
                      Composite
                    </th>
                    {CTSGV_AXES.map(a => (
                      <th key={a.key} style={{ textAlign: 'left', padding: '0 12px 10px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }}>
                        <span style={{ ...type.eyebrow, color: inkOf(CTSGV_COLORS[a.key], 70) }}>{a.key} · {a.name}</span>
                        <span style={{ ...type.caption, color: TEXT_MUT, marginLeft: 6 }}>{Math.round(BASE_WEIGHTS[a.key] * 100)}%</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((model, idx) => {
                    const isFav = model.model_id === favId;
                    const weights = effectiveWeights(model);
                    return (
                      <tr key={model.model_id} style={{ borderBottom: '1px solid var(--born-overlay-2)' }}>
                        <td style={{ padding: '10px 12px 10px 0', maxWidth: 240 }}>
                          <div title={model.model_id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                              background: isFav ? GOLD : BORN_COLORS[idx % BORN_COLORS.length],
                            }} />
                            <span style={{
                              ...type.ui, color: isFav ? inkOf(GOLD, 70) : TEXT_PRI,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {shortName(model.model_id)}
                            </span>
                          </div>
                        </td>
                        <td style={{
                          ...type.caption, fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                          padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap',
                          color: inkOf(qualityColor(model.avg_composite), 75), fontWeight: 600,
                        }}>
                          {model.avg_composite != null ? formatPct(model.avg_composite) : '--'}
                        </td>
                        {CTSGV_AXES.map(a => {
                          const v = model[a.field];
                          const w = weights[a.key];
                          return (
                            <td key={a.key} style={{ padding: '10px 12px', minWidth: 120 }}>
                              <AxisCell
                                value={v}
                                color={CTSGV_COLORS[a.key]}
                                title={v == null
                                  ? `${a.name}: not judged yet`
                                  : `${a.name}: ${formatPct(v)} · effective weight ${w != null ? `${(w * 100).toFixed(0)}%` : '—'}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{
              ...type.caption, color: TEXT_MUT,
              marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}`,
              display: 'flex', gap: 16, flexWrap: 'wrap',
            }}>
              <span>Hatched = not judged yet (S/G are filled by the async judge).</span>
              <span>Unavailable axes are redistributed out of the composite.</span>
              <span>Outcome gate caps: truncated → 0.18 (context) / 0.35 (SQL-only), errored → 0.10.</span>
            </div>
          </div>
        )}

        {/* ── 6. WHERE EACH ARM WINS — task-type × model heatmap ─────────────── */}
        {sorted.length > 0 && (
          <TaskHeatmapPanel stats={sorted} favId={favId} />
        )}

        {/* ── 7. POSTERIOR EVOLUTION — stacked area allocation timeline ───────── */}
        <PosteriorTimelinePanel
          allocationSeries={data?.allocationSeries ?? []}
          stats={sorted}
          favId={favId}
        />

        {/* ── 8. LIVE FEED ─────────────────────────────────────────────────────── */}
        <LiveFeedPanel recentRuns={data?.recentRuns ?? []} favId={favId} />

      </div>

      {/* ── ARM DETAIL DRAWER ──────────────────────────────────────────────────── */}
      {drawerModelId && (
        <ArmDetailDrawer
          stat={sorted.find(s => s.model_id === drawerModelId)!}
          rank={sorted.findIndex(s => s.model_id === drawerModelId) + 1}
          favId={favId}
          recentRuns={data?.recentRuns ?? []}
          isOpen={!!drawerModelId}
          onClose={() => setDrawerModelId(null)}
        />
      )}
    </div>
  );
}

// ── Table helpers ─────────────────────────────────────────────────────────────

const LEADERBOARD_COLS = ['#', 'Model', 'Provider', 'Pulls', 'Success rate', 'Avg quality', 'Avg duration', 'P(next)', 'Phase'];

/** Axis names from src/lib/lifecycle/score-ctsgv.ts. */
const CTSGV_AXES = [
  { key: 'C', name: 'Cost', field: 'avg_c' },
  { key: 'T', name: 'Tool', field: 'avg_t' },
  { key: 'S', name: 'Semantic', field: 'avg_s' },
  { key: 'G', name: 'Grounds', field: 'avg_g' },
  { key: 'V', name: 'Verify', field: 'avg_v' },
] as const satisfies readonly { key: keyof typeof BASE_WEIGHTS; name: string; field: keyof CtsgvModelStat }[];

function PhasePill({ phase }: { phase: CtsgvModelStat['phase'] }) {
  const exploiting = phase === 'exploiting';
  return (
    <span style={{
      ...type.caption,
      padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', display: 'inline-block',
      color: exploiting ? inkOf(TEAL, 70) : TEXT_SEC,
      background: exploiting ? `color-mix(in srgb, ${TEAL} 14%, transparent)` : 'var(--born-overlay-2)',
    }}>
      {phase}
    </span>
  );
}

function AxisCell({ value, color, title }: { value: number | null; color: string; title: string }) {
  const pending = value == null;
  return (
    <div title={title} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, minWidth: 48, height: 6, borderRadius: 999, overflow: 'hidden',
        background: pending
          ? `repeating-linear-gradient(45deg, color-mix(in srgb, ${color} 35%, transparent) 0 2px, transparent 2px 6px)`
          : 'var(--born-overlay-2)',
      }}>
        {!pending && (
          <div style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%',
            background: color, borderRadius: 999,
          }} />
        )}
      </div>
      <span style={{
        ...type.caption, fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
        color: pending ? TEXT_MUT : TEXT_SEC, minWidth: 40, textAlign: 'right',
      }}>
        {pending ? '—' : `${Math.round(value * 100)}%`}
      </span>
    </div>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, hint, meter, meterColor = TEAL,
}: {
  label: string;
  value: string;
  hint?: string;
  meter?: number | null;
  meterColor?: string;
}) {
  return (
    <div className="born-card" style={{ padding: '16px 18px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...type.eyebrow, color: TEXT_MUT }}>{label}</div>
      <div style={{
        ...type['kpi-lg'], color: TEXT_PRI,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
      {/* Track always takes its row so every tile's hint lines up, meter or not. */}
      <div
        aria-hidden
        style={{
          height: 4, background: 'var(--born-overlay-2)', borderRadius: 999, overflow: 'hidden',
          visibility: meter != null ? 'visible' : 'hidden',
        }}
      >
        <div style={{
          width: `${Math.max(0, Math.min((meter ?? 0) * 100, 100))}%`,
          height: '100%', background: meterColor, borderRadius: 999,
          transition: 'width 300ms ease',
        }} />
      </div>
      {hint && (
        <div title={hint} style={{
          ...type.caption, color: TEXT_MUT,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}
