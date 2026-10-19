export const LLM_LITE_KEY_PREFIX = 'llm-lite:';

/** Stable Inspector picker key for a gateway model id (may contain `/`). */
export function toLlmLiteModelKey(gatewayModelId: string): string {
  return `${LLM_LITE_KEY_PREFIX}${gatewayModelId.replace(/\//g, '--')}`;
}

export function fromLlmLiteModelKey(key: string): string | null {
  if (!key.startsWith(LLM_LITE_KEY_PREFIX)) return null;
  return key.slice(LLM_LITE_KEY_PREFIX.length).replace(/--/g, '/');
}

export function isLlmLiteModelKey(key: string): boolean {
  return key.startsWith(LLM_LITE_KEY_PREFIX);
}
