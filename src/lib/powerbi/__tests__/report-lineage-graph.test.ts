import { describe, expect, it } from 'vitest';
import {
  REPORT_NODE_ID,
  buildLineageGraph,
  lineageReadiness,
  lineageRows,
  lineageRowsToTsv,
  liveLineageStatus,
  originKey,
  shortLocation,
  traceRelated,
} from '@/lib/powerbi/report-lineage-graph';
import { describeReportTableSource, type ReportLineageTableMetadata } from '@/lib/powerbi/report-lineage-sources';
import type { ReportLineagePayload, ReportLineageTableSource } from '@/lib/powerbi/report-lineage-types';
import type { SourceOrigin } from '@/lib/powerbi/source-origin';

const meta = (name: string, partition_kind: string | null, uc: string | null = null): ReportLineageTableMetadata => ({
  name, partition_kind, storage_mode: 'Import',
  sourceBinding: uc ? { connector: 'databricks', connection_host: null, native_sql: null, bind_status: 'matched', uc_full_path: uc } : null,
});

const DATABRICKS = (table: string) => `let S = Databricks.Catalogs("adb-1.azuredatabricks.net", "/sql/1.0/warehouses/w", []),
  C = S{[Name="prod",Kind="Database"]}[Data], Sc = C{[Name="gold",Kind="Schema"]}[Data], T = Sc{[Name="${table}",Kind="Table"]}[Data] in T`;
const EXCEL = 'let S = Excel.Workbook(File.Contents("C:\\plans\\targets.xlsx"), null, true), T = S{[Item="Targets",Kind="Sheet"]}[Data] in T';
const SQL = 'let S = Sql.Database("sqlprod01", "Planning"), T = S{[Schema="dbo",Item="Region"]}[Data] in T';

function source(table: string, m: string | null, metadata: ReportLineageTableMetadata, refs: string[]): ReportLineageTableSource {
  const described = describeReportTableSource(table, m, metadata.sourceBinding?.uc_full_path ?? null, new Map(), metadata);
  return { ...described, referenced_by_measures: refs };
}

function payload(): ReportLineagePayload {
  const sales = source('FactSales', DATABRICKS('fact_sales'), meta('FactSales', 'warehouse_query', 'prod.gold.fact_sales'), ['Revenue', 'Attainment']);
  const product = source('DimProduct', DATABRICKS('dim_product'), meta('DimProduct', 'warehouse_query', 'prod.gold.dim_product'), ['Revenue']);
  const targets = source('Targets', EXCEL, meta('Targets', 'other_file'), ['Attainment']);
  const region = source('Region', SQL, meta('Region', 'warehouse_query'), ['Attainment']);
  const archive = source('Archive', null, meta('Archive', 'unknown'), []);
  return {
    report: { id: 'r1', name: 'Sales report', pbi_report_id: 'pbi-r1', model_id: 'm1', model_name: 'Sales model' },
    harvest: { page_count: 3, measure_count: 3, has_definition_on_disk: true, from_props_count: 3, from_disk_count: 3 },
    measures: [
      { name: 'Revenue', found_in_model: true, measure_table: 'FactSales', tables_involved: ['FactSales', "'DimProduct'"], uc_paths: [], sources: [sales, product] },
      { name: 'Attainment', found_in_model: true, measure_table: '_Measures', tables_involved: ['FactSales', 'Targets', 'Region'], uc_paths: [], sources: [] },
      { name: 'Ghost', found_in_model: false, measure_table: null, tables_involved: [], uc_paths: [], sources: [] },
    ],
    sources: [archive, region, targets, product, sales],
    source_connections: [],
    uc_paths: ['prod.gold.dim_product', 'prod.gold.fact_sales'],
    warnings: [],
  };
}

describe('buildLineageGraph', () => {
  it('builds source → table → measure → report lanes, ordered warehouse first', () => {
    const graph = buildLineageGraph(payload());
    expect(graph.sources.map((s) => s.cls)).toEqual(['warehouse', 'warehouse', 'database', 'file', 'unknown']);
    expect(graph.tables.map((t) => t.name)).toEqual(['DimProduct', 'FactSales', 'Region', 'Targets', 'Archive']);
    expect(graph.tables.find((t) => t.name === 'Targets')!.binding).toBe('file');
    expect(graph.tables.find((t) => t.name === 'Region')!.binding).toBe('unbound');
    expect(graph.tables.find((t) => t.name === 'FactSales')!.binding).toBe('bound');
    expect(graph.tables.find((t) => t.name === 'Archive')).toMatchObject({ binding: 'unknown', modelWide: true });
  });

  it('links measures through their own DAX analysis, including quoted table names', () => {
    const graph = buildLineageGraph(payload());
    const revenue = graph.measures.find((m) => m.measure.name === 'Revenue')!;
    expect(revenue.tableIds).toEqual(['t:factsales', 't:dimproduct']);
    const attainment = graph.measures.find((m) => m.measure.name === 'Attainment')!;
    expect(attainment.classes).toEqual(['warehouse', 'database', 'file']);
    expect(graph.measures.at(-1)!.measure.name).toBe('Ghost');
  });

  it('marks model-wide and unresolved edges', () => {
    const { edges } = buildLineageGraph(payload());
    expect(edges.filter((e) => e.kind === 'model_wide').map((e) => [e.from, e.to])).toEqual([
      [expect.stringMatching(/^s:/), 't:archive'], ['t:archive', REPORT_NODE_ID],
    ]);
    expect(edges.filter((e) => e.kind === 'unresolved')).toEqual([{ from: 'm:ghost', to: REPORT_NODE_ID, kind: 'unresolved', cls: null }]);
  });

  it('hides model-wide tables and their sources when asked', () => {
    const graph = buildLineageGraph(payload(), { showModelWide: false });
    expect(graph.tables.map((t) => t.name)).not.toContain('Archive');
    expect(graph.sources.some((s) => s.cls === 'unknown')).toBe(false);
  });

  it('shares one source node between tables reading the same place', () => {
    const p = payload();
    const copy = source('SalesCopy', DATABRICKS('fact_sales'), meta('SalesCopy', 'warehouse_query'), ['Revenue']);
    const graph = buildLineageGraph({ ...p, sources: [...p.sources, copy] });
    const shared = graph.sources.find((s) => s.title === 'gold.fact_sales' || s.origin.object?.includes('fact_sales'))!;
    expect(shared.tableIds.sort()).toEqual(['t:factsales', 't:salescopy']);
  });
});

describe('traceRelated', () => {
  it('returns everything upstream and downstream of a node', () => {
    const graph = buildLineageGraph(payload());
    const file = graph.sources.find((s) => s.cls === 'file')!;
    const { nodes, edges } = traceRelated(graph.edges, [file.id]);
    expect([...nodes].sort()).toEqual([file.id, 'm:attainment', REPORT_NODE_ID, 't:targets'].sort());
    expect(edges.size).toBe(3);
  });
});

describe('lineageReadiness', () => {
  it('explains what keeps the report partial, tied to graph nodes', () => {
    const p = payload();
    const graph = buildLineageGraph(p);
    const items = lineageReadiness(p, graph);
    expect(items.map((i) => [i.id, i.tone])).toEqual([
      ['unknown-sources', 'bad'], ['missing-measures', 'warn'], ['unbound', 'warn'], ['bound', 'ok'], ['files', 'ok'], ['resolved', 'ok'],
    ]);
    expect(items.find((i) => i.id === 'unbound')!.nodeIds).toEqual(['t:region']);
    expect(liveLineageStatus(items)).toBe('partial');
  });

  it('is ready when everything is traced and blocked without a definition', () => {
    const p = payload();
    const clean = { ...p, measures: p.measures.slice(0, 1), sources: p.sources.filter((s) => ['FactSales', 'DimProduct'].includes(s.table)) };
    expect(liveLineageStatus(lineageReadiness(clean, buildLineageGraph(clean)))).toBe('ready');
    const missing = { ...clean, harvest: { ...clean.harvest, has_definition_on_disk: false, from_props_count: 0 } };
    expect(liveLineageStatus(lineageReadiness(missing, buildLineageGraph(missing)))).toBe('blocked');
  });
});

describe('lineageRows', () => {
  it('flattens to one row per measure × table × source, keeping unresolved and model-wide rows', () => {
    const rows = lineageRows(buildLineageGraph(payload()));
    expect(rows).toHaveLength(2 + 3 + 1 + 1);
    expect(rows.find((r) => r.measure === 'Ghost')).toMatchObject({ table: null, measureFound: false });
    expect(rows.find((r) => r.measure === null)).toMatchObject({ table: 'Archive', binding: 'unknown' });
    const tsv = lineageRowsToTsv(rows).split('\n');
    expect(tsv[0]).toBe('measure\tmodel_table\tstorage_mode\tsource_system\tlocation\tdatabase_or_folder\tobject_or_file\tunity_catalog');
    expect(tsv.every((line) => line.split('\t').length === 8)).toBe(true);
  });
});

describe('source labels', () => {
  it('groups URLs by site or host and keeps paths and hosts as they are', () => {
    expect(shortLocation('https://contoso.sharepoint.com/sites/Finance/Shared Documents')).toBe('sites/Finance');
    expect(shortLocation('https://fx.example.net/daily_rates.csv?x=1')).toBe('fx.example.net');
    expect(shortLocation('adb-1.azuredatabricks.net')).toBe('adb-1.azuredatabricks.net');
    expect(shortLocation('C:\\exports\\')).toBe('C:\\exports');
  });
});

describe('originKey', () => {
  const origin = (system: SourceOrigin['system'], object: string | null): SourceOrigin => ({
    system, connector: null, format: null, location: 'host', folder: null, file: null, items: [], database: 'db', object, query: null, via: [],
  });
  it('matches shareable sources across tables and keeps in-model sources apart', () => {
    expect(originKey(origin('snowflake', 'REF.REGIONS'), 'A')).toBe(originKey(origin('snowflake', 'ref.regions'), 'B'));
    expect(originKey(origin('calculated', null), 'A')).not.toBe(originKey(origin('calculated', null), 'B'));
  });
});
