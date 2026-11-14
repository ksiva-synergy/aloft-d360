import { describe, expect, it } from 'vitest';

import { checkPbiSql } from '@/lib/powerbi/sql-gate';

const ok = (sql: string) => expect(checkPbiSql(sql)).toEqual({ ok: true });
const blocked = (sql: string, reason: RegExp) => {
  const r = checkPbiSql(sql);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(reason);
};

describe('SQL gate for executed Power BI SQL', () => {
  it('allows read-only queries, including keyword-like names and literals', () => {
    ok('SELECT SUM(a.`x`) AS value FROM `c`.`s`.`t` a');
    ok("WITH t1 AS (SELECT `UPDATED_AT`, `delete_flag` FROM c.s.t) SELECT COUNT(*) FROM t1 WHERE status <> 'DELETE' -- set x\n");
    ok('(SELECT 1) UNION SELECT 2');
    ok("SELECT * FROM VALUES ('drop table x') AS e(`create`)");
    ok('SELECT 1;');
  });

  it('blocks writes, admin statements and multiple statements', () => {
    blocked('DELETE FROM c.s.t', /only SELECT/);
    blocked('SELECT 1; DROP TABLE c.s.t', /more than one statement/);
    blocked('WITH x AS (SELECT 1) INSERT INTO c.s.t SELECT * FROM x', /INSERT/);
    blocked('SELECT 1 FROM t WHERE 1 = 1 AND (UPDATE t SET a = 1) IS NULL', /UPDATE/);
    blocked('SET spark.sql.ansi.enabled = false', /only SELECT/);
  });

  it('blocks file, network and paid AI functions', () => {
    blocked("SELECT * FROM read_files('s3://bucket/x')", /read_files/);
    blocked("SELECT http_request('https://example.com')", /http_request/);
    blocked("SELECT ai_query('model', 'prompt')", /ai_query/);
  });
});
