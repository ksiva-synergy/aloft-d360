import 'server-only';

import OpenAI from 'openai';
import { BOOST_MODELS } from '@/lib/boost/models';

/** Prefer Foundry (same path as embeddings / session summary); avoids broken Bedrock IAM (F-001). */
const DEFAULT_SCORER_MODEL =
  process.env.BOOST_SCORER_MODEL ?? process.env.INSPECTOR_SESSION_SUMMARY_MODEL ?? 'gpt-6-luna';

export function getScorerModelId(): string {
  return DEFAULT_SCORER_MODEL;
}

function resolveTokenParam(modelId: string): 'max_tokens' | 'max_completion_tokens' {
  const registered = BOOST_MODELS.find((m) => m.modelId === modelId || m.key === modelId);
  return registered?.tokenParam ?? 'max_completion_tokens';
}

export function getScorerClient(): OpenAI | null {
  const foundryEndpoint = process.env.FOUNDRY_ENDPOINT;
  const foundryKey = process.env.FOUNDRY_API_KEY;
  if (foundryEndpoint && foundryKey) {
    const base = foundryEndpoint.replace(/\/$/, '');
    return new OpenAI({
      apiKey: foundryKey,
      baseURL: `${base}/openai/v1`,
      defaultHeaders: { 'api-key': foundryKey },
    });
  }

  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment =
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? process.env.BOOST_SCORER_MODEL ?? 'gpt-5.4-PBC';
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

  return null;
}

/**
 * Non-streaming judge call via Foundry / Azure OpenAI.
 * Omits temperature (gpt-6-luna / GPT-5 family reject non-default values).
 */
export async function callScorerLlm(params: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const client = getScorerClient();
  if (!client) {
    throw new Error(
      'Boost scorers require FOUNDRY_ENDPOINT + FOUNDRY_API_KEY (or AZURE_OPENAI_*)',
    );
  }

  const model = getScorerModelId();
  let tokenParam = resolveTokenParam(model);
  const messages = [
    { role: 'system' as const, content: params.system },
    { role: 'user' as const, content: params.user },
  ];

  const createCompletion = (param: 'max_tokens' | 'max_completion_tokens') =>
    client.chat.completions.create({
      model,
      messages,
      stream: false,
      ...(param === 'max_tokens'
        ? { max_tokens: params.maxTokens }
        : { max_completion_tokens: params.maxTokens }),
    });

  try {
    const response = await createCompletion(tokenParam);
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('max_tokens') || msg.includes('max_completion_tokens')) {
      tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
      const response = await createCompletion(tokenParam);
      return response.choices[0]?.message?.content?.trim() ?? '';
    }
    throw err;
  }
}
