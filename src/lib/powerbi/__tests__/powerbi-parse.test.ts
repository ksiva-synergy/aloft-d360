import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyModelAnswerability,
  classifyPartitionSource,
  extractDatabricksHost,
  extractNativeSql,
} from '@/lib/powerbi/partition-kind';
import { parseLegacyReportJson } from '@/lib/powerbi/report-parse-legacy';
import {
  parseTmdlRelationshipsFile,
  parseTmdlTableFile,
} from '@/lib/powerbi/tmdl-parse';

const fixturesDir = path.join(__dirname, 'fixtures');

describe('partition classifier §8.5', () => {
  it('detects Databricks warehouse query', () => {
    const m =
      'Value.NativeQuery(Databricks.Catalogs("host", "wh"), "SELECT 1", null, [EnableFolding=true])';
    expect(classifyPartitionSource(m, 'T')).toBe('warehouse_query');
    expect(extractDatabricksHost(m)).toBe('host');
    expect(extractNativeSql(m)).toBe('SELECT 1');
  });

  it('detects auto date tables by name', () => {
    expect(classifyPartitionSource('', 'LocalDateTable_abc')).toBe('auto_date_table');
  });

  it('classifies model answerability with RLS as caveated', () => {
    expect(
      classifyModelAnswerability({
        rlsRequired: true,
        partitionKinds: ['warehouse_query'],
      }),
    ).toBe('caveated');
    expect(
      classifyModelAnswerability({
        rlsRequired: false,
        partitionKinds: ['warehouse_query'],
      }),
    ).toBe('answerable');
  });
});

describe('TMDL parse', () => {
  it('parses sample table with measure and warehouse partition', () => {
    const text = fs.readFileSync(path.join(fixturesDir, 'sample-table.tmdl'), 'utf8');
    const table = parseTmdlTableFile(text);
    expect(table?.name).toBe('Demo_Fact');
    expect(table?.columns).toHaveLength(1);
    expect(table?.measures[0]?.name).toBe('Total');
    expect(table?.measures[0]?.dax).toContain('SUM');
    const kind = classifyPartitionSource(table!.partitionSourceM, table!.name);
    expect(kind).toBe('warehouse_query');
  });

  it('parses relationships file', () => {
    const text = `relationship rel-1
	fromColumn: A.Col
	toColumn: B.Col
`;
    const rows = parseTmdlRelationshipsFile(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].fromColumn).toBe('A.Col');
  });
});

describe('legacy report parse', () => {
  it('extracts measure refs from config blob', () => {
    const raw = JSON.stringify({
      config: '{"sections":{"ReportSectionabc":{"visualContainers":{}}},"singleVisual":{"visualType":"card","activeProjections":{"Values":[{"Measure":{"Expression":{"SourceRef":{"Entity":"CII_Measures"}},"Property":"Attained_CII YTD"}}]}}}',
    });
    const summary = parseLegacyReportJson(raw);
    expect(summary.measureRefs).toContain('Attained_CII YTD');
  });
});

const estateTable = path.join(
  process.cwd(),
  'powerbi-estate/definitions/1e76560b-6e65-4741-b10f-66efb4078a23/definition/tables/CII_Measures.tmdl',
);

describe.runIf(fs.existsSync(estateTable))('CII estate fixture (local only)', () => {
  it('parses CII_Measures with many measures', () => {
    const text = fs.readFileSync(estateTable, 'utf8');
    const table = parseTmdlTableFile(text);
    expect(table?.name).toBe('CII_Measures');
    expect(table!.measures.length).toBeGreaterThan(10);
    expect(
      table!.measures.some(
        (m) => m.name === 'Attained_CII' || m.dax.includes('Attained_CII') || m.name.includes('Attained_CII'),
      ),
    ).toBe(true);
  });
});
