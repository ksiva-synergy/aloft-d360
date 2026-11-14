import { describe, expect, it, vi } from 'vitest';

// verified-query-embed is a server module (DB + embedding client); only its pure text builder is tested
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ default: {} }));
vi.mock('@/lib/context/embed', () => ({ embedQuery: async () => null }));

import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import { incrementalRefreshWindow, inlineMParameters, readMParameters, tableParameterValues } from '@/lib/powerbi/m-parameters';
import type { MeasureLogicCatalog, MeasureLogicColumnMeta } from '@/lib/powerbi/measure-logic-analyze';
import {
  parseTmdlCultureFile,
  parseTmdlDatabaseFile,
  parseTmdlModelFile,
  parseTmdlRelationshipsFile,
  parseTmdlRoleFile,
  parseTmdlTableFile,
  unhandledTmdlKeywords,
} from '@/lib/powerbi/tmdl-parse';

const lines = (...l: string[]) => l.join('\n');

describe('TMDL: nothing useful is dropped', () => {
  it('bare flags are properties, never DAX; descriptions are kept', () => {
    const t = parseTmdlTableFile(
      lines(
        '/// Orders fact',
        'table Orders',
        '\tisHidden',
        '\t/// Amount in USD',
        '\tcolumn Amount',
        '\t\tdataType: double',
        '\t\tisHidden',
        '\t\tisNameInferred',
        '\t\tsourceColumn: AMOUNT',
        '\t\tdisplayFolder: Money',
        '\tcolumn Year = YEAR([Date])',
        '\t\tisHidden',
        "\tmeasure 'Total' = SUM(Orders[Amount])",
        '\t\tisHidden',
        '\t\tformatStringDefinition = SELECTEDVALUE(Fmt[f])',
      ),
    )!;
    expect(t.hidden).toBe(true);
    expect(t.meta.description).toBe('Orders fact');
    expect(t.columns[0]).toMatchObject({ calculatedDax: null, displayFolder: 'Money', meta: { hidden: true, description: 'Amount in USD' } });
    expect(t.columns[1]!.calculatedDax).toBe('YEAR([Date])');
    expect(t.measures[0]).toMatchObject({ dax: 'SUM(Orders[Amount])', meta: { hidden: true, formatStringDefinition: 'SELECTEDVALUE(Fmt[f])' } });
  });

  it('incremental refresh policy, hierarchies and field parameters', () => {
    const t = parseTmdlTableFile(
      lines(
        'table Fact',
        '\trefreshPolicy',
        '\t\tpolicyType: basic',
        '\t\trollingWindowGranularity: year',
        '\t\trollingWindowPeriods: 2',
        '\t\tincrementalGranularity: month',
        '\t\tincrementalPeriods: 3',
        '\t\tsourceExpression =',
        '\t\t\tlet',
        '\t\t\t    Source = Sql.Database("s", "d")',
        '\t\t\tin',
        '\t\t\t    Source',
        '\thierarchy Geo',
        '\t\tlevel Country',
        '\t\t\tcolumn: Country',
        '\tpartition Fact = m',
        '\t\tmode: import',
        '\t\tsource =',
        '\t\t\t\tlet S = 1 in S',
      ),
    )!;
    expect(t.meta.refreshPolicy).toMatchObject({ rollingWindowGranularity: 'year', rollingWindowPeriods: 2, incrementalGranularity: 'month', incrementalPeriods: 3 });
    expect(t.meta.refreshPolicy!.sourceExpression).toMatch(/^let\n\s+Source = Sql\.Database/);
    expect(t.meta.hierarchies).toEqual([{ name: 'Geo', hidden: false, levels: [{ name: 'Country', column: 'Country' }] }]);
    expect(t.partitionSourceM).toBe('let S = 1 in S');

    const fp = parseTmdlTableFile(
      lines(
        'table Parameter',
        '\tcolumn Parameter',
        '\t\tsourceColumn: [Value1]',
        '\t\trelatedColumnDetails',
        "\t\t\tgroupByColumn: 'Parameter Fields'",
        '\tpartition Parameter = calculated',
        '\t\tsource = {("Amount", NAMEOF(Orders[Amount]), 0)}',
      ),
    )!;
    expect(fp.meta.fieldParameter).toBe(true);
    expect(fp.columns[0]).toMatchObject({ calculatedDax: null, meta: { groupByColumns: ['Parameter Fields'] } });
  });

  it('relationship cardinality and RLS table filters', () => {
    const [mm, def] = parseTmdlRelationshipsFile(
      lines(
        'relationship r1',
        '\ttoCardinality: many',
        '\tcrossFilteringBehavior: bothDirections',
        '\tfromColumn: A.k',
        '\ttoColumn: B.k',
        'relationship r2',
        '\tfromColumn: C.k',
        '\ttoColumn: D.k',
      ),
    );
    expect(mm!.cardinality).toBe('many_to_many');
    expect(def!.cardinality).toBe('many_to_one');

    const role = parseTmdlRoleFile(
      lines(
        "role 'Region RLS'",
        '\tmodelPermission: read',
        '\ttablePermission Users = [Email] == USERPRINCIPALNAME()',
        "\ttablePermission 'Sales Region' =",
        '\t\t\t[Region] IN { "EU", "US" }',
        '\tmember a@b.com',
        '\t\tidentityProvider: AzureAD',
      ),
    )!;
    expect(role.tablePermissions).toEqual([
      { table: 'Users', filter: '[Email] == USERPRINCIPALNAME()' },
      { table: 'Sales Region', filter: '[Region] IN { "EU", "US" }' },
    ]);
    expect(role.filterDax).toBe('Users: [Email] == USERPRINCIPALNAME()\nSales Region: [Region] IN { "EU", "US" }');
    expect(role.members[0]).toMatchObject({ name: 'a@b.com', identityProvider: 'AzureAD' });
  });

  it('model settings, compatibility level, synonyms, and unknown TMDL objects are reported', () => {
    const m = parseTmdlModelFile(
      lines(
        'model Model',
        '\tculture: en-US',
        '\tsourceQueryCulture: en-IN',
        '\tdiscourageImplicitMeasures',
        '\tdataAccessOptions',
        '\t\tfastCombine',
        '',
        'annotation __PBI_TimeIntelligenceEnabled = 1',
      ),
    )!;
    expect(m).toMatchObject({ culture: 'en-US', sourceQueryCulture: 'en-IN', discourageImplicitMeasures: true, dataAccessOptions: ['fastCombine'], timeIntelligenceEnabled: true });
    expect(parseTmdlDatabaseFile('database\n\tcompatibilityLevel: 1567').compatibilityLevel).toBe(1567);

    const culture = lines(
      'cultureInfo en-US',
      '',
      '\tlinguisticMetadata =',
      '\t\t\t{"Version":"4.1.0","Entities":{',
      '\t\t\t"sales.amt":{"Definition":{"Binding":{"ConceptualEntity":"Sales","ConceptualProperty":"Amount"}},',
      '\t\t\t"Terms":[{"revenue":{"State":"Authored"}},{"amount":{"State":"Generated","Weight":0.99}},{"quantum":{"State":"Suggested","Weight":0.5}}]}}}',
      '\t\tcontentType: json',
    );
    expect(parseTmdlCultureFile(culture)).toEqual({ culture: 'en-US', synonyms: { 'Sales.Amount': ['revenue', 'amount'] }, authored: 1 });

    expect(unhandledTmdlKeywords(lines('table T', '\tcalendar Fiscal', '\t\tlineageTag: x'))).toEqual({ calendar: 1 });
  });
});

describe('Power Query parameters and incremental refresh', () => {
  const policy = {
    policyType: 'basic',
    mode: null,
    rollingWindowGranularity: 'year',
    rollingWindowPeriods: 1,
    incrementalGranularity: 'year',
    incrementalPeriods: 1,
    incrementalPeriodsOffset: null,
    pollingExpression: null,
    sourceExpression: null,
  };

  it('reads literal parameters only', () => {
    expect(
      readMParameters([
        { name: 'Env', m: '"PROD" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]' },
        { name: 'RangeStart', m: '#datetime(2025, 3, 9, 0, 0, 0) meta [IsParameterQuery=true, Type="DateTime"]' },
        { name: 'Parameter2', m: '#"Sample File" meta [IsParameterQuery=true, BinaryIdentifier=#"Sample File", Type="Binary"]' },
        { name: 'Helper', m: 'let x = 1 in x' },
      ]),
    ).toEqual({ Env: '"PROD"', RangeStart: '#datetime(2025, 3, 9, 0, 0, 0)' });
  });

  it('the dataset holds the rolling window, not the desktop RangeStart/RangeEnd values', () => {
    const w = incrementalRefreshWindow(policy, new Date('2026-11-15T08:00:00Z'))!;
    expect(w.start.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    const monthly = incrementalRefreshWindow(
      { ...policy, rollingWindowGranularity: 'month', rollingWindowPeriods: 12, incrementalGranularity: 'day', incrementalPeriods: 10 },
      new Date('2026-11-15T08:00:00Z'),
    )!;
    expect(monthly.start.toISOString()).toBe('2025-11-01T00:00:00.000Z');
    expect(monthly.end.toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });

  it('inlines parameters so lineage compiles the RangeStart filter', () => {
    const m = lines(
      'let',
      '    Source = Value.NativeQuery(Snowflake.Databases("h","w"){[Name="DB"]}[Data], "SELECT * FROM DB.S.T", null),',
      '    #"Filtered" = Table.SelectRows(Source, each [UPDATED] >= RangeStart and [UPDATED] < RangeEnd and [ENV] = Env)',
      'in',
      '    #"Filtered"',
    );
    expect(parseMLineage(m).unsupported.join(' ')).toMatch(/RangeStart/);
    const values = tableParameterValues({ Env: '"PROD"', RangeStart: '#datetime(2025, 3, 9, 0, 0, 0)' }, policy, new Date('2026-11-15T00:00:00Z'));
    const inlined = inlineMParameters(m, values)!;
    expect(inlined).toContain('[UPDATED] >= #datetime(2025, 1, 1, 0, 0, 0) and [UPDATED] < #datetime(2027, 1, 1, 0, 0, 0) and [ENV] = "PROD"');
    const lin = parseMLineage(inlined);
    expect(lin.unsupported).toEqual([]);
    expect(lin.where.length).toBeGreaterThan(0);
    // record fields, strings and step names are left alone
    expect(inlineMParameters('let RangeStart = 1, x = [RangeStart], y = "RangeStart" in RangeStart', values)).toBe(
      'let RangeStart = 1, x = [RangeStart], y = "RangeStart" in RangeStart',
    );
  });
});

describe('compiler: relationship cardinality', () => {
  function catalog(cardinality?: string): MeasureLogicCatalog {
    const cols = (e: [string, MeasureLogicColumnMeta][]) => new Map(e);
    return {
      columnsByTable: new Map([
        ['fact', cols([['k', { source_column: 'K', calculated_dax: null }], ['amt', { source_column: 'AMT', calculated_dax: null }]])],
        ['dim', cols([['k', { source_column: 'K', calculated_dax: null }], ['name', { source_column: 'NAME', calculated_dax: null }]])],
      ]),
      tableMeta: new Map([
        ['fact', { displayName: 'Fact', uc_full_path: 'c.s.fact', source_m: null }],
        ['dim', { displayName: 'Dim', uc_full_path: 'c.s.dim', source_m: null }],
      ]),
      measures: new Map(),
      relationships: [{ fromTable: 'Fact', fromColumn: 'k', toTable: 'Dim', toColumn: 'k', both: false, active: true, ...(cardinality ? { cardinality } : {}) }],
    };
  }

  it('many-to-many relationships add no blank row (limited relationship)', () => {
    const regular = compileMeasureToSql({ measureDax: 'COUNTROWS(VALUES(Dim[k]))', catalog: catalog() });
    expect(regular.ok && regular.sql).toContain('blank_row');
    const mm = compileMeasureToSql({ measureDax: 'COUNTROWS(VALUES(Dim[k]))', catalog: catalog('many_to_many') });
    expect(mm.ok && mm.sql).not.toContain('blank_row');
  });

  it('one-to-one relationships filter in both directions', () => {
    const dax = 'CALCULATE(COUNTROWS(Dim), Fact[amt] > 10)';
    const single = compileMeasureToSql({ measureDax: dax, catalog: catalog() });
    const oneToOne = compileMeasureToSql({ measureDax: dax, catalog: catalog('one_to_one') });
    expect(single.ok && oneToOne.ok).toBe(true);
    if (single.ok && oneToOne.ok) {
      expect(single.sql).not.toMatch(/`AMT`/);
      expect(oneToOne.sql).toMatch(/`AMT`/);
    }
  });
});

describe('publishing uses the definition', () => {
  it('constant measures that exist for a dynamic format string are not published', async () => {
    const { isDisplayHelper } = await import('@/lib/powerbi/publish-question');
    expect(isDisplayHelper({ dax: '0', props: { tmdl: { formatStringDefinition: 'SELECTEDVALUE(X[f])' } } })).toBe(true);
    expect(isDisplayHelper({ dax: 'SUM(T[x])', props: { tmdl: { formatStringDefinition: 'SELECTEDVALUE(X[f])' } } })).toBe(false);
    expect(isDisplayHelper({ dax: '0', props: {} })).toBe(false);
  });

  it('embedding text carries the description and synonyms', async () => {
    const { composeVerifiedQueryEmbedText } = await import('@/lib/powerbi/verified-query-embed');
    const text = composeVerifiedQueryEmbedText({
      question: 'What is total revenue?',
      altPhrasings: [],
      measureName: 'Total Revenue',
      description: 'Invoiced revenue in USD',
      synonyms: ['total revenue', 'sales', 'turnover'],
    });
    expect(text.split('\n')).toEqual(['What is total revenue?', 'Total Revenue', 'Invoiced revenue in USD', 'sales', 'turnover']);
  });
});
