import { describe, expect, it } from 'vitest';

import { policyErrorText, policyValue } from '@/lib/powerbi/investigator-policy';
import { matchPlaybooks } from '@/lib/powerbi/playbooks';

describe('playbooks', () => {
  it('match on root cause, detectors, error text and the first differing probe', () => {
    expect(matchPlaybooks({ rootCause: 'replica_drift' })[0]!.id).toBe('replica-drift');
    expect(matchPlaybooks({ errorText: '[INTERNAL_ERROR] The Spark SQL phase optimization failed' })[0]!.id).toBe(
      'spark-correlation',
    );
    expect(matchPlaybooks({ firstDifference: 'row_count', rootCause: 'data_freshness' })[0]!.id).toBe('stale-dataset');
    expect(matchPlaybooks({ firstDifference: 'distinct_values' }).map((p) => p.id)).toContain('blank-row');
    expect(matchPlaybooks({ rootCause: 'parity_mismatch' })).toEqual([]); // unknown → the investigator works it out
  });
});

describe('LLM data policy: metadata plus aggregates, never rows', () => {
  it('passes numbers, numeric text, dates and booleans', () => {
    expect(policyValue(5537)).toBe(5537);
    expect(policyValue('8684893.4519')).toBe(8684893.4519);
    expect(policyValue('2026-11-12T00:07:18Z')).toBe('2026-11-12T00:07:18Z');
    expect(policyValue(true)).toBe(true);
    expect(policyValue(12n)).toBe(12);
  });

  it('withholds text values that come from data', () => {
    expect(policyValue('NORD KARAS')).toMatch(/withheld/);
    expect(policyValue({ a: 1 })).toMatch(/withheld/);
  });

  it('masks quoted text literals in error messages but keeps numbers', () => {
    expect(policyErrorText(`The value 'ACME LTD' of the type "STRING" cannot be cast to "DOUBLE"`)).toBe(
      `The value '…' of the type "STRING" cannot be cast to "DOUBLE"`,
    );
    expect(policyErrorText(`limit '100' exceeded`)).toBe(`limit '100' exceeded`);
  });
});
