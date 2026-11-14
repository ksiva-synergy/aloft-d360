import { describe, expect, it } from 'vitest';

import { blockingIssuesFor, buildFidelityReport } from '@/lib/powerbi/fidelity-gate';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { classifyRootCause } from '@/lib/powerbi/recreation-root-cause';

const SITE = 'https://contoso.sharepoint.com/sites/Ops/';
const FILE_M = `let
    Source = SharePoint.Files("${SITE}", [ApiVersion = 15]),
    #"Filtered Rows" = Table.SelectRows(Source, each ([Name] = "Tracker.xlsx")),
    #"Invoked" = Table.AddColumn(#"Filtered Rows", "T", each #"Transform File"([Content]))
in
    #"Invoked"`;
const HELPER_M = `let
    Source = (P) => let
        Source = Excel.Workbook(P, null, true),
        Sheet = Source{[Item="Process",Kind="Table"]}[Data]
    in
        Sheet
in
    Source`;
const DB_M = 'let Source = Value.NativeQuery(Snowflake.Databases("acct","WH"){[Name="DB"]}[Data], "SELECT * FROM DB.S.V", null) in Source';

function catalog(): MeasureLogicCatalog {
  return {
    columnsByTable: new Map([
      ['tracker', new Map([['IMO', { source_column: 'IMO', calculated_dax: null }]])],
      ['vessel', new Map([['IMO_NO', { source_column: 'IMO_NO', calculated_dax: null }]])],
    ]),
    tableMeta: new Map([
      ['tracker', { displayName: 'Tracker', uc_full_path: null, source_m: FILE_M }],
      ['vessel', { displayName: 'Vessel', uc_full_path: 'main.qhse.vessel', source_m: DB_M, warehouse_columns: [] }],
      ['measure', { displayName: 'Measure', uc_full_path: null, source_m: null }],
    ]),
    measures: new Map([
      ['tracked', { name: 'Tracked', table: 'Measure', dax: "DISTINCTCOUNT('Tracker'[IMO])" }],
      ['vessels', { name: 'Vessels', table: 'Measure', dax: 'DISTINCTCOUNT(Vessel[IMO_NO])' }],
    ]),
    relationships: [],
    sourceQueries: new Map([['Transform File', HELPER_M]]),
  };
}

describe('source not in warehouse', () => {
  it('blocks measures that read a file-sourced table, naming the file, sheet and site', () => {
    const report = buildFidelityReport(catalog());
    expect(report.blocked).toEqual(['Tracked']);
    const [issue] = blockingIssuesFor(report, 'Tracked');
    expect(issue).toMatchObject({ kind: 'source_not_in_warehouse', table: 'Tracker' });
    expect(issue!.detail).toBe(`Tracker is loaded from Excel file "Tracker.xlsx" (table Process) on SharePoint site ${SITE} — not in the warehouse`);
    expect(blockingIssuesFor(report, 'Vessels')).toEqual([]);
  });

  it('root cause is precise: from the gate, and from an older "no Unity Catalog binding" compile failure', () => {
    const cat = catalog();
    const fromGate = classifyRootCause({
      stage: 'no_sql',
      dax: "DISTINCTCOUNT('Tracker'[IMO])",
      tier: 'unresolved',
      props: { fidelity_block: { reason: 'Tracker: …', issues: [{ kind: 'source_not_in_warehouse' }] } },
      catalog: cat,
    });
    expect(fromGate).toMatchObject({ category: 'source_not_in_warehouse', precise: true });

    const fromCompile = classifyRootCause({
      stage: 'no_sql',
      dax: "DISTINCTCOUNT('Tracker'[IMO])",
      tier: 'unresolved',
      props: { expand_failure: { stage: 'compile', reason: "Table 'Tracker' has no Unity Catalog binding" } },
      catalog: cat,
    });
    expect(fromCompile?.category).toBe('source_not_in_warehouse');
    expect(fromCompile?.detail).toMatch(/Tracker\.xlsx/);
  });
});
