import { BOOST_MODELS, type BoostModel } from '@/lib/boost/models';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import { chatModelKeyForRole, isPlatformAdminRole } from '@/lib/inspector/model-access';
import { fromLlmLiteModelKey, toLlmLiteModelKey } from '@/lib/llmlite/keys';
import { DEFAULT_LLM_LITE_GATEWAY_MODEL_ID } from '@/lib/llmlite/default-model';
import { boostModelFromLlmLiteKey, gatewayModelToOption } from '@/lib/llmlite/inspector-models';
import type { ModelFeatureId } from '@/lib/llmlite/model-registry';
import { getCachedModelSettings } from '@/lib/llmlite/model-settings-store';

/** Model resolution shared by the workbench chat and test-run routes. LLM Lite gateway only. */
export const DEFAULT_WORKBENCH_MODEL = DEFAULT_INSPECTOR_MODEL_KEY;

export function resolveBoostModel(modelKey: string): BoostModel | null {
  const gatewayId = fromLlmLiteModelKey(modelKey);
  if (gatewayId) return boostModelFromLlmLiteKey(modelKey, gatewayId);
  let boost = BOOST_MODELS.find((m) => m.key === modelKey);
  if (!boost) return null;
  if (boost.key === 'grok-xai' && process.env.XAI_MODEL) {
    boost = { ...boost, modelId: process.env.XAI_MODEL };
  }
  return boost;
}

export function resolveWorkbenchModel(
  requestedKey: string | undefined,
  role?: string | null,
  feature: ModelFeatureId = 'workbench_chat',
) {
  const settings = getCachedModelSettings();
  const featureDefaultId =
    settings.featureModels[feature] ||
    settings.defaultGatewayModelId ||
    DEFAULT_LLM_LITE_GATEWAY_MODEL_ID;
  const featureDefaultKey = toLlmLiteModelKey(featureDefaultId);

  const candidateKey = isPlatformAdminRole(role, settings.roleAccess)
    ? (requestedKey ?? featureDefaultKey)
    : chatModelKeyForRole(requestedKey, role, settings.roleAccess, featureDefaultKey);

  const gatewayId = fromLlmLiteModelKey(candidateKey) ?? featureDefaultId;
  const modelKey = fromLlmLiteModelKey(candidateKey) ? candidateKey : featureDefaultKey;
  const option = gatewayModelToOption({ id: gatewayId });
  const boostModel = boostModelFromLlmLiteKey(modelKey, gatewayId);
  return {
    modelKey,
    option,
    boostModel,
    bedrockModelId: '',
    effectiveModelId: gatewayId,
  };
}
