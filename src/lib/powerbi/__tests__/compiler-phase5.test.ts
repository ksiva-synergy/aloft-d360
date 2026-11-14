import { describe, expect, it } from 'vitest';

import { compileMeasureToSql, isUncorrelatedSql } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';

function catalog(measures: Record<string, string>, calc: Record<string, string> = {}): MeasureLogicCatalog {
  const cols = (e: [string, MeasureLogicColumnMeta][]) => new Map(e);
  return {
    columnsByTable: new Map([
      [
        'fact',
        cols([
          ['Vessel', { source_column: 'VESSEL', calculated_dax: null }],
          ['Fuel', { source_column: 'FUEL', calculated_dax: null }],
          ['Dist', { source_column: 'DIST', calculated_dax: null }],
          ['Ghost', { source_column: 'GHOST', calculated_dax: null }], // not in the replica
          ...Object.entries(calc).map(([n, dax]) => [n, { source_column: null, calculated_dax: dax }] as [string, MeasureLogicColumnMeta]),
        ]),
      ],
    ]),
    tableMeta: new Map([
      ['fact', { displayName: 'Fact', uc_full_path: 'c.s.fact', source_m: null, warehouse_columns: ['VESSEL', 'FUEL', 'DIST'] }],
    ]),
    measures: new Map(Object.entries(measures).map(([name, dax]) => [name.toLowerCase(), { name, table: 'Fact', dax }])),
    relationships: [],
  };
}

const sqlOf = (dax: string, cat: MeasureLogicCatalog) => {
  const r = compileMeasureToSql({ measureDax: dax, catalog: cat });
  if (!r.ok) throw new Error(r.reason);
  return r.sql;
};

describe('correlation test for sharing', () => {
  it('aliases defined inside the SQL do not make it correlated; outer ones do', () => {
    expect(isUncorrelatedSql('(SELECT MAX(a1.`Date`) FROM t1 a1)')).toBe(true);
    expect(isUncorrelatedSql('x IN (SELECT r62.`Date` FROM t1 r62 WHERE r62.`Date` <= (SELECT MAX(a1.`Date`) FROM t1 a1))')).toBe(true);
    expect(isUncorrelatedSql('(SELECT SUM(a3.`x`) FROM t2 a3 WHERE a3.`v` = a1.`Vessel`)')).toBe(false);
    expect(isUncorrelatedSql('cur.`Fuel` * 2')).toBe(false);
  });
});

describe('CALCULATE on the current row (context transition)', () => {
  it('compiles to a row-identity comparison instead of failing', () => {
    const cat = catalog({ Total: 'SUM(Fact[Share])' }, { Share: 'DIVIDE(Fact[Fuel], CALCULATE(SUM(Fact[Fuel])))' });
    const sql = sqlOf('[Total]', cat);
    expect(sql).toContain('xxhash64(');
    expect(sql).toMatch(/`__rowhash` = cur\.`__rowhash`/);
    // the column missing from the replica is left out of the row identity
    expect(sql).not.toContain('GHOST');
  });
});

describe('BLANK-aware arithmetic stays linear', () => {
  it('large correlated operands are referenced once', () => {
    // per-vessel iteration: the inner measure is correlated with the vessel, so it cannot be shared
    const cat = catalog({
      Base: 'SUM(Fact[Fuel]) - SUM(Fact[Dist]) + SUM(Fact[Fuel])',
      Twice: '[Base] - [Base] + [Base] - [Base]',
      PerVessel: 'SUMX(VALUES(Fact[Vessel]), [Twice])',
    });
    const sql = sqlOf('[PerVessel]', cat);
    expect(sql).toContain('aggregate(array(');
    expect(sql.length).toBeLessThan(6000);
  });

  it('small operands keep the short CASE form', () => {
    const sql = sqlOf('SUM(Fact[Fuel]) - SUM(Fact[Dist])', catalog({}));
    expect(sql).not.toContain('aggregate(array(');
  });
});
