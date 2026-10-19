import 'server-only';

import { getLlmLiteApiKey, getLlmLiteBaseUrl, isLlmLiteConfigured } from './config';

export type LlmLiteGatewayModel = {
  id: string;
  mode?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
};

const ROUTER_ALIASES = new Set(['quick', 'balanced', 'default']);

let cachedModels: LlmLiteGatewayModel[] | null = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

function isChatGatewayModel(m: LlmLiteGatewayModel): boolean {
  if (ROUTER_ALIASES.has(m.id)) return false;
  if (m.mode === 'embedding' || m.mode === 'ocr') return false;
  return m.mode === 'chat' || !m.mode;
}

export async function fetchLlmLiteGatewayModels(): Promise<LlmLiteGatewayModel[]> {
  if (!isLlmLiteConfigured()) return [];

  const now = Date.now();
  if (cachedModels && now - cachedAt < CACHE_MS) {
    return cachedModels;
  }

  const base = getLlmLiteBaseUrl()!;
  const apiKey = getLlmLiteApiKey()!;

  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    console.warn('[llmlite] /v1/models failed:', res.status, await res.text().catch(() => ''));
    return cachedModels ?? [];
  }

  const body = (await res.json()) as { data?: LlmLiteGatewayModel[] };
  const chat = (body.data ?? []).filter(isChatGatewayModel);
  cachedModels = chat;
  cachedAt = now;
  return chat;
}
