export interface CatalogCandidateScore {
  id: string;
  score: number;
  semantic_score: number | null;
  keyword_score: number;
  exact_name_match: boolean;
  match_type: 'semantic' | 'keyword' | 'name' | 'blended';
}

/**
 * Titan v2 cosine similarity below this is effectively unrelated text
 * (observed ~0.05–0.10 for unrelated tables, ~0.2–0.35 for related ones).
 */
export const MIN_SEMANTIC_SIMILARITY = 0.15;

export function rankCatalogCandidates(input: {
  vectorScores: Map<string, number>;
  keywordScores: Map<string, number>;
  exactNameMatchIds: Set<string>;
  keywordCount: number;
  limit: number;
}): CatalogCandidateScore[] {
  const vectorScores = new Map(
    [...input.vectorScores].filter(([, similarity]) => similarity >= MIN_SEMANTIC_SIMILARITY),
  );
  const ids = new Set([
    ...vectorScores.keys(),
    ...input.keywordScores.keys(),
    ...input.exactNameMatchIds,
  ]);
  const hasVectors = vectorScores.size > 0;
  const scored: CatalogCandidateScore[] = [];

  for (const id of ids) {
    const semanticScore = vectorScores.get(id) ?? null;
    const keywordScore = input.keywordCount > 0
      ? Math.min((input.keywordScores.get(id) ?? 0) / input.keywordCount, 1)
      : 0;
    const exactNameMatch = input.exactNameMatchIds.has(id);
    const score = hasVectors
      ? (semanticScore ?? 0) * 0.7 + keywordScore * 0.15 + (exactNameMatch ? 0.15 : 0)
      : keywordScore * 0.65 + (exactNameMatch ? 0.35 : 0);
    const matchType = semanticScore !== null
      ? keywordScore > 0 || exactNameMatch ? 'blended' : 'semantic'
      : exactNameMatch ? 'name' : 'keyword';

    scored.push({
      id,
      score,
      semantic_score: semanticScore,
      keyword_score: keywordScore,
      exact_name_match: exactNameMatch,
      match_type: matchType,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, input.limit);
}
