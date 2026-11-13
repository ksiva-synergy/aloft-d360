import { describe, expect, it } from 'vitest';
import {
  decideParityVerdict,
  extractOracleScalar,
  scalarsWithinTolerance,
} from '@/lib/powerbi/parity-compare';

describe('parity compare', () => {
  it('reads oracle preview Value column', () => {
    expect(extractOracleScalar([{ Value: 100 }])).toBe(100);
  });

  it('passes within 1% relative tolerance', () => {
    expect(scalarsWithinTolerance(100, 100.5)).toBe(true);
    expect(scalarsWithinTolerance(100, 102)).toBe(false);
  });

  it('decides pass when values align', () => {
    const d = decideParityVerdict({ oracleValue: 10, sqlValue: 10.02 });
    expect(d.verdict).toBe('pass');
  });
});
