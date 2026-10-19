import { hasXaiCredentials } from '@/lib/inspector/llm-configured';
import { BOOST_MODELS, type BoostModel } from '@/lib/boost/models';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';

/** Model resolution shared by the workbench chat and test-run routes. */
export const DEFAULT_WORKBENCH_MODEL = hasXaiCredentials() ? DEFAULT_INSPECTOR_MODEL_KEY : 'sonnet-5-5';

const FOUNDRY_MODEL_KEYS = new Set(
  BOOST_MODELS.filter((m) => m.apiType === 'foundry').map((m) => m.key),
);

export function resolveBoostModel(modelKey: string): BoostModel | null {
  let boost = BOOST_MODELS.find((m) => m.key === modelKey);
  if (!boost) return null;
  if (boost.key === 'grok-xai' && process.env.XAI_MODEL) {
    boost = { ...boost, modelId: process.env.XAI_MODEL };
  }
  return boost;
}

function resolveBedrockModelId(modelKey: string): string {
  const m = AVAILABLE_MODELS.find((x) => x.key === modelKey);
  if (m?.bedrockId && !FOUNDRY_MODEL_KEYS.has(modelKey)) return m.bedrockId;
  const fallback = AVAILABLE_MODELS.find((x) => x.key === 'sonnet-5-5');
  return fallback?.bedrockId ?? 'us.anthropic.claude-sonnet-5-5';
}

export function resolveWorkbenchModel(requestedKey: string | undefined) {
  const modelKey = requestedKey ?? DEFAULT_WORKBENCH_MODEL;
  const option = AVAILABLE_MODELS.find((m) => m.key === modelKey)
    ?? AVAILABLE_MODELS.find((m) => m.key === DEFAULT_WORKBENCH_MODEL);
  if (!option) return null;
  const boostModel = FOUNDRY_MODEL_KEYS.has(modelKey) ? resolveBoostModel(modelKey) : null;
  const bedrockModelId = resolveBedrockModelId(modelKey);
  return {
    modelKey,
    option,
    boostModel,
    bedrockModelId,
    effectiveModelId: boostModel?.modelId ?? bedrockModelId,
  };
}
