import 'server-only';

import prisma from '@/lib/db';
import { embedQuery } from '@/lib/context/embed';

export interface VerifiedQueryHit {
  id: string;
  question: string;
  sql: string;
  score: number;
  origin: string;
  props: Record<string, unknown>;
}

/**
 * v1 retrieval: vector match when embedded, else question ilike fallback.
 * Inspector wiring lands in a follow-up; publish job fills this table.
 */
export async function matchVerifiedQueries(
  orgId: string,
  query: string,
  opts?: { limit?: number },
): Promise<VerifiedQueryHit[]> {
  const limit = Math.min(opts?.limit ?? 3, 10);
  const q = query.trim();
  if (!q) return [];

  const vec = await embedQuery(q);
  if (vec) {
    const vecStr = `[${vec.join(',')}]`;
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        question: string;
        sql: string;
        origin: string;
        props: unknown;
        score: number;
      }>
    >`
      SELECT id, question, sql, origin, props,
             1 - (embedding <=> ${vecStr}::text::vector) AS score
      FROM kb_verified_queries
      WHERE org_id = ${orgId}
        AND status = 'verified'
        AND origin = 'powerbi'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vecStr}::text::vector
      LIMIT ${limit}
    `;
    return rows
      .filter(r => r.score >= 0.72)
      .map(r => ({
        id: r.id,
        question: r.question,
        sql: r.sql,
        origin: r.origin,
        score: r.score,
        props: (r.props && typeof r.props === 'object' ? r.props : {}) as Record<string, unknown>,
      }));
  }

  const rows = await prisma.kbVerifiedQuery.findMany({
    where: {
      org_id: orgId,
      status: 'verified',
      origin: 'powerbi',
      OR: [
        { question: { contains: q, mode: 'insensitive' } },
        { alt_phrasings: { hasSome: [q] } },
      ],
    },
    take: limit,
  });

  return rows.map((r, i) => ({
    id: r.id,
    question: r.question,
    sql: r.sql,
    origin: r.origin,
    score: 0.8 - i * 0.05,
    props: (r.props as Record<string, unknown>) ?? {},
  }));
}
