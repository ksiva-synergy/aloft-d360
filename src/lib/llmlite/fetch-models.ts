import 'server-only';

import { getLlmLiteApiKey, getLlmLiteBaseUrl, isLlmLiteConfigured } from './config';
import { labelForGatewayModelId } from './labels';
import { toLlmLiteModelKey } from './keys';
import { loadModelSettings } from './model-settings-store';

// Gateway catalog inspection & live model listing
export type LlmLiteGatewayModel = {
  id: string;
  mode?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
};

export interface LlmLiteCatalogEntry {
  id: string;
  key: string;
  label: string;
  mode: string;
  upstreamProvider: string;
  isRouterAlias: boolean;
  isChatCapable: boolean;
  keyAllowed: boolean;
  adminEnabled: boolean;
  selectableInPicker: boolean;
  filterReason: string | null;
}

const ROUTER_ALIASES = new Set(['quick', 'balanced', 'default', 'azure_ai/model-router', 'model-router']);

export function isRouterModelId(id: string): boolean {
  if (ROUTER_ALIASES.has(id)) return true;
  const lower = id.toLowerCase();
  const tail = lower.includes('/') ? lower.split('/').pop()! : lower;
  return tail === 'model-router' || tail.endsWith('/model-router');
}

function isChatGatewayModel(m: LlmLiteGatewayModel): boolean {
  if (isRouterModelId(m.id)) return false;
  if (m.mode === 'embedding' || m.mode === 'ocr') return false;
  return m.mode === 'chat' || !m.mode;
}

function upstreamProviderOf(id: string): string {
  if (id.startsWith('aws_bedrock/')) return 'AWS Bedrock (via LLM Lite)';
  if (id.startsWith('azure_ai/')) return 'Azure AI Foundry (via LLM Lite)';
  if (id.includes('/')) return id.split('/')[0];
  return 'Gateway Alias';
}

/**
 * Queries the gateway for the models this virtual key is actually allowed to call.
 * LiteLLM's `GET /v1/models` returns all gateway deployments even when the key is
 * scoped to a subset (`key_model_access_denied` on unauthorized models). Sending a
 * zero-token probe with an unknown model id returns the exact allowed-models list
 * without invoking any upstream LLM.
 */
export async function fetchKeyAllowedModelIds(base: string, apiKey: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: '__aloft_key_scope_probe__', messages: [] }),
      cache: 'no-store',
    });
    if (res.ok) return null;
    const text = await res.text().catch(() => '');
    const match = text.match(/models=\[([^\]]+)\]/);
    if (!match) return null;
    const allowed = new Set<string>();
    for (const part of match[1].split(',')) {
      const cleaned = part.trim().replace(/^['"]|['"]$/g, '');
      if (cleaned) allowed.add(cleaned);
    }
    return allowed.size > 0 ? allowed : null;
  } catch {
    return null;
  }
}

/**
 * Full diagnostic catalog of everything returned by `GET /v1/models`, annotated with
 * router status, key scope permissions, and admin enable/disable status.
 */
export async function inspectLlmLiteGatewayCatalog(): Promise<{
  configured: boolean;
  baseUrl: string | null;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
  entries: LlmLiteCatalogEntry[];
}> {
  const base = getLlmLiteBaseUrl();
  const apiKey = getLlmLiteApiKey();
  if (!base || !apiKey) {
    return {
      configured: false,
      baseUrl: base,
      reachable: false,
      latencyMs: null,
      error: 'LLMLITE_BASE_URL or LLMLITE_API_KEY is not set in environment.',
      entries: [],
    };
  }

  const started = Date.now();
  try {
    const [res, allowedIds, settings] = await Promise.all([
      fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      }),
      fetchKeyAllowedModelIds(base, apiKey),
      loadModelSettings(),
    ]);
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        configured: true,
        baseUrl: base,
        reachable: false,
        latencyMs,
        error: `Gateway returned HTTP ${res.status}: ${errText.slice(0, 180)}`,
        entries: [],
      };
    }

    const body = (await res.json()) as { data?: LlmLiteGatewayModel[] };
    const disabledSet = new Set(settings.disabledGatewayModelIds);
    const rawList = body.data ?? [];

    const entries: LlmLiteCatalogEntry[] = rawList.map((m) => {
      const router = isRouterModelId(m.id);
      const chatCapable = isChatGatewayModel(m);
      const keyAllowed = !allowedIds || allowedIds.has(m.id);
      const adminEnabled = !disabledSet.has(m.id);
      const selectable = chatCapable && keyAllowed && adminEnabled;

      let filterReason: string | null = null;
      if (router) filterReason = 'Router alias (hidden)';
      else if (m.mode === 'embedding' || m.mode === 'ocr') filterReason = `Non-chat mode (${m.mode})`;
      else if (!keyAllowed) filterReason = 'Virtual key access denied (403)';
      else if (!adminEnabled) filterReason = 'Disabled by admin';

      return {
        id: m.id,
        key: toLlmLiteModelKey(m.id),
        label: labelForGatewayModelId(m.id),
        mode: m.mode ?? 'chat',
        upstreamProvider: upstreamProviderOf(m.id),
        isRouterAlias: router,
        isChatCapable: chatCapable,
        keyAllowed,
        adminEnabled,
        selectableInPicker: selectable,
        filterReason,
      };
    });

    return {
      configured: true,
      baseUrl: base,
      reachable: true,
      latencyMs,
      error: null,
      entries,
    };
  } catch (err) {
    return {
      configured: true,
      baseUrl: base,
      reachable: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'Gateway request failed',
      entries: [],
    };
  }
}

/** Live list from the LLM Lite gateway (`GET /v1/models`). Excludes router aliases, non-chat models, key-restricted models, and admin-disabled models. */
export async function fetchLlmLiteGatewayModels(): Promise<LlmLiteGatewayModel[]> {
  if (!isLlmLiteConfigured()) return [];

  const base = getLlmLiteBaseUrl()!;
  const apiKey = getLlmLiteApiKey()!;

  const [res, allowedIds, settings] = await Promise.all([
    fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    }),
    fetchKeyAllowedModelIds(base, apiKey),
    loadModelSettings(),
  ]);

  if (!res.ok) {
    console.warn('[llmlite] /v1/models failed:', res.status, await res.text().catch(() => ''));
    return [];
  }

  const disabledSet = new Set(settings.disabledGatewayModelIds);
  const body = (await res.json()) as { data?: LlmLiteGatewayModel[] };
  return (body.data ?? []).filter(
    (m) => isChatGatewayModel(m) && (!allowedIds || allowedIds.has(m.id)) && !disabledSet.has(m.id),
  );
}
