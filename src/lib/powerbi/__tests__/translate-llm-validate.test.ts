import { describe, expect, it } from 'vitest';

import { extractSqlBacktickIdentifiers, validateSqlAgainstAllowlist } from '@/lib/powerbi/translate-llm-validate';

describe('LLM SQL allowlist', () => {
  it('treats a backtick-quoted catalog.schema.table chain as one name, not three columns', () => {
    // CII run 2026-11-14: "columns outside the allowlist: reporting_layer, ems, consumption_log"
    const sql = 'SELECT SUM(`slip`) AS value FROM `reporting_layer`.`ems`.`consumption_log` WHERE `vessel` IS NOT NULL';
    expect(extractSqlBacktickIdentifiers(sql)).toEqual(['slip', 'reporting_layer.ems.consumption_log', 'vessel']);
    expect(validateSqlAgainstAllowlist(sql, ['slip', 'vessel'])).toEqual({ ok: true, invalid: [] });
  });

  it('still rejects a column that is not in the allowlist', () => {
    const sql = 'SELECT SUM(t.`slip`) AS value FROM `c`.`s`.`t` t WHERE `ghost_col` > 0';
    expect(validateSqlAgainstAllowlist(sql, ['slip'])).toEqual({ ok: false, invalid: ['ghost_col'] });
  });
});
