/**
 * src/lib/memory/diversity.ts
 * Maximal Marginal Relevance (MMR) selection for FOER Phase 1b task recall.
 * MMR score: score(d) = λ·relevance(d) − (1−λ)·max_{s∈S} cosine(d, s)
 * λ=1 → pure relevance (== plain top-k); default λ=0.7. Pure functions, no I/O.
 */
export interface DiversityCandidate {
  id: string;
  embedding: number[];   // Titan v2, 1024-d; need not be pre-normalised
  relevance: number;     // cosine sim to task query (0..1), precomputed by pgvector
  tokens: number;        // injected token cost, for budget packing
}
export interface MmrOptions { lambda?: number; k?: number; budgetTokens?: number; }
export const MMR_DEFAULTS = { lambda: 0.7, k: 20, budgetTokens: 1200 } as const;

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function mmrSelect(candidates: DiversityCandidate[], opts: MmrOptions = {}): DiversityCandidate[] {
  const lambda = opts.lambda ?? MMR_DEFAULTS.lambda;
  const k = opts.k ?? MMR_DEFAULTS.k;
  const budget = opts.budgetTokens ?? MMR_DEFAULTS.budgetTokens;
  if (lambda < 0 || lambda > 1) throw new Error(`mmrSelect: lambda must be 0..1, got ${lambda}`);
  const pool = [...candidates].sort((a, b) => b.relevance - a.relevance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected: DiversityCandidate[] = [];
  let usedTokens = 0;
  const simCache = new Map<string, number>();
  const pairSim = (x: DiversityCandidate, y: DiversityCandidate): number => {
    const key = x.id < y.id ? `${x.id}|${y.id}` : `${y.id}|${x.id}`;
    let v = simCache.get(key);
    if (v === undefined) { v = cosine(x.embedding, y.embedding); simCache.set(key, v); }
    return v;
  };
  while (selected.length < k && pool.length > 0) {
    let best: DiversityCandidate | null = null, bestScore = -Infinity, bestIdx = -1;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (usedTokens + c.tokens > budget) continue;
      const maxSim = selected.length === 0 ? 0 : Math.max(...selected.map((s) => pairSim(c, s)));
      const score = lambda * c.relevance - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; best = c; bestIdx = i; }
    }
    if (best === null) break;
    selected.push(best); usedTokens += best.tokens; pool.splice(bestIdx, 1);
  }
  return selected;
}

export function meanPairwiseSimilarity(items: DiversityCandidate[]): number {
  if (items.length < 2) return 0;
  let sum = 0, n = 0;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) { sum += cosine(items[i].embedding, items[j].embedding); n++; }
  return n === 0 ? 0 : sum / n;
}

/** Parse a pgvector text value '[0.1,0.2,...]' into number[]. */
export function parsePgVector(text: string): number[] {
  return text.replace(/^\[|\]$/g, '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}
