'use client';

import { useEffect, useRef, useState } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionColor } from '@/lib/companion/preferences';
import { LOGIN_COLUMN_MAX_PX, LOGIN_SECTION_PAD_X_PX } from '@/components/login/layout';
import { FONT_SANS } from '@/lib/typography/tokens';

/** The page's own face, for anything Captain draws as text on the canvas. */
const CAPTAIN_FONT = FONT_SANS;

export type DotBotMode = 'idle' | 'happy' | 'watching' | 'privacy' | 'peek' | 'loading' | 'error' | 'success';
type Mode = DotBotMode | 'sleep';

// ── Captain's visor display ─────────────────────────────────────────────────
// The everyday eyes are solid vector shapes (see `paintEyes`). For pictograms, scrolling words and the dizzy spiral the
// visor switches to a 7×7 dot display per eye; a pattern is a list of lit cells [col, row, brightness].

type Cell = [number, number, number];

const RING: [number, number][] = [
  [3, 1], [4, 1], [5, 2], [5, 3], [5, 4], [4, 5], [3, 5], [2, 5], [1, 4], [1, 3], [1, 2], [2, 1],
];

// ── Captain talks through its visor: a 5×7 LED font scrolls across both eyes, or a 7×7 pictogram shows in each ──
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['111', '010', '010', '010', '010', '010', '111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '!': ['1', '1', '1', '1', '1', '0', '1'], '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};
const ICONS = {
  check: ['0000000', '0000001', '0000010', '1000100', '0101000', '0010000', '0000000'],
  lock: ['0011100', '0100010', '0100010', '1111111', '1110111', '1110111', '1111111'],
  ask: ['0111110', '1100011', '0000011', '0001110', '0001100', '0000000', '0001100'],
  caps: ['0001000', '0011100', '0111110', '1111111', '0011100', '0011100', '0011100'],
};
type Icon = keyof typeof ICONS;
type Led = { text: string } | { icon: Icon; dur: number };

/** Text → LED columns (7-bit each, bit r = row r), one blank column between letters, padded so it scrolls in and out. */
function ledColumns(text: string): number[] {
  const cols: number[] = new Array(14).fill(0);
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let c = 0; c < g[0].length; c++) {
      let bits = 0;
      for (let r = 0; r < 7; r++) if (g[r][c] === '1') bits |= 1 << r;
      cols.push(bits);
    }
    cols.push(0);
  }
  return cols.concat(new Array(14).fill(0));
}
const SCROLL = 17; // LED columns per second
/** Centres of the two eyes on the visor (SVG units). */
const EYE_POS = [45, 75];

// ── short reactions layered over the current mode (clicks, waking, hover, idle fidgets) ──
type ReactKind = 'wink' | 'spin' | 'dizzy' | 'startle' | 'glance' | 'hop' | 'tilt';
type Reaction = { kind: ReactKind; start: number; until: number };

/** Dot-display pattern for the dizzy spiral; every other reaction uses the solid eyes. */
function reactEyes(kind: ReactKind, side: 'L' | 'R', t: number): Cell[] {
  switch (kind) {
    case 'dizzy': {
      // spiral eyes: a comet runs round each eye, the two turning opposite ways
      const tick = Math.floor(t * 14), dir = side === 'L' ? 1 : -1;
      const cells = [0, 1, 2, 3].map((i): Cell => {
        const [c, r] = RING[(((dir * tick - dir * i) % 12) + 12) % 12];
        return [c, r, 1 - i * 0.22];
      });
      cells.push([3, 3, 0.6]);
      return cells;
    }
    default: return [];
  }
}

/** What Captain says for each moment: `sr` is the full sentence for screen readers, `led` is what the visor shows. */
function lineFor(mode: Mode, prev: Mode, name: string): { sr: string | null; led: Led | null } {
  switch (mode) {
    case 'idle': return prev === 'sleep' ? { sr: 'Oh! Hi there.', led: null } : { sr: null, led: null };
    case 'happy': return { sr: "Let's get you in.", led: null };
    case 'watching': return name ? { sr: `Hi ${name}!`, led: null } : { sr: null, led: null };
    case 'privacy': return { sr: "I won't look. Promise.", led: { icon: 'lock', dur: 1.3 } };
    case 'peek': return { sr: 'Okay, just a tiny peek.', led: null };
    case 'loading': return { sr: 'Signing you in.', led: null };
    case 'error': return { sr: "Hmm, that didn't work. Try again?", led: { icon: 'ask', dur: 1.2 } };
    case 'success': return { sr: name ? `You're in, ${name}!` : "You're in!", led: { icon: 'check', dur: 1.4 } };
    case 'sleep': return { sr: null, led: null }; // shown as floating z's
  }
}

// ── particle aura ───────────────────────────────────────────────────────────

// canvas and Dot geometry (px); the canvases overhang Dot so the aura can orbit it
const FW = 440;
const FH = 380;
const FX_TOP = -70;
const DOT_W = 140;
const DOT_H = 128;
const DOT_TOP = 52;
const CX = FW / 2;
const CY = -FX_TOP + DOT_TOP + DOT_H / 2;
const U = 56; // px per world unit
const NA = 440;
const NSPARK = 60;

export type LoginTheme = 'light' | 'dark';

/**
 * Effect colours per theme. Dark adds light ('lighter' blending, white-hot cores); light can't add light to a white
 * page, so it draws ink/terracotta/sage normally and keeps glows subtle.
 */
const PALETTE = {
  dark: {
    // monochrome night: white and greys only (red kept for errors so they still read as errors)
    rgb: ['255,255,255', '190,190,190', '235,235,235'], bad: '255,120,120', think: '200,200,200', core: '255,255,255',
    blend: 'lighter' as GlobalCompositeOperation, glow: '255,255,255', glyph: '#f2f2f2', drop: '#d6d6d6', spark: '#ffffff', star: '255,255,255',
  },
  light: {
    // Sage Studio: ink, terracotta and sage (matches the day theme in globals.css)
    rgb: ['26,35,28', '168,72,31', '94,127,106'], bad: '180,35,35', think: '94,127,106', core: '',
    blend: 'source-over' as GlobalCompositeOperation, glow: '168,72,31', glyph: '#A8481F', drop: '#5E7F6A', spark: '#C2653A', star: '26,35,28',
  },
};

function sprite(rgb: string, core = '255,255,255') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${core || rgb},1)`);
  g.addColorStop(0.18, `rgba(${rgb},.9)`);
  g.addColorStop(0.45, `rgba(${rgb},.18)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

type Props = {
  mode: DotBotMode;
  /** First name to greet the user with, if known. */
  name?: string;
  /** Running count of keystrokes in the form; each increase sends sparks into Dot. */
  keystrokes?: number;
  /** 0–1 progress through the username, so Dot's eyes follow along while typing. */
  progress?: number;
  /** Keep the floating particles on at rest; false shows them only during actions (click, sign-in, success, error). */
  ambient?: boolean;
  /** Master switch for the particle halo; false hides it entirely, even during actions. */
  particles?: boolean;
  /** Page theme: the glow effects are drawn differently on a light page. */
  theme?: LoginTheme;
};

/**
 * Captain, the login companion: a flat white helmet with LED dot-matrix eyes, given depth by a gentle
 * tilt, eye parallax and a particle aura that orbits behind and in front of it.
 * idle → follows the cursor, blinks, dozes off after 15s alone · happy → ^ ^
 * watching → reads along as you type · privacy → eyes shut · peek → one eye opens
 * loading → spinner eyes, motes swirl in faster · error → > < and a head shake · success → nod and burst
 * Reactions: repeat clicks escalate (^ ^ → wink → spin → dizzy) · hover perks it up (a small lift)
 * · waking from sleep startles it (eyes lift, "!") · idle fidgets (glance, hop, head tilt) · Caps Lock in a password shows ↑
 */
export function DotCompanion({ mode, name = '', keystrokes = 0, progress = 0, ambient = true, particles = true, theme = 'dark' }: Props) {
  const companionPreferences = useCompanionPreferences();
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const ledGroupRef = useRef<SVGGElement>(null);
  const visorRef = useRef<SVGGElement>(null);
  const ledRefs = useRef<(SVGCircleElement | null)[]>([]);
  const eyeRefs = useRef<(SVGElement | null)[]>([]);
  const [spoken, setSpoken] = useState('');

  const props = useRef({ mode, name, progress, ambient, particles, theme });
  props.current = { mode, name, progress, ambient, particles, theme };
  const api = useRef<{ setMode: (m: Mode) => void; sparks: (n: number) => void; greet: (name: string) => void } | null>(null);
  const lastKeys = useRef(keystrokes);

  useEffect(() => {
    const back = backRef.current, front = frontRef.current, dot = dotRef.current, headEl = headRef.current;
    const shadowEl = shadowRef.current, faceEl = faceRef.current, ledGroup = ledGroupRef.current, bodyEl = bodyRef.current, visorEl = visorRef.current;
    const bctx = back?.getContext('2d'), fctx = front?.getContext('2d');
    if (!back || !front || !dot || !headEl || !shadowEl || !faceEl || !ledGroup || !bodyEl || !visorEl || !bctx || !fctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = () => performance.now() / 1000;

    // ── speech: Captain talks through its visor (scrolling LED text or a pictogram); screen readers get the sentence ──
    let speaking = false, amp = 0, ampKick = 0;
    type Msg = { cols: number[]; start: number; key: string } | { icon: Icon; start: number; dur: number; key: string };
    let msg: Msg | null = null, lastCol = -1;
    const say = (sr: string | null, led: Led | null) => {
      if (sr) setSpoken(sr);
      if (!led) return; // a message already on the visor finishes on its own
      const key = 'text' in led ? `t:${led.text}` : `i:${led.icon}`;
      if (msg && msg.key === key) return; // already showing this
      if (reduced && 'text' in led) return; // no scrolling under reduced motion; the sentence still reaches screen readers
      msg = 'text' in led
        ? { cols: ledColumns(led.text), start: now(), key }
        : { icon: led.icon, start: now(), dur: led.dur, key };
      lastCol = -1;
      ampKick = 1;
    };
    /** Cells for one eye while a message is on the visor, or null when there is none (or it just finished). */
    const msgCells = (side: 'L' | 'R', t: number): Cell[] | null => {
      if (!msg) return null;
      const cells: Cell[] = [];
      if ('icon' in msg) {
        ICONS[msg.icon].forEach((row, r) => { for (let c = 0; c < 7; c++) if (row[c] === '1') cells.push([c, r, 1]); });
        return cells;
      }
      const o = Math.floor((t - msg.start) * SCROLL);
      if (side === 'L' && o !== lastCol) { if (o % 6 === 0) ampKick = 1; lastCol = o; } // pulse the voice ring as letters pass
      for (let v = 0; v < 7; v++) {
        const bits = msg.cols[o + v + (side === 'R' ? 7 : 0)] ?? 0;
        for (let r = 0; r < 7; r++) if (bits & (1 << r)) cells.push([v, r, 1]);
      }
      return cells;
    };

    // ── mode ──
    let cur: Mode = props.current.mode, modeAt = now(), sqV = 0, burst = 0, sparks = 0;
    const setMode = (m: Mode) => {
      if (m === cur) return;
      const prev = cur;
      cur = m;
      modeAt = now();
      if (m === 'happy') sqV += 2;
      if (m === 'success') { sqV += 3; burst += 2.4; emitSparkles(); }
      if (m === 'error') { sqV -= 1.5; emit('drop', CX + 60, CY - 34, 1.3, 0.25); }
      const line = lineFor(m, prev, props.current.name);
      say(line.sr, line.led);
    };
    api.current = {
      setMode: m => { sleeping = false; lastActivity = now(); setMode(m); },
      sparks: n => { sparks += n; sqV += n * 0.15; },
      // the name arrives while typing the username: greet once it's known
      greet: n => { if (n && cur === 'watching') say(`Hi ${n}!`, null); },
    };

    // ── reactions ──
    let react: Reaction | null = null, hovering = false;
    const startReact = (kind: ReactKind, dur: number) => { const t = now(); react = { kind, start: t, until: t + dur }; };

    // ── dozing off when left alone ──
    let sleeping = false, lastActivity = now(), nextFidget = now() + 8;
    const activity = () => {
      lastActivity = now();
      // woken up: a startled hop with O O eyes, then back to whatever the page is doing
      if (sleeping) { sleeping = false; sqV += 1.5; startReact('startle', 1.2); emit('bang', CX + 46, CY - 56, 0.9); setMode(props.current.mode); }
    };
    const sleepCheck = setInterval(() => {
      const t = now();
      if (!sleeping && cur === 'idle' && t - lastActivity > 15) { sleeping = true; react = null; setMode('sleep'); return; }
      // idle fidgets: every 8–12s while nobody's moving the mouse, a small random action
      if (cur === 'idle' && !sleeping && !hovering && !react && t - lastMove > 3 && t > nextFidget) {
        const pick = (['glance', 'hop', 'tilt'] as const)[Math.floor(Math.random() * 3)];
        startReact(pick, pick === 'glance' ? 1.6 : pick === 'hop' ? 0.6 : 1.4);
        if (pick === 'hop') sqV += 1;
        nextFidget = t + 12 + Math.random() * 6;
      }
    }, 1000);

    // ── cursor ──
    const look = { x: 0, y: 0 }, mouse = { x: -1e4, y: -1e4 };
    // body offset (px) and velocity: a spring that walks Captain toward the cursor
    const body = { x: 0, y: 0, vx: 0, vy: 0 }, bodyMoved = { x: 0, y: 0 };
    const canFollow = !reduced && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    // cursor left the window: let Captain drift home
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) lastMove = -10; };
    let lastMove = -10;
    const onMove = (e: MouseEvent) => {
      // measured from where Captain rests, so moving toward the cursor doesn't shrink the pull
      const r = dot.getBoundingClientRect();
      look.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2 - body.x)) / LOGIN_COLUMN_MAX_PX));
      look.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2 - body.y)) / 300));
      const fr = front.getBoundingClientRect();
      mouse.x = e.clientX - fr.left;
      mouse.y = e.clientY - fr.top;
      lastMove = now();
      activity();
    };
    let boopUntil = 0, combo = 0, lastBoop = -10;
    const onBoop = () => {
      if (cur === 'loading') return;
      const t = now();
      // clicking a sleeping Captain just wakes it (the window click listener would otherwise do it after us)
      if (sleeping) { activity(); return; }
      burst += 1.3; sqV -= 3; actionUntil = t + 2.5;
      // quick repeat clicks escalate: ^ ^ → wink → a full spin → dizzy
      combo = t - lastBoop < 2.5 ? combo + 1 : 1;
      lastBoop = t;
      // eyes stay politely shut (or happy) while a password is being typed
      const step = cur === 'privacy' || cur === 'peek' ? 1 : Math.min(combo, 4);
      switch (step) {
        case 1:
          boopUntil = t + 0.9;
          if (t - lastSpark > 0.45) { lastSpark = t; emit('spark', CX + 22, CY - 66, 0.8); }
          break;
        case 2:
          startReact('wink', 1);
          emit('spark', CX - 30, CY - 62, 0.7);
          say('Hehe.', null);
          break;
        case 3:
          startReact('spin', 0.9);
          emitSparkles();
          say('Wheee!', null);
          break;
        default:
          startReact('dizzy', 2.4);
          sqV -= 2;
          if (!reduced) [0, 2.1, 4.2].forEach(seed => glyphs.push({ kind: 'orbit', age: 0, life: 2.3, delay: 0, x: CX, y: CY - 66, seed }));
          say('Whoa… dizzy!', null);
          combo = 0;
      }
    };
    const onEnter = () => {
      hovering = true;
      if (cur === 'idle' && !sleeping) sqV += 0.5;
    };
    const onLeave = () => { hovering = false; };
    // Caps Lock while typing a password: an up-arrow on the visor
    let capsOn = false, capsShown = -10;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.matches?.('input[type="password"], input[autocomplete="current-password"]')) return;
      const on = e.getModifierState?.('CapsLock') ?? false;
      if (on && (!capsOn || now() - capsShown > 8)) {
        capsShown = now();
        sqV += 1.5;
        say('Caps Lock is on.', { icon: 'caps', dur: 1.8 });
      }
      capsOn = on;
    };
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseout', onOut);
    window.addEventListener('keydown', onKey);
    ['keydown', 'focusin', 'click'].forEach(ev => window.addEventListener(ev, activity));
    dot.addEventListener('click', onBoop);
    dot.addEventListener('mouseenter', onEnter);
    dot.addEventListener('mouseleave', onLeave);

    const greet = setTimeout(() => {
      if (cur !== 'idle') return;
      const h = new Date().getHours();
      const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      say(`${greeting}! I'm Captain, your Agent Lab companion.`, null);
    }, 1500);

    // ── canvases ──
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    [back, front].forEach(c => {
      c.width = FW * DPR;
      c.height = FH * DPR;
      c.getContext('2d')!.setTransform(DPR, 0, 0, DPR, 0, 0);
    });
    const spritesFor = (p: (typeof PALETTE)[LoginTheme]) => ({
      base: p.rgb.map(rgb => sprite(rgb, p.core)), bad: sprite(p.bad, p.core), think: sprite(p.think, p.core),
    });
    const SPRITES = { dark: spritesFor(PALETTE.dark), light: spritesFor(PALETTE.light) };

    // ── particles: free-floating motes around Dot, each wandering on its own path (dust = smaller, dimmer) ──
    const X = new Float32Array(NA * 3), V = new Float32Array(NA * 3);
    const HX = new Float32Array(NA), HY = new Float32Array(NA), HZ = new Float32Array(NA);
    const f1 = new Float32Array(NA), f2 = new Float32Array(NA), dust = new Uint8Array(NA);
    const tw = new Float32Array(NA), pk = new Float32Array(NA), sz = new Float32Array(NA);
    const col = new Uint8Array(NA), star = new Uint8Array(NA), PX = new Float32Array(NA).fill(NaN), PY = new Float32Array(NA).fill(NaN);
    for (let i = 0; i < NA; i++) {
      // home: a random point in a soft shell around Dot, wider than tall
      const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, rr = 1.45 + Math.pow(Math.random(), 0.8) * 1.05;
      const ring = Math.sqrt(1 - u * u);
      HX[i] = ring * Math.cos(ph) * rr * 1.15; HY[i] = u * rr * 0.85; HZ[i] = ring * Math.sin(ph) * rr;
      f1[i] = 0.25 + Math.random() * 0.35; f2[i] = 0.2 + Math.random() * 0.3;
      dust[i] = Math.random() < 0.3 ? 1 : 0;
      tw[i] = Math.random() * Math.PI * 2;
      pk[i] = 0.7 + Math.random() * 0.6;
      sz[i] = dust[i] ? 0.7 + Math.random() * 0.7 : 0.9 + Math.pow(Math.random(), 2) * 1.3;
      col[i] = Math.random() < 0.6 ? 0 : Math.random() < 0.6 ? 1 : 2;
      star[i] = Math.random() < 0.04 ? 1 : 0;
      // emerge from inside Dot, then drift out to their orbits
      X[i * 3] = (Math.random() - 0.5) * 0.4; X[i * 3 + 1] = (Math.random() - 0.5) * 0.4; X[i * 3 + 2] = -0.3;
    }
    const sparkPool = Array.from({ length: NSPARK }, () => ({ on: false, s: 0, dur: 1, x0: 0, cx: 0 }));

    // ── eyes: solid rounded shapes that morph between expressions. Curved lids (masks) carve ^ ^ smiles and frowns.
    // The dot-matrix display only lights up for pictograms, scrolling words and the spinner/dizzy patterns. ──
    type Eye = { x: number; y: number; w: number; h: number; r: number; lb: number; lt: number; la: number; o: number };
    const EYE_X = EYE_POS;
    const eyes: Eye[] = EYE_X.map(x => ({ x, y: 54, w: 12, h: 16, r: 6, lb: 0, lt: 0, la: 0, o: 0 }));
    const eyeTarget = (side: 'L' | 'R', si: number, t: number, gaze: { x: number; y: number }, blink: boolean): Eye => {
      const cx = EYE_X[si];
      const open = (dy = 0, h = 16): Eye => ({ x: cx + gaze.x * 5, y: 54 + gaze.y * 3.5 + dy, w: 12, h: blink ? 2.2 : h, r: blink ? 1.1 : 6, lb: 0, lt: 0, la: 0, o: 1 });
      const happy: Eye = { x: cx, y: 53, w: 15, h: 15, r: 7.5, lb: 1, lt: 0, la: 0, o: 1 };
      const shut: Eye = { x: cx, y: 57, w: 14, h: 2.4, r: 1.2, lb: 0, lt: 0, la: 0, o: 1 };
      if (t < boopUntil && cur !== 'loading') return happy;
      const rx = react && t < react.until && !['loading', 'error', 'success', 'privacy', 'peek'].includes(cur) ? react : null;
      if (rx) {
        const since = t - rx.start;
        switch (rx.kind) {
          case 'wink': return side === 'L' ? open() : happy;
          case 'spin': case 'hop': return happy;
          case 'startle': return { ...open(-3, 18), w: 13 };
          case 'tilt': return open(-2);
          case 'glance': { const g = since < 0.9 ? -1 : since < 1.9 ? 1 : 0; return { ...open(), x: cx + g * 6 }; }
        }
      }
      switch (cur) {
        case 'happy': case 'success': return happy;
        case 'privacy': case 'sleep': return shut;
        case 'peek': return side === 'L' ? shut : { ...open(), x: cx + 5, y: 56 };
        case 'error': return { x: cx, y: 55, w: 13, h: 14, r: 5, lb: 0, lt: 1, la: side === 'L' ? 18 : -18, o: 1 };
        // thinking: eyes glance up, a little squinted
        case 'loading': return { x: cx + 2, y: 50, w: 12, h: 13, r: 6, lb: 0.25, lt: 0, la: 0, o: 1 };
        default: return open();
      }
    };
    const level = [new Float32Array(49), new Float32Array(49)];
    const paintEyes = (t: number, dt: number, gaze: { x: number; y: number }) => {
      // a soft, faint halo around the eyes (night eyes are pure white; day keeps the warm white), a little stronger while Captain speaks
      const color = props.current.theme === 'light' ? '#FFF4EC' : '#FFFFFF';
      const halo = props.current.theme === 'light' ? 'rgba(255,244,236,.4)' : 'rgba(255,255,255,.4)';
      ledGroup.style.filter = `drop-shadow(0 0 ${(1.2 + amp * 1.8).toFixed(1)}px ${halo})`;
      const k = 1 - Math.exp(-dt * 26), ke = 1 - Math.exp(-dt * 20);
      // a finished message leaves the visor (checked once, so both eyes switch back together)
      if (msg && ('icon' in msg ? t - msg.start > msg.dur : Math.floor((t - msg.start) * SCROLL) > msg.cols.length - 14)) msg = null;
      const rx = react && t < react.until && !['loading', 'error', 'success', 'privacy', 'peek'].includes(cur) ? react : null;
      const ledOn = !!msg || (rx && rx.kind === 'dizzy');
      (['L', 'R'] as const).forEach((side, si) => {
        const want = new Float32Array(49);
        const cells = msgCells(side, t) ?? (ledOn && rx ? reactEyes(rx.kind, side, t) : null);
        cells?.forEach(([c, r, v]) => {
          if (c >= 0 && c < 7 && r >= 0 && r < 7) want[r * 7 + c] = v;
        });
        const lv = level[si];
        for (let i = 0; i < 49; i++) {
          lv[i] += (want[i] - lv[i]) * k;
          const d = ledRefs.current[si * 49 + i];
          if (!d) continue;
          const on = lv[i] > 0.04;
          d.setAttribute('fill', color);
          d.setAttribute('fill-opacity', on ? Math.min(1, lv[i]).toFixed(3) : '0');
        }

        // solid eye: ease every parameter toward its target; while the display is in use it shrinks away
        const e = eyes[si];
        const tg = ledOn ? { ...e, w: 6, h: 1, r: 0.5, o: 0 } : eyeTarget(side, si, t, gaze, t < blinkUntil);
        (Object.keys(tg) as (keyof Eye)[]).forEach(key => { e[key] += (tg[key] - e[key]) * ke; });
        const shape = eyeRefs.current[si * 3], lidB = eyeRefs.current[si * 3 + 1], lidT = eyeRefs.current[si * 3 + 2];
        if (!shape || !lidB || !lidT) return;
        const h = Math.max(0.1, e.h), r = Math.min(e.r, e.w / 2, h / 2);
        shape.setAttribute('x', (e.x - e.w / 2).toFixed(2)); shape.setAttribute('y', (e.y - h / 2).toFixed(2));
        shape.setAttribute('width', e.w.toFixed(2)); shape.setAttribute('height', h.toFixed(2));
        shape.setAttribute('rx', r.toFixed(2)); shape.setAttribute('fill', color);
        shape.setAttribute('fill-opacity', Math.max(0, Math.min(1, e.o)).toFixed(3));
        // bottom lid: a curved cutout that rises to leave a ^ crescent
        lidB.setAttribute('cx', e.x.toFixed(2));
        lidB.setAttribute('cy', (e.y + h / 2 + h * 0.8 - e.lb * h * 0.8).toFixed(2));
        lidB.setAttribute('rx', (e.w * 0.75).toFixed(2)); lidB.setAttribute('ry', (h * 0.75).toFixed(2));
        // top lid: a slanted cut for a frown
        const topY = e.y - h / 2 + e.lt * h * 0.5;
        lidT.setAttribute('x', (e.x - 20).toFixed(2)); lidT.setAttribute('y', (topY - 30).toFixed(2));
        lidT.setAttribute('transform', `rotate(${e.la.toFixed(2)} ${e.x.toFixed(2)} ${topY.toFixed(2)})`);
      });
    };

    // ── animation loop ──
    const st = { yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0 };
    let sq = 1, dim = 1, tint = 0, tintBad = false, blinkUntil = 0, nextBlink = 3, flow = 0;
    let pvis = props.current.particles && props.current.ambient ? 1 : 0, actionUntil = 0;
    // ── little glowing glyphs that float off Captain's head (one small touch per moment) ──
    // z: sleeping · dot: thinking while signing in · drop: sweat drop on an error · spark: success and a click
    // orbit: little stars circling a dizzy Captain · bang: "!" when woken up
    type Glyph = { kind: 'z' | 'dot' | 'drop' | 'spark' | 'orbit' | 'bang'; age: number; life: number; delay: number; x: number; y: number; seed: number };
    const glyphs: Glyph[] = [];
    let nextZ = 0, nextDot = 0, dotIdx = 0, lastSpark = -10;
    const emit = (kind: Glyph['kind'], x: number, y: number, life: number, delay = 0) => {
      if (!reduced) glyphs.push({ kind, age: 0, life, delay, x, y, seed: Math.random() * Math.PI * 2 });
    };
    const emitSparkles = () => {
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI * 0.9 + (k / 5) * Math.PI * 0.8 + (Math.random() - 0.5) * 0.3, r = 78 + Math.random() * 18;
        emit('spark', CX + Math.cos(a) * r, CY - 4 + Math.sin(a) * r, 0.75, k * 0.07);
      }
    };
    const sparkShape = (r: number) => {
      fctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, rr = k % 2 ? r * 0.28 : r;
        fctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      fctx.closePath();
      fctx.fill();
    };
    const drawGlyphs = (t: number, dt: number, yOff: number) => {
      if (cur === 'sleep' && t > nextZ) { emit('z', CX + 44, CY - 50, 2.6); nextZ = t + 1.05; }
      // thinking dots appear one after another above Captain's head, left to right
      if (cur === 'loading' && t > nextDot) { emit('dot', CX + 26 + dotIdx * 13, CY - 64, 1.1); dotIdx = (dotIdx + 1) % 3; nextDot = t + 0.32; }
      for (let i = glyphs.length - 1; i >= 0; i--) {
        const g = glyphs[i];
        g.age += dt;
        if (g.age < g.delay) continue;
        const a = g.age - g.delay;
        if (a >= g.life) { glyphs.splice(i, 1); continue; }
        const p = a / g.life;
        const pal = PALETTE[props.current.theme];
        fctx.save();
        fctx.globalCompositeOperation = 'source-over';
        fctx.shadowBlur = props.current.theme === 'light' ? 4 : 8;
        switch (g.kind) {
          case 'bang': {
            // pops up with a little overshoot, holds, fades
            const pop = Math.min(1, a / 0.18), sc = pop < 1 ? 0.6 + 0.6 * pop : 1.2 - 0.2 * Math.min(1, (a - 0.18) / 0.12);
            fctx.globalAlpha = Math.min(1, a * 10) * (1 - Math.pow(p, 3));
            fctx.font = `800 22px ${CAPTAIN_FONT}`;
            fctx.textAlign = 'center';
            fctx.fillStyle = pal.glyph;
            fctx.shadowColor = `rgba(${pal.glow},.8)`;
            fctx.translate(g.x, g.y + yOff - p * 8);
            fctx.rotate(0.15);
            fctx.scale(sc, sc);
            fctx.fillText('!', 0, 0);
            break;
          }
          case 'z': {
            const size = 11 + p * 13;
            fctx.globalAlpha = Math.min(1, p * 5) * (1 - p) * 0.9;
            fctx.font = `600 ${size.toFixed(1)}px ${CAPTAIN_FONT}`;
            fctx.fillStyle = pal.glyph;
            fctx.shadowColor = `rgba(${pal.glow},.8)`;
            fctx.translate(g.x + p * 46 + Math.sin(g.seed + a * 2.4) * 6, g.y + yOff - p * 92);
            fctx.rotate(-0.18 + Math.sin(g.seed) * 0.1);
            fctx.fillText('z', 0, 0);
            break;
          }
          case 'dot': {
            // pops up, rises a little, fades
            fctx.globalAlpha = Math.min(1, p * 6) * (1 - p);
            fctx.fillStyle = pal.glyph;
            fctx.shadowColor = `rgba(${pal.glow},.9)`;
            fctx.beginPath();
            fctx.arc(g.x, g.y + yOff - p * 12, 3.2 * (0.6 + 0.4 * Math.min(1, p * 4)), 0, Math.PI * 2);
            fctx.fill();
            break;
          }
          case 'drop': {
            // a sweat drop that slides down the side of the helmet
            const ease = 1 - Math.pow(1 - p, 2);
            fctx.globalAlpha = Math.min(1, p * 8) * (1 - Math.pow(p, 4)) * 0.95;
            fctx.fillStyle = pal.drop;
            fctx.shadowColor = `rgba(${pal.glow},.8)`;
            fctx.translate(g.x, g.y + yOff + ease * 34);
            fctx.beginPath();
            fctx.moveTo(0, -9);
            fctx.bezierCurveTo(4, -3, 6, 1, 6, 4);
            fctx.arc(0, 4, 6, 0, Math.PI);
            fctx.bezierCurveTo(-6, 1, -4, -3, 0, -9);
            fctx.fill();
            fctx.fillStyle = 'rgba(255,255,255,.8)';
            fctx.beginPath();
            fctx.arc(-2, 3, 1.6, 0, Math.PI * 2);
            fctx.fill();
            break;
          }
          case 'spark': {
            // pops in, twinkles, shrinks away
            const s = Math.sin(Math.PI * p);
            fctx.globalAlpha = s;
            fctx.fillStyle = pal.spark;
            fctx.shadowColor = `rgba(${pal.glow},1)`;
            fctx.translate(g.x, g.y + yOff);
            fctx.rotate(g.seed + p * 0.6);
            sparkShape(3 + s * 6);
            break;
          }
          case 'orbit': {
            // a small star circling above the head
            const ang = g.seed + a * 5;
            fctx.globalAlpha = Math.min(1, a * 5) * Math.min(1, (g.life - a) * 3) * (Math.sin(ang) > 0 ? 1 : 0.55);
            fctx.fillStyle = pal.spark;
            fctx.shadowColor = `rgba(${pal.glow},1)`;
            fctx.translate(g.x + Math.cos(ang) * 36, g.y + yOff + Math.sin(ang) * 8);
            fctx.rotate(ang);
            sparkShape(5);
            break;
          }
        }
        fctx.restore();
      }
    };
    let talkDim = 0;
    let last = now(), raf = 0;
    const startAt = last;

    const targets = (t: number) => {
      const L = t - lastMove > 3.5 ? { x: Math.sin(t * 0.5) * 0.55, y: Math.sin(t * 0.37) * 0.25 } : look;
      const since = t - modeAt;
      // degrees, kept small so Dot stays flat and graphic
      const o = { yaw: L.x * 18, pitch: L.y * 10, roll: Math.sin(t * 0.7) * 1.5 - L.x * 2, gx: L.x, gy: L.y };
      switch (cur) {
        case 'watching': {
          const p = props.current.progress;
          Object.assign(o, { yaw: -6 + p * 12, pitch: 10, roll: -1, gx: -0.7 + p * 1.4, gy: 1 });
          break;
        }
        case 'sleep': Object.assign(o, { yaw: 0, pitch: 8, roll: 7, gx: 0, gy: 0.5 }); break;
        case 'privacy': Object.assign(o, { yaw: -22, pitch: -2, roll: 5, gx: -1, gy: 0 }); break;
        case 'peek': Object.assign(o, { yaw: -14, pitch: 4, roll: 3, gx: 1, gy: 1 }); break;
        case 'loading': Object.assign(o, { yaw: Math.sin(t * 2) * 3, pitch: -6, roll: 0, gx: 0, gy: -1 }); break;
        case 'error': Object.assign(o, { yaw: Math.sin(since * 22) * 16 * Math.exp(-since * 2.6), pitch: 3, roll: 0, gx: 0, gy: 0 }); break;
        case 'success': Object.assign(o, { yaw: 0, pitch: Math.sin(since * 13) * 12 * Math.exp(-since * 2.2), roll: 0, gx: 0, gy: 0 }); break;
        case 'happy': o.roll = 5; break;
      }
      // reaction poses, eased in and out
      if (react && t < react.until && !reduced) {
        const rs = t - react.start, env = Math.sin(Math.PI * Math.min(1, rs / (react.until - react.start)));
        switch (react.kind) {
          case 'wink': o.roll += 9 * env; break;
          case 'dizzy': o.roll += Math.sin(rs * 9) * 11 * env; o.yaw += Math.sin(rs * 4.5) * 12 * env; break;
          case 'startle': o.pitch -= 7 * env; break;
          case 'glance': {
            // a slow look left, then right, then back: one smooth sine sweep, no snapping
            const g = Math.sin((rs / (react.until - react.start)) * Math.PI * 2) * -env;
            o.yaw = g * 14; o.gx = g; break;
          }
          case 'tilt': o.roll += 13 * env; o.pitch += 4 * env; break;
        }
      }
      return o;
    };
    /** Unsmoothed extras: the spin's full turn and hop/startle lift, so they snap to their curves. */
    const reactMotion = (t: number) => {
      if (!react || t >= react.until || reduced) return { spin: 0, lift: 0 };
      const rs = t - react.start;
      if (react.kind === 'spin') { const p = Math.min(1, rs / 0.8); return { spin: 360 * (1 - Math.pow(1 - p, 3)), lift: Math.sin(Math.PI * p) * 8 }; }
      if (react.kind === 'hop') return { spin: 0, lift: Math.sin(Math.PI * Math.min(1, rs / 0.7)) * 7 };
      if (react.kind === 'startle') return { spin: 0, lift: Math.sin(Math.PI * Math.min(1, rs / 0.6)) * 5 };
      return { spin: 0, lift: 0 };
    };
    let hov = 0;

    const frame = () => {
      const t = now(), dt = Math.min(t - last, 0.04), since = t - modeAt;
      last = t;
      const ease = (r: number) => 1 - Math.exp(-dt * r);
      const asleep = cur === 'sleep', loading = cur === 'loading';

      // Dot: tilt, parallax, float, squash, pop-in
      const tg = targets(t), m = reduced ? 1 : ease(cur === 'error' || cur === 'success' ? 30 : 3.5);
      st.yaw += (tg.yaw - st.yaw) * m; st.pitch += (tg.pitch - st.pitch) * m; st.roll += (tg.roll - st.roll) * m;
      st.gx += (tg.gx - st.gx) * m; st.gy += (tg.gy - st.gy) * m;
      sqV += (-(sq - 1) * 220 - sqV * 14) * dt; sq += sqV * dt;
      // pop-in on a clock (ease-out-back), so it lands on time even when frames are sparse
      const pop = reduced ? 1 : Math.min(1, Math.max(0, (t - startAt - 0.5) / 0.55)) - 1;
      const b = reduced ? 1 : 1 + 2.70158 * pop * pop * pop + 1.70158 * pop * pop;
      const float = reduced ? 0 : asleep ? Math.sin(t * 0.9) * 2 + 5 : Math.sin(t * 1.4) * 4;
      const rm = reactMotion(t);
      if (react && t >= react.until) react = null;
      // hover: a small lift and swell
      hov += ((hovering && cur === 'idle' && !reduced ? 1 : 0) - hov) * ease(10);
      // follow: the whole body drifts toward the cursor. The eyes lead, the head turns, then the body catches up on a soft spring.
      // It stays with you while the cursor is on the page, and drifts home slowly when you leave, after 8s of stillness,
      // while asleep, and whenever the form needs it (password, signing in, results). Mouse-only: touch has no cursor to follow.
      const follows = canFollow && (cur === 'idle' || cur === 'happy' || cur === 'watching') && t - lastMove < 8;
      const reach = Math.max(0, Math.min(22, (window.innerWidth - LOGIN_COLUMN_MAX_PX - LOGIN_SECTION_PAD_X_PX) / 2));
      const bx = follows ? look.x * reach : 0, by = follows ? look.y * 6 : 0;
      // critically damped-ish springs: glides over and settles without bouncing
      const [k, c] = follows ? [12, 7] : [6, 5];
      body.vx += ((bx - body.x) * k - body.vx * c) * dt; body.vy += ((by - body.y) * k - body.vy * c) * dt;
      const pbx = body.x, pby = body.y;
      body.x += body.vx * dt; body.y += body.vy * dt;
      bodyMoved.x = body.x - pbx; bodyMoved.y = body.y - pby;
      bodyEl.style.transform = `translate(${body.x.toFixed(2)}px, ${body.y.toFixed(2)}px)`;
      // lean into the motion, like it's heading somewhere on purpose; it straightens up as it arrives
      const lean = Math.max(-4, Math.min(4, body.vx * 0.08));
      const stretch = 0;
      headEl.style.transform =
        `perspective(520px) translateY(${(4 - float - rm.lift - hov * 3).toFixed(2)}px) ` +
        `rotateZ(${(st.roll + rm.spin + lean).toFixed(2)}deg) scale(${(b * (1 + hov * 0.03 + stretch) * (1 - (sq - 1) * 0.5)).toFixed(3)}, ${(b * (1 + hov * 0.03 - stretch * 0.6) * sq).toFixed(3)})`;
      // the ground shadow stays on the ground: it cancels the body's vertical drift and shrinks as Captain rises
      const height = float + rm.lift - body.y;
      shadowEl.style.transform = `translateY(${(-body.y).toFixed(2)}px) scaleX(${(b * (1 - height * 0.03)).toFixed(3)})`;
      shadowEl.style.opacity = Math.max(0, b * (0.9 - height * 0.04)).toFixed(3);
      // Captain is a ball: turning doesn't squash its outline or move its highlight (the light is fixed). Instead the visor
      // drifts a little across the surface toward where it looks, narrowing slightly as if curving away. The travel is
      // capped so the visor always stays whole on the face, never sliced by the edge.
      const nx = Math.max(-1, Math.min(1, st.yaw / 24)), ny = Math.max(-1, Math.min(1, st.pitch / 12));
      visorEl.setAttribute('transform',
        `translate(${(60 + nx * 8).toFixed(2)} ${(54 + ny * 5).toFixed(2)}) ` +
        `scale(${(1 - Math.abs(nx) * 0.1).toFixed(3)} ${(1 - Math.abs(ny) * 0.06).toFixed(3)}) translate(-60 -54)`);
      // parallax: the eyes sit a little deeper than the glass, so they shift a touch further
      faceEl.setAttribute('transform', `translate(${(nx * 2.5).toFixed(2)} ${(ny * 1.5).toFixed(2)})`);
      if (!reduced && t > nextBlink) { blinkUntil = t + 0.13; nextBlink = t + 2.4 + Math.random() * 3.4; }
      paintEyes(t, dt, { x: st.gx, y: st.gy });

      // aura state
      dim += ((asleep ? 0.35 : cur === 'privacy' ? 0.6 : 1) - dim) * ease(3);
      tint += ((cur === 'error' ? 1 : loading ? 0.85 : 0) - tint) * ease(6);
      if (cur === 'error') tintBad = true; else if (loading) tintBad = false;
      const pal = PALETTE[props.current.theme], spr = SPRITES[props.current.theme];
      const tintSpr = tintBad ? spr.bad : spr.think, tintRgb = tintBad ? pal.bad : pal.think;
      const speed = reduced ? 0 : loading ? 3 : asleep ? 0.3 : cur === 'privacy' ? 0.6 : 1;
      const rMul = loading ? 0.82 : cur === 'privacy' ? 0.9 : asleep ? 0.92 : 1;
      flow += dt * speed;
      // the whole cloud turns slowly so motes pass behind and in front of Dot
      const turn = flow * 0.08, ca = Math.cos(turn), sa = Math.sin(turn);
      const fy = float / U, sink = asleep ? -0.4 : 0;
      // aura fades in after Dot pops in
      const intro = reduced ? 1 : Math.min(1, Math.max(0, (t - startAt - 0.6) / 1.4));
      const jitter = cur === 'error' && since < 0.6 ? 7 : 0, bb = burst;
      burst = 0;
      const damp = Math.exp(-dt * 5);
      const mx = (mouse.x - CX) / U, my = -(mouse.y - CY) / U;

      bctx.clearRect(0, 0, FW, FH);
      fctx.clearRect(0, 0, FW, FH);
      bctx.globalCompositeOperation = fctx.globalCompositeOperation = pal.blend;
      bctx.lineCap = fctx.lineCap = 'round';

      // voice level: kicks as letters pass across the visor, with a light flutter in between
      speaking = msg !== null;
      const flutter = speaking ? 0.25 + 0.35 * Math.abs(Math.sin(t * 17) * Math.sin(t * 7.3)) : 0;
      ampKick *= Math.exp(-dt * 7);
      amp += (Math.min(1, Math.max(flutter, ampKick)) - amp) * ease(18);
      // motes step back while Captain talks so the voice ring and words lead
      talkDim += ((speaking ? 1 : 0) - talkDim) * ease(5);
      // particles: always on, or only while something is happening (fade in fast, out slowly)
      const acting = cur === 'loading' || cur === 'success' || cur === 'error' || t < actionUntil;
      pvis += ((props.current.particles && (props.current.ambient || acting) ? 1 : 0) - pvis) * ease(acting ? 8 : 2.5);
      // voice visualiser: a ring of bars around Captain that moves with the voice
      if (amp > 0.02 && !reduced) {
        bctx.save();
        bctx.translate(CX, CY + 2);
        bctx.strokeStyle = `rgb(${pal.glow})`;
        bctx.lineWidth = 2;
        bctx.shadowColor = `rgba(${pal.glow},.9)`;
        bctx.shadowBlur = 6;
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          const wob = 0.5 + 0.5 * Math.sin(k * 1.7 + t * 12) * Math.sin(k * 0.6 - t * 7);
          const len = 2 + amp * (4 + 12 * wob);
          bctx.globalAlpha = 0.65 * amp;
          bctx.beginPath();
          bctx.moveTo(Math.cos(a) * 80, Math.sin(a) * 80);
          bctx.lineTo(Math.cos(a) * (80 + len), Math.sin(a) * (80 + len));
          bctx.stroke();
        }
        bctx.restore();
      }

      // particles and floating glyphs live in the world, not on the body: when Captain moves they're left behind
      // for a moment and their springs pull them back, so the aura trails it like a cloud
      if (bodyMoved.x || bodyMoved.y) {
        const mxu = bodyMoved.x / U, myu = bodyMoved.y / U;
        for (let i = 0; i < NA; i++) { X[i * 3] -= mxu; X[i * 3 + 1] += myu; }
        for (const g of glyphs) if (g.kind !== 'orbit' && g.kind !== 'dot') { g.x -= bodyMoved.x; g.y -= bodyMoved.y; }
      }
      for (let i = 0; i < NA; i++) {
        const i3 = i * 3;
        // home position turned with the cloud, plus a slow wander of its own
        const hx = HX[i] * ca - HZ[i] * sa, hz = HX[i] * sa + HZ[i] * ca;
        const tx = hx * rMul + Math.sin(flow * f1[i] + tw[i]) * 0.24;
        const ty = HY[i] * rMul + Math.cos(flow * f2[i] + tw[i] * 1.3) * 0.2 + fy + sink;
        const tz = hz * rMul + Math.sin(flow * f2[i] * 0.8 + tw[i] * 0.7) * 0.22;
        // gentle spring during the intro so the aura unfolds instead of snapping out
        const k = (reduced ? 300 : 24 * (0.25 + 0.75 * intro)) * pk[i];
        V[i3] += (tx - X[i3]) * k * dt; V[i3 + 1] += (ty - X[i3 + 1]) * k * dt; V[i3 + 2] += (tz - X[i3 + 2]) * k * dt;
        if (bb) {
          const inv = 1 / (Math.hypot(X[i3], X[i3 + 1], X[i3 + 2]) + 0.01);
          V[i3] += X[i3] * inv * bb * pk[i] * 3; V[i3 + 1] += X[i3 + 1] * inv * bb * pk[i] * 3;
        }
        if (jitter) { V[i3] += (Math.random() - 0.5) * jitter; V[i3 + 1] += (Math.random() - 0.5) * jitter; }
        const ddx = X[i3] - mx, ddy = X[i3 + 1] - my, d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.4 && d2 > 1e-4) {
          const d = Math.sqrt(d2), f = ((0.63 - d) * 30 * dt) / d;
          V[i3] += ddx * f; V[i3 + 1] += ddy * f;
        }
        V[i3] *= damp; V[i3 + 1] *= damp; V[i3 + 2] *= damp;
        X[i3] += V[i3] * dt; X[i3 + 1] += V[i3 + 1] * dt; X[i3 + 2] += V[i3 + 2] * dt;

        const z = X[i3 + 2], px = CX + X[i3] * U, py = CY - X[i3 + 1] * U;
        const tws = Math.sin(t * 2.2 + tw[i]);
        // depth: far side smaller and dimmer, near side brighter
        let al = (0.55 + 0.35 * tws) * dim * intro * pvis * (1 - 0.45 * talkDim) * (z < 0 ? 0.35 + 0.25 * (1 + z / 2.6) : 1) * (dust[i] ? 0.55 : 1);
        // keep Dot's face clear when particles pass in front of it
        if (z > 0 && Math.abs(X[i3]) < 1.25 && Math.abs(X[i3 + 1] - fy) < 1.0) al *= 0.12;
        const ctx = z < 0 ? bctx : fctx;
        const s = sz[i] * (1 + z * 0.16) * 2;
        const ppx = PX[i], ppy = PY[i];
        PX[i] = px; PY[i] = py;
        if (al < 0.01) continue;

        // short soft trail behind each particle
        if (!reduced && !Number.isNaN(ppx) && dt > 0) {
          let vx = (px - ppx) / dt, vy = (py - ppy) / dt;
          const sp = Math.hypot(vx, vy);
          if (sp > 6 && sp < 1500) {
            const len = Math.min(sp * 0.035, 7) / sp;
            vx *= len; vy *= len;
            ctx.globalAlpha = Math.min(1, al * 0.18);
            ctx.strokeStyle = `rgb(${tint > 0.5 ? tintRgb : pal.rgb[col[i]]})`;
            ctx.lineWidth = Math.max(0.6, s * 0.32);
            ctx.beginPath(); ctx.moveTo(px - vx, py - vy); ctx.lineTo(px, py); ctx.stroke();
          }
        }
        ctx.globalAlpha = Math.min(1, al * (1 - tint));
        ctx.drawImage(spr.base[col[i]], px - s, py - s, s * 2, s * 2);
        if (tint > 0.02) {
          ctx.globalAlpha = Math.min(1, al * tint);
          ctx.drawImage(tintSpr, px - s, py - s, s * 2, s * 2);
        }
        // a few particles glint into a four-point star
        if (star[i] && tws > 0.8) {
          const g = (tws - 0.8) / 0.2, arm = s * 3.2 * g;
          ctx.globalAlpha = Math.min(1, al * g * 0.9);
          ctx.strokeStyle = `rgb(${pal.star})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(px - arm, py); ctx.lineTo(px + arm, py);
          ctx.moveTo(px, py - arm); ctx.lineTo(px, py + arm);
          ctx.stroke();
        }
      }

      // sparks: keystrokes stream up from the form into Dot
      if (!reduced) {
        for (let n = Math.min(sparks, 8); n > 0; n--) {
          const sp = sparkPool.find(p => !p.on);
          if (!sp) break;
          sp.on = true; sp.s = 0; sp.dur = 0.55 + Math.random() * 0.35;
          sp.x0 = CX + (Math.random() - 0.5) * 220;
          sp.cx = CX + (sp.x0 - CX) * 0.2 + (Math.random() - 0.5) * 50;
        }
      }
      sparks = 0;
      for (const sp of sparkPool) {
        if (!sp.on) continue;
        sp.s += dt / sp.dur;
        if (sp.s >= 1) { sp.on = false; sqV += 0.05; continue; }
        const u = sp.s, iu = 1 - u, y0 = FH + 10, cy = CY + 90, ey = CY + 10 - float;
        const x = iu * iu * sp.x0 + 2 * iu * u * sp.cx + u * u * CX;
        const y = iu * iu * y0 + 2 * iu * u * cy + u * u * ey;
        fctx.globalAlpha = Math.sin(Math.PI * u) * 0.95;
        fctx.drawImage(spr.base[2], x - 7, y - 7, 14, 14);
      }

      drawGlyphs(t, dt, 4 - float);

      raf = requestAnimationFrame(frame);
    };

    const start = () => { cancelAnimationFrame(raf); last = now(); raf = requestAnimationFrame(frame); };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(greet);
      clearInterval(sleepCheck);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseout', onOut);
      window.removeEventListener('keydown', onKey);
      ['keydown', 'focusin', 'click'].forEach(ev => window.removeEventListener(ev, activity));
      dot.removeEventListener('click', onBoop);
      dot.removeEventListener('mouseenter', onEnter);
      dot.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      api.current = null;
    };
  }, []);

  useEffect(() => { api.current?.setMode(mode); }, [mode]);
  useEffect(() => { api.current?.greet(name); }, [name]);
  useEffect(() => {
    const added = keystrokes - lastKeys.current;
    lastKeys.current = keystrokes;
    if (added > 0) api.current?.sparks(Math.min(added * 2, 6));
  }, [keystrokes]);

  const P = 3.6;
  return (
    <div className="dot-companion relative h-[210px] w-full" style={{ color: companionColor(companionPreferences.color) }}>
      <style>{`
        .dot-companion .sheen { animation: dot-sheen 7s ease-in-out infinite; }
        @keyframes dot-sheen { 0%,70% { transform: translateX(-90px) } 100% { transform: translateX(110px) } }
        @media (prefers-reduced-motion: reduce) { .dot-companion .sheen { animation: none; } }
      `}</style>
      {/* the whole body (glow, aura, helmet) moves as one so Captain can follow the cursor */}
      {/* no will-change here or on the head: a promoted layer is rasterized once and then stretched/resampled, which blurs the vector eyes */}
      <div ref={bodyRef} className="absolute inset-0">
      {/* soft tinted glow so the white helmet reads on the page: warm by day, a faint white halo at night */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          top: DOT_TOP + DOT_H * 0.5,
          background: theme === 'light'
            ? 'radial-gradient(closest-side, rgba(168,72,31,.22), rgba(168,72,31,.12) 45%, rgba(94,127,106,.07) 70%, rgba(94,127,106,0))'
            : 'radial-gradient(closest-side, rgba(255,255,255,.12), rgba(255,255,255,.06) 45%, rgba(255,255,255,.02) 70%, rgba(255,255,255,0))',
        }}
      />
      <canvas
        ref={backRef}
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ top: FX_TOP, width: FW, height: FH }}
      />
      <div
        ref={dotRef}
        role="img"
        aria-label="Captain, your Agent Lab companion"
        className="absolute left-1/2 z-[1] cursor-pointer"
        style={{
          top: DOT_TOP, width: DOT_W, height: DOT_H, marginLeft: -DOT_W / 2,
          // lift the white helmet off the page with a grounded shadow
          filter: theme === 'light'
            ? 'drop-shadow(0 12px 20px rgba(26,35,28,.24)) drop-shadow(0 2px 3px rgba(26,35,28,.12))'
            : 'drop-shadow(0 12px 22px rgba(0,0,0,.55))',
        }}
      >
        <span
          ref={shadowRef}
          // centred with a margin, not translate: the animation loop owns `transform` (scaleX)
          className="absolute bottom-0 left-1/2 ml-[-42px] h-[10px] w-[84px] rounded-full"
          style={{
            background: theme === 'light'
              ? 'radial-gradient(closest-side, rgba(26,35,28,.28), rgba(26,35,28,0))'
              : 'radial-gradient(closest-side, rgba(0,0,0,.55), rgba(0,0,0,0))',
            transformOrigin: 'center',
          }}
        />
        <div ref={headRef} className="absolute inset-0" style={{ transform: 'scale(0)', transformOrigin: '50% 60%' }}>
          <svg viewBox="0 0 120 110" width="100%" height="100%" className="block overflow-visible" aria-hidden>
            <defs>
              {/* day follows Sage Studio (ivory shell, green-black visor); night is monochrome: a white-to-graphite sphere with a pure black visor */}
              {theme === 'light' ? (
                <linearGradient id="dot-shell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#E7ECE1" />
                </linearGradient>
              ) : (
                <radialGradient id="dot-shell" cx=".38" cy=".3" r=".8">
                  <stop offset="0" stopColor="#FFFFFF" />
                  <stop offset=".55" stopColor="#E2E2E2" />
                  <stop offset="1" stopColor="#8A8A8A" />
                </radialGradient>
              )}
              <linearGradient id="dot-glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={theme === 'light' ? '#26322B' : '#1C1C1C'} />
                <stop offset="1" stopColor={theme === 'light' ? '#111813' : '#050505'} />
              </linearGradient>
              <clipPath id="dot-visor">
                <rect x="22" y="31" width="76" height="46" rx="21" />
              </clipPath>
              <clipPath id="dot-ball">
                <circle cx="60" cy="56" r="47.5" />
              </clipPath>
              {/* "goo": blur the lit LEDs together, then sharpen the alpha so they read as solid, smooth-edged eyes */}
              <filter id="dot-goo" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.1" result="b" />
                <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -8" />
              </filter>
            </defs>
            {/* shell */}
            <rect
              x="12" y="8" width="96" height="96" rx="48" fill="url(#dot-shell)"
              // hairline edge so the white helmet doesn't melt into a white page
              stroke={theme === 'light' ? 'rgba(26,35,28,.18)' : 'rgba(255,255,255,.4)'} strokeWidth={1}
            />
            <ellipse cx="46" cy="17" rx="13" ry="3" fill="#fff" opacity=".9" />
            {/* visor: slides across the ball as Captain turns (see `frame`), clipped to the ball so it wraps around the edge */}
            <g clipPath="url(#dot-ball)">
            <g ref={visorRef}>
            <rect x="22" y="31" width="76" height="46" rx="21" fill="url(#dot-glass)" />
            {theme === 'dark' && (
              <rect x="22" y="31" width="76" height="46" rx="21" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={1.4} />
            )}
            <g clipPath="url(#dot-visor)">
              <polygon className="sheen" points="44,25 58,25 40,85 26,85" fill="#fff" opacity=".08" />
              <g ref={faceRef}>
                <g ref={ledGroupRef}>
                  {/* solid eyes; each carries a mask with two lids (bottom ellipse, slanted top) driven by paintEyes */}
                  {[0, 1].map(si => (
                    <g key={si}>
                      <mask id={`dot-eye-m${si}`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="110">
                        <rect x="0" y="0" width="120" height="110" fill="#fff" />
                        <ellipse ref={el => { eyeRefs.current[si * 3 + 1] = el; }} cx="0" cy="200" rx="1" ry="1" fill="#000" />
                        <rect ref={el => { eyeRefs.current[si * 3 + 2] = el; }} x="0" y="-100" width="40" height="30" fill="#000" />
                      </mask>
                      <rect ref={el => { eyeRefs.current[si * 3] = el; }} mask={`url(#dot-eye-m${si})`} x={EYE_POS[si] - 6} y="46" width="12" height="16" rx="6" fill="#fff" fillOpacity={0} />
                    </g>
                  ))}
                  <g filter="url(#dot-goo)">
                  {[45, 75].map((ex, si) =>
                    Array.from({ length: 49 }, (_, k) => (
                      <circle
                        key={`${si}-${k}`}
                        ref={el => { ledRefs.current[si * 49 + k] = el; }}
                        cx={ex - 3 * P + (k % 7) * P}
                        cy={54 - 3 * P + Math.floor(k / 7) * P}
                        r={2.05}
                        fill="#fff"
                        fillOpacity={0}
                      />
                    )),
                  )}
                  </g>
                </g>
              </g>
            </g>
            </g>
            </g>
          </svg>
        </div>
      </div>
      <canvas
        ref={frontRef}
        aria-hidden
        className="pointer-events-none absolute left-1/2 z-[2] -translate-x-1/2"
        style={{ top: FX_TOP, width: FW, height: FH }}
      />
      </div>
      {/* Captain speaks on its visor; screen readers get the full sentence */}
      <span className="sr-only" aria-live="polite">{spoken}</span>
    </div>
  );
}
