import { describe, expect, it } from 'vitest';
import {
  countDatasourceTables,
  datasourceTableRefs,
  mergeDatasourceTables,
  tablesToDatabricksDatasources,
} from '../datasource-tables';

describe('datasource-tables', () => {
  it('reads qualified refs and scope lists', () => {
    const items = [
      { kind: 'databricks' as const, ref: 'sap_prod.curated_zone.a', scope: null },
      {
        kind: 'databricks' as const,
        ref: 'synergy_dwh',
        scope: 'sap_prod.curated_zone.b, sap_prod.curated_zone.c',
      },
    ];
    expect(datasourceTableRefs(items)).toEqual([
      'sap_prod.curated_zone.a',
      'sap_prod.curated_zone.b',
      'sap_prod.curated_zone.c',
    ]);
    expect(countDatasourceTables(items)).toBe(3);
  });

  it('dedupes and normalizes on merge', () => {
    const items = [
      { kind: 'databricks' as const, ref: 'synergy_dwh', scope: 'a.b.c, a.b.d' },
      { kind: 'kb' as const, ref: 'fleet-docs', scope: null },
    ];
    const next = mergeDatasourceTables(items, ['a.b.c', 'a.b.e']);
    expect(tablesToDatabricksDatasources(['a.b.c', 'a.b.e'])).toEqual([
      { kind: 'databricks', ref: 'a.b.c', scope: null },
      { kind: 'databricks', ref: 'a.b.e', scope: null },
    ]);
    expect(next).toEqual([
      { kind: 'databricks', ref: 'a.b.c', scope: null },
      { kind: 'databricks', ref: 'a.b.e', scope: null },
      { kind: 'kb', ref: 'fleet-docs', scope: null },
    ]);
  });
});
