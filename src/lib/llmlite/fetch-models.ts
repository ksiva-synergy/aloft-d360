import 'server-only';

import { getLlmLiteApiKey, getLlmLiteBaseUrl, isLlmLiteConfigured } from './config';

export type LlmLiteGatewayModel = {
  id: string;
  mode?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
};

const ROUTER_ALIASES = new Set(['quick', 'balanced', 'default']);

function isChatGatewayModel(m: LlmLiteGatewayModel): boolean {
  if (ROUTER_ALIASES.has(m.id)) return false;
  if (m.mode === 'embedding' || m.mode === 'ocr') return false;
  return m.mode === 'chat' || !m.mode;
}

/** Live list from the LLM Lite gateway (`GET /v1/models`). Not cached — new gateway models show on the next picker refresh. */
export async function fetchLlmLiteGatewayModels(): Promise<LlmLiteGatewayModel[]> {
  if (!isLlmLiteConfigured()) return [];

  const base = getLlmLiteBaseUrl()!;
  const apiKey = getLlmLiteApiKey()!;

  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    console.warn('[llmlite] /v1/models failed:', res.status, await res.text().catch(() => ''));
    return [];
  }

  const body = (await res.json()) as { data?: LlmLiteGatewayModel[] };
  return (body.data ?? []).filter(isChatGatewayModel);
}
