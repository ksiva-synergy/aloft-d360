import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { clientMeta } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { denyUnlessSection, requireSection } from '@/lib/sections/server';
import { inspectLlmLiteGatewayCatalog } from '@/lib/llmlite/fetch-models';
import { MODEL_FEATURES, type PlatformModelSettings } from '@/lib/llmlite/model-registry';
import { loadModelSettings, saveModelSettings } from '@/lib/llmlite/model-settings-store';
import {
  DEFAULT_EMBED_DIMS,
  OPENAI_EMBED_MODEL,
  TITAN_EMBED_MODEL,
  isAwsEmbeddingConfigured,
  isAzureOpenAIEmbeddingConfigured,
} from '@/lib/azure/embed-client';
import { ocrConfigFromEnv } from '@/lib/knowledge/ocr';

export const dynamic = 'force-dynamic';

export interface VectorSurfaceStatus {
  id: string;
  label: string;
  table: string;
  columnType: string;
  dimensions: number;
  activeModelId: string;
  provider: string;
  regionOrEndpoint: string;
  configured: boolean;
  description: string;
  codePaths: string[];
  totalRows: number;
  embeddedRows: number;
  modelsInDb: Array<{ modelId: string; count: number }>;
}

export interface EmbeddingConfigSummary {
  dimensions: number;
  awsTitanConfigured: boolean;
  awsTitanModel: string;
  awsTitanRegion: string;
  knowledgeEmbedRegion: string;
  azureFoundryConfigured: boolean;
  azureFoundryModel: string;
  gatewayEmbeddingModels: Array<{
    id: string;
    label: string;
    upstreamProvider: string;
    keyAllowed: boolean;
  }>;
  ocr: {
    configured: boolean;
    via: 'litellm' | 'foundry' | 'unconfigured';
    model: string;
    endpoint: string | null;
  };
  surfaces: VectorSurfaceStatus[];
}

async function getEmbeddingSummary(
  gatewayEntries: Awaited<ReturnType<typeof inspectLlmLiteGatewayCatalog>>['entries'],
): Promise<EmbeddingConfigSummary> {
  const awsTitanConfigured = isAwsEmbeddingConfigured();
  const azureFoundryConfigured = isAzureOpenAIEmbeddingConfigured();
  const awsTitanRegion =
    process.env.BEDROCK_EMBED_REGION || process.env.BEDROCK_REGION || 'us-east-1';
  const knowledgeEmbedRegion =
    process.env.KNOWLEDGE_EMBED_REGION || awsTitanRegion;

  const ocrCfg = ocrConfigFromEnv();

  // Query live vector counts from PostgreSQL (safe fallback on error)
  let contextByModel: Array<{ model_id: string | null; cnt: bigint }> = [];
  let nlIntentByModel: Array<{ model_id: string | null; cnt: bigint }> = [];
  let knowledgeCounts: Array<{ total: bigint; embedded: bigint }> = [];
  let memoryCounts: Array<{ total: bigint; embedded: bigint }> = [];

  try {
    [contextByModel, nlIntentByModel, knowledgeCounts, memoryCounts] = await Promise.all([
      prisma.$queryRaw<Array<{ model_id: string | null; cnt: bigint }>>`
        SELECT COALESCE(model_id, 'amazon.titan-embed-text-v2:0') AS model_id, COUNT(*)::bigint AS cnt
        FROM platform_context_embeddings
        WHERE embedding IS NOT NULL
        GROUP BY 1
        ORDER BY cnt DESC
      `.catch(() => []),
      prisma.$queryRaw<Array<{ model_id: string | null; cnt: bigint }>>`
        SELECT COALESCE(model_id, 'amazon.titan-embed-text-v2:0') AS model_id, COUNT(*)::bigint AS cnt
        FROM platform_nl_intent_embeddings
        WHERE embedding IS NOT NULL
        GROUP BY 1
        ORDER BY cnt DESC
      `.catch(() => []),
      prisma.$queryRaw<Array<{ total: bigint; embedded: bigint }>>`
        SELECT COUNT(*)::bigint AS total, COUNT(embedding)::bigint AS embedded
        FROM knowledge_chunks
      `.catch(() => []),
      prisma.$queryRaw<Array<{ total: bigint; embedded: bigint }>>`
        SELECT COUNT(*)::bigint AS total, COUNT(embedding)::bigint AS embedded
        FROM platform_agent_memory
      `.catch(() => []),
    ]);
  } catch {
    // Ignore DB errors
  }

  const contextTotal = contextByModel.reduce((acc, r) => acc + Number(r.cnt), 0);
  const nlIntentTotal = nlIntentByModel.reduce((acc, r) => acc + Number(r.cnt), 0);
  const kbTotal = Number(knowledgeCounts[0]?.total ?? 0);
  const kbEmbedded = Number(knowledgeCounts[0]?.embedded ?? 0);
  const memTotal = Number(memoryCounts[0]?.total ?? 0);
  const memEmbedded = Number(memoryCounts[0]?.embedded ?? 0);

  const gatewayEmbeddingModels = gatewayEntries
    .filter((e) => e.mode === 'embedding' || e.id.toLowerCase().includes('embedding'))
    .map((e) => ({
      id: e.id,
      label: e.label,
      upstreamProvider: e.upstreamProvider,
      keyAllowed: e.keyAllowed,
    }));

  const surfaces: VectorSurfaceStatus[] = [
    {
      id: 'estate-catalog-vectors',
      label: 'Data Estate Catalog & Columns (Harvest T2)',
      table: 'platform_context_embeddings',
      columnType: 'vector(1024)',
      dimensions: DEFAULT_EMBED_DIMS,
      activeModelId: TITAN_EMBED_MODEL,
      provider: 'AWS Bedrock (Titan v2)',
      regionOrEndpoint: awsTitanRegion,
      configured: awsTitanConfigured,
      description:
        'Embeds harvested Databricks/Postgres tables, views, semantic cards, and columns for semantic schema discovery in Chat & Studio.',
      codePaths: [
        'src/lib/context/embed.ts',
        'src/lib/azure/embed-client.ts',
        'scripts/context/tiers/t2-semantics.ts',
      ],
      totalRows: contextTotal,
      embeddedRows: contextTotal,
      modelsInDb: contextByModel.map((r) => ({
        modelId: r.model_id ?? TITAN_EMBED_MODEL,
        count: Number(r.cnt),
      })),
    },
    {
      id: 'knowledge-base-chunks',
      label: 'Knowledge Bases & Manuals (RAG Chunks)',
      table: 'knowledge_chunks',
      columnType: 'vector(1024)',
      dimensions: DEFAULT_EMBED_DIMS,
      activeModelId: TITAN_EMBED_MODEL,
      provider: 'AWS Bedrock (Titan v2)',
      regionOrEndpoint: knowledgeEmbedRegion,
      configured: awsTitanConfigured,
      description:
        'Embeds structure-aware document chunks (manuals, SMS clauses, tables, Q&A) and user RAG queries into a unified 1024-dim cosine space.',
      codePaths: [
        'src/lib/knowledge/embed.ts',
        'src/lib/knowledge/index-document.ts',
        'src/lib/context/knowledge-sync.ts',
      ],
      totalRows: kbTotal,
      embeddedRows: kbEmbedded,
      modelsInDb: kbEmbedded > 0 ? [{ modelId: TITAN_EMBED_MODEL, count: kbEmbedded }] : [],
    },
    {
      id: 'operating-memory-bullets',
      label: 'Operating Memory & FOER Rules (Phase 1b)',
      table: 'platform_agent_memory',
      columnType: 'vector(1024)',
      dimensions: DEFAULT_EMBED_DIMS,
      activeModelId: TITAN_EMBED_MODEL,
      provider: 'AWS Bedrock (Titan v2)',
      regionOrEndpoint: awsTitanRegion,
      configured: awsTitanConfigured,
      description:
        'Embeds learned heuristics, source preferences, failure modes, and user-taught rules for task-scoped MMR cosine recall.',
      codePaths: [
        'src/lib/memory/retrieve.ts',
        'src/lib/memory/teach.ts',
        'src/lib/context/embed.ts',
      ],
      totalRows: memTotal,
      embeddedRows: memEmbedded,
      modelsInDb: memEmbedded > 0 ? [{ modelId: TITAN_EMBED_MODEL, count: memEmbedded }] : [],
    },
    {
      id: 'semantic-nl-intents',
      label: 'Governed Semantic NL Intent Matching',
      table: 'platform_nl_intent_embeddings',
      columnType: 'vector(1024)',
      dimensions: DEFAULT_EMBED_DIMS,
      activeModelId: TITAN_EMBED_MODEL,
      provider: 'AWS Bedrock (Titan v2)',
      regionOrEndpoint: awsTitanRegion,
      configured: awsTitanConfigured,
      description:
        'Embeds natural-language questions for governed semantic measures, dimensions, and verified raw-SQL charts.',
      codePaths: [
        'src/lib/semantic/intent-embed.ts',
        'src/lib/semantic/intent-match.ts',
      ],
      totalRows: nlIntentTotal,
      embeddedRows: nlIntentTotal,
      modelsInDb: nlIntentByModel.map((r) => ({
        modelId: r.model_id ?? TITAN_EMBED_MODEL,
        count: Number(r.cnt),
      })),
    },
  ];

  return {
    dimensions: DEFAULT_EMBED_DIMS,
    awsTitanConfigured,
    awsTitanModel: TITAN_EMBED_MODEL,
    awsTitanRegion,
    knowledgeEmbedRegion,
    azureFoundryConfigured,
    azureFoundryModel: `openai/${OPENAI_EMBED_MODEL}`,
    gatewayEmbeddingModels,
    ocr: {
      configured: Boolean(ocrCfg),
      via: ocrCfg?.via ?? 'unconfigured',
      model: ocrCfg?.model ?? 'azure_ai/mistral-ocr-4-0',
      endpoint: ocrCfg?.endpoint ?? null,
    },
    surfaces,
  };
}

async function get30DayModelUsage(): Promise<
  Array<{ model: string; turns: number; inputTokens: number; outputTokens: number; errors: number }>
> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.agent_turn_log.findMany({
      where: { started_at: { gte: since } },
      select: {
        model: true,
        input_tokens: true,
        output_tokens: true,
        outcome: true,
      },
      take: 5000,
    });

    const byModel = new Map<
      string,
      { model: string; turns: number; inputTokens: number; outputTokens: number; errors: number }
    >();
    for (const r of rows) {
      const m = r.model?.trim() || 'unknown';
      const cur = byModel.get(m) ?? { model: m, turns: 0, inputTokens: 0, outputTokens: 0, errors: 0 };
      cur.turns += 1;
      cur.inputTokens += r.input_tokens ?? 0;
      cur.outputTokens += r.output_tokens ?? 0;
      if (r.outcome === 'errored') cur.errors += 1;
      byModel.set(m, cur);
    }
    return Array.from(byModel.values()).sort((a, b) => b.turns - a.turns);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const deniedSection = await denyUnlessSection(req, ['govern.models', 'view']);
  if (deniedSection) return deniedSection;

  try {
    const [settings, gateway, usage30d] = await Promise.all([
      loadModelSettings(true),
      inspectLlmLiteGatewayCatalog(),
      get30DayModelUsage(),
    ]);
    const embeddings = await getEmbeddingSummary(gateway.entries);

    return NextResponse.json(
      {
        settings,
        features: MODEL_FEATURES,
        gateway,
        usage30d,
        embeddings,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (err) {
    console.error('[/api/model-config GET] Error:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load model configuration',
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await resolveAuth(req);
    requireSection(auth, ['govern.models', 'manage']);

    const body = (await req.json()) as Partial<PlatformModelSettings>;
    const before = await loadModelSettings(true);
    const saved = await saveModelSettings(body, auth.userId);

    await writeAudit({
      actorId: auth.userId,
      action: 'model_settings.updated',
      entityType: 'policy',
      entityId: 'platform-model-settings',
      before,
      after: saved,
      ...clientMeta(req),
    }).catch(() => {});

    return NextResponse.json({ settings: saved });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Failed to save model settings';
    return NextResponse.json({ error: message }, { status });
  }
}
