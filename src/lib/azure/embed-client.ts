import 'server-only';

import OpenAI from 'openai';

export const OPENAI_EMBED_MODEL =
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
  process.env.FOUNDRY_EMBEDDING_DEPLOYMENT ||
  'text-embedding-3-large';

/** Kept for import compatibility; Titan is no longer used as an embedding provider. */
export const TITAN_EMBED_MODEL = 'amazon.titan-embed-text-v2:0';
export const DEFAULT_EMBED_DIMS = 1024;

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

/** @deprecated Titan path disabled — always false. Prefer isAzureOpenAIEmbeddingConfigured. */
export function isAwsEmbeddingConfigured(): boolean {
  return false;
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
 * Titan / Bedrock embedding is disabled — use OpenAI only.
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
