import { describe, expect, it } from 'vitest';
import {
  isRetryableModelHttpFailure,
  isSlowModelFailure,
  modelFailureCanFallback,
  orderFallbackModelIds,
} from '../model-fallback-rules';

describe('model fallback order', () => {
  it('tries the configured default first, then the other models, and skips the one that failed', () => {
    expect(orderFallbackModelIds(
      'aws_bedrock/xAI-Grok-4.7',
      ['aws_bedrock/Claude', 'aws_bedrock/xAI-Grok-4.7', 'azure_ai/gpt'],
      'azure_ai/gpt',
    )).toEqual(['azure_ai/gpt', 'aws_bedrock/Claude']);
  });

  it('offers only the default when the catalog could not be loaded', () => {
    expect(orderFallbackModelIds('aws_bedrock/missing', [], 'azure_ai/gpt')).toEqual(['azure_ai/gpt']);
  });
});

describe('when a failed turn may switch models', () => {
  it('switches only when the model produced no text and no tool calls', () => {
    expect(modelFailureCanFallback({ outcome: 'errored', finalText: '', toolCalls: [], errorDetail: '404 model not found' })).toBe(true);
    expect(modelFailureCanFallback({ outcome: 'errored', finalText: 'partial', toolCalls: [] })).toBe(false);
    expect(modelFailureCanFallback({ outcome: 'errored', finalText: '', toolCalls: [{}] })).toBe(false);
    expect(modelFailureCanFallback({ outcome: 'completed', finalText: 'ok', toolCalls: [] })).toBe(false);
  });

  it('treats a missing or refused model as retryable, and a bad key as not', () => {
    expect(isRetryableModelHttpFailure(404, 'model not found')).toBe(true);
    expect(isRetryableModelHttpFailure(400, 'invalid model id')).toBe(true);
    expect(isRetryableModelHttpFailure(400, 'messages is required')).toBe(false);
    expect(isRetryableModelHttpFailure(401, 'invalid api key')).toBe(false);
    expect(isSlowModelFailure('request timed out after 180s')).toBe(true);
  });
});
