import 'server-only';

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { BOOST_MODELS } from '@/lib/boost/models';

export type HarvesterMessage = { role: 'user' | 'assistant'; content: string };

export type HarvesterLlmResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
};

/**
 * Chat model for Data Estate harvest jobs (enrich, usage narratives, silo/mapping adjudication).
 * Defaults to Grok 4.7 (xAI direct when XAI_API_KEY is set, else Foundry deployment name).
 */
export function getContextHarvesterModelId(): string {
  if (process.env.CONTEXT_HARVEST_MODEL?.trim()) {
    return process.env.CONTEXT_HARVEST_MODEL.trim();
  }
  if (process.env.ESTATE_HARVEST_MODEL?.trim()) {
    return process.env.ESTATE_HARVEST_MODEL.trim();
  }
  if (process.env.XAI_API_KEY) {
    return process.env.XAI_MODEL?.trim() || 'grok-4.7';
  }
  return (
    process.env.FOUNDRY_HARVEST_DEPLOYMENT?.trim() ||
    process.env.FOUNDRY_CHAT_DEPLOYMENT?.trim() ||
    'grok-4.7'
  );
}

/** USD per 1M tokens (for harvest cost telemetry). */
export function getContextHarvesterTokenPricing(): { inputPerM: number; outputPerM: number } {
  const input = Number(process.env.CONTEXT_HARVEST_PRICE_INPUT_PER_M);
  const output = Number(process.env.CONTEXT_HARVEST_PRICE_OUTPUT_PER_M);
  if (Number.isFinite(input) && Number.isFinite(output)) {
    return { inputPerM: input, outputPerM: output };
  }
  return { inputPerM: 3, outputPerM: 15 };
}

function resolveTokenParam(modelId: string): 'max_tokens' | 'max_completion_tokens' {
  const registered = BOOST_MODELS.find((m) => m.modelId === modelId || m.key === modelId);
  if (registered?.tokenParam) return registered.tokenParam;
  if (modelId.startsWith('grok')) return 'max_tokens';
  return 'max_completion_tokens';
}

export function getContextHarvesterClient(): OpenAI {
  if (process.env.XAI_API_KEY) {
    const base = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
    return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: base });
  }

  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const apiKey = process.env.FOUNDRY_API_KEY;
  if (endpoint && apiKey) {
    const base = endpoint.replace(/\/$/, '');
    return new OpenAI({
      apiKey,
      baseURL: `${base}/openai/v1`,
      defaultHeaders: { 'api-key': apiKey },
    });
  }

  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? getContextHarvesterModelId();
  if (azureEndpoint && azureKey) {
    const base = azureEndpoint.replace(/\/$/, '');
    return new OpenAI({
      apiKey: azureKey,
      baseURL: `${base}/openai/deployments/${deployment}`,
      defaultQuery: {
        'api-version': process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview',
      },
      defaultHeaders: { 'api-key': azureKey },
    });
  }

  throw new Error(
    'Context harvest LLM requires XAI_API_KEY, or FOUNDRY_ENDPOINT + FOUNDRY_API_KEY, or AZURE_OPENAI_*',
  );
}

/**
 * Non-streaming JSON-oriented completion for estate harvest pipelines.
 */
export async function callContextHarvesterLlm(params: {
  system: string;
  messages: HarvesterMessage[];
  maxTokens: number;
  temperature?: number;
}): Promise<HarvesterLlmResult> {
  const client = getContextHarvesterClient();
  const modelId = getContextHarvesterModelId();
  let tokenParam = resolveTokenParam(modelId);

  const openAiMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: params.system },
    ...params.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const createCompletion = (param: 'max_tokens' | 'max_completion_tokens') => {
    const tokenBlock =
      param === 'max_tokens'
        ? { max_tokens: params.maxTokens }
        : { max_completion_tokens: params.maxTokens };
    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: modelId,
      messages: openAiMessages,
      stream: false,
      ...tokenBlock,
    };
    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }
    return client.chat.completions.create(body);
  };

  try {
    const response = await createCompletion(tokenParam);
    return {
      text: response.choices[0]?.message?.content?.trim() ?? '',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      modelId,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('max_tokens') || msg.includes('max_completion_tokens')) {
      tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
      const response = await createCompletion(tokenParam);
      return {
        text: response.choices[0]?.message?.content?.trim() ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        modelId,
      };
    }
    if (msg.includes('temperature') && params.temperature !== undefined) {
      const response = await client.chat.completions.create({
        model: modelId,
        messages: openAiMessages,
        stream: false,
        ...(tokenParam === 'max_tokens'
          ? { max_tokens: params.maxTokens }
          : { max_completion_tokens: params.maxTokens }),
      });
      return {
        text: response.choices[0]?.message?.content?.trim() ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        modelId,
      };
    }
    throw err;
  }
}
