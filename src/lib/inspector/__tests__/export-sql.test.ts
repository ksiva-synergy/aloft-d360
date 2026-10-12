import { describe, it, expect } from 'vitest';
import {
  sqlHasMultiSourceCombine,
  stripTrailingLimit,
  resolveExportSql,
} from '@/lib/inspector/export-sql';

describe('sqlHasMultiSourceCombine', () => {
  it('detects JOIN and UNION', () => {
    expect(sqlHasMultiSourceCombine('SELECT * FROM a JOIN b ON a.id=b.id')).toBe(true);
    expect(sqlHasMultiSourceCombine('SELECT * FROM a UNION ALL SELECT * FROM b')).toBe(true);
    expect(sqlHasMultiSourceCombine("SELECT 'join' AS x FROM t")).toBe(false);
    expect(sqlHasMultiSourceCombine('SELECT * FROM t WHERE imo = 1')).toBe(false);
  });
});

describe('stripTrailingLimit', () => {
  it('strips trailing LIMIT', () => {
    expect(stripTrailingLimit('SELECT * FROM t LIMIT 50')).toBe('SELECT * FROM t');
    expect(stripTrailingLimit('SELECT * FROM t LIMIT 50;')).toBe('SELECT * FROM t');
  });
});

describe('resolveExportSql', () => {
  const last = 'SELECT * FROM landing_zone_dev.sire_2_0.sire_report WHERE IMO_NO = \'9788576\' LIMIT 50';

  it('defaults to last SQL without LIMIT', () => {
    const r = resolveExportSql({ lastSql: last });
    expect(r).toEqual({
      sql: "SELECT * FROM landing_zone_dev.sire_2_0.sire_report WHERE IMO_NO = '9788576'",
      source: 'last',
    });
  });

  it('falls back to last when override has JOIN without allowCombined', () => {
    const r = resolveExportSql({
      lastSql: last,
      statement: 'SELECT * FROM a LEFT JOIN b ON a.id=b.id',
    });
    expect(r).toMatchObject({ source: 'last' });
  });

  it('rejects JOIN override when no safe last SQL', () => {
    const r = resolveExportSql({
      statement: 'SELECT * FROM a UNION ALL SELECT * FROM b',
    });
    expect('error' in r && r.error.includes('EXPORT_COMBINE_REJECTED')).toBe(true);
  });

  it('allows JOIN when allowCombined', () => {
    const r = resolveExportSql({
      statement: 'SELECT * FROM a JOIN b ON 1=1',
      allowCombined: true,
    });
    expect(r).toEqual({ sql: 'SELECT * FROM a JOIN b ON 1=1', source: 'override' });
  });
});
