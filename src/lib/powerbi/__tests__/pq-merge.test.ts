import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { decodeEmbeddedTable, parseMLineage } from '@/lib/powerbi/m-lineage';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph, measureNodeId } from '@/lib/powerbi/model-graph';

// Mirrors the CII model (2026-11-14): Log ← merge Details ← (Master warehouse table ⨝ embedded Dwts).
const rows = [
  ['VESSEL A', '9000001', '50000'],
  ['VESSEL B', '9000002', null],
];
const b64 = deflateRawSync(Buffer.from(JSON.stringify(rows))).toString('base64');

const DWTS_M = `let
    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("${b64}", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [VESSEL_NAME = _t, IMO_NUMBER = _t, #"DEAD WEIGHT" = _t]),
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"IMO_NUMBER", Int64.Type}, {"DEAD WEIGHT", Int64.Type}}),
    #"Renamed Columns" = Table.RenameColumns(#"Changed Type",{{"DEAD WEIGHT", "DWT"}})
in
    #"Renamed Columns"`;

const DETAILS_M = `let
    Source = Table.NestedJoin(Master, {"IMO_NO"}, Dwts, {"IMO_NUMBER"}, "Dwt rows", JoinKind.LeftOuter),
    #"Expanded Dwt rows" = Table.ExpandTableColumn(Source, "Dwt rows", {"DWT"}),
    #"Added Custom" = Table.AddColumn(#"Expanded Dwt rows", "Ref", each 1000 * Number.Power([DWT], -0.5)),
    #"Renamed Columns" = Table.RenameColumns(#"Added Custom",{{"IMO_NO", "IMO Number"}})
in
    #"Renamed Columns"`;

const LOG_M = `let
    Source = Databricks.Catalogs("host", "/sql/1.0/warehouses/x", [Catalog="c"]){[Name="c",Kind="Database"]}[Data],
    T = Source{[Name="s"]}[Data]{[Name="log"]}[Data],
    #"Renamed Columns" = Table.RenameColumns(T,{{"IMO_NO", "IMO Number"}, {"REPORT_DATE", "Date"}}),
    #"Split Column by Delimiter" = Table.SplitColumn(Table.TransformColumnTypes(#"Renamed Columns", {{"Date", type text}}, "en-US"), "Date", Splitter.SplitTextByDelimiter(" ", QuoteStyle.None), {"Date.1", "Date.2"}),
    #"Changed Type3" = Table.TransformColumnTypes(#"Split Column by Delimiter",{{"Date.1", type date}}),
    #"Renamed Columns2" = Table.RenameColumns(#"Changed Type3",{{"Date.1", "Date"}}),
    #"Merged Queries" = Table.NestedJoin(#"Renamed Columns2", {"IMO Number"}, #"Details", {"IMO Number"}, "Details", JoinKind.LeftOuter),
    #"Expanded Details" = Table.ExpandTableColumn(#"Merged Queries", "Details", {"DWT", "Ref"}, {"DWT", "Ref Line"}),
    #"Filtered Rows" = Table.SelectRows(#"Expanded Details", each [DWT] <> null)
in
    #"Filtered Rows"`;

function catalog(): MeasureLogicCatalog {
  const cols = (e: [string, MeasureLogicColumnMeta][]) => new Map(e);
  return {
    columnsByTable: new Map([
      ['log', cols([['Date', { source_column: 'Date', calculated_dax: null }], ['DWT', { source_column: 'DWT', calculated_dax: null }], ['Ref Line', { source_column: 'Ref Line', calculated_dax: null }]])],
      ['details', cols([['DWT', { source_column: 'DWT', calculated_dax: null }]])],
      ['master', cols([['IMO_NO', { source_column: 'IMO_NO', calculated_dax: null }]])],
      ['dwts', cols([['DWT', { source_column: 'DWT', calculated_dax: null }]])],
    ]),
    tableMeta: new Map([
      ['log', { displayName: 'Log', uc_full_path: 'c.s.log', source_m: LOG_M, warehouse_columns: ['IMO_NO', 'REPORT_DATE'] }],
      ['details', { displayName: 'Details', uc_full_path: null, source_m: DETAILS_M }],
      ['master', { displayName: 'Master', uc_full_path: 'c.s.master', source_m: null, warehouse_columns: ['IMO_NO'] }],
      ['dwts', { displayName: 'Dwts', uc_full_path: null, source_m: DWTS_M }],
    ]),
    measures: new Map([
      ['total dwt', { name: 'Total DWT', table: 'Log', dax: 'SUM(Log[DWT])' }],
      ['ref', { name: 'Ref', table: 'Log', dax: 'MAX(Log[Ref Line])' }],
      ['days', { name: 'Days', table: 'Log', dax: 'DISTINCTCOUNT(Log[Date])' }],
    ]),
    relationships: [],
  };
}

describe('Power Query merges, splits and embedded tables', () => {
  it('decodes "Enter data" rows exactly as Power BI stores them', () => {
    const e = decodeEmbeddedTable(DWTS_M)!;
    expect(e.columns).toEqual(['VESSEL_NAME', 'IMO_NUMBER', 'DEAD WEIGHT']);
    expect(e.rows).toEqual(rows);
    expect(parseMLineage(DWTS_M).unsupported).toEqual([]);
  });

  it('walks nested table calls, splits columns and records merges', () => {
    const l = parseMLineage(LOG_M);
    expect(l.unsupported).toEqual([]);
    const date = l.column('Date');
    expect('error' in date ? date.error : date.sql).toMatch(/try_element_at\(split\(CAST\(.*`REPORT_DATE`.*\), ' '\), 1\)/);
    expect(l.joins.map((j) => [j.table, j.kind, j.rightKeys])).toEqual([['Details', 'left', ['IMO Number']]]);
    expect(parseMLineage(DETAILS_M).baseTable).toBe('Master');
  });

  it('compiles through the merge chain with referenced tables defined first', () => {
    const sql = (() => {
      const r = compileMeasureToSql({ measureDax: 'SUM(Log[DWT]) + MAX(Log[Ref Line])', catalog: catalog() });
      if (!r.ok) throw new Error(r.reason);
      return r.sql;
    })();
    expect(sql).toContain('FROM VALUES');
    expect(sql).toMatch(/LEFT JOIN t\d+ src_\d+_j1 ON/);
    expect(sql).toContain('power(');
    // CTE order: Dwts and Master before Details, Details before Log
    const pos = (needle: string) => sql.indexOf(needle);
    expect(pos('FROM VALUES')).toBeLessThan(pos('`c`.`s`.`log`'));
    expect(pos('`c`.`s`.`master`')).toBeLessThan(pos('`c`.`s`.`log`'));
  });

  it('the model graph follows Power Query references for impact and incremental runs', () => {
    const g = buildModelGraph(catalog());
    const closure = g.closure(measureNodeId('Total DWT'));
    expect(closure.has('t:details')).toBe(true);
    expect(closure.has('t:dwts')).toBe(true);
    expect(closure.has('t:master')).toBe(true);
  });
});
