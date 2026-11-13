import { describe, expect, it } from 'vitest';
import { tryRuleTierSql } from '@/lib/powerbi/translate-rule';

describe('translate rule tier', () => {
  it('translates SUM on bound table', () => {
    const r = tryRuleTierSql({
      dax: "SUM('Facts'[Amount])",
      tableName: 'Facts',
      ucFullPath: 'hive_metastore.cat.schema.facts',
    });
    expect(r?.pattern).toBe('SUM');
    expect(r?.sql).toContain('SUM(`Amount`)');
    expect(r?.sql).toContain('`facts`');
  });

  it('rejects mismatched table name', () => {
    expect(
      tryRuleTierSql({
        dax: "SUM('Other'[Amount])",
        tableName: 'Facts',
        ucFullPath: 'c.s.t',
      }),
    ).toBeNull();
  });
});
