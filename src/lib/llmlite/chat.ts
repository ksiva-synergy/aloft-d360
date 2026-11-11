import 'server-only';

import { getLlmLiteApiKey, getLlmLiteBaseUrl } from './config';
import { fallbackGatewayModelIds, isRetryableModelHttpFailure } from './model-fallback';
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

  const first = input.model ?? defaultModel;
  const models = [first];
  let lastError = 'LLM Lite chat failed';
  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    let res: Response;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          max_tokens: input.maxTokens ?? 800,
          temperature: input.temperature ?? 0.3,
        }),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'LLM Lite chat failed';
      if (models.length === 1) models.push(...await fallbackGatewayModelIds(model));
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      lastError = `LLM Lite chat failed: ${res.status} ${detail}`;
      if (!isRetryableModelHttpFailure(res.status, detail)) break;
      if (models.length === 1) models.push(...await fallbackGatewayModelIds(model));
      if (i > 0) console.warn(`[model-fallback] ${model} failed (${res.status}); trying the next model`);
      continue;
    }
    if (model !== first) console.warn(`[model-fallback] answered with ${model} after ${first} failed`);
    const body = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const choice = body.choices?.[0];
    return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' };
  }
  throw new Error(lastError);
}
