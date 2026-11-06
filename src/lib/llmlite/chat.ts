import 'server-only';

import { getLlmLiteApiKey, getLlmLiteBaseUrl } from './config';
import type { ModelFeatureId } from './model-registry';
import { getCachedModelSettings, loadModelSettings } from './model-settings-store';

export type LlmLiteChatInput = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  feature?: ModelFeatureId;
};

/** Single-shot text completion through the LLM Lite gateway (OpenAI-compatible). */
export async function llmLiteComplete(input: LlmLiteChatInput): Promise<string> {
  return (await llmLiteCompleteWithMeta(input)).text;
}

export async function llmLiteCompleteWithMeta(
  input: LlmLiteChatInput,
): Promise<{ text: string; truncated: boolean }> {
  const base = getLlmLiteBaseUrl();
  const apiKey = getLlmLiteApiKey();
  if (!base || !apiKey) throw new Error('LLM Lite gateway is not configured (LLMLITE_BASE_URL / LLMLITE_API_KEY)');

  const settings = await loadModelSettings().catch(() => getCachedModelSettings());
  const defaultModel = input.feature
    ? (settings.featureModels[input.feature] || settings.defaultGatewayModelId)
    : settings.defaultGatewayModelId;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: input.model ?? defaultModel,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_tokens: input.maxTokens ?? 800,
      temperature: input.temperature ?? 0.3,
    }),
  });
  if (!res.ok) throw new Error(`LLM Lite chat failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const choice = body.choices?.[0];
  return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' };
}
