import { describe, expect, it } from 'vitest';

import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import { classifyRootCause } from '@/lib/powerbi/recreation-root-cause';
import { parseTmdlTableFile } from '@/lib/powerbi/tmdl-parse';

function catalog(): MeasureLogicCatalog {
  const columnsByTable = new Map<string, Map<string, MeasureLogicColumnMeta>>();
  const col = (table: string, name: string, meta: Partial<MeasureLogicColumnMeta> = {}) => {
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
  col('Audit', 'imono', { data_type: 'string' });
  col('Audit', 'Key2', { data_type: 'string' });
  col('Audit', 'AuditToDate', { data_type: 'dateTime' });
  col('Ships', 'IMO_NO', { data_type: 'string' });
  col('Ships', 'KEY', { data_type: 'string' });
  col('Ships', 'TAKE_OVER_DATE', { data_type: 'dateTime' });
  col('Status_Table', 'Status', { source_column: '[Status]' });
  col('Snapshot', 'IMO_NO', { source_column: 'IMO_Master_List[IMO_NO]' });
  col('Snapshot', 'Takeover_Date', { source_column: '[Takeover_Date]' });
  col('CAL', 'Date', { source_column: '[Date]' });

  const tableMeta = new Map([
    ['audit', { displayName: 'Audit', uc_full_path: 'c.s.audit', source_m: null }],
    ['ships', { displayName: 'Ships', uc_full_path: 'c.s.ships', source_m: null }],
    [
      'status_table',
      {
        displayName: 'Status_Table',
        uc_full_path: null,
        source_m: 'calculated source = DATATABLE( "Status", STRING, { {"VIA Done"}, {"No VIA"} } )',
      },
    ],
    [
      'snapshot',
      {
        displayName: 'Snapshot',
        uc_full_path: null,
        source_m: 'SUMMARIZE( Ships, Ships[IMO_NO], "Takeover_Date", MAX(Ships[TAKE_OVER_DATE]) )',
      },
    ],
    ['cal', { displayName: 'CAL', uc_full_path: null, source_m: 'CALENDAR(DATE(2024,1,1), DATE(2024,12,31))' }],
  ]);
  const measures = new Map([
    ['audit_count', { name: 'Audit_Count', table: 'Measure', dax: "DISTINCTCOUNT('Audit'[imono])" }],
    ['ship_count', { name: 'Ship_Count', table: 'Measure', dax: 'COUNTROWS(Ships)' }],
    ['audit_status', { name: 'Audit_Status', table: 'Measure', dax: 'IF([Audit_Count] > 0, "VIA Done", "No VIA")' }],
  ]);
  return {
    columnsByTable,
    tableMeta,
    measures,
    relationships: [
      // Audit (many) → Ships (one), both directions
      { fromTable: 'Audit', fromColumn: 'Key2', toTable: 'Ships', toColumn: 'KEY', both: true, active: true },
    ],
  };
}

describe('compiler: measures, calculated tables, iterators', () => {
  it('compiles a measure built only from other measures', () => {
    const out = compileMeasureToSql({ measureDax: 'DIVIDE([Audit_Count], [Ship_Count], 0)', catalog: catalog() });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.measures_inlined).toEqual(expect.arrayContaining(['Audit_Count', 'Ship_Count']));
  });

  it('compiles DATATABLE and SUMMARIZE calculated tables', () => {
    const dt = compileMeasureToSql({ measureDax: 'COUNTROWS(Status_Table)', catalog: catalog() });
    expect(dt.ok && dt.sql).toContain("FROM VALUES ('VIA Done'), ('No VIA') AS v(`Status`)");
    const sm = compileMeasureToSql({ measureDax: 'MAX(Snapshot[Takeover_Date])', catalog: catalog() });
    expect(sm.ok).toBe(true);
    if (sm.ok) expect(sm.sql).toMatch(/SELECT DISTINCT x\d+\.`IMO_NO` AS `IMO_NO`/);
  });

  it('SUMX over VALUES turns context transition into a column filter that follows relationships', () => {
    const out = compileMeasureToSql({
      measureDax: 'SUMX(VALUES(Ships[IMO_NO]), IF([Audit_Status] = SELECTEDVALUE(Status_Table[Status]), 1, 0))',
      catalog: catalog(),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Audit is filtered through Audit.Key2 IN (Ships.KEY where Ships.IMO_NO = current value)
    expect(out.sql).toMatch(/CAST\(a\d+\.`Key2` AS STRING\) IN \(SELECT CAST\(r\d+\.`KEY` AS STRING\) FROM t\d+ r\d+ WHERE r\d+\.`IMO_NO` <=> g\d+\.`IMO_NO`\)/);
    expect(out.result_kind).toBe('number');
  });

  it('TOPN(1) keeps the max row (ties included)', () => {
    const out = compileMeasureToSql({
      measureDax: "MAXX(TOPN(1, 'Audit', 'Audit'[AuditToDate], DESC), 'Audit'[imono])",
      catalog: catalog(),
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sql).toMatch(/`AuditToDate` = \(SELECT MAX\(/);
  });

  it('TOTALYTD filters the calendar from Jan 1 of the last visible date', () => {
    const out = compileMeasureToSql({ measureDax: "TOTALYTD(COUNTROWS('CAL'), 'CAL'[Date])", catalog: catalog() });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sql).toContain('make_date(year(');
  });

  it('reports text-valued measures', () => {
    const out = compileMeasureToSql({ measureDax: '[Audit_Status]', catalog: catalog() });
    expect(out.ok && out.result_kind).toBe('string');
  });
});

describe('tmdl calculated partitions', () => {
  it('keeps the full DAX of fenced and single-line calculated sources', () => {
    const fenced = [
      'table Status_Table',
      '\tcolumn Status',
      '\t\tdataType: string',
      '\t\tsourceColumn: [Status]',
      '',
      '\tpartition Status_Table = calculated',
      '\t\tmode: import',
      '\t\tsource = ```',
      '\t\t\t\tDATATABLE( "Status", STRING,',
      '\t\t\t\t  { {"In Window"}, {"Over Due"} } )',
      '\t\t\t\t```',
      '',
    ].join('\n');
    expect(parseTmdlTableFile(fenced)?.partitionSourceM).toBe(
      'DATATABLE( "Status", STRING,\n  { {"In Window"}, {"Over Due"} } )',
    );
    const single = [
      'table LocalDateTable_1',
      '\tpartition LocalDateTable_1 = calculated',
      '\t\tmode: import',
      "\t\tsource = Calendar(Date(2015,1,1), Date(2015,1,1))",
      '',
    ].join('\n');
    expect(parseTmdlTableFile(single)?.partitionSourceM).toBe('Calendar(Date(2015,1,1), Date(2015,1,1))');
  });
});

describe('classifyRootCause', () => {
  const cat = catalog();
  it('flags slicer helpers, empty DAX and compile failures', () => {
    expect(
      classifyRootCause({
        stage: 'no_uc',
        dax: 'VAR s = SELECTEDVALUE(Status_Table[Status]) RETURN IF(ISBLANK(s), 1, 0)',
        tier: 'unresolved',
        props: null,
        catalog: cat,
      })?.category,
    ).toBe('ui_slicer_helper');
    expect(
      classifyRootCause({ stage: 'no_uc', dax: '// SUM(x)', tier: null, props: null, catalog: cat })?.category,
    ).toBe('empty_dax');
    expect(
      classifyRootCause({
        stage: 'no_sql',
        dax: 'TOPN(2, T, T[x])',
        tier: 'llm_failed',
        props: { expand_failure: { stage: 'compile', reason: 'TOPN is supported only with N = 1' } },
        catalog: cat,
      })?.category,
    ).toBe('unsupported_dax');
    expect(
      classifyRootCause({
        stage: 'parity_fail',
        dax: 'X',
        tier: 'expand',
        props: { expand_spec: { warnings: ['Table.Distinct …'] } },
        catalog: cat,
      })?.category,
    ).toBe('nondeterministic_source');
    expect(
      classifyRootCause({ stage: 'published', dax: 'X', tier: 'expand', props: null, catalog: cat }),
    ).toBeNull();
  });
});

describe('date arithmetic and multi-hop filters', () => {
  it('date + number adds days with DAX BLANK semantics', () => {
    const out = compileMeasureToSql({ measureDax: "MAX('Audit'[AuditToDate]) + 365", catalog: catalog() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sql).toContain('timestampadd(SECOND, CAST(round((365) * 86400) AS BIGINT)');
    expect(out.sql).toContain("TIMESTAMP'1899-12-30 00:00:00'");
    expect(out.result_kind).toBe('date');
  });

  it('propagates a filter through two relationships', () => {
    const cat = catalog();
    cat.relationships!.push({
      fromTable: 'Ships',
      fromColumn: 'TAKE_OVER_DATE',
      toTable: 'CAL',
      toColumn: 'Date',
      both: false,
      active: true,
    });
    // CAL → Ships (one-to-many) → Audit (Ships is the one side of Audit.Key2)
    const out = compileMeasureToSql({
      measureDax: "CALCULATE(COUNTROWS('Audit'), 'CAL'[Date] >= DATE(2024,6,1))",
      catalog: cat,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sql).toMatch(/CAST\(a\d+\.`Key2` AS STRING\) IN \(SELECT CAST\(r\d+\.`KEY` AS STRING\) FROM t\d+ r\d+ WHERE r\d+\.`TAKE_OVER_DATE` IN \(SELECT r\d+\.`Date`/);
  });
});

describe('DAX BLANK semantics', () => {
  it('BLANK compares as the type zero (BLANK = BLANK, BLANK <= 90)', () => {
    const out = compileMeasureToSql({ measureDax: "IF(MAX('Audit'[AuditToDate]) <= DATE(2024,1,1), 1, 0)", catalog: catalog() });
    expect(out.ok && out.sql).toContain("coalesce(CAST((SELECT MAX(");
    const eq = compileMeasureToSql({
      measureDax: 'IF([Audit_Status] = SELECTEDVALUE(Status_Table[Status]), 1, 0)',
      catalog: catalog(),
    });
    expect(eq.ok && eq.sql).toMatch(/lower\(coalesce\(/);
  });

  it('VALUES adds the relationship blank row when many-side keys are unmatched; DISTINCT does not', () => {
    const v = compileMeasureToSql({ measureDax: 'COUNTROWS(VALUES(Ships[IMO_NO]))', catalog: catalog() });
    expect(v.ok && v.sql).toContain('UNION SELECT NULL AS `IMO_NO` FROM (SELECT 1) one WHERE EXISTS');
    const d = compileMeasureToSql({ measureDax: 'COUNTROWS(DISTINCT(Ships[IMO_NO]))', catalog: catalog() });
    expect(d.ok && d.sql).not.toContain('UNION SELECT NULL');
  });
});

describe('data freshness root cause', () => {
  it('flags warehouse values newer than the dataset snapshot', () => {
    const base = { stage: 'parity_fail', dax: 'X', tier: 'expand', catalog: null };
    const parity = (oracle: unknown, sql: unknown) => ({
      parity: {
        summary: 'Mismatch',
        oracle_value: oracle,
        sql_value: sql,
        model_refresh_at: '2026-11-13T02:40:07.893Z',
        checked_at: '2026-11-14T09:00:00.000Z',
      },
    });
    expect(
      classifyRootCause({ ...base, props: parity('2026-11-11T18:30:00', '2026-11-12T18:30:00') })?.category,
    ).toBe('data_freshness');
    expect(
      classifyRootCause({
        ...base,
        props: parity('- Last Record Updated at 12 Nov 2026 -', '- Last Record Updated at 13 Nov 2026 -'),
      })?.category,
    ).toBe('data_freshness');
    expect(classifyRootCause({ ...base, props: parity(1, 0) })?.category).toBe('parity_mismatch');
  });
});

describe('root cause: per-value counts vs slicer helpers', () => {
  it('a SUMX count over a slicer status is an engine limit, not a slicer helper', () => {
    const cat = catalog();
    expect(
      classifyRootCause({
        stage: 'no_sql',
        dax: 'SUMX(VALUES(Ships[IMO_NO]), IF([Audit_Status] = SELECTEDVALUE(Status_Table[Status]), 1, 0))',
        tier: 'llm_failed',
        props: {
          expand_failure: {
            stage: 'warehouse',
            reason: 'Query FAILED: [INTERNAL_ERROR] The Spark SQL phase optimization failed',
          },
        },
        catalog: cat,
      })?.category,
    ).toBe('engine_limit');
    expect(
      classifyRootCause({
        stage: 'no_sql',
        dax: 'SUMX(VALUES(Ships[IMO_NO]), IF([Audit_Status] = SELECTEDVALUE(Status_Table[Status]), 1, 0))',
        tier: 'llm_failed',
        props: null,
        catalog: cat,
      })?.category,
    ).not.toBe('ui_slicer_helper');
  });
});

describe('tmdl harvest fidelity', () => {
  it('strips TMDL quotes from measure names', () => {
    const t = parseTmdlTableFile(['table M', "\tmeasure 'Avg CO2' = SUM(T[x])", ''].join('\n'));
    expect(t?.measures[0]?.name).toBe('Avg CO2');
  });

  it('does not store table TMDL text as the source of a measure-only table', () => {
    const t = parseTmdlTableFile(
      ['table CII_Measures', '\tmeasure Total = ```', '\t\t\tSUM(T[x])', '\t\t\t```', '\t\tformatString: 0', ''].join('\n'),
    );
    expect(t?.partitionSourceM).toBe('');
    expect(t?.partitionType).toBeNull();
  });

  it('reports the partition type for calculated partitions', async () => {
    const { classifyPartitionSource } = await import('@/lib/powerbi/partition-kind');
    const t = parseTmdlTableFile(
      ['table Cal', '\tpartition Cal = calculated', '\t\tmode: import', '\t\tsource = CALENDAR(DATE(2024,1,1), DATE(2024,12,31))', ''].join('\n'),
    );
    expect(t?.partitionType).toBe('calculated');
    expect(classifyPartitionSource(t!.partitionSourceM, t!.name, t!.partitionType)).toBe('calculated_table');
  });
});

describe('step-2 capabilities', () => {
  it('compiles date-hierarchy levels, WEEKNUM, COMBINEVALUES and empty measures', () => {
    const cat = catalog();
    const lvl = compileMeasureToSql({ measureDax: "MAX('Audit'[AuditToDate].[Year])", catalog: cat });
    expect(lvl.ok && lvl.sql).toContain('year(');
    const wk = compileMeasureToSql({ measureDax: "MAX('Ships'[TAKE_OVER_DATE]) + WEEKNUM(TODAY())", catalog: cat });
    expect(wk.ok && wk.sql).toContain('dayofyear(current_date())');
    const cv = compileMeasureToSql({ measureDax: 'COMBINEVALUES("-", "a", "b")', catalog: cat });
    expect(cv.ok && cv.sql).toContain("concat_ws('-'");
    const empty = compileMeasureToSql({ measureDax: '// SUM(x)\n// RETURN y', catalog: cat });
    expect(!empty.ok && empty.reason).toMatch(/empty or fully commented out/);
  });

  it('M if-then-else and Number.Round become SQL', async () => {
    const { parseMLineage } = await import('@/lib/powerbi/m-lineage');
    const l = parseMLineage(
      'let Source = Sql.Database("h","d"), A = Table.AddColumn(Source, "Flag", each if [x] > 10 then "big" else "small"), B = Table.TransformColumns(A, {{"y", each Number.Round(_, 2)}}) in B',
    );
    expect(l.unsupported).toEqual([]);
    expect((l.column('Flag') as { sql: string }).sql).toBe("(CASE WHEN (`x` > 10) THEN 'big' ELSE 'small' END)");
    expect((l.column('y') as { sql: string }).sql).toBe('bround(`y`, 2)');
  });
});
