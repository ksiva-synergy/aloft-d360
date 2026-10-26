import { describe, expect, it } from 'vitest';
import {
  catalogSchemaMatchesIncludePatterns,
  objectMatchesJobScope,
  pathExcludedBySchemas,
  pathToIncludePattern,
  resolveEffectiveScope,
  schemaMatchesIncludePatterns,
  statementReferencesObject,
  usesEstateObjectPlan,
} from './job-scope';

describe('job-scope', () => {
  it('usesEstateObjectPlan for T0 and inventory only', () => {
    expect(usesEstateObjectPlan('t0_structural')).toBe(true);
    expect(usesEstateObjectPlan('estate_inventory')).toBe(true);
    expect(usesEstateObjectPlan('t1_profile')).toBe(false);
  });

  it('maps scope.path to includePatterns when patterns absent', () => {
    const resolved = resolveEffectiveScope({
      path: 'curated_db.my_schema.my_table',
      excludeSchemas: ['other.cat'],
    });
    expect(resolved.includePatterns).toEqual(['curated_db.my_schema.my_table']);
    expect(resolved.excludeSchemas).toEqual(['other.cat']);
  });

  it('pathToIncludePattern preserves full path', () => {
    expect(pathToIncludePattern('  a.b.c  ')).toBe('a.b.c');
  });

  it('statementReferencesObject prefers qualified table names', () => {
    const obj = { catalog_name: 'curated_db', schema_name: 'sales', object_name: 'orders' };
    expect(
      statementReferencesObject('select * from curated_db.sales.orders', obj),
    ).toBe(true);
    expect(
      statementReferencesObject('select * from sales.orders', obj),
    ).toBe(true);
    expect(
      statementReferencesObject('select * from other_schema.orders', obj),
    ).toBe(false);
    expect(
      statementReferencesObject('select * from orders', obj),
    ).toBe(false);
  });

  it('schemaMatchesIncludePatterns accepts catalog.schema.* globs', () => {
    expect(
      schemaMatchesIncludePatterns('curated_db', 'my_schema', ['curated_db.my_schema.*']),
    ).toBe(true);
    expect(
      schemaMatchesIncludePatterns('curated_db', 'other', ['curated_db.my_schema.*']),
    ).toBe(false);
  });

  it('catalogSchemaMatchesIncludePatterns accepts schema-prefix Limit globs', () => {
    const pat = 'curated_db.db_smac_prod_navitasai_masters_crewing*';
    expect(
      catalogSchemaMatchesIncludePatterns('curated_db', 'db_smac_prod_navitasai_masters_crewing', [pat]),
    ).toBe(true);
    expect(catalogSchemaMatchesIncludePatterns('curated_db', 'other_schema', [pat])).toBe(false);
  });

  it('pathExcludedBySchemas respects catalog.schema keys', () => {
    expect(pathExcludedBySchemas('curated_db.sales.orders', ['curated_db.sales'])).toBe(true);
    expect(pathExcludedBySchemas('curated_db.sales.orders', ['other.sales'])).toBe(false);
  });

  it('objectMatchesJobScope applies Limit and excludes', () => {
    expect(
      objectMatchesJobScope('curated_db.a.t1', 'curated_db', 'a', {
        includePatterns: ['curated_db.a.*'],
        excludeSchemas: [],
      }),
    ).toBe(true);
    expect(
      objectMatchesJobScope('curated_db.a.t1', 'curated_db', 'a', {
        includePatterns: [],
        excludeSchemas: ['curated_db.a'],
      }),
    ).toBe(false);
  });
});
