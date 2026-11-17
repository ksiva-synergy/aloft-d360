import { DEFAULT_LLM_LITE_GATEWAY_MODEL_ID } from './default-model';
import { fetchLlmLiteGatewayModels } from './fetch-models';
import {
  MODEL_FALLBACK_LIMIT,
  orderFallbackModelIds,
} from './model-fallback-rules';
import { getCachedModelSettings } from './model-settings-store';

export {
  MODEL_FALLBACK_LIMIT,
  isRetryableModelHttpFailure,
  isSlowModelFailure,
  modelFailureCanFallback,
  orderFallbackModelIds,
} from './model-fallback-rules';

/** Chat models to try after `primaryId`, preferred default first. Empty when nothing else is available. */
export async function fallbackGatewayModelIds(primaryId: string): Promise<string[]> {
  const settings = getCachedModelSettings();
  const preferred = settings.defaultGatewayModelId || DEFAULT_LLM_LITE_GATEWAY_MODEL_ID;
  let available: string[] = [];
  try {
    available = (await fetchLlmLiteGatewayModels()).map((model) => model.id);
  } catch (err) {
    console.warn('[model-fallback] could not list gateway models', err);
  }
  return orderFallbackModelIds(primaryId, available, preferred).slice(0, MODEL_FALLBACK_LIMIT);
}
