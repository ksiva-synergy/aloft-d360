import { runAgentLoop } from '../agent-loop';
import { runFoundryAgentLoop } from './foundry-chat';
import type { BoostModel } from '../../boost/models';
import type { AgentLoopParams, AgentLoopResult } from '../agent-loop';
import { boostModelFromLlmLiteKey } from '@/lib/llmlite/inspector-models';
import { toLlmLiteModelKey } from '@/lib/llmlite/keys';
import {
  fallbackGatewayModelIds,
  isSlowModelFailure,
  modelFailureCanFallback,
} from '@/lib/llmlite/model-fallback';

async function runOnce(model: BoostModel | null, params: AgentLoopParams): Promise<AgentLoopResult> {
  const modelId = model?.modelId || params.modelId;
  const result = model?.apiType === 'foundry'
    ? await runFoundryAgentLoop({ ...params, model })
    : await runAgentLoop({ ...params, modelId });
  return { ...result, servedModelId: modelId };
}

/**
 * Run a chat turn. When the chosen model fails before it writes anything, try the other
 * gateway models so the reply still arrives. Pass `{ fallback: false }` for a scored run
 * that must stay on one model.
 */
export async function dispatchAgentLoop(
  model: BoostModel | null,
  params: AgentLoopParams,
  options?: { fallback?: boolean },
): Promise<AgentLoopResult> {
  let result = await runOnce(model, params);
  if (options?.fallback === false || !modelFailureCanFallback(result)) return result;

  const primaryId = model?.modelId || params.modelId;
  const alternatives = await fallbackGatewayModelIds(primaryId);
  let slowFailures = isSlowModelFailure(result.errorDetail) ? 1 : 0;
  for (const id of alternatives) {
    if (slowFailures >= 2) break;
    console.warn(`[model-fallback] ${primaryId} failed (${result.errorDetail ?? 'no detail'}); trying ${id}`);
    params.onModelSwitch?.(id);
    const next = boostModelFromLlmLiteKey(toLlmLiteModelKey(id), id);
    result = await runOnce(next, { ...params, modelId: id });
    if (!modelFailureCanFallback(result)) return result;
    if (isSlowModelFailure(result.errorDetail)) slowFailures += 1;
  }
  return result;
}
