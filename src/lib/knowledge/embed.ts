import {
  embedWithFallback,
  CURRENT_EMBEDDING_MODEL,
  OPENAI_EMBED_MODEL,
  DEFAULT_EMBED_DIMS,
} from '@/lib/azure/embed-client';

export const EMBEDDING_DIMS = DEFAULT_EMBED_DIMS;
export { OPENAI_EMBED_MODEL, CURRENT_EMBEDDING_MODEL };

/**
 * Embed a string (Bedrock Titan v2 first, then Azure OpenAI / Foundry fallback).
 * Truncates input. Never throws — returns null on failure.
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
