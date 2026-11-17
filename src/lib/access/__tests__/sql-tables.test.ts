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

describe('common SQL that is not a table reference or a forbidden statement', () => {
  const ok = (sql: string, paths: string[]) => expect(extractTablesForAuthorization(sql)).toEqual({ ok: true, paths });

  it('ORDER BY … DESC is not DESCRIBE', () => ok('SELECT a FROM x.y.z ORDER BY a DESC LIMIT 10', ['x.y.z']));
  it('a column or alias called show / use is not a statement', () => ok('SELECT a AS show, use_case FROM x.y.z', ['x.y.z']));
  it('FROM inside EXTRACT, TRIM and SUBSTRING is not a table', () => {
    ok('SELECT EXTRACT(YEAR FROM d), TRIM(BOTH \' \' FROM n), SUBSTRING(n FROM 1 FOR 3) FROM x.y.z', ['x.y.z']);
  });
  it('a sub-query inside such a function is still scanned', () => {
    ok('SELECT SUBSTRING((SELECT max(n) FROM d.e.f) FROM 1) FROM x.y.z', ['d.e.f', 'x.y.z']);
  });
  it('DESCRIBE, SHOW and USE as the statement are still refused', () => {
    expect(extractTablesForAuthorization('DESCRIBE x.y.z').ok).toBe(false);
    expect(extractTablesForAuthorization('DESC x.y.z').ok).toBe(false);
    expect(extractTablesForAuthorization('SHOW TABLES').ok).toBe(false);
    expect(extractTablesForAuthorization('USE x').ok).toBe(false);
  });
});

describe('every source in a FROM list is checked (review C1)', () => {
  const paths = (sql: string) => {
    const r = extractTablesForAuthorization(sql);
    return r.ok ? r.paths : `fail: ${r.reason}`;
  };

  it('reads comma joins, with and without aliases', () => {
    expect(paths('SELECT * FROM a.b.c t1, d.e.f t2')).toEqual(['a.b.c', 'd.e.f']);
    expect(paths('SELECT * FROM a.b.c, d.e.f WHERE 1=1')).toEqual(['a.b.c', 'd.e.f']);
    expect(paths('SELECT * FROM a.b.c AS x, d.e.f AS y, g.h.i z')).toEqual(['a.b.c', 'd.e.f', 'g.h.i']);
  });

  it('reads a source after a join condition', () => {
    expect(paths('SELECT * FROM a.b.c x JOIN d.e.f y ON x.id = y.id, g.h.i z WHERE 1=1')).toEqual(['a.b.c', 'd.e.f', 'g.h.i']);
  });

  it('reads TABLE statements', () => {
    expect(paths('TABLE d.e.f')).toEqual(['d.e.f']);
    expect(paths('TABLE schema_only')).toMatch(/^fail/);
  });

  it('reads past a CTE name in a comma list', () => {
    expect(paths('WITH t AS (SELECT 1 AS n) SELECT * FROM t, d.e.f')).toEqual(['d.e.f']);
  });

  it('reads comma joins inside sub-queries and CTE bodies', () => {
    expect(paths('SELECT * FROM a.b.c WHERE id IN (SELECT id FROM d.e.f, g.h.i)')).toEqual(['a.b.c', 'd.e.f', 'g.h.i']);
    expect(paths('WITH t AS (SELECT * FROM d.e.f, g.h.i) SELECT * FROM t')).toEqual(['d.e.f', 'g.h.i']);
    expect(paths('SELECT * FROM (SELECT * FROM d.e.f) s, g.h.i')).toEqual(['d.e.f', 'g.h.i']);
  });

  it('does not treat commas outside the FROM clause as tables', () => {
    expect(paths('SELECT concat(a, b), c FROM a.b.c GROUP BY a, b ORDER BY c, a')).toEqual(['a.b.c']);
    expect(paths('SELECT * FROM a.b.c x JOIN d.e.f y USING (k1, k2)')).toEqual(['a.b.c', 'd.e.f']);
    expect(paths('SELECT a FROM a.b.c WHERE a IS NOT DISTINCT FROM b')).toEqual(['a.b.c']);
    expect(paths('SELECT * FROM a.b.c VERSION AS OF 3')).toEqual(['a.b.c']);
  });

  it('refuses what it cannot read', () => {
    expect(paths('SELECT * FROM a.b.c LATERAL VIEW explode(x) e AS y')).toMatch(/^fail/);
    expect(paths('SELECT * FROM a.b.c TABLESAMPLE (10 PERCENT)')).toMatch(/^fail/);
    expect(paths('SELECT * FROM range(10)')).toMatch(/^fail/);
    expect(paths('SELECT * FROM a.b.c, system.access.audit')).toMatch(/^fail/);
  });
});
