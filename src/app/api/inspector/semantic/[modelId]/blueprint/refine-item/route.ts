import { NextRequest, NextResponse } from 'next/server';
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { runAgentLoop } from '@/lib/inspector/agent-loop';
import {
  buildBlueprintToolConfig,
  buildRefineItemSystemPrompt,
  parseProposedItems,
  PROPOSE_BLUEPRINT_TOOL_NAME,
} from '@/lib/dashboards/blueprint-propose';
import {
  groundBlueprint,
  type GroundingCatalog,
  type RawBlueprintItem,
} from '@/lib/dashboards/blueprint-ground';
import type { ChartBlueprint, ResolvedIntent } from '@/lib/dashboards/guided-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/inspector/semantic/[modelId]/blueprint/refine-item  (Guided Stage 2)
 *
 * Regenerate ONE proposed chart from natural-language feedback. The whole-blueprint
 * sibling (../blueprint) proposes 4–6 charts on first entry; this re-proposes a
 * single card the user gave feedback on, so the rest of their curation is untouched.
 *
 * The model proposes; the SERVER grounds — the exact same "no fabricated id can
 * survive" guarantee (blueprint-ground.ts). The result is deliberately allowed to
 * come back `grounding: 'undefined'`: feedback like "exclude near-misses" or "add
 * avg days between inspections" may reference a metric that isn't governed, and we
 * refuse-rather-than-guess — the card then surfaces the inline define-it path
 * instead of silently binding a wrong metric.
 *
 * Body: { intent: ResolvedIntent, item: ChartBlueprint, feedback: string }
 * Returns: { item: ChartBlueprint }  (id preserved so the client replaces in place)
 */

const BLUEPRINT_MODEL = 'us.anthropic.claude-sonnet-4-6';

function isBedrockConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      intent?: ResolvedIntent;
      item?: ChartBlueprint;
      feedback?: string;
    };
    const { intent, item } = body;
    const feedback = (body.feedback ?? '').trim();
    if (!intent || typeof intent.topic !== 'string' || !intent.topic.trim()) {
      return NextResponse.json({ error: 'A resolved intent with a topic is required' }, { status: 400 });
    }
    if (!item || typeof item.id !== 'string') {
      return NextResponse.json({ error: 'The chart item being refined is required' }, { status: 400 });
    }
    if (!feedback) {
      return NextResponse.json({ error: 'Feedback text is required' }, { status: 400 });
    }

    // ── Load the model (non-archived) ─────────────────────────────────────────
    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id, status: { not: 'archived' } },
      select: { id: true },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    // ── Load the definition catalog — same load as ../blueprint (uncapped,
    //    non-archived, non-draft; entities filtered FIRST). ────────────────────
    const entities = await prisma.platform_sem_entities.findMany({
      where: { model_id: modelId, org_id: org.id, status: { notIn: ['archived', 'draft'] } },
      select: { id: true },
    });
    const entityIds = entities.map((e) => e.id);

    const [dimensions, measures] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id, status: { notIn: ['archived', 'draft'] } },
        select: { id: true, dimension_label: true, dimension_type: true },
      }),
      prisma.platform_sem_measures.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id, status: { notIn: ['archived', 'draft'] } },
        select: { id: true, measure_label: true },
      }),
    ]);

    const catalog: GroundingCatalog = {
      measures: measures.map((m) => ({ id: m.id, label: m.measure_label })),
      dimensions: dimensions.map((d) => ({ id: d.id, label: d.dimension_label, type: d.dimension_type })),
      disambiguations: intent.disambiguations,
    };

    // ── Propose ONE refined chart (single forced tool). Falls back to grounding
    //    the model's original refs if the backend is unavailable — the item is
    //    returned essentially unchanged rather than erroring. ───────────────────
    let rawItems: RawBlueprintItem[] = [];

    if (isBedrockConfigured() && (catalog.measures.length > 0 || catalog.dimensions.length > 0)) {
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ text: `Refine this chart per the feedback: ${feedback}` } as ContentBlock],
        },
      ];
      const captured: RawBlueprintItem[][] = [];
      try {
        await runAgentLoop({
          modelId: BLUEPRINT_MODEL,
          systemPrompt: buildRefineItemSystemPrompt(intent, catalog, item, feedback),
          messages,
          tools: buildBlueprintToolConfig(),
          executeTool: async (toolName, toolInput) => {
            if (toolName === PROPOSE_BLUEPRINT_TOOL_NAME) {
              captured.push(parseProposedItems(toolInput));
              return 'Refined chart received.';
            }
            return 'Unknown tool.';
          },
          maxLoops: 2,
          supportsTools: true,
          // Forcing a single tool (toolChoice) is incompatible with extended
          // thinking on Anthropic — keep thinking off for this structured turn.
          supportsThinking: false,
        });
      } catch (err) {
        console.warn('[blueprint/refine-item POST] proposal loop failed; grounding fallback:', err);
      }
      rawItems = captured.flat();
    }

    // Fallback: no model output → re-ground the item's own current refs so the
    // response is always a valid ChartBlueprint (never an error for the user).
    if (rawItems.length === 0) {
      rawItems = [{
        title: item.title,
        measureIds: item.measureIds,
        dimensionIds: item.dimensionIds,
        filters: item.filters,
        rationale: item.rationale,
        undefinedTerm: item.grounding === 'undefined' ? item.undefinedTerm : undefined,
      }];
    }

    // ── Ground server-side — the guarantee. Take the FIRST item, grounded OR
    //    undefined; preserve the incoming id so the client replaces in place. ───
    const grounded = groundBlueprint(rawItems, catalog);
    const first = grounded[0];
    if (!first) {
      // The model returned nothing groundable and no term to define — keep the
      // original item rather than dropping the card.
      return NextResponse.json({ item });
    }

    const refined: ChartBlueprint = { ...first, id: item.id };
    return NextResponse.json({ item: refined });
  } catch (err) {
    console.error('[blueprint/refine-item POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
