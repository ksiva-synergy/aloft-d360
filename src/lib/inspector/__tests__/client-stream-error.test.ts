import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientStreamError } from '../client-stream-error';

describe('clientStreamError', () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: Array<[string, RegExp]> = [
    ['Grok request timed out after 120s. Set XAI_REASONING_EFFORT=low.', /took too long/],
    ['ValidationException: Input is too long for requested model', /too long for the model/],
    ['ThrottlingException: Rate exceeded (429)', /busy right now/],
    ['The response was filtered due to content_filter policy', /declined this request/],
    ['xAI 401: invalid api key sk-abc123', /administrator/],
    ['503 Service Unavailable from https://internal-gateway.example/v1', /temporarily unavailable/],
    ['TypeError: Cannot read properties of undefined (reading "x")', /Something went wrong/],
  ];

  it.each(cases)('maps %s to a safe message without the raw text', (raw, expected) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = clientStreamError(new Error(raw), 'test');
    expect(out).toMatch(expected);
    expect(out).toMatch(/\(ref [0-9a-f]{8}\)$/);
    expect(out).not.toContain(raw);
    expect(out).not.toMatch(/sk-abc123|internal-gateway|XAI_|ValidationException/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[test] stream error ref='), raw);
  });

  it('accepts plain strings and unknown values', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(clientStreamError('Bedrock ECONNRESET', 'test')).toMatch(/temporarily unavailable/);
    expect(clientStreamError({ weird: true }, 'test')).toMatch(/Something went wrong/);
  });
});
