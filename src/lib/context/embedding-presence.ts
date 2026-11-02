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
 * Object `o` has an embedding written at/after its latest semantic card version.
 * The embed job refreshes `created_at` even when embed text is unchanged, so a
 * re-described table with an identical card is still counted current after embed.
 */
export const SQL_OBJECT_EMBEDDING_CURRENT = Prisma.sql`EXISTS (
  SELECT 1 FROM platform_context_embeddings e
  WHERE e.subject_kind = 'object'
    AND e.subject_id = o.id
    AND e.embedding IS NOT NULL
    AND e.created_at >= COALESCE(
      (SELECT MAX(s.created_at) FROM platform_context_semantics s
        WHERE s.subject_kind = 'object' AND s.subject_id = o.id),
      '-infinity'::timestamptz
    )
)`;
