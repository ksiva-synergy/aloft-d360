import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';
import { fetchLlmLiteInspectorModelOptions, gatewayModelToOption } from '@/lib/llmlite/inspector-models';
import { isLlmLiteConfigured } from '@/lib/llmlite/config';
import { toLlmLiteModelKey } from '@/lib/llmlite/keys';
import { loadModelSettings } from '@/lib/llmlite/model-settings-store';
import { filterChatModelsForRole } from '@/lib/inspector/model-access';
import { getSessionUserRole } from '@/lib/inspector/session-role';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET() {
  const [role, settings] = await Promise.all([
    getSessionUserRole(),
    loadModelSettings(),
  ]);
  const rolePolicy = role ? settings.roleAccess.rolePolicies?.[role] : undefined;
  const effectiveDefaultGatewayId =
    rolePolicy?.defaultModelId || settings.defaultGatewayModelId;
  const defaultModelKey = toLlmLiteModelKey(effectiveDefaultGatewayId);
  const configuredDefaultOption = gatewayModelToOption({ id: effectiveDefaultGatewayId });
  const baseSource = [
    configuredDefaultOption,
    ...AVAILABLE_MODELS.filter((m) => m.key !== configuredDefaultOption.key),
  ];
  const base = filterChatModelsForRole(baseSource, role, settings.roleAccess, defaultModelKey);
  if (!isLlmLiteConfigured()) {
    return NextResponse.json(
      { models: base, defaultModelKey, llmLiteEnabled: false },
      { headers: NO_STORE },
    );
  }

  try {
    const gateway = await fetchLlmLiteInspectorModelOptions();
    const gatewayKeys = new Set(gateway.map((g) => g.key));
    const merged = filterChatModelsForRole(
      [...base.filter((b) => !gatewayKeys.has(b.key)), ...gateway],
      role,
      settings.roleAccess,
      defaultModelKey,
    );
    return NextResponse.json(
      {
        models: merged,
        defaultModelKey,
        llmLiteEnabled: true,
        llmLiteCount: gateway.length,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.warn('[chat-models] LLM Lite fetch failed:', err);
    return NextResponse.json(
      { models: base, defaultModelKey, llmLiteEnabled: false, llmLiteError: true },
      { headers: NO_STORE },
    );
  }
}
