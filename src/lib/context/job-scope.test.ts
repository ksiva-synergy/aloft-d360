import { describe, expect, it } from 'vitest';
import {
  catalogSchemaMatchesIncludePatterns,
  objectMatchesJobScope,
  pathExcludedBySchemas,
  buildQueryHistoryStatementSqlFilter,
  prefilterHistoryRowsForObjects,
  pathToIncludePattern,
  resolveEffectiveScope,
  schemaMatchesIncludePatterns,
  includePatternsOverlap,
  statementReferencesObject,
  tablePatternsMayMatchSchema,
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
    expect(
      statementReferencesObject('select * from `curated_db`.`sales`.`orders`', obj),
    ).toBe(true);
  });

  it('buildQueryHistoryStatementSqlFilter emits schema LIKE clauses', () => {
    const sql = buildQueryHistoryStatementSqlFilter([
      { catalog_name: 'Cat', schema_name: 'Sch' },
    ]);
    expect(sql).toContain("LOWER(statement_text) LIKE '%cat.sch.%'");
  });

  it('prefilterHistoryRowsForObjects keeps rows referencing in-scope tables', () => {
    const obj = { catalog_name: 'c', schema_name: 's', object_name: 't1' };
    const rows = [
      { statement_text: 'select * from c.s.t1' },
      { statement_text: 'select 1' },
    ];
    expect(prefilterHistoryRowsForObjects(rows, [obj])).toEqual([rows[0]]);
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

  it('table-level Limit globs do not match the whole schema', () => {
    const pat = 'open_analytics_zone.ash_scratchpad.global_employee_master';
    expect(catalogSchemaMatchesIncludePatterns('open_analytics_zone', 'ash_scratchpad', [pat])).toBe(false);
    expect(tablePatternsMayMatchSchema('open_analytics_zone', 'ash_scratchpad', [pat])).toBe(true);
    expect(tablePatternsMayMatchSchema('open_analytics_zone', 'other', [pat])).toBe(false);
    expect(tablePatternsMayMatchSchema('curated_db', 'sales', ['curated_db.*'])).toBe(false);
    expect(tablePatternsMayMatchSchema('curated_db', 'sales_eu', ['curated_db.sales*.orders'])).toBe(true);
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

  it('includePatternsOverlap treats empty as full source', () => {
    expect(includePatternsOverlap([], ['a.b.*'])).toBe(true);
    expect(includePatternsOverlap(['a.b.*'], [])).toBe(true);
  });

  it('includePatternsOverlap detects nested catalog globs', () => {
    expect(includePatternsOverlap(['curated_db.*'], ['curated_db.foo.*'])).toBe(true);
    expect(includePatternsOverlap(['curated_db.foo.*'], ['curated_db.bar.*'])).toBe(false);
  });
});
