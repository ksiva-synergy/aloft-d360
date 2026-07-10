/**
 * Pure-TS Lloyd's k-means over L2-normalized embeddings.
 * On unit vectors, Euclidean distance is monotone with cosine distance,
 * so this is effectively cosine k-means with no native dependencies.
 */

export interface ClusterAssignment {
  signatureIndex: number;
  clusterId: number;
}

export interface ClusterResult {
  k: number;
  assignments: ClusterAssignment[];
  centroids: number[][];
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function l2Norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function normalize(v: number[]): number[] {
  const n = l2Norm(v);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

function centroid(vecs: number[][]): number[] {
  const dims = vecs[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vecs) for (let i = 0; i < dims; i++) sum[i] += v[i];
  return normalize(sum.map((x) => x / vecs.length));
}

function euclideanSq(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

function nearestCentroid(v: number[], cents: number[][]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k < cents.length; k++) {
    const d = euclideanSq(v, cents[k]);
    if (d < bestDist) { bestDist = d; best = k; }
  }
  return best;
}

// ── k-means++ initialization (deterministic LCG seed) ────────────────────────

function lcgRand(state: { v: number }): number {
  state.v = ((state.v * 1664525 + 1013904223) | 0) >>> 0;
  return state.v / 4294967296;
}

function initCentroids(vecs: number[][], k: number, seed: number): number[][] {
  const rng = { v: seed >>> 0 };
  const cents: number[][] = [];

  cents.push(vecs[Math.floor(lcgRand(rng) * vecs.length)]);

  for (let c = 1; c < k; c++) {
    const dists = vecs.map((v) => {
      let minD = Infinity;
      for (const cent of cents) {
        const d = euclideanSq(v, cent);
        if (d < minD) minD = d;
      }
      return minD;
    });
    const total = dists.reduce((s, d) => s + d, 0);
    let threshold = lcgRand(rng) * total;
    let pick = vecs.length - 1;
    for (let i = 0; i < dists.length; i++) {
      threshold -= dists[i];
      if (threshold <= 0) { pick = i; break; }
    }
    cents.push(vecs[pick]);
  }
  return cents;
}

// ── k selection formula ───────────────────────────────────────────────────────

/** k = clamp(round(sqrt(N/2)), 3, 10) */
export function selectK(n: number): number {
  return Math.max(3, Math.min(10, Math.round(Math.sqrt(n / 2))));
}

// ── Lloyd's k-means ───────────────────────────────────────────────────────────

/**
 * Cluster `vectors` into `k` groups.
 * Vectors need not be pre-normalized — this function normalizes internally.
 * Returns compact cluster IDs (0..k-1 with no gaps after tiny-cluster merge).
 */
export function kmeans(
  vectors: number[][],
  k: number,
  maxIter = 100,
  seed = 42,
): ClusterResult {
  if (vectors.length < 3) {
    return { k: 0, assignments: [], centroids: [] };
  }
  const effectiveK = Math.min(k, vectors.length);

  const normed = vectors.map(normalize);
  let cents = initCentroids(normed, effectiveK, seed);
  let labels = normed.map((v) => nearestCentroid(v, cents));

  for (let iter = 0; iter < maxIter; iter++) {
    const newCents = Array.from({ length: effectiveK }, (_, ci) => {
      const members = normed.filter((_, i) => labels[i] === ci);
      return members.length > 0 ? centroid(members) : cents[ci];
    });
    const newLabels = normed.map((v) => nearestCentroid(v, newCents));
    const changed = newLabels.some((l, i) => l !== labels[i]);
    cents = newCents;
    labels = newLabels;
    if (!changed) break;
  }

  // Merge tiny clusters (size < 2) into nearest valid centroid
  const MIN_SIZE = 2;
  const sizes = Array<number>(effectiveK).fill(0);
  for (const l of labels) sizes[l]++;

  const tinySet = new Set(sizes.map((s, i) => (s < MIN_SIZE ? i : -1)).filter((i) => i >= 0));

  if (tinySet.size > 0 && tinySet.size < effectiveK) {
    labels = labels.map((ci, vi) => {
      if (!tinySet.has(ci)) return ci;
      let best = ci;
      let bestDist = Infinity;
      for (let j = 0; j < effectiveK; j++) {
        if (tinySet.has(j)) continue;
        const d = euclideanSq(normed[vi], cents[j]);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      return best;
    });
  }

  // Compact: remap cluster IDs to 0..m-1 (removes empty cluster slots)
  const usedIds = [...new Set(labels)].sort((a, b) => a - b);
  const remap = new Map(usedIds.map((id, idx) => [id, idx]));
  const finalLabels = labels.map((l) => remap.get(l)!);
  const finalCentroids = usedIds.map((ci) => cents[ci]);

  // Assign every vector — no outlier exclusion so coverage stays at 100%
  const assignments: ClusterAssignment[] = finalLabels.map((clusterId, signatureIndex) => ({
    signatureIndex,
    clusterId,
  }));

  return {
    k: finalCentroids.length,
    assignments,
    centroids: finalCentroids,
  };
}
