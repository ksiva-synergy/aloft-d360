/**
 * LLM backend for context harvest T2 (semantic) and T3 (usage narratives).
 *
 * Default provider: LLM Lite gateway (aws_bedrock/xAI-Grok-4.7).
 * Legacy override with HARVEST_LLM_PROVIDER=llmlite|xai|bedrock|groq.
 */

import OpenAI from 'openai';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { getLlmLiteApiKey, getLlmLiteBaseUrl, isLlmLiteConfigured } from '@/lib/llmlite/config';
import { getFeatureGatewayModelIdSync } from '@/lib/llmlite/model-settings-store';

export type HarvestLlmProvider = 'llmlite' | 'xai' | 'bedrock' | 'groq';

export function getHarvestLlmProvider(): HarvestLlmProvider {
  const explicit = process.env.HARVEST_LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === 'llmlite' || explicit === 'xai' || explicit === 'bedrock' || explicit === 'groq') {
    return explicit;
  }
  if (isLlmLiteConfigured()) return 'llmlite';
  return 'llmlite';
}

/** Model id stored on platform_context_semantic.model_id and used for API calls. */
export function getHarvestLlmModelId(): string {
  const provider = getHarvestLlmProvider();
  const configuredDefault = getFeatureGatewayModelIdSync('harvest_semantic');
  if (provider === 'llmlite') {
    return (
      process.env.HARVEST_LLMLITE_MODEL?.trim() ||
      process.env.CONTEXT_HARVEST_MODEL?.trim() ||
      configuredDefault
    );
  }
  if (provider === 'xai') {
    return (
      process.env.HARVEST_XAI_MODEL?.trim() ||
      process.env.XAI_MODEL?.trim() ||
      'grok-4.7'
    );
  }
  if (provider === 'groq') {
    return (
      process.env.HARVEST_GROQ_MODEL?.trim() ||
      process.env.GROQ_MODEL?.trim() ||
      'llama-3.3-70b-versatile'
    );
  }
  return (
    process.env.HARVEST_BEDROCK_MODEL_ID?.trim() ||
    process.env.BEDROCK_SONNET_MODEL_ID?.trim() ||
    configuredDefault
  );
}

export function getHarvestLlmCostPerMillion(): { input: number; output: number } {
  const inEnv = process.env.HARVEST_LLM_INPUT_PRICE_PER_M_USD;
  const outEnv = process.env.HARVEST_LLM_OUTPUT_PRICE_PER_M_USD;
  if (inEnv && outEnv) {
    return { input: parseFloat(inEnv), output: parseFloat(outEnv) };
  }
  const provider = getHarvestLlmProvider();
  if (provider === 'groq') {
    return { input: 0.59, output: 0.79 };
  }
  if (provider === 'xai') {
    return { input: 3, output: 15 };
  }
  return { input: 3, output: 15 };
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type HarvestLlmCompleteParams = {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
};

export type HarvestLlmCompleteResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

function getLlmLiteClient(): OpenAI {
  const base = getLlmLiteBaseUrl();
  const apiKey = getLlmLiteApiKey();
  if (!base || !apiKey) {
    throw new Error('[harvest-llm] LLMLITE_BASE_URL and LLMLITE_API_KEY are required for LLM Lite harvest');
  }
  return new OpenAI({ apiKey, baseURL: `${base}/v1` });
}

function getXaiClient(): OpenAI {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('[harvest-llm] XAI_API_KEY is required when HARVEST_LLM_PROVIDER=xai');
  }
  const base = (process.env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1').replace(/\/$/, '');
  return new OpenAI({ apiKey, baseURL: base });
}

function getGroqClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('[harvest-llm] GROQ_API_KEY is required when HARVEST_LLM_PROVIDER=groq');
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.GROQ_BASE_URL?.trim() || 'https://api.groq.com/openai/v1',
  });
}

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? 'us-east-1',
  });
}

async function completeViaOpenAiCompatible(
  client: OpenAI,
  params: HarvestLlmCompleteParams,
): Promise<HarvestLlmCompleteResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: params.system },
    ...params.messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const resp = await client.chat.completions.create({
    model: getHarvestLlmModelId(),
    messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature ?? 0.2,
  });

  const text = resp.choices[0]?.message?.content ?? '';
  return {
    text,
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
  };
}

async function completeViaXai(params: HarvestLlmCompleteParams): Promise<HarvestLlmCompleteResult> {
  return completeViaOpenAiCompatible(getXaiClient(), params);
}

async function completeViaGroq(params: HarvestLlmCompleteParams): Promise<HarvestLlmCompleteResult> {
  return completeViaOpenAiCompatible(getGroqClient(), params);
}

async function completeViaBedrock(params: HarvestLlmCompleteParams): Promise<HarvestLlmCompleteResult> {
  const client = getBedrockClient();
  const modelId = getHarvestLlmModelId();

  const resp = await client.send(
    new ConverseCommand({
      modelId,
      system: [{ text: params.system }],
      messages: params.messages.map(m => ({
        role: m.role,
        content: [{ text: m.content }],
      })),
      inferenceConfig: {
        maxTokens: params.maxTokens,
        temperature: params.temperature ?? 0.2,
      },
    }),
  );

  const text = resp.output?.message?.content?.[0]?.text ?? '';
  return {
    text,
    inputTokens: resp.usage?.inputTokens ?? 0,
    outputTokens: resp.usage?.outputTokens ?? 0,
  };
}

export async function harvestLlmComplete(
  params: HarvestLlmCompleteParams,
): Promise<HarvestLlmCompleteResult> {
  const provider = getHarvestLlmProvider();
  if (provider === 'llmlite') return completeViaOpenAiCompatible(getLlmLiteClient(), params);
  if (provider === 'xai') return completeViaXai(params);
  if (provider === 'groq') return completeViaGroq(params);
  return completeViaBedrock(params);
}
