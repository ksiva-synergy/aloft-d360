/** §8.5 partition classifier kinds (Power BI harvest build plan). */
export type PartitionKind =
  | 'warehouse_query'
  | 'embedded_table'
  | 'query_join'
  | 'dataflow'
  | 'calculated_table'
  | 'personal_file'
  | 'other_file'
  | 'auto_date_table'
  | 'unknown';

export function isAutoDateTableName(tableName: string): boolean {
  return (
    /^LocalDateTable_/i.test(tableName) ||
    /^DateTableTemplate_/i.test(tableName)
  );
}

/**
 * Classify partition M source (and optional table name for auto-date skip).
 */
export function classifyPartitionSource(
  partitionSource: string,
  tableName: string,
): PartitionKind {
  if (isAutoDateTableName(tableName)) return 'auto_date_table';
  const m = partitionSource;
  if (!m.trim()) return 'unknown';
  if (/\bpartition\b.*=\s*calculated/i.test(m) || /= calculated\b/i.test(m)) {
    return 'calculated_table';
  }
  if (/Table\.FromRows\s*\(/i.test(m) && /Binary\.FromText/i.test(m)) {
    return 'embedded_table';
  }
  if (/PowerBI\.Dataflows/i.test(m)) return 'dataflow';
  if (/Table\.NestedJoin|Table\.ExpandTableColumn/i.test(m) && !/Databricks\.Catalogs|Value\.NativeQuery/i.test(m)) {
    return 'query_join';
  }
  if (/-my\.sharepoint\.com\/personal\//i.test(m)) return 'personal_file';
  if (
    /Databricks\.Catalogs|Value\.NativeQuery|Sql\.Database|Snowflake\.Databases/i.test(m)
  ) {
    return 'warehouse_query';
  }
  if (/Excel\.Workbook|Web\.Contents|SharePoint\.Tables/i.test(m)) {
    return 'other_file';
  }
  return 'unknown';
}

export type ModelAnswerability = 'answerable' | 'caveated' | 'blocked';

export function classifyModelAnswerability(input: {
  rlsRequired: boolean;
  partitionKinds: PartitionKind[];
  parseError?: boolean;
}): ModelAnswerability {
  if (input.parseError) return 'blocked';
  const kinds = input.partitionKinds.filter((k) => k !== 'auto_date_table');
  if (kinds.length === 0) return 'caveated';

  const hasWarehouse = kinds.includes('warehouse_query');
  const hasPersonal = kinds.includes('personal_file');
  const onlyCalculatedOrEmbedded = kinds.every((k) =>
    ['calculated_table', 'embedded_table', 'query_join', 'unknown'].includes(k),
  );

  if (hasPersonal) return 'caveated';
  if (input.rlsRequired) return 'caveated';
  if (hasWarehouse) return 'answerable';
  if (onlyCalculatedOrEmbedded) return 'caveated';
  if (kinds.includes('other_file') || kinds.includes('dataflow')) return 'caveated';
  return 'caveated';
}

/** Best-effort UC path from Databricks native SQL in M. */
export function extractNativeSql(mSource: string): string | null {
  const i = mSource.indexOf('Value.NativeQuery');
  if (i === -1) return null;
  const tail = mSource.slice(i);
  const re = /"((?:[^"\\]|#\(lf\))*)"\s*,\s*null/g;
  let sql: string | null = null;
  for (const match of tail.matchAll(re)) {
    sql = match[1];
  }
  return sql ? sql.replace(/#\(lf\)/g, '\n').trim() : null;
}

export function extractDatabricksHost(mSource: string): string | null {
  const match = mSource.match(/Databricks\.Catalogs\s*\(\s*"([^"]+)"/i);
  return match?.[1] ?? null;
}

export function extractCatalogFromNativeSql(sql: string): string | null {
  const m = sql.match(/FROM\s+([A-Za-z0-9_]+)\.[A-Za-z0-9_#]+\.[A-Za-z0-9_#]+/i);
  return m?.[1] ?? null;
}
