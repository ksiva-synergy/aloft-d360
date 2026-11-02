import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { buildSystemPrompt } from '../prompts';

describe('inspector answer voice', () => {
  it('puts the stakeholder writing rules last in both modes', () => {
    for (const mode of ['harvested', 'warehouse_only'] as const) {
      const prompt = buildSystemPrompt(mode);
      expect(prompt).toContain('HOW TO WRITE THE ANSWER');
      expect(prompt).toContain('Do not add a sources or joins section');
      expect(prompt.indexOf('HOW TO WRITE THE ANSWER')).toBeGreaterThan(prompt.indexOf('RESPONSE FORMAT'));
    }
  });
});
