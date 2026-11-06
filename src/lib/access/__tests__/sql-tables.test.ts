import { describe, expect, it } from 'vitest';
import { extractTablesForAuthorization } from '@/lib/access/sql-tables';

describe('extractTablesForAuthorization', () => {
  it('collects fully qualified tables', () => {
    const r = extractTablesForAuthorization(
      'SELECT a FROM ops_gold.finance.vessel t JOIN ops_gold.marine.inspections o ON 1=1',
    );
    expect(r).toEqual({
      ok: true,
      paths: ['ops_gold.finance.vessel', 'ops_gold.marine.inspections'],
    });
  });

  it('rejects two-part names', () => {
    const r = extractTablesForAuthorization('SELECT * FROM schema.table');
    expect(r.ok).toBe(false);
  });

  it('rejects SHOW', () => {
    const r = extractTablesForAuthorization('SHOW TABLES IN cat');
    expect(r.ok).toBe(false);
  });

  it('allows SELECT 1 with no tables', () => {
    const r = extractTablesForAuthorization('SELECT 1');
    expect(r).toEqual({ ok: true, paths: [] });
  });
});
