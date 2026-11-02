'use client';

import { useEffect, useRef } from 'react';

type Theme = 'dark' | 'light';

const INK: Record<Theme, { line: string; accent: string; lineA: number; accentA: number }> = {
  light: { line: '26,35,28', accent: '168,72,31', lineA: 0.11, accentA: 0.2 },
  dark: { line: '255,255,255', accent: '126,180,255', lineA: 0.06, accentA: 0.16 },
};

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/** Canvas plumbing: DPR sizing, ~30fps loop, pause when hidden, one static frame under reduced motion. */
function useCanvasLoop(draw: Draw) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const frame = (time: number) => {
      if (!reduced) raf = requestAnimationFrame(frame);
      if (!reduced && time - last < 33) return;
      last = time;
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h, reduced ? 0 : time / 1000);
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
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return canvasRef;
}

/** Fades whatever is drawn out of the centre column so the companion and form sit on a calm field. */
function clearCentre(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rx = Math.min(360, w * 0.45);
  const ry = h * 0.48;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.translate(w / 2, h * 0.52);
  ctx.scale(rx / ry, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  g.addColorStop(0, 'rgba(0,0,0,0.92)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-ry * 2, -ry * 2, ry * 4, ry * 4);
  ctx.restore();
}

const CELL = 16;
const LEVEL_STEP = 0.22;
const LEVELS = Array.from({ length: 21 }, (_, i) => -2.2 + i * LEVEL_STEP);
// marching-squares segments per case; edges: 0 top, 1 right, 2 bottom, 3 left
const SEGMENTS: number[][] = [
  [], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0],
  [3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], [],
];

/** Login background: slowly drifting sea-chart depth contours, every fifth one a terracotta "index" line. Ignores the cursor. */
export function LoginBackdrop({ theme }: { theme: Theme }) {
  const ref = useCanvasLoop((ctx, w, h, t) => {
    const ink = INK[theme];
    const cols = Math.ceil(w / CELL) + 1;
    const rows = Math.ceil(h / CELL) + 1;
    const v = new Float32Array(cols * rows);
    const hx = w * 0.72;
    const hy = h * 0.3;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * CELL;
        const y = j * CELL;
        v[j * cols + i] =
          Math.sin(x * 0.0036 + t * 0.05) * Math.cos(y * 0.0046 - t * 0.04) +
          0.6 * Math.sin((x + y) * 0.003 + 1.3 + t * 0.03) +
          0.45 * Math.cos(Math.sqrt((x - hx) ** 2 + (y - hy) ** 2) * 0.0058 - t * 0.06) +
          0.3 * Math.sin(x * 0.008 - y * 0.0065 + t * 0.045);
      }
    }

    ctx.lineJoin = 'round';
    LEVELS.forEach((L, li) => {
      const index = li % 5 === 0;
      ctx.beginPath();
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = v[j * cols + i];
          const b = v[j * cols + i + 1];
          const c = v[(j + 1) * cols + i + 1];
          const d = v[(j + 1) * cols + i];
          const seg = SEGMENTS[(a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0)];
          if (!seg.length) continue;
          const x0 = i * CELL;
          const y0 = j * CELL;
          const pt = (e: number): [number, number] =>
            e === 0 ? [x0 + (CELL * (L - a)) / (b - a), y0]
            : e === 1 ? [x0 + CELL, y0 + (CELL * (L - b)) / (c - b)]
            : e === 2 ? [x0 + (CELL * (L - d)) / (c - d), y0 + CELL]
            : [x0, y0 + (CELL * (L - a)) / (d - a)];
          for (let s = 0; s < seg.length; s += 2) {
            const p = pt(seg[s]);
            const q = pt(seg[s + 1]);
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
          }
        }
      }
      ctx.strokeStyle = index ? `rgba(${ink.accent},${ink.accentA})` : `rgba(${ink.line},${ink.lineA})`;
      ctx.lineWidth = index ? 1.1 : 0.8;
      ctx.stroke();
    });
    clearCentre(ctx, w, h);
  });
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
