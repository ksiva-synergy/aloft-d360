/**
 * src/lib/semantic/intent-embed.ts
 *
 * Phase 3.5D — write side of NL-intent activation.
 *
 * When an authored definition or a raw-SQL chart gets (or changes) its
 * `nl_intent`, we embed that text and upsert a row into
 * platform_nl_intent_embeddings. The read side (intent-match.ts) then powers
 * empty-state starter prompts and disambiguation ranking.
 *
 * Reuses the EXACT embedding call the context-builder uses (embedQuery →
 * Titan v2, 1024-dim). No second embedding model/path is introduced.
 *
 * Every write is non-fatal: a definition or chart save must NEVER fail because
 * embedding was unavailable — the intent simply isn't matchable until a later
 * capture or the backfill script re-embeds it.
 */

import 'server-only';
import prisma from '@/lib/db';
import { embedQuery } from '@/lib/context/embed';

export type IntentSourceType = 'measure' | 'dimension' | 'raw_chart';

/**
 * Embed `intentText` and upsert its embedding row. When `intentText` is empty
 * or null (the user cleared the intent), any existing row is removed so stale
 * intents stop surfacing.
 */
export async function upsertIntentEmbedding(args: {
  orgId: string;
  sourceType: IntentSourceType;
  sourceId: string;
  intentText: string | null | undefined;
  modelId?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  const text = args.intentText?.trim();
  if (!text) {
    await deleteIntentEmbedding(args.sourceType, args.sourceId);
    return;
  }
  try {
    const vec = await embedQuery(text);
    if (!vec) {
      console.warn(
        `[intent-embed] Titan returned null for ${args.sourceType}:${args.sourceId} — not matchable until re-embedded`,
      );
      return;
    }
    const vecStr = `[${vec.join(',')}]`;
    // ::text::vector cast required — Prisma binds interpolated values as typed
    // parameters and Postgres cannot apply ::vector to a bound param at parse time.
    // COALESCE on created_by preserves the original author across edits.
    await prisma.$executeRaw`
      INSERT INTO platform_nl_intent_embeddings
        (id, org_id, source_type, source_id, intent_text, embedding, model_id, created_by, created_at, updated_at)
      VALUES (
        gen_random_uuid(), ${args.orgId}, ${args.sourceType}, ${args.sourceId},
        ${text}, ${vecStr}::text::vector, ${args.modelId ?? null}, ${args.createdBy ?? null},
        NOW(), NOW()
      )
      ON CONFLICT (source_type, source_id) DO UPDATE SET
        org_id      = EXCLUDED.org_id,
        intent_text = EXCLUDED.intent_text,
        embedding   = EXCLUDED.embedding,
        model_id    = EXCLUDED.model_id,
        created_by  = COALESCE(platform_nl_intent_embeddings.created_by, EXCLUDED.created_by),
        updated_at  = NOW()
    `;
  } catch (err) {
    console.error('[intent-embed upsert] non-fatal', err);
  }
}

/** Remove an intent embedding (source deleted, or intent cleared). Non-fatal. */
export async function deleteIntentEmbedding(
  sourceType: IntentSourceType,
  sourceId: string,
): Promise<void> {
  try {
    await prisma.$executeRaw`
      DELETE FROM platform_nl_intent_embeddings
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}
    `;
  } catch (err) {
    console.error('[intent-embed delete] non-fatal', err);
  }
}
