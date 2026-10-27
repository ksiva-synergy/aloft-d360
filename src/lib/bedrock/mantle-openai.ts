import 'server-only';

import OpenAI from 'openai';

/**
 * In-region Mantle id. GPT-6 Luna on Mantle exists only in us-east-1.
 * ap-south-1 (and every region except us-east-1) must use the global
 * bedrock-runtime profile instead.
 */
export const BEDROCK_GPT_6_LUNA_MANTLE_MODEL_ID = 'openai.gpt-6-luna';

/** Global cross-region profile. Callable from ap-south-1 via bedrock-runtime. */
export const BEDROCK_GPT_6_LUNA_MODEL_ID = 'global.openai.gpt-6-luna';

const LUNA_ALIASES = new Set([
  'gpt-6-luna',
  BEDROCK_GPT_6_LUNA_MANTLE_MODEL_ID,
  'us.openai.gpt-6-luna',
  BEDROCK_GPT_6_LUNA_MODEL_ID,
]);

export function isBedrockMantleConfigured(): boolean {
  return !!process.env.BEDROCK_MANTLE_API_KEY?.trim();
}

export function getBedrockMantleRegion(): string {
  return process.env.BEDROCK_MANTLE_REGION?.trim() || 'us-east-1';
}

function getBedrockApiKey(): string | null {
  return (
    process.env.BEDROCK_MANTLE_API_KEY?.trim() ||
    process.env.BEDROCK_API_KEY?.trim() ||
    process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() ||
    null
  );
}

/** Source region for the runtime call. The global profile is invoked from here. */
export function getBedrockLunaSourceRegion(): string {
  return getBedrockMantleRegion();
}

export function getBedrockMantleOpenAIClient(): OpenAI | null {
  const apiKey = getBedrockApiKey();
  if (!apiKey) return null;
  const region = getBedrockMantleRegion();
  return new OpenAI({
    apiKey,
    baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1`,
  });
}

/**
 * OpenAI-compatible client on bedrock-runtime.
 * Model id must be a cross-region profile (`global.openai.gpt-6-luna`), not `openai.gpt-6-luna`.
 */
export function getBedrockRuntimeOpenAIClient(): OpenAI | null {
  const apiKey = getBedrockApiKey();
  if (!apiKey) return null;
  const region = getBedrockLunaSourceRegion();
  return new OpenAI({
    apiKey,
    baseURL: `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`,
  });
}

/** Map Luna aliases to the global runtime profile when a Bedrock API key is set. */
export function resolveOpenAIChatModelId(model: string): string {
  if (LUNA_ALIASES.has(model) && getBedrockApiKey()) {
    return BEDROCK_GPT_6_LUNA_MODEL_ID;
  }
  return model;
}

/**
 * OpenAI-compatible chat client for small Luna calls (scorers, titles, session summary).
 * Uses global bedrock-runtime so the call works from ap-south-1. Falls back to Azure Foundry.
 */
export function getLunaOpenAIChatClient(): OpenAI | null {
  return getBedrockRuntimeOpenAIClient() ?? getFoundryOpenAIChatClient();
}

function getFoundryOpenAIChatClient(): OpenAI | null {
  const endpoint = process.env.FOUNDRY_ENDPOINT?.trim();
  const apiKey = process.env.FOUNDRY_API_KEY?.trim();
  if (!endpoint || !apiKey) return null;
  const base = endpoint.replace(/\/$/, '');
  return new OpenAI({
    apiKey,
    baseURL: `${base}/openai/v1`,
    defaultHeaders: { 'api-key': apiKey },
  });
}
