import { describe, expect, it } from 'vitest';
import {
  clusterModelFamilies,
  normalizeModelFamilyKey,
  pickCanonicalMemberId,
} from '@/lib/powerbi/family-cluster';

describe('family clustering', () => {
  it('normalizes year-variant CII model names to one key', () => {
    expect(normalizeModelFamilyKey('CII SDK-2024')).toBe(normalizeModelFamilyKey('CII SDK-2025'));
  });

  it('clusters year siblings in the same workspace', () => {
    const clusters = clusterModelFamilies([
      {
        model_id: 'a',
        name: 'CII SDK-2024',
        pbi_model_id: 'p1',
        workspace_id: 'ws1',
        measure_count: 10,
      },
      {
        model_id: 'b',
        name: 'CII SDK-2025',
        pbi_model_id: 'p2',
        workspace_id: 'ws1',
        measure_count: 12,
      },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].varying_parameter).toBe('year');
    expect(clusters[0].members).toHaveLength(2);
  });

  it('picks canonical by measure count', () => {
    const id = pickCanonicalMemberId([
      {
        model_id: 'a',
        name: 'M 2024',
        pbi_model_id: 'p1',
        workspace_id: 'ws',
        measure_count: 5,
      },
      {
        model_id: 'b',
        name: 'M 2025',
        pbi_model_id: 'p2',
        workspace_id: 'ws',
        measure_count: 20,
      },
    ]);
    expect(id).toBe('b');
  });
});
