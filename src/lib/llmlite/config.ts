import 'server-only';

/** OpenAI-compatible Synergy LLM Lite gateway (LiteLLM proxy). */
export function getLlmLiteBaseUrl(): string | null {
  const raw =
    process.env.LLMLITE_BASE_URL?.trim() ||
    process.env.llmlite_base_url?.trim() ||
    '';
  return raw ? raw.replace(/\/$/, '') : null;
}

export function getLlmLiteApiKey(): string | null {
  const raw =
    process.env.LLMLITE_API_KEY?.trim() ||
    process.env.llmlite_api_key?.trim() ||
    '';
  return raw || null;
}

export function isLlmLiteConfigured(): boolean {
  return !!(getLlmLiteBaseUrl() && getLlmLiteApiKey());
}
