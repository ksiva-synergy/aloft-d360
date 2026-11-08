import { callScorerLlm } from '@/lib/boost/scorers/llm-client';
import { applyRerankKeepIndices, parseRerankKeepIndices } from '@/lib/access/search-rerank-parse';
import type { ColumnSearchHit } from '@/lib/access/column-search-hybrid';

const MAX_POOL = 40;
const MIN_TO_RERANK = 10;
const MIN_MEANING_TO_RERANK = 4;

function enabled(): boolean {
  const v = process.env.ACCESS_COLUMN_SEARCH_RERANK;
  return v !== 'false' && v !== '0';
}

/** Strong name hit: exact or substring on column name — always kept without LLM. */
export function isPinnedColumnHit(q: string, hit: ColumnSearchHit): boolean {
  if (hit.match !== 'name') return false;
  const term = q.trim().toLowerCase();
  if (!term) return false;
  if (hit.column === term) return true;
  return hit.column.includes(term);
}

export function shouldRerankColumnSearch(q: string, hits: ColumnSearchHit[]): boolean {
  if (!enabled()) return false;
  if (hits.length < MIN_TO_RERANK) return false;
  const meaning = hits.filter((h) => h.match === 'meaning').length;
  if (meaning >= MIN_MEANING_TO_RERANK) return true;
  const pool = hits.filter((h) => !isPinnedColumnHit(q, h)).length;
  return pool >= MIN_TO_RERANK;
}

export { applyRerankKeepIndices } from '@/lib/access/search-rerank-parse';

function candidateLine(h: ColumnSearchHit, i: number): string {
  const bits = [`${i}. column=${h.column}`, `table=${h.tablePath}`];
  if (h.type) bits.push(`type=${h.type}`);
  bits.push(`via=${h.match}`);
  if (h.description) bits.push(`about=${h.description.slice(0, 120)}`);
  if (h.score != null) bits.push(`sim=${h.score.toFixed(2)}`);
  return bits.join(' | ');
}

/**
 * Luna re-rank on the ambiguous tail of hybrid column search (after pinning strong name hits).
 */
export async function rerankColumnSearchHits(q: string, hits: ColumnSearchHit[]): Promise<ColumnSearchHit[]> {
  if (!shouldRerankColumnSearch(q, hits)) return hits;

  const pinned = hits.filter((h) => isPinnedColumnHit(q, h));
  const pool = hits.filter((h) => !isPinnedColumnHit(q, h)).slice(0, MAX_POOL);
  if (pool.length === 0) return pinned;

  const system = `You help data stewards tag sensitive columns for access control.
Given a search query and numbered column candidates (name, table, description, match type), return ONLY columns the steward likely wants.
Drop unrelated columns (e.g. generic email/id fields when the query is about pay, unless the query asks for contact/email data).
Reply with JSON only: {"keep":[0,2,5]} using candidate indices. Include all clearly relevant rows; omit noise.`;

  const user = `Query: "${q.trim()}"

Candidates:
${pool.map((h, i) => candidateLine(h, i)).join('\n')}`;

  try {
    const raw = await callScorerLlm({ system, user, maxTokens: 256 });
    const keep = parseRerankKeepIndices(raw, pool.length);
    const trimmed = keep ? applyRerankKeepIndices(pool, keep) : pool.slice(0, Math.min(12, pool.length));
    return [...pinned, ...trimmed];
  } catch {
    return hits;
  }
}
