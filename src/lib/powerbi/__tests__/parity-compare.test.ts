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

describe('decideTypedParity', () => {
  const v = (raw: unknown) => ({ present: true, raw });
  it('matches BLANK, dates, text and decorated numbers', async () => {
    const { decideTypedParity } = await import('@/lib/powerbi/parity-compare');
    expect(decideTypedParity({ oracle: v(null), sql: v(null) }).verdict).toBe('pass');
    expect(decideTypedParity({ oracle: v(null), sql: v(3) }).verdict).toBe('fail');
    expect(
      decideTypedParity({ oracle: v('2026-11-29T13:00:00'), sql: v('2026-11-29 13:00:00') }).verdict,
    ).toBe('pass');
    expect(decideTypedParity({ oracle: v('VIA Done'), sql: v('VIA Done') }).verdict).toBe('pass');
    expect(decideTypedParity({ oracle: v('VIA Done'), sql: v('No VIA') }).verdict).toBe('fail');
    expect(decideTypedParity({ oracle: v('~ 477.02'), sql: v(477.26) }).verdict).toBe('pass');
    expect(decideTypedParity({ oracle: v('🚢1264'), sql: v('🚢1264') }).verdict).toBe('pass');
    expect(decideTypedParity({ oracle: { present: false, raw: null }, sql: v(1) }).verdict).toBe('skipped');
  });
});
