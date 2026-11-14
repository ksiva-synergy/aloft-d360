import { describe, expect, it } from 'vitest';

import { parseDax } from '@/lib/powerbi/dax-parse';
import { printDax } from '@/lib/powerbi/dax-print';
import {
  concludeDecomposition,
  planDecomposition,
  probeMatches,
  type ProbeResult,
} from '@/lib/powerbi/decompose-plan';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph } from '@/lib/powerbi/model-graph';

function catalog(): MeasureLogicCatalog {
  const cols = (e: [string, MeasureLogicColumnMeta][]) => new Map(e);
  const measures: Record<string, string> = {
    Base: 'SUM(Audit[Days])',
    Ratio: 'DIVIDE([Base], [Vessels])',
    Vessels: 'COUNTROWS(VALUES(Fleet[IMO]))',
    Top: `VAR b = [Ratio]
VAR adj = b * 100
RETURN IF(adj > 50, "High ""risk""", adj)`,
  };
  return {
    columnsByTable: new Map([
      ['audit', cols([['Days', { source_column: 'DAYS', calculated_dax: null }], ['IMO', { source_column: 'IMO', calculated_dax: null }]])],
      ['fleet', cols([['IMO', { source_column: 'IMO', calculated_dax: null }]])],
    ]),
    tableMeta: new Map([
      ['audit', { displayName: 'Audit', uc_full_path: 'c.s.audit', source_m: null, warehouse_columns: ['DAYS', 'IMO'] }],
      ['fleet', { displayName: 'Fleet', uc_full_path: 'c.s.fleet', source_m: null, warehouse_columns: ['IMO'] }],
    ]),
    measures: new Map(Object.entries(measures).map(([name, dax]) => [name.toLowerCase(), { name, table: 'Audit', dax }])),
    relationships: [{ fromTable: 'Audit', fromColumn: 'IMO', toTable: 'Fleet', toColumn: 'IMO', both: false, active: true }],
  };
}

describe('DAX printer', () => {
  it('round-trips through the parser', () => {
    const src = `VAR x = CALCULATE(SUM('My Table'[Amt]), 'My Table'[Kind] IN {"a", "b"}, NOT ISBLANK([M]))
RETURN IF(x > 0 && x <= 10, "it""s", -x)`;
    const printed = printDax(parseDax(src));
    expect(printDax(parseDax(printed))).toBe(printed);
    expect(printed).toContain(`"it""s"`);
    expect(printed).toContain(`'My Table'[Amt]`);
  });
});

describe('decomposition plan (L5)', () => {
  it('orders probes inputs → outputs: row counts, distinct keys, called measures deepest first, VARs', () => {
    const cat = catalog();
    const probes = planDecomposition({ measure: 'Top', catalog: cat, graph: buildModelGraph(cat) });
    const kinds = probes.map((p) => p.kind);
    expect(kinds.indexOf('row_count')).toBeLessThan(kinds.indexOf('distinct_values'));
    expect(kinds.indexOf('distinct_values')).toBeLessThan(kinds.indexOf('measure'));
    expect(kinds.lastIndexOf('measure')).toBeLessThan(kinds.indexOf('var'));
    expect(probes.filter((p) => p.kind === 'row_count').map((p) => p.dax).sort()).toEqual(["COUNTROWS('Audit')", "COUNTROWS('Fleet')"]);
    expect(probes.find((p) => p.kind === 'distinct_values')!.dax).toBe("COUNTROWS(VALUES('Fleet'[IMO]))");
    const measureOrder = probes.filter((p) => p.kind === 'measure').map((p) => p.label);
    expect(measureOrder.indexOf('[Ratio]')).toBeGreaterThan(measureOrder.indexOf('[Base]')); // Ratio uses Base
    const vars = probes.filter((p) => p.kind === 'var');
    expect(vars.map((v) => v.label)).toEqual(['VAR b', 'VAR adj']);
    expect(vars[1]!.dax).toMatch(/VAR b = \[Ratio\]\nVAR adj = \(b \* 100\)\nRETURN adj/);
  });

  it('counts compare exactly, values with parity tolerance', () => {
    expect(probeMatches({ kind: 'row_count' }, 5537, '5538')).toBe(false);
    expect(probeMatches({ kind: 'distinct_values' }, 12, 12)).toBe(true);
    expect(probeMatches({ kind: 'measure' }, 100, 100.4)).toBe(true);
    expect(probeMatches({ kind: 'measure' }, 100, 120)).toBe(false);
  });

  it('concludes with the first (most upstream) differing part', () => {
    const r = (label: string, kind: ProbeResult['kind'], status: ProbeResult['status'], pbi: unknown, sql: unknown): ProbeResult => ({
      id: label,
      label,
      kind,
      dax: '',
      status,
      pbi,
      sql,
    });
    const c = concludeDecomposition([
      r("Rows in 'Audit'", 'row_count', 'match', 10, 10),
      r("Distinct 'Fleet'[IMO]", 'distinct_values', 'differ', 1265, '1264'),
      r('[Ratio]', 'measure', 'differ', 2, 3),
    ]);
    expect(c.first_difference?.label).toBe("Distinct 'Fleet'[IMO]");
    expect(c.conclusion).toContain('Power BI 1,265, SQL 1,264');
    expect(c.conclusion).toContain('relationship blank row');
    expect(c.differing).toEqual(["Distinct 'Fleet'[IMO]", '[Ratio]']);
  });
});
