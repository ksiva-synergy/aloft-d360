import type { KnowledgeRepo, SearchHit } from './repo';

// Search across knowledge bases: meaning (Titan vectors) and exact words (full text) combined, current
// document versions only, each result with its citation. The caller passes the knowledge bases this
// request may see; deciding that from personal / team / organisation access arrives with Phases 1–2.
// Every search is logged for quality and gap reports (best effort: a logging failure never fails search).

export type Citation = {
  text: string;
  knowledgeBaseId: string;
  documentId: string | null;
  document: string | null;
  version: number | null;
  section: string | null;
  page: number | null;
  kind: string;
  score: number;
  /** Which search found it: by meaning, by the exact words, or both. */
  matchedBy: 'meaning' | 'words' | 'both';
};

export type SearchInput = { orgId: string; userId: string | null; surface: 'agent' | 'automation' | 'test_search' | 'script'; sourceIds: string[]; question: string; limit?: number };
export type SearchDeps = { repo: KnowledgeRepo; embedQuestion: (q: string) => Promise<number[]> };

export function toCitation(h: SearchHit): Citation {
  return {
    text: h.content,
    knowledgeBaseId: h.sourceId,
    documentId: h.documentId,
    document: h.documentName,
    version: h.version,
    section: h.sectionPath,
    page: h.page,
    kind: h.chunkType,
    score: Number(h.score.toFixed(5)),
    matchedBy: h.vectorRank && h.keywordRank ? 'both' : h.keywordRank ? 'words' : 'meaning',
  };
}

export async function searchKnowledge(input: SearchInput, deps: SearchDeps): Promise<Citation[]> {
  const question = input.question.trim().slice(0, 2000);
  const sourceIds = [...new Set(input.sourceIds)];
  if (!question || !sourceIds.length) return [];
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const embedding = await deps.embedQuestion(question);
  const hits = await deps.repo.hybridSearch({ sourceIds, question, embedding, limit, candidates: Math.max(40, limit * 5) });
  await deps.repo
    .logQuery({ orgId: input.orgId, userId: input.userId, surface: input.surface, sourceIds, question, hits })
    .catch((e: unknown) => console.warn('[knowledge] query log failed:', e instanceof Error ? e.message : e));
  return hits.map(toCitation);
}
