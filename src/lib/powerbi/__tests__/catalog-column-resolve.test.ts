import { describe, expect, it } from 'vitest';

import { extractColumnNamesFromNativeSql } from '@/lib/powerbi/catalog-column-parse';
import { extractDaxColumnRefs } from '@/lib/powerbi/translate-dax-refs';
import { validateSqlAgainstAllowlist } from '@/lib/powerbi/translate-llm-validate';
import { tryRuleTierSql } from '@/lib/powerbi/translate-rule';

describe('extractDaxColumnRefs', () => {
  it('parses quoted table column refs', () => {
    const refs = extractDaxColumnRefs("COUNT('Vessel Internal Audit'[Audit_ID])");
    expect(refs).toEqual([{ table: 'Vessel Internal Audit', column: 'Audit_ID' }]);
  });
});

describe('extractColumnNamesFromNativeSql', () => {
  it('collects backtick identifiers from native sql', () => {
    const cols = extractColumnNamesFromNativeSql(
      'SELECT `audit_id`, `vessel_name` FROM cat.schema.table',
    );
    expect(cols).toContain('audit_id');
    expect(cols).toContain('vessel_name');
  });
});

describe('validateSqlAgainstAllowlist', () => {
  it('flags inventend columns', () => {
    const r = validateSqlAgainstAllowlist(
      'SELECT COUNT(`bogus_col`) AS value FROM `c`.`s`.`t`',
      ['audit_id', 'vessel_name'],
    );
    expect(r.ok).toBe(false);
    expect(r.invalid).toContain('bogus_col');
  });

  it('allows known columns', () => {
    const r = validateSqlAgainstAllowlist(
      'SELECT COUNT(`audit_id`) AS value FROM `c`.`s`.`t`',
      ['audit_id'],
    );
    expect(r.ok).toBe(true);
  });
});

describe('translate rule tier COUNT DISTINCT', () => {
  it('emits valid COUNT(DISTINCT ...) SQL', () => {
    const r = tryRuleTierSql({
      dax: "DISTINCTCOUNT('Facts'[Ship_ID])",
      tableName: 'Facts',
      ucFullPath: 'hive_metastore.cat.schema.facts',
      columnMap: { Ship_ID: 'ship_id' },
    });
    expect(r?.sql).toContain('COUNT(DISTINCT `ship_id`)');
  });
});
