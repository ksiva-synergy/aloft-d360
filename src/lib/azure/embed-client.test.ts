import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { embedBulkWithTitan, TITAN_EMBED_MODEL } from './embed-client';

describe('embedBulkWithTitan', () => {
  let inFlight = 0;
  let maxInFlight = 0;

  beforeEach(() => {
    vi.stubEnv('BEDROCK_API_KEY', 'test-key');
    inFlight = 0;
    maxInFlight = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const { inputText } = JSON.parse(init.body) as { inputText: string };
        if (inputText === 'fail') return new Response('boom', { status: 500 });
        return Response.json({ embedding: [inputText.length] });
      }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns one result per input in order, with null for failed rows', async () => {
    const results = await embedBulkWithTitan(['a', 'fail', 'ccc'], 1024, 2);
    expect(results).toEqual([
      { embedding: [1], modelId: TITAN_EMBED_MODEL },
      null,
      { embedding: [3], modelId: TITAN_EMBED_MODEL },
    ]);
  });

  it('never runs more Titan calls at once than the concurrency limit', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const results = await embedBulkWithTitan(texts, 1024, 3);
    expect(results.every(Boolean)).toBe(true);
    expect(maxInFlight).toBe(3);
  });

  it('handles an empty batch without calling Bedrock', async () => {
    expect(await embedBulkWithTitan([], 1024, 4)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
