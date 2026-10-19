import 'server-only';

import type { ModelOption } from '@/components/agent-lab/workbench/types';
import type { BoostModel } from '@/lib/boost/models';
import { fetchLlmLiteGatewayModels } from './fetch-models';
import { labelForGatewayModelId } from './labels';
import { toLlmLiteModelKey } from './keys';

function tokenParamForGatewayId(id: string): 'max_tokens' | 'max_completion_tokens' {
  const lower = id.toLowerCase();
  if (lower.includes('gpt') || lower.includes('o3')) return 'max_completion_tokens';
  return 'max_tokens';
}

export function gatewayModelToOption(m: { id: string }): ModelOption {
  return {
    key: toLlmLiteModelKey(m.id),
    label: labelForGatewayModelId(m.id),
    provider: 'llmlite',
    bedrockId: m.id,
    supportsTools: true,
    supportsThinking: m.id.toLowerCase().includes('o3'),
    description: `Synergy LLM Lite gateway · ${m.id}`,
  };
}

export function boostModelFromLlmLiteKey(key: string, gatewayModelId: string): BoostModel {
  return {
    key,
    label: labelForGatewayModelId(gatewayModelId),
    provider: 'foundry',
    apiType: 'foundry',
    modelId: gatewayModelId,
    resource: 'llmlite',
    tokenParam: tokenParamForGatewayId(gatewayModelId),
    tier: 'production',
  };
}

export function llmLiteInspectorRuntimeConfig(gatewayModelId: string) {
  return {
    bedrockId: '',
    foundryDeployment: gatewayModelId,
    supportsTools: true,
    supportsThinking: gatewayModelId.toLowerCase().includes('o3'),
  };
}

export async function fetchLlmLiteInspectorModelOptions(): Promise<ModelOption[]> {
  const gateway = await fetchLlmLiteGatewayModels();
  return gateway.map(gatewayModelToOption);
}
