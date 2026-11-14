import { describe, expect, it } from 'vitest';

import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph } from '@/lib/powerbi/model-graph';
import { chooseSliceDimension, compareSlices } from '@/lib/powerbi/slicing';

function catalog(): MeasureLogicCatalog {
  const cols = (e: [string, MeasureLogicColumnMeta][]) => new Map(e);
  return {
    columnsByTable: new Map([
      ['audit', cols([['Days', { source_column: 'DAYS', calculated_dax: null }], ['Key', { source_column: 'KEY', calculated_dax: null }], ['Date', { source_column: 'D', calculated_dax: null }]])],
      ['ships', cols([['KEY', { source_column: 'KEY', calculated_dax: null }]])],
      ['calendar', cols([['Date', { source_column: 'D', calculated_dax: null }]])],
      ['localdatetable_x', cols([['Date', { source_column: 'D', calculated_dax: null }]])],
    ]),
    tableMeta: new Map([
      ['audit', { displayName: 'Audit', uc_full_path: 'c.s.a', source_m: null }],
      ['ships', { displayName: 'Ships', uc_full_path: 'c.s.s', source_m: null }],
      ['calendar', { displayName: 'Calendar', uc_full_path: 'c.s.c', source_m: null }],
      ['localdatetable_x', { displayName: 'LocalDateTable_x', uc_full_path: null, source_m: 'CALENDAR(1,2)' }],
    ]),
    measures: new Map([['total days', { name: 'Total Days', table: 'Audit', dax: 'SUM(Audit[Days])' }]]),
    relationships: [
      { fromTable: 'Audit', fromColumn: 'Date', toTable: 'LocalDateTable_x', toColumn: 'Date', both: false, active: true },
      { fromTable: 'Audit', fromColumn: 'Date', toTable: 'Calendar', toColumn: 'Date', both: false, active: true },
      { fromTable: 'Audit', fromColumn: 'Key', toTable: 'Ships', toColumn: 'KEY', both: false, active: true },
    ],
  };
}

describe('sliced parity', () => {
  it('chooses an entity dimension the measure is related to (not auto-date, calendar last)', () => {
    const cat = catalog();
    expect(chooseSliceDimension('Total Days', cat, buildModelGraph(cat))).toEqual({ table: 'Ships', column: 'KEY' });
  });

  it('finds errors that cancel out in the total', () => {
    const r = compareSlices({
      dimension: { table: 'Ships', column: 'KEY' },
      powerBi: [
        { key: 'A', value: 10 },
        { key: 'B', value: 20 },
        { key: null, value: 3 },
      ],
      sql: [
        { key: 'a', value: 12 },
        { key: 'B', value: 18 },
        { key: 'C', value: null },
      ],
    });
    expect(r.compared).toBe(2);
    expect(r.mismatched).toBe(2);
    expect(r.examples.map((e) => e.key).sort()).toEqual(['a', 'b']);
    expect(r.blank_member).toEqual({ power_bi: 3 });
  });
});
