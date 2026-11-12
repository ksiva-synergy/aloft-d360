import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { gatewayCacheParams } from '../providers/foundry-chat';
import type { BoostModel } from '@/lib/boost/models';

const m = (modelId: string, resource = 'llmlite') => ({ key: 'k', modelId, resource, apiType: 'foundry' }) as unknown as BoostModel;

describe('gatewayCacheParams', () => {
  it('Claude via gateway + cacheConversation: system + moving last-message markers', () => {
    expect(gatewayCacheParams(m('aws_bedrock/Claude-Sonnet-5'), { cacheConversation: true })).toEqual({
      cache_control_injection_points: [{ location: 'message', role: 'system' }, { location: 'message', index: -1 }],
    });
  });
  it('cacheSystemPrompt alone marks only the system message', () => {
    expect(gatewayCacheParams(m('aws_bedrock/Claude-Haiku-4.5'), { cacheSystemPrompt: true })).toEqual({
      cache_control_injection_points: [{ location: 'message', role: 'system' }],
    });
  });
  it('sends nothing when not opted in, for non-Claude models, or for other resources', () => {
    expect(gatewayCacheParams(m('aws_bedrock/Claude-Sonnet-5'), {})).toEqual({});
    expect(gatewayCacheParams(m('aws_bedrock/xAI-Grok-4.7'), { cacheConversation: true })).toEqual({});
    expect(gatewayCacheParams(m('azure_ai/gpt-5.6-luna'), { cacheConversation: true })).toEqual({});
    expect(gatewayCacheParams(m('claude-x', 'resource2'), { cacheConversation: true })).toEqual({});
  });
});
