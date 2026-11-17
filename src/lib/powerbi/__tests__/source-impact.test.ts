import { describe, expect, it } from 'vitest';
import {
  MAX_DRAWN,
  NODE_SEP,
  buildSourceImpact,
  buildSourceTree,
  nodeIdForKey,
  normalizeOrigin,
  originPath,
  type ImpactRow,
} from '@/lib/powerbi/source-impact';
import { originKey } from '@/lib/powerbi/report-lineage-graph';
import type { SourceOrigin } from '@/lib/powerbi/source-origin';

const origin = (o: Partial<SourceOrigin> & Pick<SourceOrigin, 'system'>): SourceOrigin => ({
  connector: null, format: null, location: null, folder: null, file: null, items: [], database: null, object: null, query: null, via: [], ...o,
});

const factSales = origin({ system: 'databricks', location: 'adb-1.azuredatabricks.net', database: 'prod', object: 'gold.fact_sales' });
const dimProduct = origin({ system: 'databricks', location: 'adb-1.azuredatabricks.net', database: 'prod', object: 'gold.dim_product' });
const excel = origin({
  system: 'sharepoint', format: 'excel', location: 'https://contoso.sharepoint.com/sites/Finance',
  folder: 'https://contoso.sharepoint.com/sites/Finance/Shared Documents/Targets/', file: 'Targets.xlsx', items: [{ name: 'Targets', kind: 'Table' }],
});

const row = (report: string, model: string, table: string, refs: string[], o: unknown, status = 'ready'): ImpactRow => ({
  report_id: report, report_name: `Report ${report}`, status, model_id: model, model_name: `Model ${model}`, table, refs, origin: o,
});

const rows: ImpactRow[] = [
  row('r1', 'm1', 'SalesTargets', ['Attainment'], excel, 'partial'),
  row('r2', 'm1', 'SalesTargets', ['Attainment', 'Gap'], excel),
  row('r3', 'm2', 'Targets', [], excel),
  row('r1', 'm1', 'FactSales', ['Revenue'], factSales),
  row('r4', 'm3', 'Product', ['Margin'], dimProduct),
  row('r1', 'm1', 'Calendar', [], { ...excel, system: 'calculated' }),
  row('r1', 'm1', 'Broken', [], 'not an origin'),
];

const id = (...parts: string[]) => parts.join(NODE_SEP);

describe('originPath', () => {
  it('follows each system’s own hierarchy', () => {
    expect(originPath(factSales).map((s) => `${s.level}:${s.label}`)).toEqual([
      'System:Databricks', 'Workspace:adb-1.azuredatabricks.net', 'Catalog:prod', 'Schema:gold', 'Table:fact_sales',
    ]);
    expect(originPath(origin({ system: 'sql_server', location: 'sqlprod01', database: 'Planning', object: 'dbo.Forecast' })).map((s) => s.level))
      .toEqual(['System', 'Server', 'Database', 'Schema', 'Table']);
    expect(originPath(excel).map((s) => `${s.level}:${s.label}`)).toEqual([
      'System:SharePoint', 'Site:sites/Finance', 'Folder:Shared Documents/Targets/', 'File:Targets.xlsx', 'Sheet:Targets',
    ]);
  });

  it('drops a repeated database prefix and names native queries and missing levels', () => {
    const snowflake = origin({ system: 'snowflake', location: 'xy.snowflakecomputing.com', database: 'CORE', object: 'CORE.REF.REGIONS' });
    expect(originPath(snowflake).map((s) => s.label)).toEqual(['Snowflake', 'xy.snowflakecomputing.com', 'CORE', 'REF', 'REGIONS']);
    expect(originPath(origin({ system: 'oracle', location: 'ora01', query: 'SELECT 1 FROM dual' })).map((s) => s.label))
      .toEqual(['Oracle', 'ora01', 'Native query']);
    expect(originPath(origin({ system: 'local_file', location: 'C:\\exports\\budget.xlsx', file: 'budget.xlsx' })).map((s) => s.label))
      .toEqual(['File path', 'C:\\exports', 'budget.xlsx']);
  });
});

describe('source tree', () => {
  it('counts reports, models and sources at every level, systems in class order', () => {
    const tree = buildSourceTree(rows);
    expect(tree.filter((n) => n.depth === 0).map((n) => [n.label, n.sources, n.reports])).toEqual([['Databricks', 2, 2], ['SharePoint', 1, 3]]);
    const schema = tree.find((n) => n.level === 'Schema')!;
    expect(schema).toMatchObject({ label: 'gold', leaf: false, sources: 2, reports: 2, models: 2 });
    expect(tree.find((n) => n.label === 'fact_sales')).toMatchObject({ leaf: true, parent: schema.id, depth: 4 });
    // depth-first order: a node's children follow it
    const i = tree.indexOf(schema);
    expect(tree.slice(i + 1, i + 3).every((n) => n.parent === schema.id)).toBe(true);
  });

  it('finds the node for a report page source key', () => {
    expect(nodeIdForKey(rows, originKey(excel))).toBe(id('sharepoint', 'sites/Finance', 'Shared Documents/Targets/', 'Targets.xlsx', 'Targets'));
    expect(nodeIdForKey(rows, 'nope')).toBeNull();
  });
});

describe('source impact', () => {
  it('builds source → tables → measures → reports for a leaf, with model-wide links', () => {
    const impact = buildSourceImpact(rows, nodeIdForKey(rows, originKey(excel))!)!;
    expect(impact.scope).toMatchObject({ level: 'Sheet', label: 'Targets', leaf: true, cls: 'file' });
    expect(impact.breadcrumb.map((c) => c.label)).toEqual(['SharePoint', 'sites/Finance', 'Shared Documents/Targets/', 'Targets.xlsx', 'Targets']);
    expect(impact.tables.map((t) => `${t.model_name}/${t.name}`)).toEqual(['Model m1/SalesTargets', 'Model m2/Targets']);
    expect(impact.measures.map((m) => m.name)).toEqual(['Attainment', 'Gap']);
    expect(impact.reports.map((r) => [r.name, r.measure_ids.length, r.model_wide_table_ids.length])).toEqual([
      ['Report r1', 1, 0], ['Report r2', 2, 0], ['Report r3', 0, 1],
    ]);
    expect(impact.edges.filter((e) => e.kind === 'model_wide')).toEqual([{ from: 't:m2|targets', to: 'r3', kind: 'model_wide', cls: 'file' }]);
  });

  it('unions everything under a higher level, such as a whole schema', () => {
    const impact = buildSourceImpact(rows, id('databricks', 'adb-1.azuredatabricks.net', 'prod', 'gold'))!;
    expect(impact.scope).toMatchObject({ level: 'Schema', label: 'gold', leaf: false });
    expect(impact.sources.map((s) => s.title).sort()).toEqual(['gold.dim_product', 'gold.fact_sales']);
    expect(impact.reports.map((r) => r.name)).toEqual(['Report r1', 'Report r4']);
    expect(impact.edges.filter((e) => e.from.startsWith('s:'))).toHaveLength(2);
    expect(impact.hidden_sources).toBe(0);
  });

  it('returns null for an unknown node and normalizes partial origins', () => {
    expect(buildSourceImpact(rows, 'nope')).toBeNull();
    expect(normalizeOrigin({ system: 'web', location: 'https://x' })).toMatchObject({ items: [], via: [], file: null });
    expect(normalizeOrigin(null)).toBeNull();
  });
});

describe('source impact at estate scale', () => {
  // One catalog, 3 schemas x 30 tables = 90 tables; each table read by its own model table in 1 of 9 models,
  // each model table used by 3 measures, every model in 2 reports.
  const wide: ImpactRow[] = [];
  for (let s = 0; s < 3; s++) {
    for (let t = 0; t < 30; t++) {
      const model = `m${(s * 30 + t) % 9}`;
      const o = origin({ system: 'databricks', location: 'adb-1.azuredatabricks.net', database: 'prod', object: `s${s}.t${String(t).padStart(2, '0')}` });
      for (const report of [`${model}-a`, `${model}-b`]) wide.push(row(report, model, `T${s}_${t}`, ['A', 'B', 'C'].map((m) => `${m} ${s}_${t}`), o));
    }
  }
  const catalog = id('databricks', 'adb-1.azuredatabricks.net', 'prod');

  it('caps every graph lane and only draws nodes connected to something drawn', () => {
    const impact = buildSourceImpact(wide, catalog)!;
    expect(impact.totals).toEqual({ sources: 90, leaves: 90, tables: 90, measures: 270, reports: 18, models: 9 });
    expect([impact.sources.length, impact.tables.length, impact.measures.length]).toEqual([MAX_DRAWN, MAX_DRAWN, MAX_DRAWN]);
    expect(impact.hidden_sources + impact.sources.length).toBe(90);
    expect(impact.hidden_tables + impact.tables.length).toBe(90);
    expect(impact.hidden_measures + impact.measures.length).toBe(270);
    const into = new Set(impact.edges.map((e) => e.to));
    const ids = new Set([...impact.sources, ...impact.tables, ...impact.measures, ...impact.reports].map((n) => n.id));
    for (const node of [...impact.tables, ...impact.measures, ...impact.reports]) expect(into.has(node.id)).toBe(true);
    for (const edge of impact.edges) expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    for (const report of impact.reports) expect(report.measure_count).toBeGreaterThanOrEqual(report.measure_ids.length);
  });

  it('lists every table and report under the scope for browsing', () => {
    const impact = buildSourceImpact(wide, catalog)!;
    expect(impact.leaf_level).toBe('Table');
    expect(impact.source_rows).toHaveLength(90);
    expect(impact.source_rows[0]).toMatchObject({
      label: 't00', path: 's0', parents: [{ id: id(...catalog.split(NODE_SEP), 's0'), level: 'Schema', label: 's0' }],
      level: 'Table', reports: 2, models: 1, tables: 1, measures: 3,
    });
    expect(impact.report_rows).toHaveLength(18);
    expect(impact.report_rows.every((r) => r.sources === 10 && r.measures === 30)).toBe(true);
    const leaf = buildSourceImpact(wide, impact.source_rows[0]!.id)!;
    expect(leaf.scope.leaf).toBe(true);
    expect(leaf.source_rows.map((r) => [r.label, r.path, r.parents])).toEqual([['t00', null, []]]);
    const workspace = buildSourceImpact(wide, id('databricks', 'adb-1.azuredatabricks.net'))!;
    expect(workspace.source_rows[0]!.parents.map((p) => `${p.level}:${p.label}`)).toEqual(['Catalog:prod', 'Schema:s0']);
  });

  it('labels tree nodes with the level of their leaves', () => {
    const tree = buildSourceTree(wide);
    expect(tree.find((n) => n.id === catalog)).toMatchObject({ sources: 90, leaf_level: 'Table', reports: 18, measures: 270 });
    expect(buildSourceTree(wide)).toBe(tree); // derived once per rows array
  });

  it('narrows the graph to the paths through one focused node, keeping totals and lists', () => {
    const report = buildSourceImpact(wide, catalog, 'm0-a')!;
    expect(report.focus).toEqual({ id: 'm0-a', kind: 'report', label: 'Report m0-a' });
    expect(report.reports.map((r) => r.id)).toEqual(['m0-a']);
    expect(report.sources).toHaveLength(10); // every table model m0 reads, none lost to the lane cap
    expect([report.hidden_sources, report.hidden_tables, report.hidden_measures, report.hidden_reports]).toEqual([0, 0, 0, 0]);
    expect(report.totals.leaves).toBe(90);
    expect(report.source_rows).toHaveLength(90);

    const table = buildSourceImpact(wide, catalog, 't:m0|t0_0')!;
    expect(table.focus).toMatchObject({ kind: 'table', label: 'T0_0' });
    expect([table.sources.length, table.tables.length, table.measures.length, table.reports.length]).toEqual([1, 1, 3, 2]);

    const measure = buildSourceImpact(wide, catalog, 'm:m0|a 0_0')!;
    expect(measure.focus).toMatchObject({ kind: 'measure', label: 'A 0_0' });
    expect(measure.measures.map((m) => m.name)).toEqual(['A 0_0']);
    expect(measure.reports.map((r) => r.id).sort()).toEqual(['m0-a', 'm0-b']);

    const source = buildSourceImpact(wide, catalog)!.sources[0]!;
    const fromSource = buildSourceImpact(wide, catalog, source.id)!;
    expect(fromSource.focus).toMatchObject({ kind: 'source', label: source.title });
    expect(fromSource.sources.map((s) => s.id)).toEqual([source.id]);
    expect(fromSource.sources[0]!.path).toMatch(/^s\d$/);

    const unknown = buildSourceImpact(wide, catalog, 'nope')!;
    expect(unknown.focus).toBeNull();
    expect(unknown.sources).toHaveLength(MAX_DRAWN);
  });

  it('keeps model-wide links when focused on a report without measures', () => {
    const impact = buildSourceImpact(rows, nodeIdForKey(rows, originKey(excel))!, 'r3')!;
    expect(impact.reports.map((r) => r.id)).toEqual(['r3']);
    expect(impact.edges.filter((e) => e.kind === 'model_wide')).toEqual([{ from: 't:m2|targets', to: 'r3', kind: 'model_wide', cls: 'file' }]);
  });
});

