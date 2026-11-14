import { describe, expect, it } from 'vitest';

import { classifyPartitionSource } from '@/lib/powerbi/partition-kind';
import {
  buildQueryMap,
  describeOrigin,
  describeSourceOrigins,
  isOutsideWarehouse,
  originTitle,
  parseTmdlExpressions,
} from '@/lib/powerbi/source-origin';

const SITE = 'https://contoso.sharepoint.com/sites/Ops/';

const FILE_TABLE_M = `let
    Source = SharePoint.Files("${SITE}", [ApiVersion = 15]),
    #"Filtered Rows" = Table.SelectRows(Source, each ([Name] = "Tracker.xlsx")),
    #"Invoke Custom Function1" = Table.AddColumn(#"Filtered Rows", "Transform File (2)", each #"Transform File (2)"([Content])),
    #"Expanded" = Table.ExpandTableColumn(#"Invoke Custom Function1", "Transform File (2)", Table.ColumnNames(#"Transform File (2)"(#"Sample File (2)")))
in
    #"Expanded"`;

const EXPRESSIONS_TMDL = [
  'expression Parameter2 = #"Sample File (2)" meta [IsParameterQuery=true, BinaryIdentifier=#"Sample File (2)", Type="Binary"]',
  '\tlineageTag: 1',
  '',
  "expression 'Sample File (2)' =",
  '\t\tlet',
  `\t\t    Source = SharePoint.Files("${SITE}", [ApiVersion = 15]),`,
  '\t\t    #"Filtered Rows" = Table.SelectRows(Source, each ([Name] = "Tracker.xlsx")),',
  '\t\t    Navigation1 = #"Filtered Rows"{0}[Content]',
  '\t\tin',
  '\t\t    Navigation1',
  '\tlineageTag: 2',
  "\tqueryGroup: 'Helper Queries'",
  '',
  '\tannotation PBI_ResultType = Binary',
  '',
  "expression 'Transform File (2)' =",
  '\t\tlet',
  '\t\t    Source = (Parameter2) => let',
  '\t\t        Source = Excel.Workbook(Parameter2, null, true),',
  '\t\t        Process_Table = Source{[Item="Process",Kind="Table"]}[Data]',
  '\t\t    in',
  '\t\t        Process_Table',
  '\t\tin',
  '\t\t    Source',
  '\tlineageTag: 3',
].join('\n');

describe('source origin', () => {
  it('parses shared expressions from expressions.tmdl', () => {
    const ex = parseTmdlExpressions(EXPRESSIONS_TMDL);
    expect(ex.map((e) => e.name)).toEqual(['Parameter2', 'Sample File (2)', 'Transform File (2)']);
    expect(ex[1]!.m).toMatch(/^let\n\s+Source = SharePoint\.Files/);
    expect(ex[1]!.m).not.toMatch(/lineageTag/);
    expect(ex[2]!.m).toMatch(/Excel\.Workbook/);
  });

  it('follows helper queries to the Excel file, its sheet / table, and the SharePoint site', () => {
    const queries = buildQueryMap(parseTmdlExpressions(EXPRESSIONS_TMDL), []);
    const [o, ...rest] = describeSourceOrigins(FILE_TABLE_M, queries);
    expect(rest).toEqual([]);
    expect(o).toMatchObject({ system: 'sharepoint', format: 'excel', location: SITE, file: 'Tracker.xlsx' });
    expect(o!.items).toEqual([{ name: 'Process', kind: 'Table' }]);
    expect(isOutsideWarehouse(o!)).toBe(true);
    expect(originTitle(o!)).toBe('Excel file on SharePoint');
    expect(describeOrigin(o!)).toBe(`Excel file "Tracker.xlsx" (table Process) on SharePoint site ${SITE}`);
  });

  it('without the helper queries still finds the site and file', () => {
    const [o] = describeSourceOrigins(FILE_TABLE_M);
    expect(o).toMatchObject({ system: 'sharepoint', file: 'Tracker.xlsx', location: SITE });
  });

  it('reads database sources: Snowflake native query, SQL Server, Databricks navigation', () => {
    const [sf] = describeSourceOrigins(
      'let Source = Value.NativeQuery(Snowflake.Databases("acct.snowflakecomputing.com","WH",[Role="R"]){[Name="REPORTING"]}[Data], "SELECT * FROM REPORTING.QHSE.VW_X", null, [EnableFolding=true]) in Source',
    );
    expect(sf).toMatchObject({ system: 'snowflake', location: 'acct.snowflakecomputing.com', database: 'REPORTING', object: 'REPORTING.QHSE.VW_X' });
    expect(isOutsideWarehouse(sf!)).toBe(false);

    const [sql] = describeSourceOrigins('let Source = Sql.Database("srv.database.windows.net", "Sales"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T');
    expect(sql).toMatchObject({ system: 'sql_server', location: 'srv.database.windows.net', database: 'Sales' });

    const [dbx] = describeSourceOrigins(
      'let Source = Databricks.Catalogs("adb-1.azuredatabricks.net", "/sql/1.0/warehouses/x", []), c = Source{[Name="main",Kind="Database"]}[Data], s = c{[Name="sales",Kind="Schema"]}[Data], t = s{[Name="orders",Kind="Table"]}[Data] in t',
    );
    expect(dbx).toMatchObject({ system: 'databricks', database: 'main', object: 'sales.orders' });
  });

  it('reads web, OneDrive, CSV, folder, dataflow and embedded sources', () => {
    const [web] = describeSourceOrigins('let Source = Csv.Document(Web.Contents("https://data.example.com/x/rates.csv"),[Delimiter=","]) in Source');
    expect(web).toMatchObject({ system: 'web', format: 'csv', file: 'rates.csv' });

    const [od] = describeSourceOrigins(
      'let Source = Excel.Workbook(Web.Contents("https://contoso-my.sharepoint.com/personal/a_b/Documents/Budget%202026.xlsx"), null, true), S = Source{[Item="Sheet1",Kind="Sheet"]}[Data] in S',
    );
    expect(od).toMatchObject({ system: 'onedrive', format: 'excel', file: 'Budget 2026.xlsx', location: 'https://contoso-my.sharepoint.com/personal/a_b/' });
    expect(od!.items).toEqual([{ name: 'Sheet1', kind: 'Sheet' }]);

    const [folder] = describeSourceOrigins('let Source = Folder.Files("\\\\fs01\\share\\exports") in Source');
    expect(folder).toMatchObject({ system: 'folder', location: '\\\\fs01\\share\\exports' });

    const [df] = describeSourceOrigins(
      'let Source = PowerPlatform.Dataflows(null), W = Source{[workspaceName="Finance"]}[Data], D = W{[dataflowName="GL"]}[Data], E = D{[entity="Ledger",version=""]}[Data] in E',
    );
    expect(df).toMatchObject({ system: 'dataflow', location: 'Finance', database: 'GL', object: 'Ledger' });

    const [emb] = describeSourceOrigins(
      'let Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("i44FAA==", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Column1 = _t]) in Source',
    );
    expect(emb!.system).toBe('embedded');
  });

  it('follows a reference to another table query', () => {
    const queries = buildQueryMap([], [{ name: 'Base', source_m: FILE_TABLE_M }]);
    const [o] = describeSourceOrigins('let Source = Table.NestedJoin(Base, {"K"}, Base, {"K"}, "j", JoinKind.LeftOuter) in Source', queries, {
      selfName: 'Joined',
    });
    expect(o).toMatchObject({ system: 'sharepoint', file: 'Tracker.xlsx' });
  });

  it('calculated tables are DAX, not a source', () => {
    expect(describeSourceOrigins('SUMMARIZE(FILTER(T, T[K] <> BLANK()), T[K])')[0]!.system).toBe('calculated');
  });
});

describe('partition kind', () => {
  it('a SharePoint / Excel query is a file even when it expands helper tables', () => {
    expect(classifyPartitionSource(FILE_TABLE_M, 'T')).toBe('other_file');
    expect(classifyPartitionSource('let S = Csv.Document(File.Contents("C:\\\\x.csv")) in S', 'T')).toBe('other_file');
    expect(
      classifyPartitionSource('let S = Excel.Workbook(Web.Contents("https://contoso-my.sharepoint.com/personal/a/x.xlsx")) in S', 'T'),
    ).toBe('personal_file');
    expect(classifyPartitionSource('let S = Table.NestedJoin(A, {"k"}, B, {"k"}, "B", JoinKind.LeftOuter) in S', 'T')).toBe('query_join');
    expect(classifyPartitionSource('let S = Value.NativeQuery(Snowflake.Databases("h","w"){[Name="D"]}[Data], "SELECT 1") in S', 'T')).toBe(
      'warehouse_query',
    );
  });
});
