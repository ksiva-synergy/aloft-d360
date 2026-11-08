import { Prisma } from '@prisma/client';

/**
 * True when platform_context_objects row `o` has a persisted object-level vector.
 * Uses EXISTS (no LEFT JOIN) so counts are not affected by duplicate joins.
 * Does not filter on e.org_id — subject_id is the object's UUID; org is enforced on `o`.
 */
export const SQL_OBJECT_HAS_EMBEDDING = Prisma.sql`EXISTS (
  SELECT 1 FROM platform_context_embeddings e
  WHERE e.subject_kind = 'object'
    AND e.subject_id = o.id
    AND e.embedding IS NOT NULL
)`;

/** Same check when the context object is aliased as `pco` (estate discovery list). */
export const SQL_PCO_HAS_EMBEDDING = Prisma.sql`EXISTS (
  SELECT 1 FROM platform_context_embeddings e
  WHERE e.subject_kind = 'object'
    AND e.subject_id = pco.id
    AND e.embedding IS NOT NULL
)`;

/**
 * Object has an embedding written at/after its latest semantic card version.
 * `objectIdExpr` must be a trusted SQL id reference (`o.id`, never user input).
 * The embed job refreshes `created_at` even when embed text is unchanged, so a
 * re-described table with an identical card is still counted current after embed.
 */
export function sqlObjectEmbeddingCurrent(objectIdExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM platform_context_embeddings e
    WHERE e.subject_kind = 'object'
      AND e.subject_id = ${objectIdExpr}
      AND e.embedding IS NOT NULL
      AND e.created_at >= COALESCE(
        (SELECT MAX(s.created_at) FROM platform_context_semantics s
          WHERE s.subject_kind = 'object' AND s.subject_id = ${objectIdExpr}),
        '-infinity'::timestamptz
      )
  )`;
}

/** Object `o` has a current embedding (see `sqlObjectEmbeddingCurrent`). */
export const SQL_OBJECT_EMBEDDING_CURRENT = Prisma.raw(sqlObjectEmbeddingCurrent('o.id'));

/** Object `o` has no embedding, or the embedding is older than its latest description. */
export const SQL_OBJECT_NEEDS_EMBED = Prisma.raw(`NOT (${sqlObjectEmbeddingCurrent('o.id')})`);
