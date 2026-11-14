import 'server-only';

import prisma from '@/lib/db';
import { embedQuery } from '@/lib/context/embed';

/** Text for vector search (SQL is not embedded per build plan §10.2). */
export function composeVerifiedQueryEmbedText(input: {
  question: string;
  altPhrasings: string[];
  measureName: string;
  modelName?: string | null;
  /** Measure description from the model definition (`///` in TMDL). */
  description?: string | null;
  /** Q&A synonyms the model defines for the measure. */
  synonyms?: string[];
}): string {
  const lines = [
    input.question,
    ...input.altPhrasings.slice(0, 5),
    input.measureName,
    input.description?.trim() ?? '',
    ...(input.synonyms ?? []).filter((s) => s.toLowerCase() !== input.measureName.toLowerCase()).slice(0, 8),
    input.modelName?.trim() ?? '',
  ].filter(Boolean);
  return lines.join('\n');
}

export async function upsertVerifiedQueryEmbedding(
  queryId: string,
  embedText: string,
): Promise<void> {
  const text = embedText.trim();
  if (!text) return;
  try {
    const vec = await embedQuery(text);
    if (!vec) {
      console.warn(`[verified-query-embed] Titan null for ${queryId}`);
      return;
    }
    const vecStr = `[${vec.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE kb_verified_queries
      SET embedding = ${vecStr}::text::vector, updated_at = NOW()
      WHERE id = ${queryId}::uuid
    `;
  } catch (err) {
    console.error('[verified-query-embed] non-fatal', err);
  }
}
