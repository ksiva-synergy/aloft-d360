import { describe, expect, it } from 'vitest';
import { rankCatalogCandidates } from './search-ranking';

describe('rankCatalogCandidates', () => {
  it('keeps vector similarity primary when an exact-name match has weak semantic relevance', () => {
    const ranked = rankCatalogCandidates({
      vectorScores: new Map([
        ['semantically-relevant', 0.8],
        ['exact-name-only', 0.3],
      ]),
      keywordScores: new Map([['exact-name-only', 1]]),
      exactNameMatchIds: new Set(['exact-name-only']),
      keywordCount: 1,
      limit: 5,
    });

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      'semantically-relevant',
      'exact-name-only',
    ]);
    expect(ranked[0].semantic_score).toBe(0.8);
  });

  it('drops vector hits below the semantic similarity floor', () => {
    const ranked = rankCatalogCandidates({
      vectorScores: new Map([
        ['related', 0.31],
        ['unrelated', 0.07],
      ]),
      keywordScores: new Map(),
      exactNameMatchIds: new Set(),
      keywordCount: 0,
      limit: 5,
    });

    expect(ranked.map((candidate) => candidate.id)).toEqual(['related']);
  });

  it('marks results as lexical-only when vector search is unavailable', () => {
    const ranked = rankCatalogCandidates({
      vectorScores: new Map(),
      keywordScores: new Map([['keyword-hit', 2]]),
      exactNameMatchIds: new Set(),
      keywordCount: 2,
      limit: 5,
    });

    expect(ranked).toEqual([{
      id: 'keyword-hit',
      score: 0.65,
      semantic_score: null,
      keyword_score: 1,
      exact_name_match: false,
      match_type: 'keyword',
    }]);
  });
});
