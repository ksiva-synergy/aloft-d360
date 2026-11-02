import { DEFAULT_LLM_LITE_GATEWAY_MODEL_ID } from '@/lib/llmlite/default-model';
import { toLlmLiteModelKey } from '@/lib/llmlite/keys';

/**
 * Default Inspector / Explore Data LLM key (client + server should agree).
 * Always an LLM Lite gateway model: Grok 4.7.
 */
export const DEFAULT_INSPECTOR_MODEL_KEY = toLlmLiteModelKey(DEFAULT_LLM_LITE_GATEWAY_MODEL_ID);
