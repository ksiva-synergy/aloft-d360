'use client';

import React, { useMemo } from 'react';
import type { CtsgvModelStat, RecentRun, SheetBreakdown } from './types';
import {
  BORDER, GOLD, TEAL,
  TEXT_PRI, TEXT_SEC, TEXT_MUT,
  SERIF, BODY, MONO,
  BASE_WEIGHTS, CTSGV_COLORS,
  modelColor, shortName,
} from '@/lib/bandits/born-tokens';
import { betaPDF } from '@/lib/bandits/born-math';
import { CtsgvMicroBar } from './CtsgvMicroBar';

// ── Local helpers ─────────────────────────────────────────────────────────────

function betaCI(a: number, b: number) {
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const sd = Math.sqrt(variance);
  return {
    mean,
    ciLow: Math.max(0, mean - 1.96 * sd),
    ciHigh: Math.min(1, mean + 1.96 * sd),
  };
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDuration(ms: number | undefined | null): string {
  if (!ms && ms !== 0) return '--';
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtTokens(n: number | undefined | null): string {
  if (n == null) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function qualityColor(v: number | null | undefined): string {
  if (v == null) return TEXT_MUT;
  if (v > 0.60) return '#6abf8a';
  if (v > 0.50) return '#c9a04e';
  return '#e15759';
}

function stripSheetType(s: string): string {
  if (!s) return s;
  if (s === 'inspector_chat') return 'inspector';
  if (s.startsWith('boost_')) return 'boost:' + s.slice(6);
  if (s.startsWith('workbench_')) return 'wb:' + s.slice(10);
  return s;
}

function providerPillStyle(provider: string): React.CSSProperties {
  if (provider === 'bedrock') {
    return { background: 'rgba(95,169,174,0.12)', color: TEAL, border: `1px solid rgba(95,169,174,0.30)` };
  }
  return { background: 'rgba(201,160,78,0.12)', color: '#c9a04e', border: `1px solid rgba(201,160,78,0.30)` };
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: TEXT_MUT,
      borderBottom: `1px solid ${BORDER}`, paddingBottom: 6, marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      {children}
    </div>
  );
}

// ── Posterior curve SVG ───────────────────────────────────────────────────────

function PosteriorCurve({
  alpha, beta: betaParam, color, bornProb,
}: {
  alpha: number;
  beta: number;
  color: string;
  bornProb: number;
}) {
  const W = 440, H = 130;
  const PADDING = { top: 10, right: 10, bottom: 24, left: 10 };
  const chartW = W - PADDING.left - PADDING.right;
  const chartH = H - PADDING.top - PADDING.bottom;

  const N = 100;
  const points: [number, number][] = [];
  let maxY = 0;
  for (let i = 0; i <= N; i++) {
    const x = 0.01 + (i / N) * 0.98;
    const y = betaPDF(x, alpha, betaParam);
    if (isFinite(y)) { points.push([x, y]); if (y > maxY) maxY = y; }
  }

  const { mean, ciLow, ciHigh } = betaCI(alpha, betaParam);

  const sx = (x: number) => PADDING.left + ((x - 0.01) / 0.98) * chartW;
  const sy = (y: number) => PADDING.top + chartH - (maxY > 0 ? (y / maxY) * chartH : 0);

  const pathD = points.map(([x, y], i) =>
    `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`
  ).join(' ');

  const fillD = pathD + ` L${sx(0.99).toFixed(1)},${(PADDING.top + chartH).toFixed(1)} L${sx(0.01).toFixed(1)},${(PADDING.top + chartH).toFixed(1)} Z`;

  const xLabels = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* Fill */}
        <path d={fillD} fill={color} fillOpacity={0.20} />
        {/* Curve */}
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
        {/* Mean line */}
        <line
          x1={sx(mean)} y1={PADDING.top}
          x2={sx(mean)} y2={PADDING.top + chartH}
          stroke={color} strokeWidth={1} strokeDasharray="3,3" opacity={0.8}
        />
        {/* CI lines */}
        {[ciLow, ciHigh].map(ci => (
          <line
            key={ci}
            x1={sx(ci)} y1={PADDING.top}
            x2={sx(ci)} y2={PADDING.top + chartH}
            stroke={color} strokeWidth={1} strokeDasharray="2,4" opacity={0.4}
          />
        ))}
        {/* Mean label */}
        <text
          x={sx(mean)} y={PADDING.top - 2}
          textAnchor="middle"
          fill={color}
          fontSize={9}
          fontFamily="IBM Plex Mono"
        >
          {pct(mean)}
        </text>
        {/* X-axis labels */}
        {xLabels.map(v => (
          <text
            key={v}
            x={sx(v < 0.01 ? 0.01 : v > 0.99 ? 0.99 : v)}
            y={H - 6}
            textAnchor="middle"
            style={{ fill: TEXT_MUT }}
            fontSize={8}
            fontFamily="IBM Plex Mono"
          >
            {Math.round(v * 100)}%
          </text>
        ))}
      </svg>
      <div style={{ fontFamily: MONO, fontSize: 10, color: TEXT_MUT, marginTop: 6 }}>
        Beta({alpha.toFixed(1)}, {betaParam.toFixed(1)}) · over composite reward
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: TEXT_MUT }}>
        95% CI: {pct(ciLow)}–{pct(ciHigh)} · P(best): {pct(bornProb)}
      </div>
    </div>
  );
}

// ── CTSGV Radar ───────────────────────────────────────────────────────────────

const RADAR_AXES: Array<{ key: keyof typeof CTSGV_COLORS; label: string }> = [
  { key: 'C', label: 'C' },
  { key: 'T', label: 'T' },
  { key: 'S', label: 'S' },
  { key: 'G', label: 'G' },
  { key: 'V', label: 'V' },
];

function radarPt(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const angle = (2 * Math.PI * i) / n - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function radarPolyPoints(cx: number, cy: number, maxR: number, values: number[]): string {
  return values
    .map((v, i) => radarPt(cx, cy, v * maxR, i, values.length).map(n => n.toFixed(1)).join(','))
    .join(' ');
}

function CtsgvRadar({
  stat, color,
}: {
  stat: CtsgvModelStat;
  color: string;
}) {
  const CX = 100, CY = 100, R = 70;
  const scores = [stat.avg_c, stat.avg_t, stat.avg_s, stat.avg_g, stat.avg_v];
  const safeScores = scores.map(v => v ?? 0);
  const gridRings = [0.25, 0.50, 0.75, 1.00];
  const n = RADAR_AXES.length;

  // Effective weights for label display
  const judged = scores.filter(v => v != null);
  const judgedWeightTotal = RADAR_AXES.reduce(
    (sum, ax, i) => sum + (scores[i] != null ? BASE_WEIGHTS[ax.key] : 0),
    0
  );

  const effWeights = RADAR_AXES.map((ax, i) =>
    scores[i] != null && judgedWeightTotal > 0
      ? BASE_WEIGHTS[ax.key] / judgedWeightTotal
      : null
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <svg width={200} height={200} viewBox="0 0 200 200" style={{ display: 'block' }}>
        {/* Grid rings */}
        {gridRings.map(ring => (
          <polygon
            key={ring}
            points={radarPolyPoints(CX, CY, R, Array(n).fill(ring))}
            fill="none"
            style={{ stroke: BORDER }}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        ))}
        {/* Axis spokes */}
        {RADAR_AXES.map((_, i) => {
          const [x, y] = radarPt(CX, CY, R, i, n);
          return (
            <line
              key={i}
              x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)}
              style={{ stroke: BORDER }} strokeWidth={1}
            />
          );
        })}
        {/* Data polygon */}
        <polygon
          points={radarPolyPoints(CX, CY, R, safeScores)}
          fill={color}
          fillOpacity={0.20}
          stroke={color}
          strokeWidth={1.5}
        />
        {/* Axis labels */}
        {RADAR_AXES.map((ax, i) => {
          const [x, y] = radarPt(CX, CY, R + 14, i, n);
          const isNull = scores[i] == null;
          return (
            <text
              key={ax.key}
              x={x.toFixed(1)} y={y.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isNull ? TEXT_MUT : CTSGV_COLORS[ax.key]}
              fillOpacity={isNull ? 0.4 : 1}
              fontSize={9}
              fontFamily="IBM Plex Mono"
              fontWeight={600}
            >
              {ax.label}
            </text>
          );
        })}
      </svg>
      {/* Weight breakdown */}
      <div style={{ fontFamily: MONO, fontSize: 10, color: TEXT_MUT }}>
        {RADAR_AXES.map((ax, i) => {
          const eff = effWeights[i];
          return (
            <span key={ax.key} style={{ marginRight: 8, color: eff != null ? CTSGV_COLORS[ax.key] : TEXT_MUT, opacity: eff != null ? 1 : 0.4 }}>
              {ax.key} {eff != null ? `${(eff * 100).toFixed(0)}%` : '?'}
            </span>
          );
        })}
        <span style={{ marginLeft: 4 }}>· V —</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10 }}>
        Composite:{' '}
        <span style={{ color: qualityColor(stat.avg_composite) }}>
          {stat.avg_composite != null ? stat.avg_composite.toFixed(3) : '--'}
        </span>
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ArmDetailDrawerProps {
  stat: CtsgvModelStat;
  rank: number;
  favId: string;
  recentRuns: RecentRun[];
  isOpen: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ArmDetailDrawer({
  stat,
  rank,
  favId,
  recentRuns,
  isOpen,
  onClose,
}: ArmDetailDrawerProps) {
  const isFav = stat.model_id === favId;
  const color = modelColor(stat.model_id);
  const name = shortName(stat.model_id);

  const posteriorAlpha = stat.posterior_alpha ?? stat.alpha ?? 1;
  const posteriorBeta = stat.posterior_beta ?? stat.beta ?? 1;
  const bornProb = stat.born_prob ?? 0;

  const sortedSheets: SheetBreakdown[] = useMemo(
    () => [...(stat.sheet_breakdown ?? [])].sort((a, b) => b.success_rate - a.success_rate),
    [stat.sheet_breakdown],
  );

  const modelRuns = useMemo(
    () => recentRuns.filter(r => (r.model_id ?? r.agent_id) === stat.model_id).slice(0, 15),
    [recentRuns, stat.model_id],
  );

  const totalRuns = recentRuns.filter(r => (r.model_id ?? r.agent_id) === stat.model_id).length;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(5,9,15,0.60)',
          zIndex: 40,
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 250ms ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 480,
          background: 'var(--born-bg)',
          borderLeft: `1px solid ${BORDER}`,
          zIndex: 50,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: `${BORDER} transparent`,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'sticky', top: 0, zIndex: 10,
            alignSelf: 'flex-end',
            background: 'transparent', border: 'none',
            color: TEXT_MUT, fontFamily: MONO, fontSize: 16,
            padding: '14px 18px', cursor: 'pointer',
            lineHeight: 1,
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = TEXT_PRI; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = TEXT_MUT; }}
        >
          ✕
        </button>

        {/* Scrollable content */}
        <div style={{ padding: '0 24px 32px', marginTop: -36 }}>

          {/* ── 1. HEADER ── */}
          <Section>
            <div style={{
              fontFamily: SERIF, fontSize: 20, fontWeight: 600,
              color: isFav ? GOLD : TEXT_PRI,
              marginBottom: 8, lineHeight: 1.2,
            }}>
              {name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                ...providerPillStyle(stat.provider),
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em',
                padding: '2px 7px', borderRadius: 4,
              }}>
                {stat.provider}
              </span>
              <span style={{
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em',
                color: stat.phase === 'exploiting' ? TEAL : TEXT_MUT,
              }}>
                {stat.phase}
              </span>
              {isFav && (
                <span style={{
                  fontFamily: MONO, fontSize: 9, color: GOLD,
                  border: `1px solid ${GOLD}`, borderRadius: 3,
                  padding: '1px 5px', letterSpacing: '0.04em',
                }}>
                  FAVOURITE
                </span>
              )}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT }}>
              arm #{rank} · {stat.total_pulls} pulls · {(stat.success_rate * 100).toFixed(1)}% success
            </div>
          </Section>

          {/* ── 2. POSTERIOR CURVE ── */}
          <Section>
            <SectionLabel>Posterior Distribution</SectionLabel>
            <PosteriorCurve
              alpha={posteriorAlpha}
              beta={posteriorBeta}
              color={color}
              bornProb={bornProb}
            />
          </Section>

          {/* ── 3. CTSGV RADAR ── */}
          <Section>
            <SectionLabel>Reward Anatomy</SectionLabel>
            <CtsgvRadar stat={stat} color={color} />
          </Section>

          {/* ── 4. SHEET BREAKDOWN ── */}
          {sortedSheets.length > 0 && (
            <Section>
              <SectionLabel>Sheet Breakdown</SectionLabel>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Sheet', 'Runs', 'Success Rate'].map(h => (
                      <th
                        key={h}
                        style={{
                          fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em',
                          textTransform: 'uppercase', color: TEXT_MUT,
                          borderBottom: `1px solid ${BORDER}`,
                          padding: '4px 8px',
                          textAlign: h === 'Sheet' ? 'left' : 'right',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedSheets.map((row) => (
                    <tr key={row.sheet_type} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '6px 8px', fontFamily: MONO, fontSize: 10, color: TEXT_SEC }}>
                        {stripSheetType(row.sheet_type)}
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: MONO, fontSize: 10, color: TEXT_MUT, textAlign: 'right' }}>
                        {row.total}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <div style={{ width: 48, height: 3, background: BORDER, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              width: `${row.success_rate * 100}%`,
                              height: '100%', background: color, borderRadius: 2,
                            }} />
                          </div>
                          <span style={{ fontFamily: MONO, fontSize: 10, color: TEXT_PRI, minWidth: 38, textAlign: 'right' }}>
                            {(row.success_rate * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* ── 5. RECENT RUNS ── */}
          <Section>
            <SectionLabel>Recent Runs</SectionLabel>
            {modelRuns.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUT, opacity: 0.6 }}>
                No runs recorded.
              </div>
            ) : (
              <>
                {modelRuns.map(run => {
                  const isCompleted = run.status === 'completed' || run.status === 'success';
                  const isErrored = run.status === 'errored' || run.status === 'failed' || run.status === 'error';
                  const durationMs = run.duration_ms ?? run.total_duration_ms;
                  const tokens = run.input_tokens != null && run.output_tokens != null
                    ? run.input_tokens + run.output_tokens
                    : run.total_tokens ?? null;
                  const composite = run.composite_score ?? run.quality_score;
                  const taskName = stripSheetType(run.sheet_type || run.sheet_id || '');

                  return (
                    <div
                      key={run.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        minHeight: 36, borderBottom: `1px solid ${BORDER}`,
                        padding: '4px 0', fontSize: 11,
                      }}
                    >
                      {/* Status icon */}
                      <div style={{ flexShrink: 0, width: 14, textAlign: 'center' }}>
                        {isCompleted
                          ? <span style={{ color: '#6abf8a', fontSize: 12 }}>✓</span>
                          : isErrored
                            ? <span style={{ color: '#e15759', fontSize: 12 }}>✗</span>
                            : <span style={{ color: '#c9a04e', fontSize: 12 }}>◷</span>
                        }
                      </div>

                      {/* Task */}
                      <span style={{
                        fontFamily: MONO, fontSize: 10, color: TEXT_SEC,
                        flex: '1 1 auto', minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={taskName}>
                        {taskName}
                      </span>

                      {/* Right cluster */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT }}>
                          {run.created_at ? timeAgo(run.created_at) : '--'}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT, minWidth: 32, textAlign: 'right' }}>
                          {fmtDuration(durationMs)}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUT, minWidth: 32, textAlign: 'right' }}>
                          {fmtTokens(tokens)}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 10, color: qualityColor(composite), minWidth: 28, textAlign: 'right' }}>
                          {composite != null ? composite.toFixed(2) : '--'}
                        </span>
                        <CtsgvMicroBar scores={run} totalWidth={48} height={8} />
                      </div>
                    </div>
                  );
                })}
                {totalRuns > 15 && (
                  <div style={{
                    marginTop: 10, fontFamily: MONO, fontSize: 10,
                    color: TEXT_MUT, textAlign: 'center',
                  }}>
                    Showing 15 of {totalRuns} runs ·{' '}
                    <a
                      href="/agent-lab/bandits"
                      style={{ color: GOLD, textDecoration: 'none' }}
                    >
                      View all on dashboard
                    </a>
                  </div>
                )}
              </>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

export default ArmDetailDrawer;
