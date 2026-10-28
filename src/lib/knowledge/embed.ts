import {
  embedWithFallback,
  embedBulkWithTitan,
  embedWithTitan,
  CURRENT_EMBEDDING_MODEL,
  OPENAI_EMBED_MODEL,
  DEFAULT_EMBED_DIMS,
} from '@/lib/azure/embed-client';

export const EMBEDDING_DIMS = DEFAULT_EMBED_DIMS;
export { OPENAI_EMBED_MODEL, CURRENT_EMBEDDING_MODEL };

/**
 * Embed a string (Bedrock Titan v2 first, then Azure OpenAI / Foundry fallback).
 * Truncates input. Never throws — returns null on failure.
 * Used by the estate knowledge sync; knowledge bases use embedForKnowledge (Titan only).
 */
export async function embedText(text: string): Promise<number[] | null> {
  const result = await embedWithFallback(text, EMBEDDING_DIMS);
  return result?.embedding ?? null;
}

/**
 * Formats a number[] as a pgvector literal string: '[0.1,0.2,...]'
 */
export function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

// ── Knowledge bases: Titan only (decision 2026-10-27) ────────────────────────────────────────
// No fallback outside AWS: if Titan is unavailable the indexing job fails with a retryable error
// and runs again later. KNOWLEDGE_EMBED_REGION pins the region (default: BEDROCK_EMBED_REGION /
// BEDROCK_REGION, which is us-east-1 today).

export class EmbeddingUnavailableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export const knowledgeEmbedRegion = () => process.env.KNOWLEDGE_EMBED_REGION?.trim() || undefined;

/** Embeds every text with Titan v2 (1,024 dimensions) or throws; never a partial result. */
export async function embedForKnowledge(texts: string[], concurrency = 6): Promise<number[][]> {
  if (!texts.length) return [];
  const results = await embedBulkWithTitan(texts, EMBEDDING_DIMS, concurrency, knowledgeEmbedRegion());
  const missing = results.filter((r) => !r?.embedding?.length).length;
  if (missing) throw new EmbeddingUnavailableError(`Titan could not embed ${missing} of ${texts.length} pieces; the job will retry`);
  return results.map((r) => r!.embedding);
}

/** One question, for search. Throws when Titan is unavailable. */
export async function embedQuestion(text: string): Promise<number[]> {
  const r = await embedWithTitan(text, EMBEDDING_DIMS, knowledgeEmbedRegion());
  if (!r?.embedding?.length) throw new EmbeddingUnavailableError('Titan is not available to embed the question');
  return r.embedding;
}
