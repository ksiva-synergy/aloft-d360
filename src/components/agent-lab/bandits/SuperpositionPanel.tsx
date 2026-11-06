'use client';

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { betaPDF, betaSample, ci95, posteriorComposite } from '@/lib/bandits/born-math';
import {
  BORN_COLORS,
  GOLD,
  CARD_BG,
  BORDER,
  TEXT_PRI,
  TEXT_MUT,
  TEXT_SEC,
  SERIF,
  MONO,
  shortName,
} from '@/lib/bandits/born-tokens';
import type { CtsgvModelStat } from './types';
import { inkOf, type } from '@/lib/typography/tokens';
import { Segmented } from './Segmented';

// ── Constants ──────────────────────────────────────────────────────────────

const SVG_W = 760;
const SVG_H = 320;
const PAD_LEFT = 36;
const PAD_RIGHT = 16;
const PAD_TOP = 12;
const PAD_BOTTOM = 40;
const PLOT_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = SVG_H - PAD_TOP - PAD_BOTTOM;
const N_POINTS = 200;
const K_TOTAL = 200;
const MAX_DOTS = 8;
const FRAME_MS = 33; // ~30fps
const SNAPSHOT_EVERY = 5; // update bars every 5 frames

// ── Types ──────────────────────────────────────────────────────────────────

interface Dot {
  cx: number;
  cy: number;
  opacity: number;
  key: number;
}

interface CurveData {
  stat: CtsgvModelStat;
  colorIndex: number;
  points: Array<{ x: number; y: number; px: number; py: number }>;
  pathD: string;
  mean: number;
  variance: number;
  alpha: number;
  beta: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function armAlphaBeta(stat: CtsgvModelStat): { alpha: number; beta: number } {
  if (stat.posterior_alpha != null && stat.posterior_beta != null) {
    return { alpha: stat.posterior_alpha, beta: stat.posterior_beta };
  }
  const arm = posteriorComposite(stat);
  return { alpha: arm.alpha, beta: arm.beta };
}

function hex2rgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface SuperpositionPanelProps {
  stats: CtsgvModelStat[];
  favId: string;
  onMeasureComplete: (tally: Map<string, number>) => void;
  onTallySnapshot: (tally: Map<string, number>) => void;
  onMeasureStart: () => void;
  onReset: () => void;
  /** Easter egg 2 phase, driven by the parent's key handler. */
  konamiPhase?: KonamiPhase;
}

export type KonamiPhase = 'idle' | 'collapsing' | 'expanding';

// ── Component ──────────────────────────────────────────────────────────────

export function SuperpositionPanel({
  stats,
  favId,
  onMeasureComplete,
  onTallySnapshot,
  onMeasureStart,
  onReset,
  konamiPhase = 'idle',
}: SuperpositionPanelProps) {
  const [mode, setMode] = useState<'overlap' | 'ridgeline'>('overlap');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; stat: CtsgvModelStat; alpha: number; beta: number;
  } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [drawCount, setDrawCount] = useState(K_TOTAL);
  const [dots, setDots] = useState<Dot[]>([]);
  const [measured, setMeasured] = useState(false);

  // EASTER EGG 1: Rapid Measure — 5 clicks in 3s freezes mid-draw
  const [eggFrozen, setEggFrozen] = useState(false);
  const measureClickTimesRef = useRef<number[]>([]);

  const rafRef = useRef<number | null>(null);
  // Latest frame callback; the rAF loop calls through this so runFrame never references itself.
  const runFrameRef = useRef<(ts: number) => void>(() => {});
  const tallyRef = useRef(new Map<string, number>());
  const lastFrameRef = useRef(0);
  const frameCountRef = useRef(0);
  const drawCountRef = useRef(K_TOTAL);
  const dotKeyRef = useRef(0);

  // ── Build curve data ─────────────────────────────────────────────────────

  const curves: CurveData[] = useMemo(() => {
    if (stats.length === 0) return [];

    // Compute per-arm alpha/beta and PDF points
    const rawCurves = stats.map((stat, idx) => {
      const { alpha, beta } = armAlphaBeta(stat);
      const mean = alpha / (alpha + beta);
      const variance = (alpha * beta) / ((alpha + beta) * (alpha + beta) * (alpha + beta + 1));

      const xVals: number[] = [];
      const yVals: number[] = [];
      for (let i = 0; i < N_POINTS; i++) {
        const x = 0.01 + (i / (N_POINTS - 1)) * 0.98;
        const y = betaPDF(x, alpha, beta);
        xVals.push(x);
        yVals.push(y);
      }

      return { stat, colorIndex: idx, xVals, yVals, mean, variance, alpha, beta };
    });

    // Find global max for y-scaling
    let globalMax = 0;
    for (const c of rawCurves) {
      for (const y of c.yVals) {
        if (y > globalMax) globalMax = y;
      }
    }
    if (globalMax === 0) globalMax = 1;

    // Sort for draw order: widest (highest variance) behind, narrowest (lowest variance) in front
    const sorted = [...rawCurves].sort((a, b) => b.variance - a.variance);

    return sorted.map((rc, sortedIdx) => {
      // In ridgeline mode, step each curve DOWN from the natural baseline
      // sortedIdx 0 (widest) stays at the original baseline;
      // each successive (narrower) curve steps down by 28px.
      const ridgeOffset = mode === 'ridgeline' ? sortedIdx * 28 : 0;

      const points = rc.xVals.map((x, i) => {
        const px = PAD_LEFT + x * PLOT_W;
        const py = PAD_TOP + PLOT_H + ridgeOffset - (rc.yVals[i] / globalMax) * PLOT_H;
        return { x, y: rc.yVals[i], px, py };
      });

      // Build filled SVG path (area under curve)
      const baseY = PAD_TOP + PLOT_H + ridgeOffset;
      let pathD = `M ${points[0].px} ${baseY}`;
      for (const p of points) {
        pathD += ` L ${p.px} ${p.py}`;
      }
      pathD += ` L ${points[points.length - 1].px} ${baseY} Z`;

      return {
        stat: rc.stat,
        colorIndex: rc.colorIndex,
        points,
        pathD,
        mean: rc.mean,
        variance: rc.variance,
        alpha: rc.alpha,
        beta: rc.beta,
      };
    });
  }, [stats, mode]);

  // ── Ridgeline viewBox height ─────────────────────────────────────────────

  const maxRidgeOffset = mode === 'ridgeline' ? (stats.length - 1) * 28 : 0;
  const viewBoxH = mode === 'ridgeline'
    ? SVG_H + maxRidgeOffset
    : SVG_H;

  // ── MEASURE loop ─────────────────────────────────────────────────────────

  const stopMeasure = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runFrame = useCallback((timestamp: number) => {
    if (drawCountRef.current <= 0) {
      stopMeasure();
      setMeasuring(false);
      setMeasured(true);
      onMeasureComplete(new Map(tallyRef.current));
      return;
    }

    const elapsed = timestamp - lastFrameRef.current;
    if (elapsed < FRAME_MS) {
      rafRef.current = requestAnimationFrame(ts => runFrameRef.current(ts));
      return;
    }
    lastFrameRef.current = timestamp;

    // One Thompson draw: sample all arms, pick argmax
    let bestVal = -Infinity;
    let bestId = '';
    let bestCurve: CurveData | null = null;

    for (const c of curves) {
      const s = betaSample(c.alpha, c.beta);
      if (s > bestVal) {
        bestVal = s;
        bestId = c.stat.model_id;
        bestCurve = c;
      }
    }

    // Update tally
    tallyRef.current.set(bestId, (tallyRef.current.get(bestId) ?? 0) + 1);

    // Place dot on the winning arm's rendered curve at x = bestVal. Reading the curve's own
    // point keeps the dot on the curve in Ridgeline mode too (the old formula ignored the offset).
    let newDot: Dot | null = null;
    if (bestCurve) {
      const clampedX = Math.max(0.01, Math.min(0.99, bestVal));
      const i = Math.round(((clampedX - 0.01) / 0.98) * (N_POINTS - 1));
      const pt = bestCurve.points[Math.max(0, Math.min(N_POINTS - 1, i))];
      newDot = { cx: pt.px, cy: Math.max(PAD_TOP + 4, pt.py), opacity: 1, key: dotKeyRef.current++ };
    }

    // Snapshot every N frames for live bar updates
    frameCountRef.current++;
    if (frameCountRef.current % SNAPSHOT_EVERY === 0) {
      onTallySnapshot(new Map(tallyRef.current));
    }

    drawCountRef.current--;
    setDrawCount(drawCountRef.current);

    setDots(prev => {
      const next = newDot
        ? [...prev.map(d => ({ ...d, opacity: d.opacity - 0.12 })).filter(d => d.opacity > 0), newDot]
        : prev.map(d => ({ ...d, opacity: d.opacity - 0.12 })).filter(d => d.opacity > 0);
      return next.slice(-MAX_DOTS);
    });

    rafRef.current = requestAnimationFrame(ts => runFrameRef.current(ts));
  }, [curves, onMeasureComplete, onTallySnapshot, stopMeasure]);

  useEffect(() => { runFrameRef.current = runFrame; }, [runFrame]);

  const startMeasure = useCallback(() => {
    // EASTER EGG 1: Rapid Measure — 5 clicks in 3s freezes mid-draw
    const now = Date.now();
    measureClickTimesRef.current.push(now);
    if (measureClickTimesRef.current.length > 5) {
      measureClickTimesRef.current = measureClickTimesRef.current.slice(-5);
    }
    if (measureClickTimesRef.current.length === 5) {
      const span = now - measureClickTimesRef.current[0];
      if (span <= 3000) {
        // Freeze mid-draw: pause animation, show overlay
        stopMeasure();
        setEggFrozen(true);
        measureClickTimesRef.current = [];
        return;
      }
    }

    tallyRef.current = new Map();
    drawCountRef.current = K_TOTAL;
    frameCountRef.current = 0;
    setDrawCount(K_TOTAL);
    setDots([]);
    setMeasuring(true);
    setMeasured(false);
    onMeasureStart();
    lastFrameRef.current = 0;
    rafRef.current = requestAnimationFrame(ts => runFrameRef.current(ts));
  }, [onMeasureStart, stopMeasure]);

  const resetMeasure = useCallback(() => {
    stopMeasure();
    tallyRef.current = new Map();
    drawCountRef.current = K_TOTAL;
    setDrawCount(K_TOTAL);
    setDots([]);
    setMeasuring(false);
    setMeasured(false);
    onReset();
  }, [stopMeasure, onReset]);

  useEffect(() => () => stopMeasure(), [stopMeasure]);

  // ── Tooltip mouse handlers ────────────────────────────────────────────────

  const svgRef = useRef<SVGSVGElement>(null);

  function handlePathMouseEnter(c: CurveData) {
    setHoveredId(c.stat.model_id);
  }

  function handlePathMouseLeave() {
    setHoveredId(null);
    setTooltip(null);
  }

  function handlePathMouseMove(e: React.MouseEvent<SVGPathElement>, c: CurveData) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Flip the tooltip to the cursor's left near the right edge so it never spills out of the card.
    const TIP_W = 220;
    const localX = e.clientX - rect.left;
    setTooltip({
      x: localX + 12 + TIP_W > rect.width ? Math.max(0, localX - 12 - TIP_W) : localX + 12,
      y: Math.max(0, e.clientY - rect.top - 8),
      stat: c.stat,
      alpha: c.alpha,
      beta: c.beta,
    });
  }

  // ── Shimmer keyframes (injected once) ────────────────────────────────────

  const shimmerStyle = `
    @keyframes bornShimmer {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.55; }
    }
  `;

  // ── Axis labels ───────────────────────────────────────────────────────────

  const axisLabels = ['0%', '25%', '50%', '75%', '100%'];

  // ── Render ────────────────────────────────────────────────────────────────

  if (stats.length === 0) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 'var(--born-r-card)', padding: '20px 24px' }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--type-ui-regular-size)', color: TEXT_MUT }}>No arm data available.</div>
      </div>
    );
  }

  return (
    <div style={{
      background: CARD_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: 'var(--born-r-card)',
      boxShadow: 'var(--shadow-xs)',
      padding: '20px 24px',
      position: 'relative',
    }}>
      <style>{shimmerStyle}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 'var(--type-title-section-size)', fontWeight: 600, color: TEXT_PRI }}>
            Superposition
          </div>
          <div style={{ ...type.caption, color: TEXT_MUT, marginTop: 2 }}>
            Beta posterior per arm · hover a curve or legend item to isolate it
          </div>
        </div>
        <Segmented
          options={[{ label: 'Overlap', value: 'overlap' }, { label: 'Ridgeline', value: 'ridgeline' }]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {/* Legend — hovering an item highlights its curve */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 8px',
        marginBottom: 10,
      }}>
        {stats.map((stat, idx) => {
          const { alpha, beta } = armAlphaBeta(stat);
          const mean = alpha / (alpha + beta);
          const isFav = stat.model_id === favId;
          const dimmed = hoveredId !== null && hoveredId !== stat.model_id;
          return (
            <span
              key={stat.model_id}
              title={stat.model_id}
              onMouseEnter={() => setHoveredId(stat.model_id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                ...type.caption, fontFamily: MONO,
                display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 280,
                padding: '2px 8px', borderRadius: 999,
                border: `1px solid ${hoveredId === stat.model_id ? BORDER : 'transparent'}`,
                background: hoveredId === stat.model_id ? 'var(--born-overlay-2)' : 'transparent',
                color: isFav ? inkOf(GOLD, 70) : TEXT_SEC,
                opacity: dimmed ? 0.45 : 1,
                cursor: 'default',
                transition: 'opacity 120ms ease, background-color 120ms ease',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isFav ? GOLD : BORN_COLORS[idx % BORN_COLORS.length],
                display: 'inline-block', flexShrink: 0,
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {shortName(stat.model_id)}
              </span>
              <span style={{ color: TEXT_MUT, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{(mean * 100).toFixed(1)}%</span>
            </span>
          );
        })}
      </div>

      {/* SVG */}
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${viewBoxH}`}
          style={{ width: '100%', display: 'block' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Axis line */}
          <line
            x1={PAD_LEFT} y1={PAD_TOP + PLOT_H}
            x2={PAD_LEFT + PLOT_W} y2={PAD_TOP + PLOT_H}
            style={{ stroke: TEXT_MUT }} strokeWidth={0.5} opacity={0.5}
          />

          {/* X-axis tick labels */}
          {axisLabels.map((label, i) => {
            const px = PAD_LEFT + (i / (axisLabels.length - 1)) * PLOT_W;
            return (
              <text
                key={label}
                x={px}
                y={PAD_TOP + PLOT_H + 16}
                textAnchor="middle"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize={10}
                style={{ fill: TEXT_MUT }}
              >
                {label}
              </text>
            );
          })}

          {/* Vertical grid lines */}
          {axisLabels.map((label, i) => {
            const px = PAD_LEFT + (i / (axisLabels.length - 1)) * PLOT_W;
            return (
              <line
                key={`grid-${label}`}
                x1={px} y1={PAD_TOP}
                x2={px} y2={PAD_TOP + PLOT_H}
                style={{ stroke: TEXT_MUT }} strokeWidth={0.3} opacity={0.2}
              />
            );
          })}

          {/* Beta curves */}
          {curves.map((c, renderIdx) => {
            const isFav = c.stat.model_id === favId;
            const isHovered = hoveredId === c.stat.model_id;
            const someHovered = hoveredId !== null;
            const color = isFav ? GOLD : BORN_COLORS[c.colorIndex % BORN_COLORS.length];

            let fillOpacity = isFav ? 0.25 : 0.14;
            let strokeOpacity = isFav ? 0.9 : 0.8;
            let strokeWidth = isFav ? 2 : 1.5;

            if (someHovered) {
              if (isHovered) {
                fillOpacity = 0.35;
                strokeWidth = 2.5;
                strokeOpacity = 1;
              } else {
                fillOpacity = 0.06;
                strokeOpacity = 0.25;
                strokeWidth = 1;
              }
            }

            // Konami collapse: non-favourite fades, favourite narrows visually
            let konamiStyle: React.CSSProperties = {};
            if (konamiPhase === 'collapsing') {
              if (!isFav) {
                konamiStyle = { opacity: 0.05, transition: 'opacity 800ms ease-in-out' };
              } else {
                konamiStyle = { transform: 'scaleX(0.15)', transformOrigin: 'center', transformBox: 'fill-box', transition: 'transform 800ms ease-in-out, opacity 800ms' };
              }
            } else if (konamiPhase === 'expanding') {
              if (!isFav) {
                konamiStyle = { opacity: 1, transition: 'opacity 1500ms ease-in-out' };
              } else {
                konamiStyle = { transform: 'scaleX(1)', transformOrigin: 'center', transformBox: 'fill-box', transition: 'transform 1500ms ease-in-out' };
              }
            }

            const animDelay = (renderIdx * 0.7).toFixed(1);
            const animDur = (4 + renderIdx * 0.35).toFixed(1);
            const shouldShimmer = !measuring && !someHovered && konamiPhase === 'idle';

            return (
              <path
                key={c.stat.model_id}
                d={c.pathD}
                fill={hex2rgba(color, fillOpacity)}
                stroke={color}
                strokeOpacity={strokeOpacity}
                strokeWidth={strokeWidth}
                style={{
                  ...(shouldShimmer ? {
                    animation: `bornShimmer ${animDur}s ease-in-out ${animDelay}s infinite`,
                  } : undefined),
                  ...konamiStyle,
                }}
                onMouseEnter={() => handlePathMouseEnter(c)}
                onMouseLeave={handlePathMouseLeave}
                onMouseMove={e => handlePathMouseMove(e, c)}
                cursor="crosshair"
              />
            );
          })}

          {/* Dots from MEASURE */}
          {dots.map(dot => (
            <circle
              key={dot.key}
              cx={dot.cx}
              cy={dot.cy}
              r={4}
              fill={GOLD}
              opacity={dot.opacity}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {tooltip && (() => {
          const { stat, alpha, beta } = tooltip;
          const mean = alpha / (alpha + beta);
          const [lo, hi] = ci95(alpha, beta);
          return (
            <div style={{
              position: 'absolute',
              left: tooltip.x,
              top: tooltip.y,
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 'var(--born-r-inner)',
              padding: '8px 12px',
              fontFamily: MONO,
              fontSize: 'var(--type-ui-regular-size)',
              color: TEXT_SEC,
              pointerEvents: 'none',
              zIndex: 10,
              lineHeight: 1.6,
              width: 220,
              boxShadow: 'var(--shadow-dialog)',
            }}>
              <div style={{ color: TEXT_PRI, fontWeight: 600, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {shortName(stat.model_id)}
              </div>
              <div>α: {alpha.toFixed(1)} &nbsp; β: {beta.toFixed(1)}</div>
              <div>Pulls: {stat.total_pulls}</div>
              <div>Mean: {(mean * 100).toFixed(1)}%</div>
              <div>95% CI: {(lo * 100).toFixed(1)}% – {(hi * 100).toFixed(1)}%</div>
            </div>
          );
        })()}

        {/* Easter Egg 1: Rapid Measure frozen overlay */}
        {eggFrozen && (
          <div
            onClick={() => {
              setEggFrozen(false);
              setMeasuring(false);
              setMeasured(false);
              setDots([]);
              tallyRef.current = new Map();
              drawCountRef.current = K_TOTAL;
              setDrawCount(K_TOTAL);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 20,
            }}
          >
            <div style={{
              background: CARD_BG,
              border: `1px solid ${GOLD}`,
              borderRadius: 'var(--born-r-inner)',
              padding: '20px 28px',
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontStyle: 'italic',
                fontSize: 'var(--type-title-section-size)',
                color: inkOf(GOLD),
                marginBottom: 8,
              }}>
                Superposition holds.
              </div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--type-ui-regular-size)',
                color: TEXT_SEC,
              }}>
                Nothing is decided until you let go.
              </div>
            </div>
          </div>
        )}

        {/* Easter Egg 2: Konami collapse overlay text */}
        {konamiPhase === 'collapsing' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 20,
          }}>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontStyle: 'italic',
              fontSize: 'var(--type-title-section-size)',
              color: inkOf(GOLD),
              marginBottom: 8,
            }}>
              Wave function collapsed.
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--type-ui-regular-size)',
              color: TEXT_SEC,
            }}>
              The favourite was never in doubt.
            </div>
          </div>
        )}
      </div>

      {/* MEASURE controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}`,
        minHeight: 34,
      }}>
        {!measuring && !measured && (
          <>
            <button type="button" className="born-btn born-btn--primary" onClick={startMeasure} style={type.ui}>
              ▶ Measure
            </button>
            <span style={{ ...type.caption, color: TEXT_MUT }}>
              Run {K_TOTAL} Thompson draws and watch the Born distribution fill in.
            </span>
          </>
        )}

        {measuring && (
          <div
            onClick={startMeasure}
            role="progressbar"
            aria-label="Measuring"
            aria-valuemin={0}
            aria-valuemax={K_TOTAL}
            aria-valuenow={K_TOTAL - drawCount}
            style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, cursor: 'pointer' }}
          >
            <span style={{ ...type.caption, fontFamily: MONO, color: inkOf(GOLD), whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              Draw {K_TOTAL - drawCount} / {K_TOTAL}
            </span>
            <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--born-overlay-2)', overflow: 'hidden' }}>
              <div style={{
                width: `${((K_TOTAL - drawCount) / K_TOTAL) * 100}%`, height: '100%',
                background: GOLD, borderRadius: 999,
              }} />
            </div>
          </div>
        )}

        {measured && (
          <>
            <span style={{ ...type.caption, fontFamily: MONO, color: inkOf(GOLD) }}>
              Measured · {K_TOTAL} draws
            </span>
            <button type="button" className="born-btn" onClick={resetMeasure} style={type.ui}>
              Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}
