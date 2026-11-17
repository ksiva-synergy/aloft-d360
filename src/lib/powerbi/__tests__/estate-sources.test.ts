import { describe, expect, it } from 'vitest';

import {
  modelSourceRefs,
  refFromServiceDatasource,
  refKeys,
  sourceTypeCategory,
  type ServiceDatasource,
} from '@/lib/powerbi/estate-sources';

const ds = (datasource_type: string, details: Record<string, unknown>, extra: Partial<ServiceDatasource> = {}): ServiceDatasource => ({
  datasource_type,
  connection_server: typeof details.server === 'string' ? details.server : null,
  connection_path: typeof details.path === 'string' ? details.path : null,
  raw: { datasourceType: datasource_type, connectionDetails: details },
  ...extra,
});

describe('refFromServiceDatasource', () => {
  it('identifies SQL Server server and database', () => {
    const r = refFromServiceDatasource(ds('Sql', { server: 'SRV01.database.windows.net', database: 'Sales' }))!;
    expect(r.type).toBe('sql_server');
    expect(r.instance?.key).toBe('srv01.database.windows.net');
    expect(r.database).toEqual({ key: 'sales', label: 'Sales' });
    expect(sourceTypeCategory(r.type)).toBe('databases');
  });

  it('reads the Databricks workspace host from the extension path', () => {
    const r = refFromServiceDatasource(
      ds('Extension', { kind: 'Databricks', path: '{"host":"adb-1.2.azuredatabricks.net","httpPath":"\\/sql\\/1.0\\/warehouses\\/abc"}' }),
    )!;
    expect(r.type).toBe('databricks');
    expect(r.instance?.key).toBe('adb-1.2.azuredatabricks.net');
  });

  it('reads the Snowflake account from the extension path', () => {
    const r = refFromServiceDatasource(ds('Extension', { kind: 'Snowflake', path: 'acct.region.snowflakecomputing.com;BI_WH' }))!;
    expect(r.type).toBe('snowflake');
    expect(r.instance?.key).toBe('acct.region.snowflakecomputing.com');
  });

  it('groups SharePoint file URLs by site and separates OneDrive', () => {
    const sp = refFromServiceDatasource(ds('Web', { url: 'https://tenant.sharepoint.com/sites/Finance/Shared%20Documents/x.xlsx' }))!;
    expect(sp.type).toBe('sharepoint');
    expect(sp.instance).toMatchObject({ key: 'tenant.sharepoint.com/sites/finance', label: 'Finance · tenant' });
    const od = refFromServiceDatasource(ds('Web', { url: 'https://tenant-my.sharepoint.com/personal/a_b_com/Documents/y.xlsx' }))!;
    expect(od.type).toBe('onedrive');
    expect(od.instance?.label).toBe('a_b_com · tenant');
  });

  it('groups local files by folder', () => {
    const r = refFromServiceDatasource(ds('File', { path: 'C:\\Reports\\Q1\\budget.xlsx' }))!;
    expect(r.type).toBe('local_file');
    expect(r.instance?.label).toBe('C:\\Reports\\Q1');
  });

  it('keeps unrecognised connectors as named "other" sources', () => {
    const r = refFromServiceDatasource(ds('Extension', { kind: 'SomeVendor', path: 'x' }))!;
    expect(r.type).toBe('other');
    expect(r.instance?.label).toBe('SomeVendor');
  });
});

describe('modelSourceRefs', () => {
  it('adds the Databricks catalog from Power Query under the service-listed workspace', () => {
    const refs = modelSourceRefs({
      datasources: [ds('Extension', { kind: 'Databricks', path: '{"host":"adb-9.azuredatabricks.net","httpPath":"/sql/1.0/warehouses/w"}' })],
      expressions: [],
      tables: [
        {
          name: 'Sales',
          partition_kind: 'm',
          source_m:
            'let Source = Databricks.Catalogs("adb-9.azuredatabricks.net", "/sql/1.0/warehouses/w"), c = Source{[Name="gold",Kind="Database"]}[Data], s = c{[Name="sales",Kind="Schema"]}[Data], t = s{[Name="orders",Kind="Table"]}[Data] in t',
        },
      ],
    });
    const keys = refs.flatMap(refKeys);
    expect(keys).toContain('cat:databricks');
    expect(keys).toContain('inst:databricks|adb-9.azuredatabricks.net');
    expect(keys).toContain('db:databricks|adb-9.azuredatabricks.net|gold');
  });

  it('attaches a database whose server is a parameter to the model’s only server of that type', () => {
    const refs = modelSourceRefs({
      datasources: [ds('Sql', { server: 'srv02', database: 'Ops' })],
      expressions: [],
      tables: [{ name: 'T', partition_kind: 'm', source_m: 'let S = Sql.Database(ServerParam, "Ops") in S' }],
    });
    expect(refs.flatMap(refKeys)).toContain('db:sql_server|srv02|ops');
    expect(refs.filter((r) => r.type === 'sql_server' && !r.instance)).toHaveLength(0);
  });

  it('classifies calculated tables under Power BI and returns nothing for an empty model', () => {
    const refs = modelSourceRefs({ datasources: [], expressions: [], tables: [{ name: 'D', partition_kind: 'calculated_table', source_m: null }] });
    expect(refs.flatMap(refKeys)).toEqual(['cat:powerbi', 'type:calculated']);
    expect(modelSourceRefs({ datasources: [], expressions: [], tables: [] })).toEqual([]);
  });
});

describe('Fabric SQL endpoints', () => {
  it('classifies Fabric hosts as Fabric, merges ports and drops GUID suffixes from database labels', () => {
    const a = refFromServiceDatasource(
      ds('Sql', { server: 'abcdefghij-xyz.database.fabric.microsoft.com,1433', database: 'audits-8e87603a-d938-4def-9055-8f9129558666' }),
    )!;
    const b = refFromServiceDatasource(ds('Sql', { server: 'abcdefghij-xyz.database.fabric.microsoft.com', database: 'audits-8e87603a-d938-4def-9055-8f9129558666' }))!;
    expect(a.type).toBe('fabric');
    expect(a.instance?.key).toBe(b.instance?.key);
    expect(a.instance?.label).toBe('SQL database · abcdefgh…');
    expect(a.database?.label).toBe('audits');
    const wh = refFromServiceDatasource(ds('Sql', { server: 'abcdefghij-xyz.datawarehouse.fabric.microsoft.com', database: 'repo' }))!;
    expect(wh.instance?.label).toBe('Warehouse / Lakehouse · abcdefgh…');
  });
});
