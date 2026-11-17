import { describe, expect, it } from 'vitest';

import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelHighLevelLineage } from '@/lib/powerbi/model-lineage-summary';
import { resolveReportMeasureLineage } from '@/lib/powerbi/report-lineage';
import { summarizeReportLineageCoverage } from '@/lib/powerbi/report-lineage-coverage';
import { describeInventoryConnection, describeReportTableSource, redactSourceDetail } from '@/lib/powerbi/report-lineage-sources';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectReportMeasureRefs,
  storedMeasureRefs,
  summarizeReportDefinitionDir,
} from '@/lib/powerbi/report-measure-refs';

function miniCatalog(): MeasureLogicCatalog {
  const columnsByTable = new Map<string, Map<string, { source_column: string | null; calculated_dax: string | null }>>();
  const fact = new Map<string, { source_column: string | null; calculated_dax: string | null }>();
  const amountCol = { source_column: 'amount', calculated_dax: null };
  fact.set('Amount', amountCol);
  fact.set('amount', amountCol);
  columnsByTable.set('fact', fact);

  const tableMeta = new Map([
    [
      'fact',
      {
        displayName: 'Fact',
        uc_full_path: 'curated.opex.fact_spend',
        source_m: 'let Source = #table(1, {}) in Source',
        warehouse_columns: ['amount'],
      },
    ],
  ]);

  const measures = new Map([
    ['total spend', { name: 'Total Spend', table: 'Fact', dax: 'SUM(Fact[amount])' }],
  ]);

  return { columnsByTable, tableMeta, measures, relationships: [], rules: [], queryCulture: null };
}

describe('report lineage coverage', () => {
  const props = {
    definition: { storage_path: 'reports/r1', content_hash: 'hash', fetched_at: '2026-11-16T08:00:00Z' },
    parse: { parsed_at: '2026-11-16T09:00:00Z', definition_hash: 'hash', measure_refs: [] },
  };

  it('counts parsed zero-measure reports and counts shared models once', () => {
    const coverage = summarizeReportLineageCoverage([
      { model_id: 'm1', props }, { model_id: 'm1', props }, { model_id: null, props: {} },
    ], [{ id: 'm1', props, tables: [
      { partition_kind: 'warehouse_query', sourceBinding: { uc_full_path: 'c.s.t' } },
      { partition_kind: 'warehouse_query', sourceBinding: null },
      { partition_kind: 'embedded', sourceBinding: null },
    ] }]);
    expect(coverage).toEqual({
      reports: 3, definitions: 2, parsed_reports: 2, missing_models: 1,
      models: 1, parsed_models: 1, warehouse_tables: 2, unresolved_tables: 1, non_warehouse_tables: 1,
    });
  });

  it('flags stale parses instead of claiming full coverage', () => {
    const coverage = summarizeReportLineageCoverage([{ model_id: 'm1', props: {
      ...props, parse: { parsed_at: '2026-11-15T09:00:00Z' },
    } }], [{ id: 'm1', props: { ...props, parse: { parsed_at: 'today', definition_hash: 'old' } }, tables: [] }]);
    expect(coverage.parsed_reports).toBe(0);
    expect(coverage.parsed_models).toBe(0);
  });
});

describe('report-measure-refs', () => {
  it('summarizes PBIR definition folders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbir-'));
  const page = path.join(dir, 'definition', 'pages', 'p1', 'visuals', 'v1');
    fs.mkdirSync(page, { recursive: true });
    fs.writeFileSync(
      path.join(page, 'visual.json'),
      '{"query":{"Measures":[{"Measure":{"Property":"Revenue KPI"}}]}}',
    );
    fs.mkdirSync(path.join(dir, 'definition', 'pages', 'p2'));
    const summary = summarizeReportDefinitionDir(dir);
    expect(summary.measureRefs).toContain('Revenue KPI');
    expect(summary.pageCount).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads measure_refs from props.parse', () => {
    expect(storedMeasureRefs({ parse: { measure_refs: ['A', 'B'] } })).toEqual(['A', 'B']);
    expect(
      collectReportMeasureRefs({
        parse: { measure_refs: ['M1'], page_count: 3 },
      }).measures,
    ).toEqual(['M1']);
  });
});

describe('resolveReportMeasureLineage', () => {
  it('keeps Direct Lake identity and explicit schema/entity paths without Power Query', () => {
    const source = describeReportTableSource('Sales', 'schemaName: dbo\nentityName: Sales', null, new Map(), {
      name: 'Sales', partition_kind: 'unknown', storage_mode: 'directLake', sourceBinding: null,
    });
    expect(source.origins[0]).toMatchObject({ system: 'fabric', connector: 'Direct Lake', object: 'dbo.Sales' });
  });

  it('retains safe inventory connection details but not credentials', () => {
    const connection = describeInventoryConnection({
      datasource_type: 'Sql', connection_server: null, connection_path: null, gateway_id: null, datasource_id: 'source',
      raw: { connectionDetails: { server: 'database.example.test', database: 'Finance', password: 'must-not-be-exposed' } },
    });
    expect(connection).toMatchObject({ server: 'database.example.test', database: 'Finance' });
    expect(JSON.stringify(connection)).not.toContain('must-not-be-exposed');
  });

  it('retains Fabric SQL endpoint and schema/table navigation without a UC binding', () => {
    const source = describeReportTableSource('Orders',
      'let S = Sql.Database("endpoint.datawarehouse.fabric.microsoft.com", "Finance"), T = S{[Schema="dbo",Item="Orders"]}[Data] in T', null);
    expect(source.origins[0]).toMatchObject({ system: 'fabric', database: 'Finance', object: 'dbo.Orders' });
    expect(source.navigation[0]?.fields).toEqual({ Schema: 'dbo', Item: 'Orders' });
  });

  it('retains Fabric lakehouse workspace/item identifiers and table navigation', () => {
    const source = describeReportTableSource('Sales',
      'let S = Lakehouse.Contents(null), W = S{[workspaceId="workspace-id"]}[Data], L = W{[lakehouseId="lakehouse-id"]}[Data], T = L{[Id="Sales",ItemKind="Table"]}[Data] in T', null);
    expect(source.origins[0]?.system).toBe('fabric');
    expect(source.navigation.map((step) => step.fields)).toEqual([
      { workspaceId: 'workspace-id' }, { lakehouseId: 'lakehouse-id' }, { Id: 'Sales', ItemKind: 'Table' },
    ]);
  });

  it('redacts credential-like parameters without losing the source path', () => {
    expect(redactSourceDetail('https://files.example.test/container/data.csv?sig=secret&version=2')).toBe('https://files.example.test/container/data.csv?sig=[redacted]&version=2');
  });

  it('retains SharePoint/file origins without requiring a UC binding', () => {
    const cat = miniCatalog();
    cat.tableMeta.set('fact', {
      displayName: 'Fact', uc_full_path: null,
      source_m: 'let S = Excel.Workbook(File.Contents("C:\\exports\\budget.xlsx"), null, true), T = S{[Item="Budget",Kind="Sheet"]}[Data] in T',
    });
    const result = resolveReportMeasureLineage(cat, ['Total Spend']);
    expect(result.uc_paths).toEqual([]);
    expect(result.measures[0]?.sources[0]?.origins[0]).toMatchObject({
      system: 'local_file', location: 'C:\\exports\\budget.xlsx', file: 'budget.xlsx',
      items: [{ name: 'Budget', kind: 'Sheet' }],
    });
    expect(result.sources[0]?.referenced_by_measures).toEqual(['Total Spend']);
  });

  it('keeps model-wide and unknown sources even when no report measures are available', () => {
    const cat = miniCatalog();
    cat.tableMeta.set('unknown', { displayName: 'Unknown', source_m: null, uc_full_path: null });
    const result = resolveReportMeasureLineage(cat, []);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.find((source) => source.table === 'Unknown')).toMatchObject({
      origins: [{ system: 'unknown' }], referenced_by_measures: [],
    });
  });

  it('maps known measures to UC paths', () => {
    const cat = miniCatalog();
    const { measures, uc_paths } = resolveReportMeasureLineage(cat, ['Total Spend', 'Ghost Measure']);
    expect(measures).toHaveLength(2);
    const total = measures.find((m) => m.name === 'Total Spend');
    expect(total?.found_in_model).toBe(true);
    expect(total?.uc_paths).toContain('curated.opex.fact_spend');
    expect(uc_paths).toContain('curated.opex.fact_spend');
    expect(measures.find((m) => m.name === 'Ghost Measure')?.found_in_model).toBe(false);
  });
});

describe('buildModelHighLevelLineage', () => {
  it('rolls up reports and warehouse bindings', () => {
    const cat = miniCatalog();
    const summary = buildModelHighLevelLineage({
      modelId: 'm1',
      modelName: 'Test',
      catalog: cat,
      reportConsumers: [{ id: 'r1', name: 'Dash', measures: ['Total Spend'] }],
    });
    expect(summary.counts.reports).toBe(1);
    expect(summary.counts.warehouse_bound).toBe(1);
    expect(summary.uc_paths).toContain('curated.opex.fact_spend');
    expect(summary.reports[0]?.measure_count).toBe(1);
  });
});