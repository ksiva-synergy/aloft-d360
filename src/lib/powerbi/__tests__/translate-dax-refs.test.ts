import { describe, expect, it } from 'vitest';

import {
  extractDaxTableNames,
  normalizePbiTableName,
  resolveUcForMeasure,
} from '@/lib/powerbi/translate-dax-refs';

describe('translate-dax-refs', () => {
  it('extracts quoted table names from DAX', () => {
    const dax = `CALCULATE(DISTINCTCOUNT('Vessel Internal Audit'[ReferenceNo]), FILTER(ALL('Vessel Internal Audit'[AuditFromDate]), ...))`;
    expect(extractDaxTableNames(dax)).toContain('Vessel Internal Audit');
  });

  it('resolves UC via DAX ref when home table unbound', () => {
    const map = new Map([
      [
        normalizePbiTableName("'Vessel Internal Audit'"),
        { uc: 'reporting_layer.qhse.bi_vw_internalaudit', nativeSql: 'SELECT 1' },
      ],
    ]);
    const r = resolveUcForMeasure({
      dax: "COUNT('Vessel Internal Audit'[auditsubtype])",
      homeTableName: 'Measure2',
      homeUc: null,
      homeNativeSql: null,
      modelTables: map,
    });
    expect(r?.via).toBe('dax_ref');
    expect(r?.sourceTable).toBe('Vessel Internal Audit');
    expect(r?.uc).toContain('bi_vw_internalaudit');
  });

  it('prefers home table UC when present', () => {
    const map = new Map([
      ['Facts', { uc: 'c.s.facts', nativeSql: null }],
    ]);
    const r = resolveUcForMeasure({
      dax: "SUM('Facts'[Amt])",
      homeTableName: 'Facts',
      homeUc: 'c.s.facts',
      homeNativeSql: null,
      modelTables: map,
    });
    expect(r?.via).toBe('home_table');
  });
});
