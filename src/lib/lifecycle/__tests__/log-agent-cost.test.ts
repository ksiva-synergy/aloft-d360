import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { computeCostUsd } from '../log-agent-cost';

describe('computeCostUsd', () => {
  it('charges all input at full price when nothing is cached', () => {
    // claude-sonnet-4: $3 / M in, $15 / M out
    expect(computeCostUsd('claude-sonnet-4', 1_000_000, 100_000)).toBeCloseTo(3 + 1.5, 6);
  });

  it('discounts cache reads and charges the premium for Anthropic cache writes', () => {
    // 1M input = 600k read (10%) + 200k write (125%) + 200k fresh
    const cost = computeCostUsd('us.anthropic.claude-sonnet-4-20250514-v1:0'.replace(/:0$/, ''), 1_000_000, 0, {
      readTokens: 600_000,
      writeTokens: 200_000,
    });
    expect(cost).toBeCloseTo(0.2 * 3 + 0.6 * 3 * 0.1 + 0.2 * 3 * 1.25, 6);
  });

  it('applies the grok cache-read rate', () => {
    // grok-4.3: $3 / M in → 800k cached at 25%, 200k fresh
    expect(computeCostUsd('grok-4.3', 1_000_000, 0, { readTokens: 800_000 })).toBeCloseTo(0.2 * 3 + 0.8 * 3 * 0.25, 6);
  });

  it('never goes negative if cache counts exceed input', () => {
    expect(computeCostUsd('gpt-4o', 100, 0, { readTokens: 500 })).toBeGreaterThanOrEqual(0);
  });
});
