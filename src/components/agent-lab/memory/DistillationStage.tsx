'use client';

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import type { LastRunInfo } from '@/lib/foer/types';
import { GOLD, MONO, SERIF } from '@/lib/foer/foer-tokens';

// ── SVG layout coordinates (matching reference HTML) ───────────────────────────
const VW = 1000;
const VH = 420;

// ── Brand colors (matching reference HTML / foer-tokens) ───────────────────────
const C_SESSION  = '#5FA9AE';
const C_KEPT_NEW = '#FDB515';
const C_KEPT_DED = '#C9A04E';
const C_DISCARD  = '#4A6080';
const C_PHANTOM  = '#D9774B';

const RULE_TYPE_COLORS: Record<string, string> = {
  HARD_RULE:    '#FDB515', // gold
  FAILURE_MODE: '#D9774B', // rust
  HEURISTIC:    '#5FA9AE', // teal
  SOURCE_PREF:  '#6F9DC4', // steel
};

function ruleTypeColor(type: string): string {
  return RULE_TYPE_COLORS[type] ?? 'var(--foer-text-mut)';
}

// ── Seeded PRNG — reproducible layout between mounts ──────────────────────────
function makeRand(seed: number) {
  let s = (seed * 31 + 7) >>> 0;
  return () => {
    s = ((s * 1664525 + 1013904223) | 0) >>> 0;
    return s / 4294967296;
  };
}

// Math helpers
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function ease(t: number) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp(val: number, min: number, max: number) { return Math.max(min, Math.min(max, val)); }
function win(t: number, a: number, b: number) { return clamp((t - a) / (b - a), 0, 1); }
function popScale(w: number) {
  const x = clamp((w - 0.2) / 0.5, 0, 1);
  return 1 + Math.sin(x * Math.PI) * 0.18;
}

interface ShelfSlot {
  x: number;
  y: number;
  filled: boolean;
  type: string;
}

interface Particle {
  id: number;
  i: number;
  kind: 'noise' | 'signal';
  type: string;
  label: string;
  outcome: string;
  x0: number;
  y0: number;
  x: number;
  y: number;
  r: number;
  phase: number;
  delay: number;
  target: ShelfSlot | null;
  dumpX: number;
  dumpYT: number;
}

interface Pulse {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

// ── Distillation Stage ─────────────────────────────────────────────────────────
export interface DistillationStageProps {
  lastRun: LastRunInfo | null;
}

export function DistillationStage({ lastRun }: DistillationStageProps) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';

  // Detect prefers-reduced-motion — starts false (matches server) and updates after mount
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  const [playState, setPlayState] = useState<'idle' | 'playing' | 'paused' | 'done'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);
  const [pulses, setPulses] = useState<Pulse[]>([]);

  // ── Sweep trigger state ───────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const [sweepState, setSweepState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [sweepResult, setSweepResult] = useState<{ inserted: number; reflected: number } | null>(null);

  const handleRunSweep = useCallback(async () => {
    if (sweepState === 'running') return;
    setSweepState('running');
    setSweepResult(null);
    try {
      const res = await fetch('/api/agent-lab/memory/synthesize', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; summary: { bulletsInserted: number; sessionsReflected: number } };
      setSweepResult({ inserted: data.summary.bulletsInserted, reflected: data.summary.sessionsReflected });
      setSweepState('done');
      // Invalidate stats and runs so the dashboard refreshes
      await queryClient.invalidateQueries({ queryKey: ['foer-memory-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['foer-memory-runs'] });
    } catch {
      setSweepState('error');
    }
  }, [sweepState, queryClient]);

  const rafRef     = useRef<number | null>(null);
  const startTsRef = useRef(0);
  const offsetRef  = useRef(0);

  // Audio Context Ref
  const actxRef = useRef<AudioContext | null>(null);

  // Trigger Refs to prevent multiple firings per frame
  const crystFiredRef = useRef<Record<number, boolean>>({});
  const arrivedRef = useRef<Record<number, boolean>>({});
  const fallFiredRef = useRef<Record<number, boolean>>({});

  // Spring & Decay state refs for lighthouse animations
  const charPopRef = useRef(1.0);
  const kRaiseRef = useRef(0.12);
  const beamBoostRef = useRef(0.0);
  const beamCutRef = useRef(0.0);
  const lampFlareRef = useRef(0.0);

  // performance.now() snapshot updated inside RAF — always 0 on first (SSR) render
  // so server and client produce identical markup before the first tick fires.
  const nowRef = useRef(0);

  // Reference coordinates
  const geo = useMemo(() => ({
    intake:  { x: 165, y: 210 },
    keeper:  { x: 455, y: 235 },
    lamp:    { x: 453, y: 217 },
    lantern: { x: 478, y: 278 },
    dumpY:   370,
    shelfX:  735,
  }), []);

  // Shelf slots (3x3 grid)
  const slots = useMemo<ShelfSlot[]>(() => {
    const arr: ShelfSlot[] = [];
    const sx = geo.shelfX;
    const types = [
      'HEURISTIC', 'SOURCE_PREF', 'HARD_RULE',
      'FAILURE_MODE', 'HEURISTIC', 'HARD_RULE',
      'SOURCE_PREF', 'FAILURE_MODE', 'HEURISTIC',
    ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const idx = r * 3 + c;
        arr.push({
          x: sx + c * 62,
          y: 80 + r * 90,
          filled: !(r === 0 && c === 2) && !(r === 2 && c === 2),
          type: types[idx],
        });
      }
    }
    return arr;
  }, [geo]);

  // Build particles array
  const parts = useMemo<Particle[]>(() => {
    const seed = lastRun ? lastRun.sessionsScanned * 31 + lastRun.bulletsInserted : 42;
    const rand = makeRand(seed);

    const fates = [
      { kind: 'noise', type: '', label: '', outcome: '' },
      { kind: 'noise', type: '', label: '', outcome: '' },
      { kind: 'noise', type: '', label: '', outcome: '' },
      { kind: 'noise', type: '', label: '', outcome: '' },
      { kind: 'noise', type: '', label: '', outcome: '' },
      { kind: 'signal', type: 'HARD_RULE', label: 'sanctions', outcome: 'new' },
      { kind: 'signal', type: 'FAILURE_MODE', label: 'manifest', outcome: 'kept' },
      { kind: 'signal', type: 'HEURISTIC', label: 'flag-state', outcome: 'kept' },
      { kind: 'signal', type: 'SOURCE_PREF', label: 'PO-line', outcome: 'folded' },
      { kind: 'signal', type: 'HARD_RULE', label: 'close-out', outcome: 'kept' },
      { kind: 'signal', type: 'HEURISTIC', label: 'pre-warm', outcome: 'folded' },
      { kind: 'signal', type: 'SOURCE_PREF', label: 'sensor', outcome: 'superseded' },
    ];

    const newSlot = slots.find(o => !o.filled);
    const superTarget = slots.find(o => o.filled && o.type === 'SOURCE_PREF');
    const keptTargets = slots.filter(o => o.filled && o !== superTarget);
    let ki = 0;

    return fates.map((f, i) => {
      const ang = (i / 12) * Math.PI * 2;
      const rad = 40 + rand() * 42;
      // Round to 3 decimal places to collapse any ULP differences between
      // Node.js (server) and Chrome (client) JIT trig implementations.
      const snap = (v: number) => Math.round(v * 1000) / 1000;
      const x = snap(geo.intake.x + Math.cos(ang) * rad);
      const y = snap(geo.intake.y + Math.sin(ang) * rad * 0.7);

      let target: ShelfSlot | null = null;
      let dumpX = 0;
      let dumpYT = 0;

      if (f.kind === 'noise') {
        dumpX = geo.keeper.x + (rand() * 150 - 75);
        dumpYT = geo.dumpY + (rand() * 8 - 4);
      } else {
        if (f.outcome === 'new' && newSlot) {
          target = newSlot;
        } else if (f.outcome === 'superseded' && superTarget) {
          target = superTarget;
        } else {
          target = keptTargets[ki % keptTargets.length];
          ki++;
        }
      }

      return {
        id: i,
        i,
        kind: f.kind as 'noise' | 'signal',
        type: f.type,
        label: f.label,
        outcome: f.outcome,
        x0: x,
        y0: y,
        x,
        y,
        r: snap(f.kind === 'noise' ? 5 + rand() * 2 : 11 + rand() * 4),
        phase: snap(rand() * Math.PI * 2),
        delay: i * 0.05,
        target,
        dumpX,
        dumpYT,
      };
    });
  }, [lastRun, slots, geo]);

  const TOTAL_DUR = 7000;

  // Sound effects chime
  const playChime = useCallback((gold: boolean) => {
    if (reducedMotion) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!actxRef.current) actxRef.current = new AudioCtx();
      const ac = actxRef.current;
      const t = ac.currentTime;
      const notes = gold ? [659.25, 987.77, 1318.5] : [523.25, 783.99];
      notes.forEach((f, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t + i * 0.04);
        g.gain.linearRampToValueAtTime(gold ? 0.14 : 0.10, t + i * 0.04 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.04 + 0.9);
        o.connect(g);
        g.connect(ac.destination);
        o.start(t + i * 0.04);
        o.stop(t + i * 0.04 + 0.95);
      });
    } catch (e) {
      console.error('[chime error]', e);
    }
  }, [reducedMotion]);

  // Handle pulse display when particles arrive
  const handleArrival = useCallback((p: Particle) => {
    const tgt = p.target;
    if (!tgt) return;

    let text = '+1';
    let color = isLight ? 'var(--foer-text-sec)' : 'var(--foer-text-pri)';

    if (p.outcome === 'new') {
      text = 'NEW';
      color = C_KEPT_NEW;
    } else if (p.outcome === 'superseded') {
      text = 'v2';
      color = C_KEPT_NEW;
    } else {
      color = p.type === 'HEURISTIC' ? C_SESSION : C_KEPT_DED;
    }

    const id = `${p.id}-${Date.now()}`;
    setPulses((prev) => [...prev, { id, x: tgt.x, y: tgt.y - 18, text, color }]);

    setTimeout(() => {
      setPulses((prev) => prev.filter((x) => x.id !== id));
    }, 950);
  }, [isLight]);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runFrame = useCallback((ts: number) => {
    nowRef.current = ts;
    const e = offsetRef.current + (ts - startTsRef.current);
    if (e >= TOTAL_DUR) {
      setElapsed(TOTAL_DUR);
      setPlayState('done');
      return;
    }
    setElapsed(e);

    // Spring & decay physics tick
    const targetRaise = (e > 0.12 * TOTAL_DUR && e < 0.9 * TOTAL_DUR) ? 1.0 : 0.12;
    kRaiseRef.current += (targetRaise - kRaiseRef.current) * 0.10;
    charPopRef.current += (1.0 - charPopRef.current) * 0.16;
    beamBoostRef.current *= 0.92;
    beamCutRef.current *= 0.92;
    lampFlareRef.current *= 0.90;

    // Check thresholds for events
    parts.forEach((p) => {
      const d = p.delay * 1000;
      if (p.kind === 'signal') {
        const crystW = win(e, 1850 + d, 2950 + d);
        if (crystW > 0 && !crystFiredRef.current[p.id]) {
          crystFiredRef.current[p.id] = true;
          beamBoostRef.current = isLight ? 0.08 : 0.11;
          charPopRef.current = 1.06;
          lampFlareRef.current = 1.0;
          playChime(p.type === 'HARD_RULE');
        }

        const chuteW = win(e, 3300 + d, 6200 + d);
        if (chuteW > 0.96 && !arrivedRef.current[p.id]) {
          arrivedRef.current[p.id] = true;
          handleArrival(p);
        }
      } else {
        const fallW = win(e, 1900 + d, 3150 + d);
        if (fallW > 0 && !fallFiredRef.current[p.id]) {
          fallFiredRef.current[p.id] = true;
          beamCutRef.current = isLight ? 0.06 : 0.10;
        }
      }
    });

    rafRef.current = requestAnimationFrame(runFrame);
  }, [parts, playChime, handleArrival, isLight]);

  const handlePlay = useCallback(() => {
    if (reducedMotion) {
      setElapsed(TOTAL_DUR);
      setPlayState('done');
      return;
    }
    startTsRef.current = performance.now();
    setPlayState('playing');
    rafRef.current = requestAnimationFrame(runFrame);
  }, [reducedMotion, runFrame]);

  const handlePause = useCallback(() => {
    stopRaf();
    offsetRef.current = elapsed;
    setPlayState('paused');
  }, [elapsed, stopRaf]);

  const handleResume = useCallback(() => {
    startTsRef.current = performance.now();
    setPlayState('playing');
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const handleReset = useCallback(() => {
    stopRaf();
    offsetRef.current = 0;
    setElapsed(0);
    setPlayState('idle');
    crystFiredRef.current = {};
    arrivedRef.current = {};
    fallFiredRef.current = {};
    kRaiseRef.current = 0.12;
    charPopRef.current = 1.0;
    beamBoostRef.current = 0.0;
    beamCutRef.current = 0.0;
    lampFlareRef.current = 0.0;
  }, [stopRaf]);

  useEffect(() => () => stopRaf(), [stopRaf]);

  // Idle bobbing loop
  useEffect(() => {
    if (playState !== 'idle') return;
    let rafId: number;
    const tick = (ts: number) => {
      nowRef.current = ts;
      // update spring physics to rest
      kRaiseRef.current += (0.12 - kRaiseRef.current) * 0.10;
      charPopRef.current += (1.0 - charPopRef.current) * 0.16;
      beamBoostRef.current *= 0.92;
      beamCutRef.current *= 0.92;
      lampFlareRef.current *= 0.90;

      setFrame((f) => f + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playState]);

  const run = lastRun;
  const sensed     = run?.sessionsScanned    ?? 142;
  const pondered   = run?.sessionsReflected  ?? 9;
  const kept       = run ? run.bulletsInserted + run.bulletsDeduped : 4;
  const newBullets = run?.bulletsInserted    ?? 1;
  const folded     = run?.bulletsDeduped     ?? 3;
  const superseded = run?.bulletsSuperseded  ?? 1;
  const discarded  = run?.sessionsSkipped    ?? 133;
  const phantoms   = run?.phantomsBlocked    ?? 0;

  const isIdle    = playState === 'idle';
  const isPlaying = playState === 'playing';
  const isPaused  = playState === 'paused';
  const isDone    = playState === 'done';

  // Dynamic counter interpolation based on timing milestones
  const curPondered = isIdle ? 0 : isDone ? pondered : Math.round(win(elapsed, 1400, 5600) * pondered);
  const curKept     = isIdle ? 0 : isDone ? kept : Math.round(win(elapsed, 3500, 6300) * kept);
  const curNew      = isIdle ? 0 : isDone ? newBullets : Math.round(win(elapsed, 4900, 6300) * newBullets);
  const curFolded   = isIdle ? 0 : isDone ? folded : Math.round(win(elapsed, 3500, 5250) * folded);
  const curSuper    = isIdle ? 0 : isDone ? superseded : Math.round(win(elapsed, 5250, 6350) * superseded);
  const curDiscard  = isIdle ? 0 : isDone ? discarded : Math.round(win(elapsed, 1400, 4900) * discarded);

  const phaseLabel = isIdle
    ? 'Idle · 12 sessions in intake'
    : isDone
      ? `Done · ${pondered} pondered · ${kept} kept · ${folded} folded · ${newBullets} new · ${superseded} superseded`
      : `Running · the Keeper is examining ${sensed} sessions`;

  // Draw parameters — nowRef.current is 0 on the initial render (server + first client paint),
  // then updated each RAF tick, so SSR and client produce identical markup until animation starts.
  const now = nowRef.current;
  const pulseVal = 0.5 + 0.5 * Math.sin(now * 0.0022);
  const ambientOpacity = 0.13 + pulseVal * 0.10 + lampFlareRef.current * 0.16;
  const lampGlowOpacity = isLight
    ? 0.04 + pulseVal * 0.06 + lampFlareRef.current * 0.10
    : 0.30 + pulseVal * 0.26 + lampFlareRef.current * 0.30;

  // Beam Path Opacity
  const baseBeam = isPlaying ? clamp((kRaiseRef.current - 0.12) / 0.6, 0, 1) * (isLight ? 0.085 : 0.13) : 0;
  const beamOpacity = isPlaying ? Math.max(0.012, baseBeam + beamBoostRef.current - beamCutRef.current) : 0;

  // Bobbing — SVG transform attributes require unitless numbers (no `px`)
  const bob = Math.sin(now * 0.0021) * 4 * (isLight ? 0.7 : 1);
  const charGTransform = `translate(0, ${bob}) translate(${geo.keeper.x}, 358) scale(${charPopRef.current}) translate(${-geo.keeper.x}, -358)`;

  // Beam Path sweep angle
  const sweepT = win(elapsed, 150, 600);
  const beamAngle = (1 - ease(sweepT)) * -7;

  // Beam Path geometry helper
  const ay = geo.lamp.y + 6;
  const by = geo.lantern.y + 7;
  const beamPathD = `M${geo.lamp.x - 6} ${ay} L${geo.lamp.x + 6} ${ay} L${geo.lantern.x + 40} ${by} L${geo.lantern.x - 40} ${by} Z`;

  return (
    <section
      id="foer-section-distillation"
      className="foer"
      style={{
        padding:      '56px 0',
        borderTop:    '1px solid var(--foer-border)',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes foer-pulse-up {
          0%   { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-22px); }
        }
        .foer-pulse-text {
          animation: foer-pulse-up 0.95s ease-out forwards;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      ` }} />

      {/* ── Section kicker + Run Sweep button ───────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'flex-start',
        justifyContent: 'space-between',
        gap:            '16px',
        marginBottom:   '14px',
      }}>
        <div style={{
          fontFamily:    MONO,
          fontSize:      '10.5px',
          letterSpacing: '0.22em',
          color:         'var(--foer-text-mut)',
          textTransform: 'uppercase',
          display:       'flex',
          alignItems:    'center',
          gap:           '10px',
        }}>
          <span style={{ color: GOLD }}>02</span> · DISTIL · THE KEEPER
        </div>

        {/* Run Sweep button */}
        <button
          onClick={handleRunSweep}
          disabled={sweepState === 'running'}
          title="Trigger a synthesis sweep — reflects new sessions into memory bullets"
          style={{
            fontFamily:    MONO,
            fontSize:      '10px',
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            borderRadius:  '6px',
            padding:       '7px 14px',
            cursor:        sweepState === 'running' ? 'default' : 'pointer',
            border:        sweepState === 'error'
              ? '1px solid #D9774B'
              : sweepState === 'done'
              ? '1px solid var(--foer-green, #22c55e)'
              : `1px solid ${GOLD}`,
            background:    sweepState === 'running'
              ? 'var(--foer-surface2)'
              : sweepState === 'error'
              ? 'rgba(217,119,75,0.12)'
              : sweepState === 'done'
              ? 'rgba(34,197,94,0.10)'
              : 'transparent',
            color: sweepState === 'running'
              ? 'var(--foer-text-mut)'
              : sweepState === 'error'
              ? '#D9774B'
              : sweepState === 'done'
              ? 'var(--foer-green, #22c55e)'
              : GOLD,
            display:       'inline-flex',
            alignItems:    'center',
            gap:           '6px',
            flexShrink:    0,
            transition:    'all 0.15s',
          }}
        >
          {sweepState === 'running' && (
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '11px' }}>⟳</span>
          )}
          {sweepState === 'running'
            ? 'Distilling…'
            : sweepState === 'done' && sweepResult
            ? `+${sweepResult.inserted} bullets · ${sweepResult.reflected} reflected`
            : sweepState === 'error'
            ? 'Sweep failed'
            : '⟳ Run sweep'}
        </button>
      </div>

      {/* ── Section title ─────────────────────────────────────────────────── */}
      <h2 style={{
        fontFamily:    SERIF,
        fontWeight:    600,
        fontSize:      '30px',
        color:         'var(--foer-text-pri)',
        letterSpacing: '-0.01em',
        margin:        '0 0 8px',
      }}>
        The Nightly Distillation
      </h2>

      {/* ── Section description ───────────────────────────────────────────── */}
      <p style={{
        color:      'var(--foer-text-sec)',
        fontSize:   '15px',
        maxWidth:   '680px',
        margin:     '0 0 0',
        lineHeight: 1.5,
      }}>
        Every day&apos;s sessions arrive as noise. The Keeper raises a lantern to each one, ponders it,
        and keeps only what&apos;s structural — crystallising the durable lessons into core memories.
      </p>

      {/* ── Stage shell ───────────────────────────────────────────────── */}
      <div style={{ marginTop: '28px' }}>
        {/* Controls row */}
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:          '14px',
          marginBottom: '16px',
          flexWrap:     'wrap',
        }}>
          {(isIdle || isPaused) && (
            <button
              onClick={isPaused ? handleResume : handlePlay}
              disabled={!run}
              style={{
                fontFamily:    MONO,
                fontSize:      '11px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                borderRadius:  '6px',
                padding:       '11px 20px',
                cursor:        run ? 'pointer' : 'default',
                border:        `1px solid ${GOLD}`,
                background:    run ? GOLD : 'var(--foer-surface2)',
                color:         run ? '#05090f' : 'var(--foer-text-mut)',
                fontWeight:    600,
                opacity:       run ? 1 : 0.4,
                transition:    'all 0.15s ease',
              }}
            >
              {isPaused ? '▶ Resume' : '▶ Run distillation'}
            </button>
          )}
          {isPlaying && (
            <button onClick={handlePause} style={{
              fontFamily:    MONO,
              fontSize:      '11px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              background:    'transparent',
              color:         'var(--foer-text-sec)',
              border:        '1px solid var(--foer-border)',
              borderRadius:  '6px',
              padding:       '11px 20px',
              cursor:        'pointer',
              fontWeight:    500,
            }}>
              ⏸ Pause
            </button>
          )}
          {(isPlaying || isPaused || isDone) && (
            <button onClick={handleReset} disabled={isIdle} style={{
              fontFamily:    MONO,
              fontSize:      '11px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              background:    'transparent',
              color:         'var(--foer-text-sec)',
              border:        '1px solid var(--foer-border)',
              borderRadius:  '6px',
              padding:       '11px 20px',
              cursor:        'pointer',
              fontWeight:    500,
            }}>
              ↻ Reset
            </button>
          )}
          <span style={{
            fontFamily:    MONO,
            fontSize:      '11px',
            letterSpacing: '0.14em',
            color:         'var(--foer-text-mut)',
            textTransform: 'uppercase',
            marginLeft:    '6px',
          }}>
            {phaseLabel}
          </span>
        </div>

        {/* Zone labels */}
        <div style={{
          display:        'flex',
          justifyContent: 'space-between',
          margin:         '4px 4px 0',
          fontFamily:     MONO,
          fontSize:       '10px',
          letterSpacing:  '0.16em',
          textTransform:  'uppercase',
          color:          'var(--foer-text-mut)',
        }}>
          <span style={{ flex: 1 }}>Foer Intake</span>
          <span style={{ flex: 1, textAlign: 'center' }}>The Keeper</span>
          <span style={{ flex: 1, textAlign: 'right' }}>The Shelves</span>
        </div>

        {/* Stage SVG */}
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ width: '100%', display: 'block', borderRadius: '6px' }}
          preserveAspectRatio="xMidYMid meet"
          aria-label="Distillation stage"
          role="img"
        >
          {/* Gradients & masks */}
          <defs>
            <linearGradient id="keeperBeam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FDE7A0" stopOpacity={0.95} />
              <stop offset="0.5" stopColor="#FDB515" stopOpacity={0.5} />
              <stop offset="1" stopColor="#FDB515" stopOpacity={0} />
            </linearGradient>

            {/* Scene floor gradient — warm glow under the keeper */}
            <radialGradient id="floorGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0"   stopColor="#FDB515" stopOpacity={isLight ? 0.18 : 0.28} />
              <stop offset="1"   stopColor="#FDB515" stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* Intake hint text */}
          <text x={geo.intake.x} y={345} textAnchor="middle"
            fontFamily={MONO} fontSize={8.5} fill="var(--foer-text-mut)"
            letterSpacing="1.5">TODAY'S SESSIONS</text>

          {/* The Harbor Basin ellipse */}
          <text x={geo.keeper.x} y={geo.dumpY - 16} textAnchor="middle"
            fontFamily={MONO} fontSize={8.5} fill="var(--foer-text-mut)"
            letterSpacing="1.5">THE HARBOR</text>
          <ellipse
            cx={geo.keeper.x}
            cy={geo.dumpY + 8}
            rx={120}
            ry={22}
            fill="var(--foer-surface)"
            stroke="var(--foer-border-dim)"
            strokeWidth={1.5}
            style={{ cursor: 'help' }}
          >
            <title>Port Alpha · manifests processed</title>
          </ellipse>
          <text x={geo.keeper.x} y={geo.dumpY + 13} textAnchor="middle"
            fontFamily={MONO} fontSize={10} fill="var(--foer-text-mut)">
            discarded: {curDiscard}
          </text>

          {/* ── Keeper character & scene integration ─────────────────────── */}

          {/* Floor glow pool — warm light spilling down from the lantern */}
          <ellipse
            cx={geo.keeper.x}
            cy={358 + 4}
            rx={72}
            ry={14}
            fill="url(#floorGlow)"
            style={{ filter: 'blur(6px)' }}
            transform={`translate(0, ${bob})`}
          />

          {/* Ambient glow behind lighthouse — both modes, just dimmer in light */}
          <ellipse
            cx={geo.lamp.x}
            cy={geo.lamp.y + 4}
            rx={54}
            ry={50}
            fill="var(--foer-gold)"
            style={{
              filter: 'blur(20px)',
              opacity: ambientOpacity,
            }}
            transform={charGTransform}
          />

          {/* Scene-integrated keeper image — clipped + blended */}
          <g transform={charGTransform}>
            {/* Dusky atmospheric backdrop — makes the edges of the image melt into the SVG */}
            <ellipse
              cx={geo.keeper.x}
              cy={358 - 56}
              rx={40}
              ry={70}
              fill={isLight ? 'rgba(248,245,238,0.42)' : 'rgba(5,9,15,0.45)'}
              style={{ filter: 'blur(14px)' }}
            />
            {/* The keeper image itself, elliptical vignette via CSS mask — fades all edges */}
            <image
              x={geo.keeper.x - 38}
              y={358 - 152}
              width={76}
              height={152}
              href="/uploads/keeper.jpg"
              preserveAspectRatio="xMidYMax meet"
              style={{
                filter: isLight
                  ? 'saturate(0.82) contrast(0.92) brightness(1.04)'
                  : 'saturate(0.68) contrast(1.08) brightness(0.88)',
                mixBlendMode: isLight ? 'multiply' : 'luminosity',
                maskImage: 'radial-gradient(ellipse 48% 52% at 50% 36%, black 35%, transparent 100%)',
                WebkitMaskImage: 'radial-gradient(ellipse 48% 52% at 50% 36%, black 35%, transparent 100%)',
              }}
            />
            {/* Subtle vignette overlay to soften hard edges */}
            <rect
              x={geo.keeper.x - 38}
              y={358 - 152}
              width={76}
              height={152}
              fill={isLight ? 'rgba(248,245,238,0.08)' : 'rgba(5,9,15,0.12)'}
              style={{ pointerEvents: 'none' }}
            />
          </g>

          {/* Lamp glow — layered on top of the image */}
          <ellipse
            cx={geo.lamp.x}
            cy={geo.lamp.y}
            rx={16}
            ry={18}
            fill="#FFE9A8"
            style={{
              filter: 'blur(7px)',
              mixBlendMode: 'screen',
              opacity: lampGlowOpacity,
            }}
            transform={charGTransform}
          />

          {/* Ground shadow — cast beneath the keeper's feet */}
          <ellipse
            cx={geo.keeper.x}
            cy={358 + 5}
            rx={28}
            ry={6}
            fill={isLight ? 'rgba(80,44,10,0.30)' : 'rgba(0,0,0,0.55)'}
            style={{ filter: 'blur(5px)' }}
            transform={`translate(0, ${bob * 0.4})`}
          />

          {/* Dynamic Beam cone */}
          <path
            d={beamPathD}
            fill="url(#keeperBeam)"
            transform={`rotate(${beamAngle} ${geo.lamp.x} ${geo.lamp.y})`}
            style={{
              filter: 'blur(3px)',
              opacity: beamOpacity,
            }}
          />

          {/* Shelf slots */}
          {slots.map((s, idx) => {
            const isSupersededSlot = s.type === 'SOURCE_PREF' && s.filled && (isDone || (isPlaying && elapsed >= 5000));
            return (
              <g key={idx}>
                {/* Dashed outer ring */}
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={15}
                  fill="none"
                  stroke="var(--foer-border)"
                  strokeWidth={1}
                  strokeDasharray={s.filled ? 'none' : '3 3'}
                />
                {/* Pre-filled stable orbs */}
                {s.filled && (
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={11}
                    fill={ruleTypeColor(s.type)}
                    fillOpacity={isSupersededSlot ? 0.45 : 0.9}
                    stroke={isSupersededSlot ? ruleTypeColor(s.type) : 'none'}
                    strokeWidth={isSupersededSlot ? 1 : 0}
                    style={{
                      filter: isLight ? `drop-shadow(0 2px 4px ${ruleTypeColor(s.type)}2e)` : `drop-shadow(0 0 6px ${ruleTypeColor(s.type)})`,
                    }}
                  />
                )}
              </g>
            );
          })}

          {/* Active Particles */}
          {parts.map((p) => {
            const d = p.delay * 1000;
            const flowW = win(elapsed, 0 + d, 1400 + d);
            const pondEnd = 1850 + d;

            let x = p.x;
            let y = p.y;
            let fillOpacity = p.kind === 'noise' ? 0.4 : 0.55;
            let r = p.r;
            let fill = 'var(--foer-text-mut)';
            let labelOpacity = 0;

            if (isIdle) {
              // Only apply bobbing offset after the first RAF tick (now > 0).
              // On the initial render nowRef is 0 on both server and client, so
              // particles sit at their static p.x0/p.y0 — eliminating the
              // sub-ULP Math.sin difference that caused the hydration mismatch.
              if (now > 0) {
                const t = now / 1000;
                const amp = isLight ? 0.6 : 1.0;
                const bobOffset = Math.sin(t * 1.1 + p.phase) * 4 * amp;
                const sx = Math.cos(t * 0.5 + p.phase) * 2 * amp;
                x = p.x0 + sx;
                y = p.y0 + bobOffset;
                fillOpacity = (p.kind === 'noise' ? 0.4 : 0.55) + Math.sin(t * 1.6 + p.phase) * 0.18 * amp;
              }
            } else {
              if (p.kind === 'noise') {
                const fallW = win(elapsed, 1900 + d, 3150 + d);
                if (flowW < 1) {
                  const e = ease(flowW);
                  x = lerp(p.x0, geo.lantern.x + (p.i % 5 - 2) * 20, e);
                  y = lerp(p.y0, geo.lantern.y + 6, e);
                } else if (elapsed < pondEnd) {
                  x = geo.lantern.x + (p.i % 5 - 2) * 20;
                  y = geo.lantern.y + 6;
                  fillOpacity = 0.5;
                } else if (fallW < 1) {
                  const e = ease(fallW);
                  x = lerp(geo.lantern.x + (p.i % 5 - 2) * 20, p.dumpX, e);
                  y = lerp(geo.lantern.y + 6, p.dumpYT, e * e);
                  fillOpacity = lerp(0.5, 0, fallW);
                  r = lerp(p.r, p.r * 0.4, fallW);
                } else {
                  fillOpacity = 0;
                }
              } else {
                const crystW = win(elapsed, 1850 + d, 2950 + d);
                const chuteW = win(elapsed, 3300 + d, 6200 + d);
                const tx = p.target ? p.target.x : geo.shelfX;
                const ty = p.target ? p.target.y : 120;
                const gx = geo.lantern.x + (p.i % 3 - 1) * 24;

                if (flowW < 1) {
                  const e = ease(flowW);
                  x = lerp(p.x0, gx, e);
                  y = lerp(p.y0, geo.lantern.y, e);
                } else if (elapsed < pondEnd) {
                  x = gx;
                  y = geo.lantern.y;
                  fillOpacity = 0.6 + Math.sin(now * 0.02) * 0.15;
                } else if (crystW < 1) {
                  x = gx;
                  y = geo.lantern.y;
                  fill = ruleTypeColor(p.type);
                  fillOpacity = lerp(0.7, 1, crystW);
                  r = p.r * popScale(crystW);
                  labelOpacity = clamp((crystW - 0.3) / 0.6, 0, 1);
                } else if (chuteW < 1) {
                  const e = ease(chuteW);
                  x = lerp(gx, tx, e);
                  y = lerp(geo.lantern.y, ty, e);
                  r = lerp(p.r, 11, e);
                  fill = ruleTypeColor(p.type);
                  fillOpacity = 1;
                  labelOpacity = lerp(1, 0, chuteW);
                } else {
                  x = tx;
                  y = ty;
                  r = 11;
                  fill = ruleTypeColor(p.type);
                  fillOpacity = (p.outcome === 'new' || p.outcome === 'superseded') ? 1.0 : 0.0;
                }
              }
            }

            if (fillOpacity === 0) return null;

            return (
              <g key={p.id}>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  style={{
                    filter: !isIdle && p.kind === 'signal' && elapsed >= 1850 + d
                      ? (isLight ? `drop-shadow(0 2px 6px ${fill}66)` : `drop-shadow(0 0 12px ${fill})`)
                      : 'none',
                  }}
                />
                {!isIdle && p.kind === 'signal' && labelOpacity > 0 && (
                  <text
                    x={x}
                    y={y + r + 12}
                    textAnchor="middle"
                    fontFamily={MONO}
                    fontSize={8}
                    fill={fill}
                    fillOpacity={labelOpacity}
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Text Arrival Pulses */}
          {pulses.map((p) => (
            <text
              key={p.id}
              x={p.x}
              y={p.y}
              className="foer-pulse-text"
              textAnchor="middle"
              fontFamily={MONO}
              fontSize={12}
              fill={p.color}
              fontWeight={600}
            >
              {p.text}
            </text>
          ))}
        </svg>

        {/* ── Recon counters (inline text) ─────────────────────────────────── */}
        <div style={{
          fontFamily:    MONO,
          fontSize:      '12px',
          letterSpacing: '0.04em',
          color:         'var(--foer-text-sec)',
          marginTop:     '14px',
          display:       'flex',
          flexWrap:      'wrap',
          gap:           '4px 16px',
        }}>
          <span>sensed <b style={{ color: GOLD, fontWeight: 600 }}>{sensed}</b></span>
          <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
          <span>pondered <b style={{ color: GOLD, fontWeight: 600 }}>{curPondered}</b></span>
          <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
          <span>kept <b style={{ color: GOLD, fontWeight: 600 }}>{curKept}</b></span>
          <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
          <span>folded <b style={{ color: GOLD, fontWeight: 600 }}>{curFolded}</b></span>
          <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
          <span>new <b style={{ color: GOLD, fontWeight: 600 }}>{curNew}</b></span>
          <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
          <span>superseded <b style={{ color: GOLD, fontWeight: 600 }}>{curSuper}</b></span>
        </div>
      </div>

      {/* ── Caption ────────────────────────────────────────────────────────── */}
      <p style={{
        fontFamily: SERIF,
        fontStyle:  'italic',
        fontSize:   '16px',
        color:      'var(--foer-text-sec)',
        marginTop:  '22px',
        maxWidth:   '720px',
      }}>
        Memory grows by deltas, never by rewrite. Watch it increment — never redraw.
      </p>
    </section>
  );
}
