import { NextRequest, NextResponse } from 'next/server';
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { runAgentLoop } from '@/lib/inspector/agent-loop';
import {
  buildBlueprintToolConfig,
  buildBlueprintSystemPrompt,
  parseProposedItems,
  PROPOSE_BLUEPRINT_TOOL_NAME,
} from '@/lib/dashboards/blueprint-propose';
import {
  groundBlueprint,
  type GroundingCatalog,
  type RawBlueprintItem,
} from '@/lib/dashboards/blueprint-ground';
import type { ResolvedIntent, GuidedBlueprint, BlueprintModelStatus } from '@/lib/dashboards/guided-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/inspector/semantic/[modelId]/blueprint  (Guided Stage 2)
 *
 * Proposes a curated-ready ChartBlueprint[] for the resolved intent. The model
 * proposes; the SERVER grounds — every field id in the response is intersected
 * with this model's real definition catalog, so a fabricated id can never be
 * emitted (blueprint-ground.ts, the "refuse rather than guess" guarantee).
 * Nothing is executed or rendered here — this is spec generation only.
 *
 * Body: { intent: ResolvedIntent }
 * Returns: GuidedBlueprint { modelId, items, modelStatus }
 *
 * Grounding source = the SAME non-archived/non-draft definition load the
 * resolve-intent + definitions endpoints use (uncapped). Per-item grounding is
 * two-state ('governed'=defined | 'undefined'); the model's governance status is
 * a MODEL-level banner (`modelStatus`), not per row (one dashboard = one model).
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

    const body = (await request.json().catch(() => ({}))) as { intent?: ResolvedIntent };
    const intent = body.intent;
    if (!intent || typeof intent.topic !== 'string' || !intent.topic.trim()) {
      return NextResponse.json({ error: 'A resolved intent with a topic is required' }, { status: 400 });
    }

    // ── Load the model (non-archived); model status drives the banner ─────────
    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id, status: { not: 'archived' } },
      select: { id: true, name: true, status: true },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    const modelStatus: BlueprintModelStatus = model.status === 'governed' ? 'governed' : 'candidate';

    // ── Load the definition catalog — same load as resolve-intent (uncapped,
    //    non-archived, non-draft). Entities filtered FIRST so a live def inside
    //    an archived entity can't leak. ────────────────────────────────────────
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

    // ── Propose (one-shot, single forced tool). Falls back to grounding an empty
    //    proposal if the backend is unavailable — the UI still renders the
    //    define-it path from the intent's not_governed terms. ───────────────────
    let rawItems: RawBlueprintItem[] = [];

    if (isBedrockConfigured() && (catalog.measures.length > 0 || catalog.dimensions.length > 0)) {
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ text: `Propose the blueprint for: ${intent.topic}` } as ContentBlock],
        },
      ];
      const captured: RawBlueprintItem[][] = [];
      try {
        await runAgentLoop({
          modelId: BLUEPRINT_MODEL,
          systemPrompt: buildBlueprintSystemPrompt(intent, catalog),
          messages,
          tools: buildBlueprintToolConfig(),
          executeTool: async (toolName, toolInput) => {
            if (toolName === PROPOSE_BLUEPRINT_TOOL_NAME) {
              captured.push(parseProposedItems(toolInput));
              return 'Blueprint proposal received.';
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
        console.warn('[blueprint POST] proposal loop failed; grounding empty proposal:', err);
      }
      rawItems = captured.flat();
    }

    // ── Ground server-side — the guarantee. No fabricated id can survive. ──────
    const items = groundBlueprint(rawItems, catalog);

    const blueprint: GuidedBlueprint = { modelId: model.id, items, modelStatus };
    return NextResponse.json(blueprint);
  } catch (err) {
    console.error('[blueprint POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
