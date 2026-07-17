import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { matchIntents } from '@/lib/semantic/intent-match';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/disambiguation-rank  (Phase 3.5D)
 *
 * Re-ranks the agent-emitted disambiguation candidates by DEMONSTRATED usage,
 * so disambiguation gets smarter as the org teaches vocabulary:
 *   - a candidate that is the target of a governed nl_intent matching the user's
 *     phrasing ranks above one that isn't, and
 *   - a candidate whose governed label/synonyms match the user's term ranks
 *     first — and if exactly one candidate is a governed synonym match, we return
 *     it as `autoResolve` (the org has repeatedly meant THIS by that term).
 *
 * Body: { originalTerm: string, candidates: { id, label, type, relevance }[] }
 * Returns: { ranked: { id, type, score, reason }[], autoResolve?: { id, label, type } }
 *
 * Best-effort: on any failure the client keeps the agent's original order.
 */

interface InCandidate {
  id: string;
  label: string;
  type: 'dimension' | 'measure';
  relevance: 'exact' | 'partial' | 'none';
}

const RELEVANCE_BASE: Record<InCandidate['relevance'], number> = {
  exact: 0.6,
  partial: 0.3,
  none: 0.05,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;
    // Best-effort caller resolution — only used to scope draft intents to their
    // owner (matchIntents defaults to governed-only, so this is belt-and-braces).
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;

    const body = (await request.json()) as { originalTerm?: string; candidates?: InCandidate[] };
    const term = (body.originalTerm ?? '').trim();
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (candidates.length === 0) {
      return NextResponse.json({ ranked: [] });
    }

    const measureIds = candidates.filter((c) => c.type === 'measure').map((c) => c.id);
    const dimensionIds = candidates.filter((c) => c.type === 'dimension').map((c) => c.id);

    // Load live label/synonyms/status for the candidates (governed synonym match).
    const [measures, dimensions, intentMatches] = await Promise.all([
      measureIds.length
        ? prisma.platform_sem_measures.findMany({
            where: { id: { in: measureIds }, org_id: org.id },
            select: { id: true, measure_label: true, synonyms: true, status: true },
          })
        : Promise.resolve([]),
      dimensionIds.length
        ? prisma.platform_sem_dimensions.findMany({
            where: { id: { in: dimensionIds }, org_id: org.id },
            select: { id: true, dimension_label: true, synonyms: true, status: true },
          })
        : Promise.resolve([]),
      term
        ? matchIntents(term, org.id, {
            topK: 10,
            minStatus: 'governed',
            callerUserId: currentUser?.id ?? null,
            modelId,
          })
        : Promise.resolve([]),
    ]);

    // id → { label, synonyms, status }
    const meta = new Map<string, { label: string; synonyms: string[]; status: string }>();
    for (const m of measures) {
      meta.set(m.id, {
        label: m.measure_label,
        synonyms: Array.isArray(m.synonyms) ? (m.synonyms as string[]) : [],
        status: m.status,
      });
    }
    for (const d of dimensions) {
      meta.set(d.id, {
        label: d.dimension_label,
        synonyms: Array.isArray(d.synonyms) ? (d.synonyms as string[]) : [],
        status: d.status,
      });
    }

    // id → best governed-intent similarity for that field.
    const intentSimById = new Map<string, number>();
    for (const im of intentMatches) {
      const prev = intentSimById.get(im.sourceId) ?? 0;
      if (im.similarity > prev) intentSimById.set(im.sourceId, im.similarity);
    }

    const termLc = term.toLowerCase();
    const synonymMatches: InCandidate[] = [];

    const ranked = candidates
      .map((c) => {
        const m = meta.get(c.id);
        const isGoverned = m?.status === 'governed';
        const synonymMatch =
          !!m &&
          isGoverned &&
          !!termLc &&
          (m.label.toLowerCase() === termLc ||
            m.synonyms.some((s) => s.toLowerCase() === termLc));
        if (synonymMatch) synonymMatches.push(c);

        const intentSim = intentSimById.get(c.id) ?? 0;
        const reasons: string[] = [];
        if (synonymMatch) reasons.push('governed alias');
        if (intentSim > 0) reasons.push(`answered before (${Math.round(intentSim * 100)}%)`);

        const score =
          RELEVANCE_BASE[c.relevance] +
          (synonymMatch ? 1.0 : 0) +
          intentSim * 0.5;

        return { id: c.id, type: c.type, score, reason: reasons.join(' · ') };
      })
      .sort((a, b) => b.score - a.score);

    // Exactly one governed alias match → confident enough to offer a one-click
    // resolution ("Did you mean X?") at the top of the card.
    let autoResolve: { id: string; label: string; type: string } | undefined;
    if (synonymMatches.length === 1) {
      const c = synonymMatches[0];
      autoResolve = { id: c.id, label: c.label, type: c.type };
    }

    return NextResponse.json({ ranked, autoResolve });
  } catch (err) {
    console.error('[semantic/disambiguation-rank POST]', err);
    return NextResponse.json({ ranked: [] });
  }
}
