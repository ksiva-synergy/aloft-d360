import { describe, expect, it } from 'vitest';
import { DEFAULT_PBI_DOMAINS } from '@/lib/powerbi/domain-registry';
import {
  detectMeasureNameConflicts,
  pickPrimaryDomain,
  scoreModelDomains,
} from '@/lib/powerbi/domain-score';

describe('domain scoring', () => {
  it('assigns qhse for CII-heavy model', () => {
    const scores = scoreModelDomains({
      domains: DEFAULT_PBI_DOMAINS,
      modelName: 'CII SDK-2025',
      workspaceName: 'QHSE Reports',
      workspaceDomainHint: null,
      measureNames: ['Attained_CII YTD', 'Fuel'],
      measureFolders: ['CII Measures'],
      catalogDomainKeywords: ['vessel', 'emission'],
    });
    const primary = pickPrimaryDomain(scores);
    expect(primary?.domain_key).toBe('qhse');
    expect((primary?.confidence ?? 0) > 0).toBe(true);
  });

  it('detects measure name conflicts across models', () => {
    const conflicts = detectMeasureNameConflicts([
      { model_id: 'm1', domain_key: 'qhse', measure_name: 'Revenue', dax_hash: 'a' },
      { model_id: 'm2', domain_key: 'finance', measure_name: 'Revenue', dax_hash: 'b' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].metric_name).toBe('Revenue');
  });
});
