'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { BanditsData, CtsgvModelStat } from './bandits/types';
import { formatMs, formatPct } from './bandits/types';
import {
  BASE, CARD_BG, BORDER, GOLD, TEAL,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  SERIF, BODY, MONO,
  BORN_COLORS, CTSGV_COLORS, BASE_WEIGHTS,
  shortName,
} from '@/lib/bandits/born-tokens';
import { SuperpositionPanel } from './bandits/SuperpositionPanel';
import { BornDistributionPanel } from './bandits/BornDistributionPanel';
import { ProbMatchPanel } from './bandits/ProbMatchPanel';
import { TaskHeatmapPanel } from './bandits/TaskHeatmapPanel';
import { PosteriorTimelinePanel } from './bandits/PosteriorTimelinePanel';
import { LiveFeedPanel } from './bandits/LiveFeedPanel';
import { BornVerdict } from './bandits/BornVerdict';
import { ArmDetailDrawer } from './bandits/ArmDetailDrawer';

// ?? Constants ????????????????????????????????????????????????????????????????

const WINDOWS = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

const SOURCES: { label: string; value: string | null }[] = [
  { label: 'All', value: null },
  { label: 'Inspector', value: 'inspector' },
  { label: 'Workbench', value: 'workbench' },
  { label: 'Boost', value: 'boost' },
  { label: 'Pipeline', value: 'pipeline' },
];

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  // MEASURE state — lifted so Superposition, Born Distribution, and Prob Match share it
  const [measureTally, setMeasureTally] = useState<Map<string, number> | null>(null);
  const [measuring, setMeasuring] = useState(false);

  // ARM DETAIL DRAWER state
  const [drawerModelId, setDrawerModelId] = useState<string | null>(null);

  // EASTER EGG 2: Konami Code — ↑↑↓↓←→←→BA collapses all posteriors
  const [konamiCollapse, setKonamiCollapse] = useState(false);
  const konamiSeqRef = useRef<string[]>([]);
  const konamiLastKeyRef = useRef(0);

  // EASTER EGG 3: Born Date — hover "BORN" for 3s reveals Max Born tribute
  const [bornTooltipVisible, setBornTooltipVisible] = useState(false);
  const [bornTooltipFading, setBornTooltipFading] = useState<'in' | 'out' | null>(null);
  const bornHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bornDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ window: String(windowDays) });
      if (sourceFilter) params.set('source', sourceFilter);
      const res = await fetch(`/api/backfill/agent-lab/bandits?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [windowDays, sourceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // EASTER EGG 2: Konami Code — ↑↑↓↓←→←→BA collapses all posteriors
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
          setKonamiCollapse(true);
          setTimeout(() => setKonamiCollapse(false), 100);
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

  const sorted = [...ctsgvModels].sort((a, b) => {
    const av = a.avg_composite ?? -1;
    const bv = b.avg_composite ?? -1;
    return bv - av;
  });

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

  // ?? Loading state ???????????????????????????????????????????????????????

  if (loading && !data) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', background: BASE, fontFamily: BODY,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Loader2 style={{ width: 28, height: 28, color: GOLD }} className="animate-spin" />
          <span style={{ color: TEXT_MUT, fontSize: 13, fontFamily: MONO }}>
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
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6,
          padding: '32px 40px', textAlign: 'center', maxWidth: 400,
        }}>
          <p style={{ color: '#e15759', fontWeight: 600, marginBottom: 8 }}>Failed to load</p>
          <p style={{ color: TEXT_MUT, fontSize: 13, marginBottom: 20 }}>{error}</p>
          <button
            onClick={fetchData}
            style={{
              padding: '8px 20px', borderRadius: 6, border: `1px solid ${GOLD}`,
              background: 'transparent', color: GOLD, fontFamily: MONO, fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ?? Shared style constants ??????????????????????????????????????????????

  const cardStyle: React.CSSProperties = {
    background: CARD_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: '20px 24px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontFamily: SERIF,
    fontSize: 18,
    fontWeight: 600,
    color: TEXT_PRI,
    marginBottom: 4,
  };

  // ?? Page ????????????????????????????????????????????????????????????????

  return (
    <div style={{
      background: BASE,
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

        {/* ?? 1. BREADCRUMB ???????????????????????????????????????????????? */}
        <div style={{
          fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em',
          color: TEXT_MUT, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>SPINOR LABS</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>ALOFT � AGENT LAB</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ color: GOLD }}>BORN</span>
        </div>

        {/* ?? 2. HERO ?????????????????????????????????????????????????????? */}
        <div>
          {/* EASTER EGG 3: Born Date — hover "BORN" for 3s reveals Max Born tribute */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div
              style={{
                fontFamily: SERIF, fontSize: 44, fontWeight: 700,
                color: GOLD, lineHeight: 1, marginBottom: 12,
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
                borderRadius: 6,
                padding: '10px 16px',
                maxWidth: 380,
                zIndex: 30,
                opacity: bornTooltipFading === 'out' ? 0 : 1,
                transition: 'opacity 300ms ease',
              }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: TEXT_SEC, lineHeight: 1.8 }}>
                  <div>Max Born &middot; 1882–1970 &middot; Nobel 1954</div>
                  <div style={{ fontStyle: 'italic' }}>The Born rule: outcomes occur in proportion to |&psi;|&sup2;.</div>
                  <div>This system routes LLMs the same way.</div>
                </div>
              </div>
            )}
          </div>

          {/* Narrative */}
          <div style={{
            fontFamily: SERIF, fontStyle: 'italic', fontSize: 15,
            color: TEXT_MUT, marginBottom: 24, maxWidth: 700, lineHeight: 1.6,
          }}>
            Ten models in superposition. Every run is a measurement; every measurement collapses
            belief. The favourite isn&apos;t chosen ? it&apos;s measured into being.
          </div>

          {/* KPI row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20,
          }}>
            <KpiCard label="OBSERVATIONS" value={String(totalObs)} />
            <KpiCard
              label="FAVOURITE"
              value={favId ? shortName(favId) : '--'}
              sub={favId ? `P=${formatPct(favProb)}` : undefined}
              gold
            />
            <KpiCard label="EXPLORATION" value={formatPct(explorationPct)} />
            <KpiCard label="S/G COVERAGE" value={formatPct(sgCoverage)} />
            <KpiCard
              label="BELIEF ENTROPY"
              value={entropy != null ? entropy.toFixed(3) : '--'}
              meter={entropy}
            />
          </div>

          {/* Filter row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {WINDOWS.map(w => (
              <button
                key={w.value}
                onClick={() => setWindowDays(w.value)}
                style={{
                  padding: '5px 12px', borderRadius: 6,
                  border: `1px solid ${windowDays === w.value ? GOLD : BORDER}`,
                  background: 'transparent',
                  color: windowDays === w.value ? GOLD : TEXT_SEC,
                  fontFamily: MONO, fontSize: 11, cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                {w.label}
              </button>
            ))}
            <div style={{ width: 1, height: 18, background: BORDER, margin: '0 4px' }} />
            {SOURCES.map(s => (
              <button
                key={s.value ?? 'all'}
                onClick={() => setSourceFilter(s.value)}
                style={{
                  padding: '5px 12px', borderRadius: 6,
                  border: `1px solid ${sourceFilter === s.value ? GOLD : BORDER}`,
                  background: 'transparent',
                  color: sourceFilter === s.value ? GOLD : TEXT_SEC,
                  fontFamily: MONO, fontSize: 11, cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* BornVerdict demo card — inline component preview */}
          {favId && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT, letterSpacing: '0.08em', marginBottom: 6 }}>
                BORN VERDICT · inline component preview
              </div>
              <BornVerdict
                selectedModelId={favId}
                sheetType="all_tasks"
                bornProb={data?.favourite_prob ?? 0}
                phase="exploiting"
                posteriorAlpha={sorted[0]?.posterior_alpha ?? 2}
                posteriorBeta={sorted[0]?.posterior_beta ?? 2}
                composite={sorted[0]?.avg_composite ?? null}
              />
            </div>
          )}
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
                  konamiCollapse={konamiCollapse}
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
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
              <span style={sectionTitleStyle}>Leaderboard</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT }}>
                {sorted.length} arms
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['#', 'Model', 'Provider', 'Pulls', 'Success Rate', 'Avg Quality', 'Avg Duration', 'Phase'].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: '6px 12px',
                          textAlign: (h === '#' || h === 'Model') ? 'left' : 'right',
                          fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em',
                          textTransform: 'uppercase', color: TEXT_MUT,
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
                    const modelColor = BORN_COLORS[idx % BORN_COLORS.length];
                    const qualColor = qualityColor(model.avg_composite);
                    return (
                      <tr
                        key={model.model_id}
                        style={{
                          borderBottom: `1px solid ${BORDER}`,
                          borderLeft: isFav ? `2px solid ${GOLD}` : '2px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--born-hover)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        onClick={() => setDrawerModelId(model.model_id)}
                      >
                        {/* Rank */}
                        <td style={{ padding: '10px 12px', width: 36 }}>
                          <span style={{
                            fontFamily: MONO, fontSize: 12, fontWeight: 700,
                            color: idx === 0 ? GOLD : TEXT_MUT,
                          }}>
                            {idx + 1}
                          </span>
                        </td>
                        {/* Model name */}
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: modelColor, flexShrink: 0,
                            }} />
                            <span style={{
                              fontFamily: BODY, fontWeight: 500, color: TEXT_PRI,
                              whiteSpace: 'nowrap',
                            }}>
                              {shortName(model.model_id)}
                            </span>
                          </div>
                        </td>
                        {/* Provider pill */}
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <span style={{
                            ...providerPillStyle(model.provider),
                            fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em',
                            padding: '2px 7px', borderRadius: 4, display: 'inline-block',
                          }}>
                            {model.provider}
                          </span>
                        </td>
                        {/* Pulls */}
                        <td style={{
                          padding: '10px 12px', textAlign: 'right',
                          fontFamily: MONO, fontSize: 12, color: TEXT_SEC,
                        }}>
                          {model.total_pulls}
                        </td>
                        {/* Success rate bar */}
                        <td style={{ padding: '10px 12px', textAlign: 'right', minWidth: 140 }}>
                          <div style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'flex-end', gap: 8,
                          }}>
                            <div style={{
                              width: 60, height: 4, background: BORDER,
                              borderRadius: 2, overflow: 'hidden',
                            }}>
                              <div style={{
                                width: `${model.success_rate * 100}%`,
                                height: '100%', background: modelColor, borderRadius: 2,
                              }} />
                            </div>
                            <span style={{
                              fontFamily: MONO, fontSize: 12, color: TEXT_PRI,
                              minWidth: 44, textAlign: 'right',
                            }}>
                              {formatPct(model.success_rate)}
                            </span>
                          </div>
                        </td>
                        {/* Avg quality */}
                        <td style={{ padding: '10px 12px', textAlign: 'right', minWidth: 90 }}>
                          <span style={{ fontFamily: MONO, fontSize: 12, color: qualColor }}>
                            {model.avg_composite != null ? formatPct(model.avg_composite) : '--'}
                          </span>
                        </td>
                        {/* Duration */}
                        <td style={{
                          padding: '10px 12px', textAlign: 'right',
                          fontFamily: MONO, fontSize: 12, color: TEXT_MUT,
                        }}>
                          {formatMs(model.avg_duration_ms)}
                        </td>
                        {/* Phase */}
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <span style={{
                            fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em',
                            color: model.phase === 'exploiting' ? TEAL : TEXT_MUT,
                          }}>
                            {model.phase}
                          </span>
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
        {sorted.length > 0 && (
          <div style={cardStyle}>
            <div style={{ marginBottom: 16 }}>
              <div style={sectionTitleStyle}>Reward Anatomy</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>
                CTSGV � 5-axis quality model
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {sorted.slice(0, 5).map((model, idx) => {
                const weights = effectiveWeights(model);
                const axes = ['C', 'T', 'S', 'G', 'V'] as const;
                const allNull = axes.every(a => {
                  const key = `avg_${a.toLowerCase()}` as keyof CtsgvModelStat;
                  return model[key] == null;
                });

                return (
                  <div key={model.model_id}>
                    {/* Row header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: BORN_COLORS[idx % BORN_COLORS.length], flexShrink: 0,
                      }} />
                      <span style={{
                        fontFamily: BODY, fontSize: 13, fontWeight: 500, color: TEXT_PRI,
                      }}>
                        {shortName(model.model_id)}
                      </span>
                      {model.model_id === favId && (
                        <span style={{
                          fontFamily: MONO, fontSize: 10, color: GOLD,
                          border: `1px solid ${GOLD}`, borderRadius: 3,
                          padding: '1px 5px', letterSpacing: '0.04em',
                        }}>
                          FAVOURITE
                        </span>
                      )}
                    </div>

                    {allNull ? (
                      <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT }}>
                        Pending judge
                      </div>
                    ) : (
                      <>
                        {/* 5-segment bar */}
                        <div style={{
                          display: 'flex', height: 12, borderRadius: 3,
                          overflow: 'hidden', background: BORDER, marginBottom: 6,
                        }}>
                          {axes.map(axis => {
                            const w = weights[axis];
                            const isNull = w == null;
                            const segWidth = isNull
                              ? BASE_WEIGHTS[axis] * 100
                              : w * 100;
                            return (
                              <div
                                key={axis}
                                title={`${axis}: ${isNull ? 'unjudged' : `${(w! * 100).toFixed(1)}%`}`}
                                style={{
                                  width: `${segWidth}%`,
                                  background: isNull
                                    ? `repeating-linear-gradient(45deg, ${CTSGV_COLORS[axis]} 0px, ${CTSGV_COLORS[axis]} 2px, transparent 2px, transparent 6px)`
                                    : CTSGV_COLORS[axis],
                                  opacity: isNull ? 0.20 : 1,
                                }}
                              />
                            );
                          })}
                        </div>

                        {/* Weight labels */}
                        <div style={{
                          fontFamily: MONO, fontSize: 10,
                          display: 'flex', gap: 12, flexWrap: 'wrap',
                        }}>
                          {axes.map(axis => {
                            const w = weights[axis];
                            return (
                              <span
                                key={axis}
                                style={{
                                  color: w != null ? CTSGV_COLORS[axis] : TEXT_MUT,
                                  opacity: w != null ? 1 : 0.5,
                                }}
                              >
                                {axis} {w != null ? `${(w * 100).toFixed(0)}%` : '?'}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* V reserved note */}
            <div style={{
              marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BORDER}`,
              fontFamily: MONO, fontSize: 10, color: TEXT_MUT,
            }}>
              V (verify) reserved � Outcome gate: truncated ? cap 0.25, errored ? cap 0.10
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

// ?? KPI card ?????????????????????????????????????????????????????????????????

function KpiCard({
  label, value, sub, gold, meter,
}: {
  label: string;
  value: string;
  sub?: string;
  gold?: boolean;
  meter?: number | null;
}) {
  const converged = meter != null && meter < 0.5;
  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${BORDER}`,
      borderRadius: 6, padding: '14px 16px',
    }}>
      <div style={{
        fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: TEXT_MUT, marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontFamily: BODY, fontSize: 28, fontWeight: 700, lineHeight: 1,
          color: gold ? GOLD : TEXT_PRI,
        }}>
          {value}
        </span>
        {sub && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT }}>
            {sub}
          </span>
        )}
      </div>
      {meter != null && (
        <div style={{
          marginTop: 8, height: 4, background: BORDER,
          borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min(meter * 100, 100)}%`,
            height: '100%',
            background: converged ? GOLD : TEAL,
            borderRadius: 2,
          }} />
        </div>
      )}
    </div>
  );
}
