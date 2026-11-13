import { describe, expect, it } from 'vitest';
import { buildMeasureOracleQuery } from '@/lib/powerbi/dax-query';
import { hashOracleRows } from '@/lib/powerbi/oracle-result-hash';

describe('oracle DAX helpers', () => {
  it('wraps measure names in brackets', () => {
    expect(buildMeasureOracleQuery('Attained CII YTD')).toBe(
      'EVALUATE ROW("Value", [Attained CII YTD])',
    );
  });

  it('escapes closing brackets in measure names', () => {
    expect(buildMeasureOracleQuery('Rev [USD]')).toBe('EVALUATE ROW("Value", [Rev [USD]]])');
  });

  it('hashes row payloads deterministically', () => {
    const rows = [{ Value: 1 }];
    expect(hashOracleRows(rows)).toBe(hashOracleRows(rows));
    expect(hashOracleRows(rows)).not.toBe(hashOracleRows([{ Value: 2 }]));
  });
});
