import 'server-only';

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import OpenAI from 'openai';

export const OPENAI_EMBED_MODEL =
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
  process.env.FOUNDRY_EMBEDDING_DEPLOYMENT ||
  'text-embedding-3-large';

export const TITAN_EMBED_MODEL =
  process.env.BEDROCK_EMBED_MODEL || 'amazon.titan-embed-text-v2:0';

export const DEFAULT_EMBED_DIMS = 1024;

/** Default concurrent Titan InvokeModel calls for estate bulk embed. */
export const EMBED_BULK_CONCURRENCY = Math.min(
  16,
  Math.max(1, Number(process.env.EMBED_BULK_CONCURRENCY || 8)),
);

type EmbedCredentials = { apiKey: string; endpoint: string };

function resolveEmbedCredentials(): EmbedCredentials | null {
  if (process.env.FOUNDRY_API_KEY) {
    const endpoint =
      process.env.FOUNDRY_EMBEDDING_ENDPOINT || process.env.FOUNDRY_ENDPOINT;
    if (endpoint) {
      return { apiKey: process.env.FOUNDRY_API_KEY, endpoint };
    }
  }

  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint =
    process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
  if (apiKey && endpoint) {
    return { apiKey, endpoint };
  }

  return null;
}

function bedrockEmbedRegion(): string {
  return process.env.BEDROCK_REGION || 'us-east-1';
}

/**
 * Bedrock client for Titan embed. Uses the default AWS credential chain:
 * ECS/Fargate **task role** (`aloftEcsTaskRole`), instance profile, or env keys.
 * Explicit `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` override when set (local dev).
 */
function getBedrockClient(): BedrockRuntimeClient {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  return new BedrockRuntimeClient({
    region: bedrockEmbedRegion(),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
}

/** Likely able to call Bedrock (task role on ECS, or explicit keys). */
export function isAwsEmbeddingConfigured(): boolean {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return true;
  if (process.env.ECS_CONTAINER_METADATA_URI || process.env.ECS_CONTAINER_METADATA_URI_V4) {
    return true;
  }
  if (process.env.AWS_EXECUTION_ENV?.includes('AWS_ECS')) return true;
  return false;
}

/** True when Azure OpenAI / Foundry embedding env is set. */
export function isAzureOpenAIEmbeddingConfigured(): boolean {
  return resolveEmbedCredentials() !== null;
}

async function callTitanEmbedding(text: string, dimensions: number): Promise<number[] | null> {
  try {
    const client = getBedrockClient();
    const truncated = text.slice(0, 32_000);
    const cmd = new InvokeModelCommand({
      modelId: TITAN_EMBED_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: truncated,
        dimensions,
        normalize: true,
      }),
    });
    const resp = await client.send(cmd);
    const parsed = JSON.parse(new TextDecoder().decode(resp.body)) as { embedding?: number[] };
    return parsed.embedding?.length ? parsed.embedding : null;
  } catch (err) {
    console.warn(`[embed] Titan (${TITAN_EMBED_MODEL}) failed`, err);
    return null;
  }
}

async function callAzureOpenAIEmbedding(text: string, dimensions: number): Promise<number[] | null> {
  const client = getAzureOpenAIEmbedClient();
  if (!client) return null;

  try {
    const truncated = text.slice(0, 8000);
    const res = await client.embeddings.create({
      model: OPENAI_EMBED_MODEL,
      input: truncated,
      dimensions,
    });
    return res.data[0]?.embedding?.length ? res.data[0].embedding : null;
  } catch (err) {
    console.warn(`[embed] OpenAI embedding (${OPENAI_EMBED_MODEL}) failed`, err);
    return null;
  }
}

export type EmbeddingResult = { embedding: number[]; modelId: string };

/**
 * Embed one text: **Bedrock Titan v2 first**, then Azure OpenAI / Foundry fallback.
 * Set `EMBED_OPENAI_ONLY=1` to skip Titan (legacy Foundry-only path).
 */
export async function embedWithFallback(
  text: string,
  dimensions = DEFAULT_EMBED_DIMS,
): Promise<EmbeddingResult | null> {
  const openAiOnly = process.env.EMBED_OPENAI_ONLY === '1';

  if (!openAiOnly) {
    const titan = await callTitanEmbedding(text, dimensions);
    if (titan) {
      return { embedding: titan, modelId: TITAN_EMBED_MODEL };
    }
  }

  const azure = await callAzureOpenAIEmbedding(text, dimensions);
  if (azure) {
    return { embedding: azure, modelId: `openai/${OPENAI_EMBED_MODEL}` };
  }

  if (!isAwsEmbeddingConfigured() && !isAzureOpenAIEmbeddingConfigured()) {
    console.warn(
      '[embed] No embedding provider configured (Bedrock task role / AWS creds for Titan, or FOUNDRY_* / AZURE_OPENAI_* for OpenAI)',
    );
  }

  return null;
}

/**
 * Embed many strings with bounded concurrency (estate embed job bulk path).
 * Returns one result per input index (null = failed for that row).
 */
export async function embedBulkWithFallback(
  texts: string[],
  dimensions = DEFAULT_EMBED_DIMS,
  concurrency = EMBED_BULK_CONCURRENCY,
): Promise<(EmbeddingResult | null)[]> {
  const results: (EmbeddingResult | null)[] = new Array(texts.length).fill(null);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= texts.length) break;
      results[i] = await embedWithFallback(texts[i], dimensions);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Label stored on new estate embedding rows when Titan is used. */
export const CURRENT_EMBEDDING_MODEL = TITAN_EMBED_MODEL;

export function getAzureOpenAIEmbedClient(): OpenAI | null {
  const creds = resolveEmbedCredentials();
  if (!creds) return null;

  const clean = creds.endpoint.replace(/\/$/, '');
  const model = OPENAI_EMBED_MODEL;

  let baseURL: string;
  if (clean.includes('/deployments/')) {
    baseURL = clean;
  } else if (clean.endsWith('/v1') || clean.includes('/openai/v1')) {
    baseURL = clean;
  } else {
    baseURL = `${clean}/openai/deployments/${model}`;
  }

  return new OpenAI({
    apiKey: creds.apiKey,
    baseURL,
    defaultQuery: {
      'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
    },
    defaultHeaders: { 'api-key': creds.apiKey },
  });
}
