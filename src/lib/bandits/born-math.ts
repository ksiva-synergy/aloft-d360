/**
 * BORN math module — pure sampling and probability utilities.
 * Ported verbatim from BORN Dashboard.dc.html (lines ~457-522).
 * No imports beyond Math. No side effects.
 */

import type { CtsgvModelStat } from '@/components/agent-lab/bandits/types';

// ── Lanczos log-gamma ────────────────────────────────────────────────────────

export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ── Marsaglia–Tsang gamma sampler ────────────────────────────────────────────

export function gammaSample(shape: number): number {
  if (shape < 1) {
    return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Beta sampler (gamma ratio) ───────────────────────────────────────────────

export function betaSample(a: number, b: number): number {
  const x = gammaSample(a);
  const y = gammaSample(b);
  return x / (x + y);
}

// ── Beta PDF ─────────────────────────────────────────────────────────────────

export function betaPDF(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return (
    Math.exp(
      (a - 1) * Math.log(x) +
        (b - 1) * Math.log(1 - x) -
        (lgamma(a) + lgamma(b) - lgamma(a + b)),
    )
  );
}

// ── Posterior helpers ────────────────────────────────────────────────────────

export interface BornArm {
  alpha: number;
  beta: number;
}

/**
 * Binary posterior: successes/failures from CtsgvModelStat.
 * alpha = successes + 1, beta = failures + 1
 */
export function posteriorBinary(stat: CtsgvModelStat): BornArm {
  const successes = Math.round(stat.success_rate * stat.total_pulls);
  const failures  = stat.total_pulls - successes;
  return { alpha: successes + 1, beta: failures + 1 };
}

/**
 * Composite posterior: avg_composite encodes mean of Beta.
 * alpha = avg_composite * total_pulls + 1
 * beta  = (1 - avg_composite) * total_pulls + 1
 */
export function posteriorComposite(stat: CtsgvModelStat): BornArm {
  const composite = stat.avg_composite ?? 0;
  return {
    alpha: composite * stat.total_pulls + 1,
    beta:  (1 - composite) * stat.total_pulls + 1,
  };
}

/**
 * 95% confidence interval via normal approximation on Beta mean.
 */
export function ci95(alpha: number, beta: number): [number, number] {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) * (alpha + beta) * (alpha + beta + 1));
  const sd = Math.sqrt(variance);
  return [Math.max(0, mean - 1.96 * sd), Math.min(1, mean + 1.96 * sd)];
}

// ── Thompson Sampling — BORN probability estimates ───────────────────────────

export interface BornResult {
  probs: number[];
  entropy: number;
}

/**
 * Estimate selection probability for each arm via Monte-Carlo Thompson Sampling.
 * M = number of simulation draws (default 8000).
 * entropy = -Σ p·ln(p) / ln(N)  (normalised to [0,1])
 */
export function computeBornProbs(arms: BornArm[], M = 8000): BornResult {
  const N = arms.length;
  if (N === 0) return { probs: [], entropy: 0 };

  const wins = new Array<number>(N).fill(0);

  for (let m = 0; m < M; m++) {
    let best = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < N; i++) {
      const s = betaSample(arms[i].alpha, arms[i].beta);
      if (s > bestVal) { bestVal = s; best = i; }
    }
    wins[best]++;
  }

  const probs = wins.map(w => w / M);

  let entropy = 0;
  const lnN = Math.log(N);
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log(p);
  }
  entropy = lnN > 0 ? entropy / lnN : 0;

  return { probs, entropy };
}
