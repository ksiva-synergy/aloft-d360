import { describe, expect, it } from 'vitest';
import {
  buildAltPhrasings,
  buildVerifiedQueryQuestion,
  humanizeMeasureName,
} from '@/lib/powerbi/publish-question';

describe('publish question', () => {
  it('humanizes PascalCase measure names', () => {
    expect(humanizeMeasureName('TotalCII')).toBe('Total CII');
  });

  it('builds a model-qualified question', () => {
    expect(buildVerifiedQueryQuestion('TotalCII', 'CII Report 2024')).toMatch(
      /CII Report 2024/,
    );
  });

  it('caps alt phrasings', () => {
    const alts = buildAltPhrasings('TotalCII', 'CII Report 2024');
    expect(alts.length).toBeLessThanOrEqual(7);
    expect(alts).toContain('TotalCII');
  });
});
