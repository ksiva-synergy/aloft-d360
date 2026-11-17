import { describe, expect, it } from 'vitest';

import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import { buildRuleSet, renderTemplate, validateTemplate } from '@/lib/powerbi/rule-registry';
import {
  buildDiffTestPlan,
  compareDiffTest,
  compileDiffTestSql,
  valuesMatch,
} from '@/lib/powerbi/rule-difftest';

const catalog = (rules = buildRuleSet([])): MeasureLogicCatalog => ({
  columnsByTable: new Map(),
  tableMeta: new Map([
    ['t', { displayName: 'T', uc_full_path: null, source_m: 'DATATABLE("x", DOUBLE, {{1}, {-2}})' }],
  ]),
  measures: new Map(),
  relationships: [],
  rules,
});

describe('rule registry', () => {
  it('validates templates: one scalar expression, placeholders in range', () => {
    expect(validateTemplate('sign({0})', 1)).toBeNull();
    expect(validateTemplate("repeat(coalesce({0}, ''), {1})", 2)).toBeNull();
    expect(validateTemplate('{2} + 1', 2)).toMatch(/out of range/);
    expect(validateTemplate('(SELECT 1)', 0)).toMatch(/single scalar/);
    expect(validateTemplate('abs({0}); drop table x', 1)).toMatch(/single scalar/);
    expect(validateTemplate('abs({0}', 1)).toMatch(/unbalanced/);
    expect(validateTemplate("concat({0}, ' from ')", 1)).toBeNull(); // keywords inside strings are fine
  });

  it('renders placeholders with parenthesized arguments', () => {
    expect(renderTemplate('{0} * {1}', ['a + 1', 'b'])).toBe('((a + 1) * (b))');
  });

  it('only verified/promoted rules are usable', () => {
    const set = buildRuleSet([
      { kind: 'dax_fn', name: 'SIGN', arity: 1, sqlTemplate: 'sign({0})', resultKind: 'number', status: 'verified' },
      { kind: 'dax_fn', name: 'REPT', arity: 2, sqlTemplate: 'repeat({0},{1})', resultKind: 'string', status: 'candidate' },
    ]);
    expect([...set.keys()]).toEqual(['dax_fn:SIGN/1']);
  });

  it('compiler applies a verified DAX rule and reports a structured gap otherwise', () => {
    const rules = buildRuleSet([
      { kind: 'dax_fn', name: 'SIGN', arity: 1, sqlTemplate: 'sign(coalesce({0}, 0))', resultKind: 'number', status: 'verified' },
    ]);
    const ok = compileMeasureToSql({ measureDax: "SUMX('T', SIGN('T'[x]))", catalog: catalog(rules) });
    expect(ok.ok && ok.sql).toMatch(/sign\(coalesce\(\(a\d+\.`x`\), 0\)\)/);
    const gap = compileMeasureToSql({ measureDax: "SUMX('T', REPT('T'[x], 2))", catalog: catalog(rules) });
    expect(!gap.ok && gap.gap).toEqual({ kind: 'dax_fn', name: 'REPT', arity: 2 });
  });

  it('M lineage applies a verified m_fn rule', () => {
    const rules = buildRuleSet([
      { kind: 'm_fn', name: 'Text.PadStart', arity: 3, sqlTemplate: 'lpad({0}, {1}, {2})', resultKind: 'string', status: 'verified' },
    ]);
    const m = 'let S = Sql.Database("h","d"), A = Table.AddColumn(S, "p", each Text.PadStart([c], 5, "0")) in A';
    expect(parseMLineage(m).column('p')).toHaveProperty('error');
    expect((parseMLineage(m, rules).column('p') as { sql: string }).sql).toBe("(lpad((`c`), (5), ('0')))");
  });
});

describe('differential test plan', () => {
  it('treats an empty literal list as a free argument, not a constant with no values', () => {
    const plan = buildDiffTestPlan({ name: 'CEILING', args: [{ kind: 'number', literals: [] }, { kind: 'number', literals: ['100'] }] });
    expect(plan.columnArgs).toEqual([0]);
    expect(plan.powerBiQuery).toMatch(/^EVALUATE ADDCOLUMNS\(DATATABLE\(.*"r0", IFERROR\(CEILING\(\[a0\], 100\), BLANK\(\)\), "e0", ISERROR\(CEILING\(\[a0\], 100\)\)\)$/);
    expect(plan.rows.length).toBeGreaterThan(1);
  });

  it('excludes rows where Power BI errors, but every other row must still match', () => {
    const plan = buildDiffTestPlan({ name: 'ABS', args: [{ kind: 'int' }] });
    const pbi = plan.rows.map((r) => ({
      '[__id]': r.id,
      '[r0]': r.values[0] === null ? null : Math.abs(Number(r.values[0])),
      '[e0]': r.values[0] === '-1', // pretend Power BI errors on one input
    }));
    const sql = plan.rows.map((r) => ({ __id: String(r.id), r0: r.values[0] === null ? null : String(Math.abs(Number(r.values[0]))) }));
    const ok = compareDiffTest(plan, pbi, sql);
    expect(ok.pass).toBe(true);
    expect(ok.powerBiErrors).toBe(1);
    expect(ok.compared).toBe(plan.rows.length - 1);

    sql[0]!.r0 = '99'; // a real mismatch on a row Power BI computed still fails
    expect(compareDiffTest(plan, pbi, sql).pass).toBe(false);
  });

  it('never passes when Power BI errored on every input', () => {
    const plan = buildDiffTestPlan({ name: 'ABS', args: [{ kind: 'int' }] });
    const pbi = plan.rows.map((r) => ({ '[__id]': r.id, '[r0]': null, '[e0]': true }));
    const result = compareDiffTest(plan, pbi, []);
    expect(result.pass).toBe(false);
    expect(result.compared).toBe(0);
  });

  it('builds a Power BI query over a literal DATATABLE and matching compiled SQL', () => {
    const plan = buildDiffTestPlan({ name: 'WEEKNUM', args: [{ kind: 'date' }, { kind: 'int', literals: ['1', '21'] }] });
    expect(plan.rows.length).toBe(9);
    expect(plan.powerBiQuery).toMatch(/^EVALUATE ADDCOLUMNS\(DATATABLE\("__id", INTEGER, "a0", DATETIME, \{\{1, "2024-01-01"\}/);
    expect(plan.powerBiQuery).toContain(
      '"r0", IFERROR(WEEKNUM([a0], 1), BLANK()), "e0", ISERROR(WEEKNUM([a0], 1)), "r1", IFERROR(WEEKNUM([a0], 21), BLANK()), "e1", ISERROR(WEEKNUM([a0], 21))',
    );
    expect(plan.powerBiQuery).toContain('BLANK()');
    const sql = compileDiffTestSql(plan);
    expect(sql.ok && sql.sql).toContain("TRY_CAST('2024-01-01' AS TIMESTAMP)");
    expect(sql.ok && sql.sql).toContain('weekofyear(');
  });

  it('caps large products but still covers every value', () => {
    const plan = buildDiffTestPlan({ name: 'DATEDIFF', args: [{ kind: 'date' }, { kind: 'date' }, { kind: 'int', literals: ['DAY'] }] });
    expect(plan.rows.length).toBe(64);
    const firstArgValues = new Set(plan.rows.map((r) => r.values[0]));
    expect(firstArgValues.size).toBe(9);
  });

  it('compares strictly: numbers to 1e-9, dates by instant, blanks equal', () => {
    expect(valuesMatch(1, '1.0')).toBe(true);
    expect(valuesMatch(0.1 + 0.2, '0.3')).toBe(true);
    expect(valuesMatch(2, '2.0001')).toBe(false);
    expect(valuesMatch('2024-01-01T00:00:00', '2024-01-01 00:00:00')).toBe(true);
    expect(valuesMatch(null, null)).toBe(true);
    expect(valuesMatch(null, 0)).toBe(false);
    expect(valuesMatch(true, 'true')).toBe(true);
    const plan = buildDiffTestPlan({ name: 'ABS', args: [{ kind: 'int' }] });
    const pbi = plan.rows.map((r) => ({ '[__id]': r.id, '[r0]': r.values[0] === null ? null : Math.abs(Number(r.values[0])) }));
    const sql = plan.rows.map((r) => ({ __id: String(r.id), r0: r.values[0] === null ? null : String(Math.abs(Number(r.values[0]))) }));
    expect(compareDiffTest(plan, pbi, sql).pass).toBe(true);
    sql[0]!.r0 = '99';
    expect(compareDiffTest(plan, pbi, sql).mismatches).toHaveLength(1);
  });
});
