// GET /api/agent-lab/context/estate-briefing
//
// Build-time API for Agent Creator — returns compact semantic object cards
// ranked by relevance to a mission statement. Consumed by ConstructionState
// datasource binding (see ESTATE_BRIEFING.md).
//
// Read-only. No side effects. Org-scoped via getDefaultOrg().id.
// INVARIANT: no warehouse access. All reads from platform_context_* tables.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { embedQuery } from '@/lib/context/embed';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── Response types ────────────────────────────────────────────────────────────

interface CompactObjectCard {
  path: string;
  kind: string;
  row_count_est: number | null;
  summary: string;
  grain: string;
  key_columns: string[];
  pii_columns: string[];
  /** Trust lifecycle status — 'assumed' until certified */
  status: string;
  /** Blended relevance score 0–1 */
  score: number;
  freshness: {
    structural_as_of: string | null;
    profile_as_of: string | null;
    stale: boolean;
  };
}

interface EstateBriefingResponse {
  mission: string;
  org_id: string;
  n: number;
  objects: CompactObjectCard[];
  embedding_available: boolean;
}

type EmbedRow = { subject_id: string; similarity: number };

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const mission = searchParams.get('mission')?.trim() ?? '';
    const n = Math.min(Math.max(parseInt(searchParams.get('n') ?? '3', 10), 1), 20);

    if (!mission) {
      return NextResponse.json(
        { error: "Missing required query parameter 'mission'." },
        { status: 400 },
      );
    }

    const org = await getDefaultOrg();
    const orgId = org.id;

    // ── Embed mission text ──────────────────────────────────────────────────────

    const vec = await embedQuery(mission);
    const embeddingAvailable = vec !== null;

    let rankedIds: string[] = [];

    if (vec !== null) {
      // pgvector cosine similarity — top n objects for this org
      const vecLiteral = `[${vec.join(',')}]`;
      const embedRows = await prisma.$queryRaw<EmbedRow[]>`
        SELECT
          e.subject_id::text AS subject_id,
          (1 - (e.embedding <=> ${vecLiteral}::text::vector))::float AS similarity
        FROM platform_context_embeddings e
        WHERE e.org_id    = ${orgId}
          AND e.subject_kind = 'object'
          AND e.embedding IS NOT NULL
        ORDER BY e.embedding <=> ${vecLiteral}::text::vector ASC
        LIMIT ${n}
      `;
      rankedIds = embedRows.map((r) => r.subject_id);
    }

    // Fallback: most recently enriched objects when embeddings are unavailable
    // or table is empty (pre-CH6 first run)
    if (rankedIds.length === 0) {
      const fallback = await prisma.platformContextObject.findMany({
        where: { org_id: orgId, lifecycle: 'active', last_t2_at: { not: null } },
        orderBy: { last_t2_at: 'desc' },
        select: { id: true },
        take: n,
      });
      rankedIds = fallback.map((r) => r.id);
    }

    if (rankedIds.length === 0) {
      const response: EstateBriefingResponse = {
        mission,
        org_id: orgId,
        n,
        objects: [],
        embedding_available: embeddingAvailable,
      };
      return NextResponse.json(response);
    }

    // ── Load object metadata ────────────────────────────────────────────────────

    const objects = await prisma.platformContextObject.findMany({
      where: { id: { in: rankedIds }, org_id: orgId },
      select: {
        id: true,
        full_path: true,
        object_kind: true,
        row_count_est: true,
        last_t0_at: true,
        last_t1_at: true,
        source_altered_at: true,
        native_comment: true,
      },
    });
    const objMap = new Map(objects.map((o) => [o.id, o]));

    // Batch load latest semantic cards (one query)
    const semantics = await prisma.platformContextSemantic.findMany({
      where: { subject_kind: 'object', subject_id: { in: rankedIds } },
      orderBy: { version: 'desc' },
      select: { subject_id: true, card: true, status: true },
    });
    const cardMap = new Map<string, { card: Record<string, unknown>; status: string }>();
    for (const s of semantics) {
      if (!cardMap.has(s.subject_id)) {
        cardMap.set(s.subject_id, {
          card: s.card as Record<string, unknown>,
          status: s.status,
        });
      }
    }

    // ── Build cards in ranked order ────────────────────────────────────────────

    const cards: CompactObjectCard[] = [];
    for (let i = 0; i < rankedIds.length; i++) {
      const id = rankedIds[i];
      const obj = objMap.get(id);
      if (!obj) continue;

      const sem = cardMap.get(id);
      const card = sem?.card ?? {};

      const stale =
        obj.source_altered_at !== null &&
        obj.last_t0_at !== null &&
        obj.source_altered_at > obj.last_t0_at;

      // Score: position-based (1.0 for rank 0, decaying) when embedding was used;
      // 0.5 fixed for fallback results
      const score = embeddingAvailable && vec !== null ? Math.max(0, 1 - i * 0.1) : 0.5;

      cards.push({
        path: obj.full_path,
        kind: obj.object_kind,
        row_count_est: obj.row_count_est !== null ? Number(obj.row_count_est) : null,
        summary:
          (typeof card.summary === 'string' ? card.summary : obj.native_comment) ??
          'No summary available.',
        grain: typeof card.grain === 'string' ? card.grain : '',
        key_columns: Array.isArray(card.key_columns) ? (card.key_columns as string[]) : [],
        pii_columns: Array.isArray(card.pii_columns) ? (card.pii_columns as string[]) : [],
        status: sem?.status ?? 'unknown',
        score: Math.round(score * 1000) / 1000,
        freshness: {
          structural_as_of: obj.last_t0_at?.toISOString() ?? null,
          profile_as_of: obj.last_t1_at?.toISOString() ?? null,
          stale,
        },
      });
    }

    const response: EstateBriefingResponse = {
      mission,
      org_id: orgId,
      n,
      objects: cards,
      embedding_available: embeddingAvailable,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[context/estate-briefing GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
