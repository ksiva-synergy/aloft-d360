import { describe, expect, it } from 'vitest';
import { validateNarrativeAgainstFacts } from '@/lib/inspector/session-knowledge-core';
import type { InspectorSessionKnowledge } from '@/lib/inspector/session-knowledge-core';

const base: InspectorSessionKnowledge = {
  version: 1,
  updatedAt: new Date().toISOString(),
  schemaPaths: ['landing_zone.db_spv2_somi_dbo.admvessel'],
  entities: [],
  heuristics: [],
};

describe('validateNarrativeAgainstFacts', () => {
  it('accepts narrative with no qualified paths', () => {
    expect(validateNarrativeAgainstFacts('Vessels 60 and 78 are confirmed.', base)).toBe(true);
  });

  it('accepts narrative citing allowed paths', () => {
    const text = 'Use landing_zone.db_spv2_somi_dbo.admvessel for vessel lookup.';
    expect(validateNarrativeAgainstFacts(text, base)).toBe(true);
  });

  it('rejects narrative citing unknown paths', () => {
    const text = 'Data lives in curated_db.fake_schema.secret_table.';
    expect(validateNarrativeAgainstFacts(text, base)).toBe(false);
  });
});
