import { callScorerLlm } from '@/lib/boost/scorers/llm-client';
import { applyRerankKeepIndices, parseRerankKeepIndices } from '@/lib/access/search-rerank-parse';
import type { TableSearchHit } from '@/lib/access/table-search-hybrid';

const MAX_POOL = 35;
const MIN_TO_RERANK = 8;
const MIN_MEANING_TO_RERANK = 3;

function enabled(): boolean {
  const t = process.env.ACCESS_TABLE_SEARCH_RERANK;
  if (t === 'false' || t === '0') return false;
  if (t === 'true' || t === '1') return true;
  const c = process.env.ACCESS_COLUMN_SEARCH_RERANK;
  return c !== 'false' && c !== '0';
}

/** Path/name substring hits from SQL search — keep without LLM. */
export function isPinnedTableHit(q: string, hit: TableSearchHit): boolean {
  if (hit.match !== 'name') return false;
  const term = q.trim().toLowerCase();
  if (!term) return false;
  const path = hit.path.toLowerCase();
  const name = (hit.name ?? path.split('.').pop() ?? '').toLowerCase();
  if (name === term || name.includes(term)) return true;
  return path.includes(term);
}

export function shouldRerankTableSearch(q: string, hits: TableSearchHit[]): boolean {
  if (!enabled()) return false;
  if (hits.length < MIN_TO_RERANK) return false;
  const meaning = hits.filter((h) => h.match === 'meaning').length;
  if (meaning >= MIN_MEANING_TO_RERANK) return true;
  const pool = hits.filter((h) => !isPinnedTableHit(q, h)).length;
  return pool >= MIN_TO_RERANK;
}

function candidateLine(h: TableSearchHit, i: number): string {
  const bits = [`${i}. path=${h.path}`, `via=${h.match}`];
  if (h.kind) bits.push(`kind=${h.kind}`);
  if (h.description) bits.push(`about=${h.description.slice(0, 140)}`);
  if (h.score != null) bits.push(`sim=${h.score.toFixed(2)}`);
  return bits.join(' | ');
}

/** Luna re-rank on embedding-only table hits after pinning name/path matches. */
export async function rerankTableSearchHits(q: string, hits: TableSearchHit[]): Promise<TableSearchHit[]> {
  if (!shouldRerankTableSearch(q, hits)) return hits;

  const pinned = hits.filter((h) => isPinnedTableHit(q, h));
  const pool = hits.filter((h) => !isPinnedTableHit(q, h)).slice(0, MAX_POOL);
  if (pool.length === 0) return pinned;

  const system = `You help data stewards find the right catalog tables in a lakehouse.
Given a search query and numbered table candidates (full path, summary, match type), return ONLY tables the user likely wants.
Drop unrelated scratch/staging tables unless the query implies them. Prefer production/curated paths when relevance is similar.
Reply with JSON only: {"keep":[0,2,5]} using candidate indices.`;

  const user = `Query: "${q.trim()}"

Candidates:
${pool.map((h, i) => candidateLine(h, i)).join('\n')}`;

  try {
    const raw = await callScorerLlm({ system, user, maxTokens: 256 });
    const keep = parseRerankKeepIndices(raw, pool.length);
    const trimmed = keep ? applyRerankKeepIndices(pool, keep, 10) : pool.slice(0, Math.min(10, pool.length));
    return [...pinned, ...trimmed];
  } catch {
    return hits;
  }
}
