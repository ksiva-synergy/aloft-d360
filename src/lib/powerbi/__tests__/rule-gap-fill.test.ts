import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { createDaxGapFiller, fillDaxFunctionGap } from '@/lib/powerbi/rule-gap-fill';
import { buildRuleSet, daxFunctionGap, type RuleSet } from '@/lib/powerbi/rule-registry';

const target = {
  workspaceId: 'w',
  datasetId: 'd',
  connection: { id: 'c', workspace_host: 'h', default_warehouse_id: 'wh' },
};

const catalog = (rules: RuleSet): MeasureLogicCatalog => ({
  columnsByTable: new Map(),
  tableMeta: new Map([
    ['t', { displayName: 'T', uc_full_path: null, source_m: 'DATATABLE("x", DOUBLE, {{1}, {-2}})' }],
  ]),
  measures: new Map(),
  relationships: [],
  rules,
});

const reptRule = buildRuleSet([
  { kind: 'dax_fn', name: 'REPT', arity: 2, sqlTemplate: 'repeat({0}, {1})', resultKind: 'string', status: 'verified' },
]);

describe('dax function gap fill', () => {
  it('only scalar DAX function gaps are synthesizable', () => {
    expect(daxFunctionGap({ kind: 'dax_fn', name: 'rept', arity: 2 })).toEqual({ name: 'REPT', arity: 2 });
    expect(daxFunctionGap({ kind: 'm_fn', name: 'Text.PadStart', arity: 3 })).toBeNull();
    expect(daxFunctionGap({ kind: 'table_expr', name: 'SUMMARIZE' })).toBeNull();
    expect(daxFunctionGap(undefined)).toBeNull();
  });

  it('installs a verified template and the compiler then uses it', async () => {
    const rules = buildRuleSet([]);
    const before = compileMeasureToSql({ measureDax: "SUMX('T', REPT('T'[x], 2))", catalog: catalog(rules) });
    expect(!before.ok && before.gap).toEqual({ kind: 'dax_fn', name: 'REPT', arity: 2 });

    const result = await fillDaxFunctionGap({
      orgId: 'o',
      name: 'REPT',
      arity: 2,
      usageExample: 'REPT("a", 2)',
      rules,
      resolveTarget: async () => target,
      synthesize: async () => ({
        name: 'REPT',
        arity: 2,
        status: 'verified',
        attempts: 1,
        sqlTemplate: 'repeat({0}, {1})',
        lastResult: null,
      }),
      loadRules: async () => reptRule,
    });

    expect(result.filled).toBe(true);
    const after = compileMeasureToSql({ measureDax: "SUMX('T', REPT('T'[x], 2))", catalog: catalog(rules) });
    expect(after.ok && after.sql).toMatch(/repeat\(/);
  });

  it('leaves the registry unchanged when Power BI rejects the template', async () => {
    const rules = buildRuleSet([]);
    const result = await fillDaxFunctionGap({
      orgId: 'o',
      name: 'REPT',
      arity: 2,
      usageExample: 'REPT("a", 2)',
      rules,
      resolveTarget: async () => target,
      synthesize: async () => ({
        name: 'REPT',
        arity: 2,
        status: 'rejected',
        attempts: 3,
        sqlTemplate: 'repeat({0}, {1})',
        lastResult: null,
        error: '2 mismatches',
      }),
      loadRules: async () => {
        throw new Error('should not load');
      },
    });
    expect(result).toMatchObject({ filled: false, status: 'rejected' });
    expect(rules.size).toBe(0);
  });

  it('synthesizes each function once per run', async () => {
    let calls = 0;
    const filler = createDaxGapFiller({
      orgId: 'o',
      resolveTarget: async () => target,
      synthesize: async () => {
        calls += 1;
        return {
          name: 'REPT',
          arity: 2,
          status: 'verified',
          attempts: 1,
          sqlTemplate: 'repeat({0}, {1})',
          lastResult: null,
        };
      },
      loadRules: async () => reptRule,
    });
    const rules = buildRuleSet([]);
    const [a, b] = await Promise.all([
      filler.request({ name: 'REPT', arity: 2, usageExample: 'REPT("a", 2)', rules }),
      filler.request({ name: 'REPT', arity: 2, usageExample: 'REPT("b", 3)', rules }),
    ]);
    expect(calls).toBe(1);
    expect(a.filled && b.filled).toBe(true);
    expect(filler.counts()).toEqual({ synthesized: 1, failed: 0 });
  });
});
