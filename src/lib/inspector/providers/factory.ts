import { runAgentLoop } from '../agent-loop';
import { runFoundryAgentLoop } from './foundry-chat';
import type { BoostModel } from '../../boost/models';
import type { AgentLoopParams, AgentLoopResult } from '../agent-loop';

export async function dispatchAgentLoop(
  model: BoostModel,
  params: AgentLoopParams,
): Promise<AgentLoopResult> {
  if (model.apiType === 'foundry') {
    return runFoundryAgentLoop({ ...params, model });
  }
  return runAgentLoop(params);
}
