'use client';

import { useEffect, useRef, useState } from 'react';

export type DotBotMode = 'idle' | 'happy' | 'watching' | 'privacy' | 'peek' | 'loading' | 'error';

const GAP = 26;

/** Calm dot grid with a slow diagonal current and a soft glow under the cursor. */
export function DotField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

      for (let x = GAP / 2; x < w; x += GAP) {
        for (let y = GAP / 2; y < h; y += GAP) {
          // fade toward the edges so the centre column stays the focus
          const vignette = 1 - Math.hypot(x - cx, y - cy) / maxR;
          // current: a soft band that sweeps diagonally across the grid
          const wave = Math.pow(Math.max(0, Math.sin((x + y) * 0.006 - t * 0.9)), 12);
          const near = Math.max(0, 1 - Math.hypot(x - mouse.x, y - mouse.y) / 140);
          const a = 0.06 + vignette * 0.08 + wave * 0.45 * vignette + near * 0.5;
          ctx.fillStyle = wave + near > 0.15 ? `rgba(126,232,255,${a})` : `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.arc(x, y, 1 + wave * 0.7 + near * 0.9, 0, Math.PI * 2);
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

// ── DotBot: LED dot-matrix eyes ─────────────────────────────────────────────
// Each eye is a 7×7 grid of dots; an expression is the set of lit cells ("col,row" → brightness).

type Pattern = Map<string, number>;

const N = 7;
const PITCH = 3.6;

const cells = (list: [number, number][], level = 1): Pattern =>
  new Map(list.map(([c, r]) => [`${c},${r}`, level]));

const openEye = (ox: number, oy: number): Pattern => {
  const list: [number, number][] = [[3, 1], [3, 5]];
  for (let c = 2; c <= 4; c++) for (let r = 2; r <= 4; r++) list.push([c, r]);
  return cells(list.map(([c, r]) => [c + ox, r + oy]));
};
const BLINK = cells([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]]);
const SHUT = cells([[1, 3], [2, 4], [3, 4], [4, 4], [5, 3]]);
const HAPPY = cells([[1, 4], [2, 3], [3, 2], [4, 3], [5, 4]]);
const GT = cells([[2, 1], [3, 2], [4, 3], [3, 4], [2, 5]]);
const LT = cells([[4, 1], [3, 2], [2, 3], [3, 4], [4, 5]]);
const RING: [number, number][] = [
  [3, 1], [4, 1], [5, 2], [5, 3], [5, 4], [4, 5], [3, 5], [2, 5], [1, 4], [1, 3], [1, 2], [2, 1],
];
const spinner = (tick: number): Pattern => {
  const p: Pattern = new Map();
  [1, 0.55, 0.25].forEach((level, i) => {
    const [c, r] = RING[(tick - i + RING.length * 4) % RING.length];
    p.set(`${c},${r}`, level);
  });
  return p;
};

function eyePattern(mode: DotBotMode, side: 'l' | 'r', look: { x: number; y: number }, blink: boolean, tick: number) {
  switch (mode) {
    case 'loading': return spinner(side === 'l' ? tick : tick + 6);
    case 'error': return side === 'l' ? GT : LT;
    case 'happy': return HAPPY;
    case 'privacy': return SHUT;
    case 'peek': return side === 'l' ? SHUT : openEye(0, 1);
    case 'watching': return blink ? BLINK : openEye(0, 1);
    default: return blink ? BLINK : openEye(look.x, look.y);
  }
}

function Eye({ x, y, pattern, color }: { x: number; y: number; pattern: Pattern; color: string }) {
  const dots = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const lit = pattern.get(`${c},${r}`) ?? 0;
      dots.push(
        <circle
          key={`${c},${r}`}
          cx={x + c * PITCH}
          cy={y + r * PITCH}
          r={1.3}
          fill={lit ? color : '#ffffff'}
          fillOpacity={lit ? lit : 0.07}
          style={{ transition: 'fill-opacity .12s, fill .2s' }}
        />,
      );
    }
  }
  return <g style={{ filter: `drop-shadow(0 0 2px ${color})` }}>{dots}</g>;
}

/**
 * DotBot, the login mascot: a little white helmet with a glass visor and LED dot-matrix eyes.
 * idle → eyes follow the cursor and blink · happy → ^ ^ (hovering sign-in)
 * watching → looks down at the form · privacy → eyes shut while a password is typed
 * peek → one eye opens when the password is shown · loading → eyes become spinners · error → > < and a shake
 */
export function DotBot({ mode, size = 104 }: { mode: DotBotMode; size?: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [tick, setTick] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  // eyes follow the cursor, snapped to the LED grid
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: MouseEvent) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const x = dx > 70 ? 1 : dx < -70 ? -1 : 0;
      const y = dy > 50 ? 1 : dy < -50 ? -1 : 0;
      setLook(prev => (prev.x === x && prev.y === y ? prev : { x, y }));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [reduced]);

  // blink at a natural, slightly random rhythm
  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 130);
      }, 2600 + Math.random() * 3200);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [reduced]);

  useEffect(() => {
    if (mode !== 'loading' || reduced) return;
    const id = setInterval(() => setTick(t => t + 1), 75);
    return () => clearInterval(id);
  }, [mode, reduced]);

  const color = mode === 'error' ? '#ff7d93' : '#7ee8ff';
  const eyeY = 54 - ((N - 1) * PITCH) / 2;

  return (
    <div ref={rootRef} className="dotbot" data-mode={mode} style={{ width: size, height: size * (110 / 120) }} aria-hidden>
      <style>{`
        .dotbot svg { overflow: visible; display: block; }
        .dotbot .head { transform-box: fill-box; transform-origin: 50% 100%; animation: dotbot-float 4.5s ease-in-out infinite; }
        .dotbot[data-mode='happy'] .head { animation: dotbot-hop .5s cubic-bezier(.3,1.6,.6,1); }
        .dotbot[data-mode='error'] .head { animation: dotbot-shake .4s ease-in-out 2; }
        .dotbot .shadow { transform-box: fill-box; transform-origin: center; animation: dotbot-shadow 4.5s ease-in-out infinite; }
        .dotbot .sheen { animation: dotbot-sheen 7s ease-in-out infinite; }
        @keyframes dotbot-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
        @keyframes dotbot-shadow { 0%,100% { transform: scaleX(1); opacity: .35 } 50% { transform: scaleX(.85); opacity: .2 } }
        @keyframes dotbot-hop { 0% { transform: translateY(0) } 40% { transform: translateY(-8px) scale(1.03) } 100% { transform: translateY(0) } }
        @keyframes dotbot-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) rotate(-3deg) } 75% { transform: translateX(5px) rotate(3deg) } }
        @keyframes dotbot-sheen { 0%,70% { transform: translateX(-90px) } 100% { transform: translateX(110px) } }
        @media (prefers-reduced-motion: reduce) {
          .dotbot * { animation: none !important; }
        }
      `}</style>
      <svg viewBox="0 0 120 110" width="100%" height="100%">
        <defs>
          <linearGradient id="dotbot-shell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#dfe5f5" />
          </linearGradient>
          <linearGradient id="dotbot-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1b2142" />
            <stop offset="1" stopColor="#0a0d1c" />
          </linearGradient>
          <clipPath id="dotbot-visor">
            <rect x="22" y="31" width="76" height="46" rx="21" />
          </clipPath>
        </defs>

        <ellipse className="shadow" cx="60" cy="106" rx="30" ry="3.5" fill="#000" />

        <g className="head">
          {/* ear pods */}
          <rect x="5" y="44" width="9" height="22" rx="4.5" fill="#cfd7ee" />
          <rect x="106" y="44" width="9" height="22" rx="4.5" fill="#cfd7ee" />
          {/* shell */}
          <rect x="10" y="14" width="100" height="84" rx="38" fill="url(#dotbot-shell)" />
          <ellipse cx="42" cy="22" rx="16" ry="3.5" fill="#fff" opacity=".9" />
          {/* visor */}
          <rect x="22" y="31" width="76" height="46" rx="21" fill="url(#dotbot-glass)" />
          <g clipPath="url(#dotbot-visor)">
            <polygon className="sheen" points="44,25 58,25 40,85 26,85" fill="#fff" opacity=".08" />
          </g>
          <Eye x={45 - ((N - 1) * PITCH) / 2} y={eyeY} pattern={eyePattern(mode, 'l', look, blink, tick)} color={color} />
          <Eye x={75 - ((N - 1) * PITCH) / 2} y={eyeY} pattern={eyePattern(mode, 'r', look, blink, tick)} color={color} />
        </g>
      </svg>
    </div>
  );
}
