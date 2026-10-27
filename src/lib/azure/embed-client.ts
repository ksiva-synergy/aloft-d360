import 'server-only';

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import OpenAI from 'openai';

export const OPENAI_EMBED_MODEL =
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
  process.env.FOUNDRY_EMBEDDING_DEPLOYMENT ||
  'text-embedding-3-large';

/** Bedrock Titan v2 — the model the harvested catalog and agent-memory vectors were built with. */
export const TITAN_EMBED_MODEL = 'amazon.titan-embed-text-v2:0';
export const DEFAULT_EMBED_DIMS = 1024;

/** Concurrent Titan InvokeModel calls for estate bulk embed jobs (1–16, default 8). */
export const EMBED_BULK_CONCURRENCY = Math.min(
  16,
  Math.max(1, Number(process.env.EMBED_BULK_CONCURRENCY) || 8),
);

let titanClient: BedrockRuntimeClient | null = null;

function getTitanClient(): BedrockRuntimeClient {
  titanClient ??= new BedrockRuntimeClient({ region: getTitanRegion() });
  return titanClient;
}

function getTitanRegion(): string {
  return process.env.BEDROCK_EMBED_REGION?.trim() || process.env.BEDROCK_REGION?.trim() || 'us-east-1';
}

/** Bedrock API key (bearer). The Mantle key is a standard Bedrock API key and works for InvokeModel. */
function getBedrockApiKey(): string | null {
  return (
    process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() ||
    process.env.BEDROCK_API_KEY?.trim() ||
    process.env.BEDROCK_MANTLE_API_KEY?.trim() ||
    null
  );
}

async function invokeTitan(body: string): Promise<{ embedding?: number[] }> {
  const apiKey = getBedrockApiKey();
  if (apiKey) {
    const res = await fetch(
      `https://bedrock-runtime.${getTitanRegion()}.amazonaws.com/model/${encodeURIComponent(TITAN_EMBED_MODEL)}/invoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      },
    );
    if (!res.ok) throw new Error(`Bedrock ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<{ embedding?: number[] }>;
  }
  const resp = await getTitanClient().send(new InvokeModelCommand({
    modelId: TITAN_EMBED_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  }));
  return JSON.parse(new TextDecoder().decode(resp.body)) as { embedding?: number[] };
}

/**
 * Embed text with Bedrock Titan v2. Vectors are only comparable with other
 * Titan v2 vectors, so callers must not mix this with OpenAI embeddings.
 */
export async function embedWithTitan(
  text: string,
  dimensions = DEFAULT_EMBED_DIMS,
): Promise<EmbeddingResult | null> {
  try {
    const parsed = await invokeTitan(
      JSON.stringify({ inputText: text.slice(0, 32_000), dimensions, normalize: true }),
    );
    return parsed.embedding?.length ? { embedding: parsed.embedding, modelId: TITAN_EMBED_MODEL } : null;
  } catch (err) {
    console.warn(`[embed] Bedrock Titan embedding (${TITAN_EMBED_MODEL}) failed`, err);
    return null;
  }
}

/**
 * Embed many texts with Titan v2 using bounded concurrency (estate embed job bulk path).
 * Returns one result per input index; null marks a failed row.
 */
export async function embedBulkWithTitan(
  texts: string[],
  dimensions = DEFAULT_EMBED_DIMS,
  concurrency = EMBED_BULK_CONCURRENCY,
): Promise<(EmbeddingResult | null)[]> {
  const results: (EmbeddingResult | null)[] = new Array(texts.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      results[i] = await embedWithTitan(texts[i], dimensions);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return results;
}

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

/** True when Azure OpenAI / Foundry embedding env is set. */
export function isAzureOpenAIEmbeddingConfigured(): boolean {
  return resolveEmbedCredentials() !== null;
}

/** True when a Bedrock API key or AWS credentials for Titan embeddings are present in env. */
export function isAwsEmbeddingConfigured(): boolean {
  return Boolean(getBedrockApiKey() || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI);
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
 * Embed text via Azure OpenAI / Foundry (text-embedding-3-large by default).
 * Used by the knowledge base. Catalog and memory vectors use embedWithTitan.
 */
export async function embedWithFallback(
  text: string,
  dimensions = DEFAULT_EMBED_DIMS,
): Promise<EmbeddingResult | null> {
  const azure = await callAzureOpenAIEmbedding(text, dimensions);
  if (azure) {
    return { embedding: azure, modelId: `openai/${OPENAI_EMBED_MODEL}` };
  }

  if (!isAzureOpenAIEmbeddingConfigured()) {
    console.warn(
      '[embed] OpenAI/Foundry embedding is not configured (set FOUNDRY_* or AZURE_OPENAI_* embedding env)',
    );
  }

  return null;
}

/** Label stored on new embedding rows (OpenAI / Foundry). */
export const CURRENT_EMBEDDING_MODEL = `openai/${OPENAI_EMBED_MODEL}`;

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
