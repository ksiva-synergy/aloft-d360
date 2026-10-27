'use client';

import { useEffect, useRef, useState } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionColor } from '@/lib/companion/preferences';
import { FONT_SANS } from '@/lib/typography/tokens';

/** The page's own face, for anything Captain draws as text on the canvas. */
const CAPTAIN_FONT = FONT_SANS;

export type DotBotMode = 'idle' | 'happy' | 'watching' | 'privacy' | 'peek' | 'loading' | 'error' | 'success';
type Mode = DotBotMode | 'sleep';

const GAP = 26;

/** Calm dot grid with a slow diagonal current and a soft glow under the cursor. */
export function DotField({ theme = 'dark' }: { theme?: LoginTheme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mouse = { x: -9999, y: -9999 };
    let w = 0;
    let h = 0;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };

    const frame = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const t = time / 1000;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);
      // clear zone behind the centre column (companion, title, form)
      const zy = h * 0.52, zrx = Math.min(320, w * 0.42), zry = h * 0.44;
      const pal = PALETTE[themeRef.current];

      for (let x = GAP / 2; x < w; x += GAP) {
        for (let y = GAP / 2; y < h; y += GAP) {
          const vignette = 1 - Math.hypot(x - cx, y - cy) / maxR;
          const zd = ((x - cx) / zrx) ** 2 + ((y - zy) / zry) ** 2;
          const calm = 0.12 + 0.88 * Math.min(1, Math.max(0, (zd - 0.6) / 0.7));
          // current: a soft, slow band that sweeps diagonally across the grid
          const wave = Math.pow(Math.max(0, Math.sin((x + y) * 0.005 - t * 0.5)), 14);
          const near = Math.max(0, 1 - Math.hypot(x - mouse.x, y - mouse.y) / 120);
          const a = ((0.035 + vignette * 0.045 + wave * 0.22 * vignette) * calm + near * 0.28) * pal.dotAlpha;
          ctx.fillStyle = wave + near > 0.2 ? `rgba(${pal.dotLit},${a})` : `rgba(${pal.dot},${a})`;
          ctx.beginPath();
          ctx.arc(x, y, 0.85 + wave * 0.4 + near * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());

    resize();
    start();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) start();
    });
    ro.observe(host);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

// ── Dot's LED eyes ──────────────────────────────────────────────────────────
// Each eye is a 7×7 grid of dots; an expression is a list of lit cells [col, row, brightness].

type Cell = [number, number, number];

const lit = (list: [number, number][]): Cell[] => list.map(([c, r]) => [c, r, 1]);
const openEye = (ox: number, oy: number): Cell[] => {
  const list: [number, number][] = [[3, 1], [3, 5]];
  for (let c = 2; c <= 4; c++) for (let r = 2; r <= 4; r++) list.push([c, r]);
  return list.map(([c, r]) => [c + ox, r + oy, 1]);
};
const PAT = {
  blink: lit([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]]),
  shut: lit([[1, 3], [2, 4], [3, 4], [4, 4], [5, 3]]),
  happy: lit([[1, 4], [2, 3], [3, 2], [4, 3], [5, 4]]),
  gt: lit([[2, 1], [3, 2], [4, 3], [3, 4], [2, 5]]),
  lt: lit([[4, 1], [3, 2], [2, 3], [3, 4], [4, 5]]),
};
const RING: [number, number][] = [
  [3, 1], [4, 1], [5, 2], [5, 3], [5, 4], [4, 5], [3, 5], [2, 5], [1, 4], [1, 3], [1, 2], [2, 1],
];
const snap = (v: number) => (v > 0.35 ? 1 : v < -0.35 ? -1 : 0);

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

function eyePattern(mode: Mode, side: 'L' | 'R', t: number, blink: boolean, booped: boolean, gaze: { x: number; y: number }): Cell[] {
  if (booped && mode !== 'loading') return PAT.happy;
  switch (mode) {
    case 'loading': {
      const tick = Math.floor(t * 13) + (side === 'R' ? 6 : 0);
      return [1, 0.55, 0.25].map((v, i): Cell => {
        const [c, r] = RING[(((tick - i) % 12) + 12) % 12];
        return [c, r, v];
      });
    }
    case 'error': return side === 'L' ? PAT.gt : PAT.lt;
    case 'happy': case 'success': return PAT.happy;
    case 'privacy': case 'sleep': return PAT.shut;
    case 'peek': return side === 'L' ? PAT.shut : openEye(1, 1);
    case 'watching': return blink ? PAT.blink : openEye(snap(gaze.x), 1);
    default: return blink ? PAT.blink : openEye(snap(gaze.x), snap(gaze.y));
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
 * page, so it draws deeper teal/indigo normally and keeps glows subtle.
 */
const PALETTE = {
  dark: {
    rgb: ['126,232,255', '176,164,255', '225,248,255'], bad: '255,125,147', think: '170,150,255', core: '255,255,255',
    blend: 'lighter' as GlobalCompositeOperation, glow: '126,232,255', glyph: '#bfefff', drop: '#9fdcff', spark: '#e8fbff', star: '235,250,255',
    dot: '255,255,255', dotLit: '126,232,255', dotAlpha: 1,
  },
  light: {
    rgb: ['8,145,178', '79,70,229', '14,116,144'], bad: '225,29,72', think: '99,102,241', core: '',
    blend: 'source-over' as GlobalCompositeOperation, glow: '8,145,178', glyph: '#0e7490', drop: '#0284c7', spark: '#0891b2', star: '8,145,178',
    dot: '30,41,79', dotLit: '8,145,178', dotAlpha: 1.15,
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
  /** Page theme: the glow effects are drawn differently on a light page. */
  theme?: LoginTheme;
};

/**
 * Captain, the login companion: a flat white helmet with LED dot-matrix eyes, given depth by a gentle
 * tilt, eye parallax and a particle aura that orbits behind and in front of it.
 * idle → follows the cursor, blinks, dozes off after 15s alone · happy → ^ ^
 * watching → reads along as you type · privacy → eyes shut · peek → one eye opens
 * loading → spinner eyes, motes swirl in faster · error → > < and a head shake · success → nod and burst
 */
export function DotCompanion({ mode, name = '', keystrokes = 0, progress = 0, ambient = true, theme = 'dark' }: Props) {
  const companionPreferences = useCompanionPreferences();
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const ledGroupRef = useRef<SVGGElement>(null);
  const ledRefs = useRef<(SVGCircleElement | null)[]>([]);
  const [spoken, setSpoken] = useState('');

  const props = useRef({ mode, name, progress, ambient, theme });
  props.current = { mode, name, progress, ambient, theme };
  const api = useRef<{ setMode: (m: Mode) => void; sparks: (n: number) => void; greet: (name: string) => void } | null>(null);
  const lastKeys = useRef(keystrokes);

  useEffect(() => {
    const back = backRef.current, front = frontRef.current, dot = dotRef.current, headEl = headRef.current;
    const shadowEl = shadowRef.current, faceEl = faceRef.current, ledGroup = ledGroupRef.current;
    const bctx = back?.getContext('2d'), fctx = front?.getContext('2d');
    if (!back || !front || !dot || !headEl || !shadowEl || !faceEl || !ledGroup || !bctx || !fctx) return;

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

    // ── dozing off when left alone ──
    let sleeping = false, lastActivity = now();
    const activity = () => {
      lastActivity = now();
      if (sleeping) { sleeping = false; sqV += 3; setMode(props.current.mode); }
    };
    const sleepCheck = setInterval(() => {
      if (!sleeping && cur === 'idle' && now() - lastActivity > 15) { sleeping = true; setMode('sleep'); }
    }, 1000);

    // ── cursor ──
    const look = { x: 0, y: 0 }, mouse = { x: -1e4, y: -1e4 };
    let lastMove = -10;
    const onMove = (e: MouseEvent) => {
      const r = dot.getBoundingClientRect();
      look.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 380));
      look.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 300));
      const fr = front.getBoundingClientRect();
      mouse.x = e.clientX - fr.left;
      mouse.y = e.clientY - fr.top;
      lastMove = now();
      activity();
    };
    let boopUntil = 0;
    const onBoop = () => {
      if (cur === 'loading') return;
      burst += 1.3; sqV -= 3; boopUntil = now() + 0.9; actionUntil = now() + 2.5;
      // a single cyan sparkle pops from Captain's head; the eyes go ^ ^ (see eyePattern's `booped`)
      if (now() - lastSpark > 0.45) { lastSpark = now(); emit('spark', CX + 22, CY - 66, 0.8); }
    };
    window.addEventListener('mousemove', onMove);
    ['keydown', 'focusin', 'click'].forEach(ev => window.addEventListener(ev, activity));
    dot.addEventListener('click', onBoop);

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

    // ── LED eyes ──
    const level = [new Float32Array(49), new Float32Array(49)];
    const paintEyes = (t: number, dt: number, gaze: { x: number; y: number }) => {
      const color = '#fff';
      // eyes glow brighter while Captain speaks
      ledGroup.style.filter = `drop-shadow(0 0 ${(2 + amp * 4).toFixed(1)}px ${color})`;
      const k = 1 - Math.exp(-dt * 26);
      // a finished message leaves the visor (checked once, so both eyes switch back together)
      if (msg && ('icon' in msg ? t - msg.start > msg.dur : Math.floor((t - msg.start) * SCROLL) > msg.cols.length - 14)) msg = null;
      (['L', 'R'] as const).forEach((side, si) => {
        const want = new Float32Array(49);
        (msgCells(side, t) ?? eyePattern(cur, side, t, t < blinkUntil, t < boopUntil, gaze)).forEach(([c, r, v]) => {
          if (c >= 0 && c < 7 && r >= 0 && r < 7) want[r * 7 + c] = v;
        });
        const lv = level[si];
        for (let i = 0; i < 49; i++) {
          lv[i] += (want[i] - lv[i]) * k;
          const d = ledRefs.current[si * 49 + i];
          if (!d) continue;
          const on = lv[i] > 0.04;
          d.setAttribute('fill', on ? color : '#fff');
          d.setAttribute('fill-opacity', on ? Math.min(1, lv[i]).toFixed(3) : '0.07');
        }
      });
    };

    // ── animation loop ──
    const st = { yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0 };
    let sq = 1, dim = 1, tint = 0, tintBad = false, blinkUntil = 0, nextBlink = 3, flow = 0;
    let pvis = props.current.ambient ? 1 : 0, actionUntil = 0;
    // ── little glowing glyphs that float off Captain's head (one small touch per moment) ──
    // z: sleeping · dot: thinking while signing in · drop: sweat drop on an error · spark: success and a click
    type Glyph = { kind: 'z' | 'dot' | 'drop' | 'spark'; age: number; life: number; delay: number; x: number; y: number; seed: number };
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
      const o = { yaw: L.x * 12, pitch: L.y * 9, roll: Math.sin(t * 0.7) * 1.5 - L.x * 2, gx: L.x, gy: L.y };
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
      return o;
    };

    const frame = () => {
      const t = now(), dt = Math.min(t - last, 0.04), since = t - modeAt;
      last = t;
      const ease = (r: number) => 1 - Math.exp(-dt * r);
      const asleep = cur === 'sleep', loading = cur === 'loading';

      // Dot: tilt, parallax, float, squash, pop-in
      const tg = targets(t), m = reduced ? 1 : ease(cur === 'error' || cur === 'success' ? 30 : 7);
      st.yaw += (tg.yaw - st.yaw) * m; st.pitch += (tg.pitch - st.pitch) * m; st.roll += (tg.roll - st.roll) * m;
      st.gx += (tg.gx - st.gx) * m; st.gy += (tg.gy - st.gy) * m;
      sqV += (-(sq - 1) * 220 - sqV * 14) * dt; sq += sqV * dt;
      // pop-in on a clock (ease-out-back), so it lands on time even when frames are sparse
      const pop = reduced ? 1 : Math.min(1, Math.max(0, (t - startAt - 0.5) / 0.55)) - 1;
      const b = reduced ? 1 : 1 + 2.70158 * pop * pop * pop + 1.70158 * pop * pop;
      const float = reduced ? 0 : asleep ? Math.sin(t * 0.9) * 2 + 5 : Math.sin(t * 1.4) * 4;
      headEl.style.transform =
        `perspective(520px) translateY(${(4 - float).toFixed(2)}px) rotateY(${st.yaw.toFixed(2)}deg) rotateX(${(-st.pitch).toFixed(2)}deg) ` +
        `rotateZ(${st.roll.toFixed(2)}deg) scale(${(b * (1 - (sq - 1) * 0.5)).toFixed(3)}, ${(b * sq).toFixed(3)})`;
      shadowEl.style.transform = `scaleX(${(b * (1 - float * 0.03)).toFixed(3)})`;
      shadowEl.style.opacity = (b * (0.9 - float * 0.04)).toFixed(3);
      // parallax: the face shifts a little more than the helmet
      faceEl.setAttribute('transform', `translate(${((st.yaw / 22) * 4).toFixed(2)} ${((st.pitch / 12) * 2.5).toFixed(2)})`);
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
      pvis += ((props.current.ambient || acting ? 1 : 0) - pvis) * ease(acting ? 8 : 2.5);
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
      ['keydown', 'focusin', 'click'].forEach(ev => window.removeEventListener(ev, activity));
      dot.removeEventListener('click', onBoop);
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
    <div className="dot-companion relative h-[210px] w-[320px] max-w-full" style={{ color: companionColor(companionPreferences.color) }}>
      <style>{`
        .dot-companion .sheen { animation: dot-sheen 7s ease-in-out infinite; }
        @keyframes dot-sheen { 0%,70% { transform: translateX(-90px) } 100% { transform: translateX(110px) } }
        @media (prefers-reduced-motion: reduce) { .dot-companion .sheen { animation: none; } }
      `}</style>
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
          // on a light page the white helmet needs a soft shadow to stand off the background
          filter: theme === 'light' ? 'drop-shadow(0 8px 18px rgba(30,40,90,.16))' : undefined,
        }}
      >
        <span
          ref={shadowRef}
          className="absolute bottom-[-6px] left-1/2 h-[10px] w-[84px] -translate-x-1/2 rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,.55), rgba(0,0,0,0))', transformOrigin: 'center' }}
        />
        <div ref={headRef} className="absolute inset-0 will-change-transform" style={{ transform: 'scale(0)', transformOrigin: '50% 60%' }}>
          <svg viewBox="0 0 120 110" width="100%" height="100%" className="block overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="dot-shell" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#dfe5f5" />
              </linearGradient>
              <linearGradient id="dot-glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#1b2142" />
                <stop offset="1" stopColor="#0a0d1c" />
              </linearGradient>
              <clipPath id="dot-visor">
                <rect x="22" y="31" width="76" height="46" rx="21" />
              </clipPath>
            </defs>
            {/* ear pods */}
            <rect x="5" y="44" width="9" height="22" rx="4.5" fill="#cfd7ee" />
            <rect x="106" y="44" width="9" height="22" rx="4.5" fill="#cfd7ee" />
            {/* shell */}
            <rect x="10" y="14" width="100" height="84" rx="38" fill="url(#dot-shell)" />
            <ellipse cx="42" cy="22" rx="16" ry="3.5" fill="#fff" opacity=".9" />
            {/* visor */}
            <rect x="22" y="31" width="76" height="46" rx="21" fill="url(#dot-glass)" />
            <g clipPath="url(#dot-visor)">
              <polygon className="sheen" points="44,25 58,25 40,85 26,85" fill="#fff" opacity=".08" />
              <g ref={faceRef}>
                <g ref={ledGroupRef}>
                  {[45, 75].map((ex, si) =>
                    Array.from({ length: 49 }, (_, k) => (
                      <circle
                        key={`${si}-${k}`}
                        ref={el => { ledRefs.current[si * 49 + k] = el; }}
                        cx={ex - 3 * P + (k % 7) * P}
                        cy={54 - 3 * P + Math.floor(k / 7) * P}
                        r={1.3}
                        fill="#fff"
                        fillOpacity={0.07}
                      />
                    )),
                  )}
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
      {/* Captain speaks on its visor; screen readers get the full sentence */}
      <span className="sr-only" aria-live="polite">{spoken}</span>
    </div>
  );
}
