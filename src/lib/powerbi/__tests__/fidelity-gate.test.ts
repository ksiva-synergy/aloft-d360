import { describe, expect, it } from 'vitest';

import {
  blockingIssuesFor,
  buildFidelityReport,
  classifySource,
  detectSplitColumn,
  isPassthroughQuery,
} from '@/lib/powerbi/fidelity-gate';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph, columnNodeId, measureNodeId } from '@/lib/powerbi/model-graph';
import { buildAdjacency, reach } from '@/lib/powerbi/graph-impact';
import { gridLayout } from '@/lib/powerbi/graph-layout';
import { measureSubgraph, modelGraphSummary, modelOverview } from '@/lib/powerbi/model-graph-view';
import { classifyRootCause } from '@/lib/powerbi/recreation-root-cause';

const SALES_M = `let
    Source = Value.NativeQuery(Snowflake.Databases("acct","WH",[]){[Name="DB"]}[Data], "SELECT * FROM DB.S.SALES", null, [EnableFolding=true]),
    #"Renamed Columns" = Table.RenameColumns(Source,{{"FUEL_HEATING_OR_DISCHARGING_MT", "Fuel Heat/Disch"}}),
    #"Filtered Rows" = Table.SelectRows(#"Renamed Columns", each ([STATUS] <> "Void"))
in
    #"Filtered Rows"`;

function cols(entries: [string, MeasureLogicColumnMeta][]): Map<string, MeasureLogicColumnMeta> {
  return new Map(entries);
}

function catalog(opts: { warehouse?: string[]; measures?: Record<string, string> } = {}): MeasureLogicCatalog {
  const measures = opts.measures ?? {
    'Total Amount': 'SUM(Sales[Amount])',
    'Fuel Total': 'SUM(Sales[Fuel Heat/Disch])',
    'Fuel Share': 'DIVIDE([Fuel Total], [Total Amount])',
    'Region Count': 'DISTINCTCOUNT(Region[Name])',
    'Amount With Tax': 'SUMX(Sales, Sales[Taxed])',
  };
  return {
    columnsByTable: new Map([
      [
        'sales',
        cols([
          ['Amount', { source_column: 'AMOUNT', calculated_dax: null }],
          ['Fuel Heat/Disch', { source_column: 'Fuel Heat/Disch', calculated_dax: null }],
          ['RegionId', { source_column: 'REGION_ID', calculated_dax: null }],
          ['Taxed', { source_column: null, calculated_dax: 'Sales[Amount] * 1.2' }],
        ]),
      ],
      ['region', cols([['Name', { source_column: 'NAME', calculated_dax: null }]])],
    ]),
    tableMeta: new Map([
      [
        'sales',
        {
          displayName: 'Sales',
          uc_full_path: 'cat.s.sales',
          source_m: SALES_M,
          warehouse_columns: opts.warehouse ?? [
            'AMOUNT',
            'REGION_ID',
            'STATUS',
            'FUEL_HEATING_MT',
            'FUEL_DISCHARGING_MT',
          ],
        },
      ],
      ['region', { displayName: 'Region', uc_full_path: 'cat.s.region', source_m: null, warehouse_columns: ['NAME'] }],
    ]),
    measures: new Map(
      Object.entries(measures).map(([name, dax]) => [
        name.toLowerCase(),
        { name, table: 'Sales', dax },
      ]),
    ),
    relationships: [
      { fromTable: 'Sales', fromColumn: 'RegionId', toTable: 'Region', toColumn: 'Name', both: false, active: true },
    ],
  };
}

describe('model graph (L1)', () => {
  it('resolves measure, column and calc-column dependencies like DAX', () => {
    const g = buildModelGraph(catalog());
    expect(g.nodes.get(measureNodeId('Fuel Share'))!.deps.sort()).toEqual(
      [measureNodeId('Fuel Total'), measureNodeId('Total Amount')].sort(),
    );
    const closure = g.closure(measureNodeId('Amount With Tax'));
    expect(closure.has(columnNodeId('Sales', 'Taxed'))).toBe(true);
    expect(closure.has(columnNodeId('Sales', 'Amount'))).toBe(true); // through the calc column
  });

  it('dependency hash changes only for the edited measure and its dependents', () => {
    const before = buildModelGraph(catalog());
    const edited = catalog();
    edited.measures!.set('fuel total', { name: 'Fuel Total', table: 'Sales', dax: 'SUM(Sales[Fuel Heat/Disch]) * 2' });
    const after = buildModelGraph(edited);
    const changed = (n: string) => before.dependencyHash(measureNodeId(n)) !== after.dependencyHash(measureNodeId(n));
    expect(changed('Fuel Total')).toBe(true);
    expect(changed('Fuel Share')).toBe(true); // uses [Fuel Total]
    expect(changed('Total Amount')).toBe(false);
    expect(changed('Region Count')).toBe(false);
    expect(changed('Amount With Tax')).toBe(false);
  });

  it('warehouse schema changes reach measures through the table node', () => {
    const before = buildModelGraph(catalog());
    const after = buildModelGraph(catalog({ warehouse: ['AMOUNT', 'REGION_ID', 'STATUS', 'NEW_COL'] }));
    expect(before.dependencyHash(measureNodeId('Total Amount'))).not.toBe(
      after.dependencyHash(measureNodeId('Total Amount')),
    );
    expect(before.dependencyHash(measureNodeId('Region Count'))).toBe(
      after.dependencyHash(measureNodeId('Region Count')),
    );
  });

  it('records unresolvable references as missing nodes', () => {
    const g = buildModelGraph(catalog({ measures: { Bad: 'SUM(Sales[Nope])' } }));
    expect([...g.nodes.values()].some((n) => n.kind === 'missing' && n.name === 'Nope')).toBe(true);
  });
});

describe('graph views (Estate UI)', () => {
  it('measure subgraph runs from warehouse leaves to the measure and marks drift', () => {
    const cat = catalog();
    const graph = buildModelGraph(cat);
    const sg = measureSubgraph({
      catalog: cat,
      graph,
      report: buildFidelityReport(cat, { graph }),
      measure: 'Fuel Share',
      status: new Map([['fuel share', 'blocked']]),
    })!;
    const byId = new Map(sg.nodes.map((n) => [n.id, n]));
    expect(byId.get(measureNodeId('Fuel Share'))!.status).toBe('blocked');
    const leaf = byId.get('w:sales/fuel_heating_or_discharging_mt')!;
    expect(leaf.kind).toBe('warehouse');
    expect(leaf.issues[0]!.kind).toBe('replica_drift');
    expect(sg.edges).toContainEqual({ from: leaf.id, to: columnNodeId('Sales', 'Fuel Heat/Disch') });
    expect(sg.edges).toContainEqual({ from: measureNodeId('Fuel Total'), to: measureNodeId('Fuel Share') });
    expect(sg.nodes.some((n) => n.kind === 'table')).toBe(false); // plain tables hidden unless they carry an issue
  });

  it('draws the external source, every Power Query step, and reports that name the measure', () => {
    const cat = catalog();
    const graph = buildModelGraph(cat);
    const sg = measureSubgraph({
      catalog: cat,
      graph,
      report: buildFidelityReport(cat, { graph }),
      measure: 'Fuel Share',
      reports: [
        { id: 'r1', name: 'CII SDK', measures: ['Fuel Share'] },
        { id: 'r2', name: 'Other report', measures: ['Region Count'] },
      ],
    })!;
    const source = sg.nodes.find((n) => n.kind === 'source')!;
    expect(source.label).toBe('Snowflake');
    expect(source.detail.summary).toMatch(/native query|SALES/i);
    const steps = sg.nodes.filter((n) => n.kind === 'pq_step');
    expect(steps.map((s) => s.label)).toEqual(['Source', 'Renamed Columns', 'Filtered Rows']);
    expect(sg.edges).toContainEqual({ from: source.id, to: steps[0]!.id });
    expect(sg.edges).toContainEqual({ from: steps[0]!.id, to: steps[1]!.id });
    expect(sg.edges).toContainEqual({ from: steps[1]!.id, to: steps[2]!.id });
    expect(sg.edges).toContainEqual({ from: steps[2]!.id, to: 'w:sales/fuel_heating_or_discharging_mt' });
    expect(sg.nodes.some((n) => n.kind === 'report' && n.label === 'CII SDK')).toBe(true);
    expect(sg.nodes.some((n) => n.label === 'Other report')).toBe(false);
    expect(sg.edges).toContainEqual({ from: measureNodeId('Fuel Share'), to: 'rep:r1' });
  });

  it('keeps an unmodeled Power Query step on the chain', () => {
    const cat = catalog();
    const sales = cat.tableMeta.get('sales')!;
    cat.tableMeta.set('sales', {
      ...sales,
      source_m: `let
    Source = Value.NativeQuery(Snowflake.Databases("acct","WH",[]){[Name="DB"]}[Data], "SELECT * FROM DB.S.SALES", null, [EnableFolding=true]),
    Combined = Table.Combine({Source})
in
    Combined`,
    });
    const graph = buildModelGraph(cat);
    const sg = measureSubgraph({
      catalog: cat,
      graph,
      report: buildFidelityReport(cat, { graph }),
      measure: 'Total Amount',
    })!;
    const combined = sg.nodes.find((n) => n.label === 'Combined');
    expect(combined?.kind).toBe('pq_step');
    expect(combined?.issues[0]?.kind).toBe('pq_unsupported');
    expect(sg.edges.some((e) => e.from === combined!.id || e.to === combined!.id)).toBe(true);
  });

  it('model overview groups every object by table, and impact walks the dependency edges', () => {
    const cat = catalog();
    const graph = buildModelGraph(cat);
    const ov = modelOverview({
      catalog: cat,
      graph,
      report: buildFidelityReport(cat, { graph }),
      status: new Map([
        ['total amount', 'recreated'],
        ['fuel total', 'blocked'],
      ]),
    });
    const sales = ov.groups.find((g) => g.id === 't:sales')!;
    expect(sales.counts).toEqual({ measure: 5, calc_column: 1, column: 3 });
    expect(sales.status.recreated).toBe(1);
    expect(sales.status.blocked).toBe(1);
    expect(sales.issues.block).toBe(1);
    expect(ov.relationships).toContainEqual({ from: 't:region', to: 't:sales', active: true, both: false });

    const adj = buildAdjacency(ov.edges);
    const drifted = columnNodeId('Sales', 'Fuel Heat/Disch');
    expect([...reach([drifted], adj, 'down')].sort()).toEqual(
      [measureNodeId('Fuel Share'), measureNodeId('Fuel Total')].sort(),
    );
    const sources = reach([measureNodeId('Amount With Tax')], adj, 'up');
    expect(sources.has(columnNodeId('Sales', 'Taxed'))).toBe(true);
    expect(sources.has(columnNodeId('Sales', 'Amount'))).toBe(true);
    expect(sources.has('t:sales')).toBe(true);
  });

  it('grid layout puts base objects left of the objects built on them and wraps tall columns', () => {
    const up = new Map([['m:c', ['m:a', 'm:b']]]);
    const ids = ['m:a', 'm:b', 'm:c', ...Array.from({ length: 13 }, (_, i) => `m:z${String(i).padStart(2, '0')}`)];
    const g = gridLayout(ids, up, { cellW: 100, cellH: 20, gapX: 10, gapY: 5, maxRows: 12 });
    expect(g.pos.get('m:c')!.x).toBeGreaterThan(g.pos.get('m:a')!.x);
    expect(g.h).toBe(12 * 25 - 5); // 15 depth-0 objects wrap into two columns of ≤ 12
    expect(new Set([...g.pos.values()].map((p) => p.x)).size).toBe(3);
  });

  it('model summary lists blocking issues first with the measures they block', () => {
    const cat = catalog();
    const s = modelGraphSummary({ catalog: cat, graph: buildModelGraph(cat), report: buildFidelityReport(cat) });
    expect(s.blocked).toBe(2);
    expect(s.issues[0]!.kind).toBe('replica_drift');
    expect(s.issues[0]!.measures).toEqual(['Fuel Share', 'Fuel Total']);
    expect(s.sources.snowflake).toBe(1);
  });
});

describe('fidelity gate (L0)', () => {
  it('flags replica drift and blocks exactly the measures that depend on it', () => {
    const report = buildFidelityReport(catalog());
    const drift = report.issues.filter((i) => i.kind === 'replica_drift');
    expect(drift).toHaveLength(1);
    expect(drift[0]!.object).toBe('Sales[Fuel Heat/Disch]');
    expect(drift[0]!.suggestion).toMatch(/FUEL_HEATING_MT \+ FUEL_DISCHARGING_MT/);
    expect(report.blocked.sort()).toEqual(['Fuel Share', 'Fuel Total']);
    expect(blockingIssuesFor(report, 'total amount')).toEqual([]);
  });

  it('a drifted row-filter column blocks every measure on the table', () => {
    const report = buildFidelityReport(
      catalog({ warehouse: ['AMOUNT', 'REGION_ID', 'FUEL_HEATING_MT', 'FUEL_DISCHARGING_MT'] }),
    );
    expect(report.issues.some((i) => i.kind === 'replica_drift' && /row filter reads source column STATUS/.test(i.detail))).toBe(true);
    expect(report.blocked).toContain('Total Amount');
    expect(report.blocked).not.toContain('Region Count');
  });

  it('resolver-approved column overrides clear the drift', () => {
    const report = buildFidelityReport(catalog(), {
      columnOverrides: { sales: { fuel_heating_or_discharging_mt: 'FUEL_HEATING_MT' } },
    });
    expect(report.blocked).toEqual([]);
  });

  it('skips the schema check when the warehouse schema is unknown or the native query is not a passthrough', () => {
    expect(buildFidelityReport(catalog({ warehouse: [] })).blocked).toEqual([]);
    const custom = catalog();
    custom.tableMeta.get('sales')!.source_m = SALES_M.replace('SELECT * FROM DB.S.SALES', 'SELECT AMOUNT AS A FROM DB.S.SALES');
    expect(buildFidelityReport(custom).issues.filter((i) => i.kind === 'replica_drift')).toEqual([]);
  });

  it('flags unparseable and empty DAX without double-reporting', () => {
    const report = buildFidelityReport(
      catalog({ measures: { Broken: 'SUM(Sales[Amount]', Empty: '// retired\n/* SUM(Sales[Amount]) */' } }),
    );
    expect(report.issues.filter((i) => i.object === 'Broken').map((i) => i.kind)).toEqual(['dax_parse_error']);
    expect(report.issues.filter((i) => i.object === 'Empty').map((i) => i.kind)).toEqual(['empty_measure']);
  });

  it('classifies source systems by connector', () => {
    expect(classifySource(SALES_M, true)).toBe('snowflake');
    expect(classifySource('let Source = PowerPlatform.Dataflows(null) in Source', false)).toBe('dataflow');
    expect(classifySource('CALENDAR(DATE(2020,1,1), TODAY())', false)).toBe('dax_calculated');
    expect(isPassthroughQuery('select * from reporting_layer.qhse.bi_vw_x')).toBe(true);
    expect(isPassthroughQuery('select distinct * from x')).toBe(false);
  });

  it('detects split columns generically', () => {
    expect(detectSplitColumn('A_HEAT_OR_COOL_MT', ['A_HEAT_MT', 'A_COOL_MT'])).toEqual(['A_HEAT_MT', 'A_COOL_MT']);
    expect(detectSplitColumn('A_HEAT_OR_COOL_MT', ['A_HEAT_MT'])).toBeNull();
  });

  it('root cause maps fidelity blocks to replica_drift', () => {
    const rc = classifyRootCause({
      stage: 'no_sql',
      dax: 'SUM(Sales[Fuel Heat/Disch])',
      tier: 'fidelity_gate',
      props: { fidelity_block: { reason: 'Sales[Fuel Heat/Disch]: missing', issues: [{ kind: 'replica_drift' }] } },
      catalog: null,
    });
    expect(rc?.category).toBe('replica_drift');
  });
});
