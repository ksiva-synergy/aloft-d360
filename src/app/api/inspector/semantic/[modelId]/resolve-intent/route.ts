import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { matchIntents } from '@/lib/semantic/intent-match';
import {
  classifyTerm,
  extractTerms,
  fieldMatchesTerm,
  type ResolvableField,
} from '@/lib/dashboards/intent-resolve';
import type { IntentDisambiguation } from '@/lib/dashboards/guided-types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/resolve-intent  (Guided Stage 1)
 *
 * Resolves the terms in a guided-builder topic against the model's governed +
 * candidate definitions and returns a four-state resolution per term
 * (matched / ambiguous / not_governed / unrecognized).
 *
 * Body: { topic: string, terms?: string[] }
 *   - topic: the user's decision/question, verbatim.
 *   - terms: optional explicit term list; when omitted we extract them.
 *
 * The deterministic pass resolves over the UNCAPPED definition set (so a
 * governed field is never dropped past a top-K cap — the exact false-negative
 * the four-state design guards against). For terms that match nothing, a
 * cap-aware embedding assist (matchIntents, top-K=10, governed-only) runs: if it
 * surfaces a governed field we reclassify; if it returns a full page and still
 * nothing usable, we mark `cappedByTopK` (absence unproven) rather than
 * asserting a hard 'unrecognized'. This never picks charts — Intent only.
 */

// The documented context/synonym injection cap (Pin-2). The embedding assist
// uses the same page size so "returned a full page" means "cap was hit".
const EMBED_TOPK = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      topic?: unknown;
      terms?: unknown;
    };
    const topic = typeof body.topic === 'string' ? body.topic : '';
    const explicitTerms = Array.isArray(body.terms)
      ? body.terms.filter((t): t is string => typeof t === 'string')
      : null;

    // ── Gate: model must be governed (same rule as the definitions picker) ────
    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id, status: 'governed' },
      select: { id: true, name: true },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found or not governed' }, { status: 404 });
    }

    // ── Load the UNCAPPED governed+candidate field set (draft excluded) ───────
    const entities = await prisma.platform_sem_entities.findMany({
      where: { model_id: modelId, org_id: org.id, status: { notIn: ['archived', 'draft'] } },
      select: { id: true },
    });
    const entityIds = entities.map((e) => e.id);

    const [dimensions, measures] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id, status: { notIn: ['archived', 'draft'] } },
        select: { id: true, dimension_label: true, description: true, synonyms: true, status: true },
      }),
      prisma.platform_sem_measures.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id, status: { notIn: ['archived', 'draft'] } },
        select: { id: true, measure_label: true, description: true, synonyms: true, status: true },
      }),
    ]);

    const fields: ResolvableField[] = [
      ...dimensions.map((d) => ({
        id: d.id,
        label: d.dimension_label,
        description: d.description,
        synonyms: d.synonyms,
        status: d.status,
        kind: 'dimension' as const,
      })),
      ...measures.map((m) => ({
        id: m.id,
        label: m.measure_label,
        description: m.description,
        synonyms: m.synonyms,
        status: m.status,
        kind: 'measure' as const,
      })),
    ];
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const fieldKinds: Record<string, 'measure' | 'dimension'> = {};
    for (const f of fields) fieldKinds[f.id] = f.kind;

    // ── Resolve each term ─────────────────────────────────────────────────────
    const terms = (explicitTerms && explicitTerms.length ? explicitTerms : extractTerms(topic))
      .map((t) => t.trim())
      .filter(Boolean);

    const resolutions: IntentDisambiguation[] = [];
    for (const term of terms) {
      const matches = fields.filter((f) => fieldMatchesTerm(f, term));
      let disambig = classifyTerm(term, matches);

      // Cap-aware embedding assist ONLY for would-be-unrecognized terms.
      if (disambig.resolution === 'unrecognized') {
        try {
          const hits = await matchIntents(term, org.id, {
            modelId,
            topK: EMBED_TOPK,
            minStatus: 'governed',
          });
          const usable = hits
            .filter((h) => h.sourceType === 'measure' || h.sourceType === 'dimension')
            .map((h) => fieldById.get(h.sourceId))
            .filter((f): f is ResolvableField => !!f);
          if (usable.length > 0) {
            disambig = classifyTerm(term, usable);
          } else if (hits.length >= EMBED_TOPK) {
            // Full page returned, nothing usable → absence is UNPROVEN. Surface
            // it as capped, don't silently report a hard 'unrecognized'.
            disambig = classifyTerm(term, [], { embeddingTruncated: true });
            console.warn(
              `[resolve-intent] term "${term}" hit the top-${EMBED_TOPK} cap on model ${modelId}; a real governed match may exist past the cap (cappedByTopK).`,
            );
          }
        } catch (err) {
          // Embedding assist is best-effort (dark creds / embed unavailable). The
          // deterministic pass already gave a valid true-absence over the uncapped
          // set, so keep it.
          console.warn('[resolve-intent] embedding assist failed:', err);
        }
      }

      resolutions.push(disambig);
    }

    return NextResponse.json({
      modelId: model.id,
      modelName: model.name,
      terms: resolutions,
      fieldKinds,
    });
  } catch (err) {
    console.error('[resolve-intent POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
