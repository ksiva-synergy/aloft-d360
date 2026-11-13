import { describe, expect, it } from 'vitest';

import { parseDax } from '@/lib/powerbi/dax-parse';
import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { extractMRowFilterTexts, parseMLineage } from '@/lib/powerbi/m-lineage';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import { planRepair } from '@/lib/powerbi/expand-validate-plan';
import { stripTrailingTmdlProperties } from '@/lib/powerbi/tmdl-parse';

const VIA_M = `let
    Source = Value.NativeQuery(Databricks.Catalogs("host", "/sql/1.0/warehouses/x", [Catalog="reporting_layer"]){[Name="reporting_layer",Kind="Database"]}[Data], "select * from reporting_layer.qhse.bi_vw_internalaudit", null, [EnableFolding=true]),
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"ReferenceNo", type text}}),
    #"Filtered Rows" = Table.SelectRows(#"Changed Type", each ([status] <> "Rejected") and ([manager_group] <> "SMIC") and ([ReferenceNo] <> null)
    //  and ([auditsubtype] = "ISM" or [auditsubtype] = "ISPS")
     ),
    #"Changed Type1" = Table.TransformColumnTypes(#"Filtered Rows",{{"AuditToDate", type datetime}, {"AuditFromDate", type datetime}})
in
    #"Changed Type1"`;

const SIRE_M = `let
    Source = Value.NativeQuery(Databricks.Catalogs("h", "/w", []){[Name="reporting_layer",Kind="Database"]}[Data], "select * from reporting_layer.qhse.bi_synergypool_vw_sire_2_0", null, [EnableFolding=true]),
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"IMO_NO", Int64.Type}, {"NO_OF_FINDINGS", Int64.Type}}),
    #"Filtered Rows" = Table.SelectRows(#"Changed Type", each true),
    Custom1 = #"Filtered Rows",
    #"Filtered Rows1" = Table.SelectRows(Custom1, each ([DATE] <> null)),
    #"Filtered Rows2" = Table.SelectRows(#"Filtered Rows1", each [NO_OF_FINDINGS] > 10)
in
    #"Filtered Rows2"`;

const PSC_M = `let
    Source = Value.NativeQuery(Databricks.Catalogs("h", "/w", []){[Name="reporting_layer",Kind="Database"]}[Data], "select distinct * from reporting_layer.qhse.bi_vw_psc_performance", null, [EnableFolding=true]),
    #"Renamed Columns" = Table.RenameColumns(Source,{{"reference_code", "REFERENCE_CODE_1"}, {"DOC", "MANAGER_GROUP"}}),
    #"Renamed Columns1" = Table.RenameColumns(#"Renamed Columns",{{"keycolumn", "Key Column"}}),
    #"Trimmed Text" = Table.TransformColumns(#"Renamed Columns1",{{"imo_no", Text.Trim, type text}}),
    #"Filtered Rows" = Table.SelectRows(#"Trimmed Text", each ([Key Column] <> "764321-20250401")),
    #"Removed Duplicates" = Table.Distinct(#"Filtered Rows", {"Key Column"})
in
    #"Removed Duplicates"`;

const SIRE_CHECK = `VAR imo = trim('Vessel Internal Audit'[imono])
VAR audtodate = 'Vessel Internal Audit'[AuditToDate]
VAR audfrom = CALCULATE(MIN('Vessel Internal Audit'[AuditFromDate]),
    FILTER('Vessel Internal Audit','Vessel Internal Audit'[imono] = imo && 'Vessel Internal Audit'[AuditFromDate] > audtodate))
VAR final = CALCULATE(MAX('SIRE 2_0'[KeyConcatenate]),
        FILTER('SIRE 2_0', 'SIRE 2_0'[IMO_NO] = imo &&'SIRE 2_0'[DATE] > audtodate && 'SIRE 2_0'[DATE] < audfrom))
RETURN final`;

const PSC_DET = `VAR imo = 'Vessel Internal Audit'[imono]
VAR audtodate = 'Vessel Internal Audit'[AuditToDate]
VAR audfrom = CALCULATE(MIN('Vessel Internal Audit'[AuditFromDate]),
        FILTER('Vessel Internal Audit','Vessel Internal Audit'[imono] = imo && 'Vessel Internal Audit'[AuditFromDate] > audtodate))
VAR final = CALCULATE(MAX(PSC[Key Column]),
            FILTER(PSC,PSC[imo_no] = imo && PSC[inspection_from_date] > audtodate &&
            PSC[inspection_from_date] < audfrom && PSC[REFERENCE_CODE_1] = "30"))
RETURN final`;

const CALENDAR_DAX = `ADDCOLUMNS ( CALENDAR (DATE(2019,01,01), TODAY()), // CALENDAR (MIN(...), TODAY()),
  "DATE_INTEGER", FORMAT ( [Date], "YYYYMMDD" ),
  "MONTH_YEAR", FORMAT ( [Date], "MMM YYYY" ),
  "QUARTER_YEAR", "Q" & FORMAT ( [Date], "Q YYYY" ),
  "YEAR", FORMAT ( [Date], "YYYY" ) )`;

function catalog(): MeasureLogicCatalog {
  const columnsByTable = new Map<string, Map<string, MeasureLogicColumnMeta>>();
  const col = (table: string, name: string, meta: Partial<MeasureLogicColumnMeta>) => {
    const t = table.toLowerCase();
    if (!columnsByTable.has(t)) columnsByTable.set(t, new Map());
    const m: MeasureLogicColumnMeta = {
      source_column: meta.source_column ?? (meta.calculated_dax ? null : name),
      calculated_dax: meta.calculated_dax ?? null,
      data_type: meta.data_type ?? null,
    };
    columnsByTable.get(t)!.set(name, m);
    columnsByTable.get(t)!.set(name.toLowerCase(), m);
  };
  col('Vessel Internal Audit', 'imono', { data_type: 'string' });
  col('Vessel Internal Audit', 'AuditToDate', { data_type: 'dateTime' });
  col('Vessel Internal Audit', 'AuditFromDate', { data_type: 'dateTime' });
  col('Vessel Internal Audit', 'SIRE_Check', { calculated_dax: SIRE_CHECK, data_type: 'string' });
  col('Vessel Internal Audit', 'PSC_Check_Det', { calculated_dax: PSC_DET, data_type: 'string' });
  col('SIRE 2_0', 'IMO_NO', { data_type: 'int64' });
  col('SIRE 2_0', 'DATE', { data_type: 'dateTime' });
  col('SIRE 2_0', 'KeyConcatenate', {
    calculated_dax: `TRIM('SIRE 2_0'[IMO_NO] & "-" & FORMAT('SIRE 2_0'[DATE], "YYYYMMDD"))`,
    data_type: 'string',
  });
  col('PSC', 'imo_no', { data_type: 'string' });
  col('PSC', 'inspection_from_date', { data_type: 'dateTime' });
  col('PSC', 'Key Column', { data_type: 'string' });
  col('PSC', 'REFERENCE_CODE_1', { data_type: 'string' });
  col('CALENDAR', 'Date', { source_column: '[Date]' });
  col('CALENDAR', 'YEAR', { source_column: '[YEAR]' });
  col('IMO_Master_List', 'MY_DATE', { data_type: 'dateTime' });
  col('IMO_Master_List', 'IMO_NO', { data_type: 'string' });

  const tableMeta = new Map([
    ['vessel internal audit', { displayName: 'Vessel Internal Audit', uc_full_path: 'reporting_layer.qhse.bi_vw_internalaudit', source_m: VIA_M }],
    ['sire 2_0', { displayName: 'SIRE 2_0', uc_full_path: 'reporting_layer.qhse.bi_synergypool_vw_sire_2_0', source_m: SIRE_M }],
    ['psc', { displayName: 'PSC', uc_full_path: 'reporting_layer.qhse.bi_vw_psc_performance', source_m: PSC_M }],
    ['calendar', { displayName: 'CALENDAR', uc_full_path: null, source_m: CALENDAR_DAX }],
    ['imo_master_list', { displayName: 'IMO_Master_List', uc_full_path: 'reporting_layer.qhse.imo_master', source_m: null }],
  ]);
  return {
    columnsByTable,
    tableMeta,
    measures: new Map(),
    relationships: [
      // filters flow from the one side (to) to the many side (from)
      { fromTable: 'IMO_Master_List', fromColumn: 'MY_DATE', toTable: 'CALENDAR', toColumn: 'Date', both: false, active: true },
      { fromTable: 'IMO_Master_List', fromColumn: 'KEY', toTable: 'SIRE 2_0', toColumn: 'KeyConcatenate', both: false, active: true },
    ],
  };
}

describe('m-lineage', () => {
  it('strips comments and keeps every clause of compound SelectRows', () => {
    const l = parseMLineage(VIA_M);
    expect(l.nativeSql).toBe('select * from reporting_layer.qhse.bi_vw_internalaudit');
    expect(l.unsupported).toEqual([]);
    const where = l.where.map((w) => w.sql).join(' ');
    expect(where).toContain("NOT (`status` <=> 'Rejected')");
    expect(where).toContain("NOT (`manager_group` <=> 'SMIC')");
    expect(where).toContain('IS NOT NULL');
    expect(where).not.toContain('auditsubtype');
    expect(extractMRowFilterTexts(VIA_M)[0]).not.toContain('//');
  });

  it('reverses renames and folds transforms back to warehouse columns', () => {
    const l = parseMLineage(PSC_M);
    expect(l.column('Key Column')).toEqual({ sql: '`keycolumn`', leaves: ['keycolumn'] });
    expect(l.column('REFERENCE_CODE_1')).toEqual({ sql: '`reference_code`', leaves: ['reference_code'] });
    expect((l.column('imo_no') as { sql: string }).sql).toBe('trim(`imo_no`)');
    expect(l.dedupe?.keySql).toEqual(['`keycolumn`']);
  });

  it('follows alias steps and skips `each true`', () => {
    const l = parseMLineage(SIRE_M);
    expect(l.where.map((w) => w.sql)).toEqual(['((`DATE` IS NOT NULL))', '(TRY_CAST(`NO_OF_FINDINGS` AS BIGINT) > 10)']);
  });
});

describe('dax-parse', () => {
  it('parses VAR blocks, quoted/unquoted column refs and comments', () => {
    const ast = parseDax(PSC_DET);
    expect(ast.k).toBe('var');
  });
});

describe('compileMeasureToSql', () => {
  it('compiles SIRE_Fin from calc-column DAX + PQ lineage (no hardcoded names)', () => {
    const out = compileMeasureToSql({
      measureDax: "DISTINCTCOUNTNOBLANK('Vessel Internal Audit'[SIRE_Check])",
      catalog: catalog(),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sql).toContain('bi_vw_internalaudit');
    expect(out.sql).toContain('bi_synergypool_vw_sire_2_0');
    expect(out.sql).toContain("NOT (src_1.`manager_group` <=> 'SMIC')");
    expect(out.sql).toContain('TRY_CAST(src_2.`NO_OF_FINDINGS` AS BIGINT) > 10');
    expect(out.sql).toContain("date_format(cur.`DATE`, 'yyyyMMdd')");
    expect(out.sql).toContain('COUNT(DISTINCT');
    expect(out.calc_columns).toEqual(
      expect.arrayContaining(['SIRE 2_0[KeyConcatenate]', 'Vessel Internal Audit[SIRE_Check]']),
    );
    expect(out.warnings).toEqual([]);
  });

  it('maps PSC columns through Power Query renames and warns on keyed Table.Distinct', () => {
    const out = compileMeasureToSql({
      measureDax: "DISTINCTCOUNTNOBLANK('Vessel Internal Audit'[PSC_Check_Det])",
      catalog: catalog(),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sql).toContain('src_2.`reference_code` AS `REFERENCE_CODE_1`');
    expect(out.sql).toContain('src_2.`keycolumn` AS `Key Column`');
    expect(out.sql).toContain('QUALIFY ROW_NUMBER()');
    expect(out.warnings[0]).toMatch(/Table\.Distinct/);
  });

  it('compiles a DAX calculated calendar table', () => {
    const out = compileMeasureToSql({ measureDax: "MAX('CALENDAR'[Date])", catalog: catalog() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sql).toContain('explode(sequence(CAST(make_date(2019, 1, 1) AS DATE), CAST(current_date() AS DATE)');
    expect(out.sql).toContain("date_format(cur.`Date`, 'MMM yyyy')");
    expect(out.sql).toContain("date_format(cur.`Date`, 'Q yyyy')");
  });

  it('propagates a calendar filter over a single-hop relationship', () => {
    const out = compileMeasureToSql({
      measureDax: "CALCULATE(DISTINCTCOUNT(IMO_Master_List[IMO_NO]), 'CALENDAR'[YEAR] = \"2024\")",
      catalog: catalog(),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sql).toMatch(/`MY_DATE` IN \(SELECT r\d+\.`Date` FROM t\d+ r\d+ WHERE/);
  });

  it('BLANK + 0 behaves like DAX (blank becomes 0)', () => {
    const out = compileMeasureToSql({ measureDax: "AVERAGE('SIRE 2_0'[IMO_NO]) + 0", catalog: catalog() });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sql).toContain('coalesce((SELECT AVG');
  });

  it('fails with a reason instead of guessing', () => {
    const out = compileMeasureToSql({
      measureDax: "MAXX(TOPN(3, PSC, PSC[inspection_from_date]), PSC[imo_no])",
      catalog: catalog(),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/TOPN/);
  });
});

describe('planRepair', () => {
  it('applies a warehouse column suggestion only when it is the same identifier', () => {
    const err =
      '[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `src_2`.`Key Column` cannot be resolved. Did you mean one of the following? [`src_2`.`keycolumn`, `src_2`.`DOC`]';
    const fix = planRepair(err, { src_2: 'psc' }, {});
    expect(fix?.options.columnOverrides).toEqual({ psc: { 'key column': 'keycolumn' } });
    const noFix = planRepair(err.replace('`keycolumn`', '`detention`'), { src_2: 'psc' }, {});
    expect(noFix).toBeNull();
  });
});

describe('stripTrailingTmdlProperties', () => {
  it('drops leaked TMDL property lines', () => {
    expect(stripTrailingTmdlProperties('DIVIDE(a,24)\nchangedProperty = DataType')).toBe('DIVIDE(a,24)');
    expect(stripTrailingTmdlProperties('changedProperty = DataType')).toBeNull();
    expect(stripTrailingTmdlProperties('isNameInferred\nvariation Variation')).toBeNull();
  });
});
