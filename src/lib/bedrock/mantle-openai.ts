import 'server-only';

import OpenAI from 'openai';

/** Bedrock Mantle model id for GPT-6 Luna (us-east-1). */
export const BEDROCK_GPT_6_LUNA_MODEL_ID = 'openai.gpt-6-luna';

const LUNA_ALIASES = new Set(['gpt-6-luna', BEDROCK_GPT_6_LUNA_MODEL_ID]);

export function isBedrockMantleConfigured(): boolean {
  return !!process.env.BEDROCK_MANTLE_API_KEY?.trim();
}

export function getBedrockMantleRegion(): string {
  return process.env.BEDROCK_MANTLE_REGION?.trim() || 'us-east-1';
}

export function getBedrockMantleOpenAIClient(): OpenAI | null {
  const apiKey = process.env.BEDROCK_MANTLE_API_KEY?.trim();
  if (!apiKey) return null;
  const region = getBedrockMantleRegion();
  return new OpenAI({
    apiKey,
    baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1`,
  });
}

/** Map Azure deployment alias to Bedrock Mantle id when Mantle is configured. */
export function resolveOpenAIChatModelId(model: string): string {
  if (LUNA_ALIASES.has(model) && isBedrockMantleConfigured()) {
    return BEDROCK_GPT_6_LUNA_MODEL_ID;
  }
  return model;
}

/**
 * OpenAI-compatible chat client for small Luna calls (scorers, titles, session summary).
 * Prefers Bedrock Mantle when configured; otherwise Azure Foundry.
 */
export function getLunaOpenAIChatClient(): OpenAI | null {
  return getBedrockMantleOpenAIClient() ?? getFoundryOpenAIChatClient();
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
