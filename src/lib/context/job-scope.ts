const minimatch = require('minimatch') as (p: string, pattern: string, opts?: { dot?: boolean }) => boolean;

/** True when launch/plan should count `platform_estate_objects` (discovery), not scanned rows. */
export function usesEstateObjectPlan(kind: string): boolean {
  return kind === 't0_structural' || kind === 'estate_inventory';
}

/** Match catalog.schema against Focus globs (same rules as planSplit). */
export function schemaMatchesIncludePatterns(catalog: string, schema: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  const qualified = `${catalog}.${schema}`;
  const wildcard = `${qualified}.*`;
  return patterns.some(
    pat =>
      minimatch(wildcard, pat, { dot: true }) ||
      minimatch(qualified, pat, { dot: true }),
  );
}

/**
 * Schema-level filter for plan split: matches when every table in catalog.schema is in
 * scope. Table-level Limit globs (catalog.schema.table) do not match here — see
 * `tablePatternsMayMatchSchema`.
 */
export function catalogSchemaMatchesIncludePatterns(
  catalog: string,
  schema: string,
  patterns: string[],
): boolean {
  if (!patterns.length) return true;
  if (schemaMatchesIncludePatterns(catalog, schema, patterns)) return true;
  const schemaGlob = `${catalog}.${schema}.*`;
  return patterns.some(pat => minimatch(schemaGlob, pat, { dot: true }));
}

/** True when a table-level glob (catalog.schema.table) could match objects in catalog.schema. */
export function tablePatternsMayMatchSchema(catalog: string, schema: string, patterns: string[]): boolean {
  const qualified = `${catalog}.${schema}`;
  return patterns.some(pat => {
    const parts = pat.split('.');
    if (parts.length < 3) return false;
    return minimatch(qualified, parts.slice(0, 2).join('.'), { dot: true });
  });
}

export function pathMatchesIncludePatterns(fullPath: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  return patterns.some(pat => minimatch(fullPath, pat, { dot: true }));
}

/** True when two Focus glob sets could match the same table path. */
export function includePatternsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb) return true;
      if (minimatch(pa, pb, { dot: true }) || minimatch(pb, pa, { dot: true })) return true;
    }
  }
  return false;
}

/** Modal exclude tree uses `catalog.schema` keys (schema-only keys supported for legacy). */
export function isSchemaExcluded(catalog: string, schema: string, excludeSchemas: string[]): boolean {
  if (!excludeSchemas.length) return false;
  const key = `${catalog}.${schema}`.toLowerCase();
  const set = new Set(excludeSchemas.map(s => s.toLowerCase()));
  return set.has(key) || set.has(schema.toLowerCase());
}

export function pathExcludedBySchemas(fullPath: string, excludeSchemas: string[]): boolean {
  if (!excludeSchemas.length) return false;
  const parts = fullPath.split('.');
  if (parts.length < 2) return false;
  return isSchemaExcluded(parts[0], parts[1], excludeSchemas);
}

export function objectMatchesJobScope(
  fullPath: string,
  catalog: string | null | undefined,
  schema: string | null | undefined,
  opts: { includePatterns?: string[]; excludeSchemas?: string[] },
): boolean {
  const includePatterns = opts.includePatterns ?? [];
  const excludeSchemas = opts.excludeSchemas ?? [];
  if (catalog && schema && isSchemaExcluded(catalog, schema, excludeSchemas)) return false;
  if ((!catalog || !schema) && pathExcludedBySchemas(fullPath, excludeSchemas)) return false;
  return pathMatchesIncludePatterns(fullPath, includePatterns);
}

/** Convert a Databricks full_path to a single-table Focus glob. */
export function pathToIncludePattern(path: string): string {
  return path.trim();
}

/**
 * Merge job scope fields used by orchestrator runners.
 * Per-object enqueue uses `path`; workers honor `includePatterns`.
 */
/** Whether SQL text likely references a table (qualified match preferred over bare name). */
export function statementReferencesObject(
  statementText: string,
  obj: {
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
  },
): boolean {
  const sql = (statementText ?? '').toLowerCase().replace(/`/g, '');
  const catalog = (obj.catalog_name ?? '').toLowerCase();
  const schema = (obj.schema_name ?? '').toLowerCase();
  const table = (obj.object_name ?? '').toLowerCase();
  if (!table || !sql) return false;

  if (catalog && schema) {
    const fullyQualified = `${catalog}.${schema}.${table}`;
    if (sql.includes(fullyQualified)) return true;
  }
  if (schema) {
    const schemaQualified = `${schema}.${table}`;
    if (sql.includes(schemaQualified)) return true;
  }
  return false;
}

/** Drop query-history rows that cannot reference any in-scope scanned object (T3 P2-5). */
/** Escape single quotes for SQL string literals (Databricks). */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Escape `%` and `_` for LIKE patterns on lineage table names (not query history). */
function sqlLikeLiteral(value: string): string {
  return sqlLiteral(value).replace(/[%_]/g, ch => `\\${ch}`);
}

/** Normalized statement_text for warehouse pushdown (matches post-filter in usage.ts). */
function queryHistoryStatementExpr(): string {
  return "replace(lower(statement_text), '`', '')";
}

/** Literal substring match — avoids LIKE `_`/`%` wildcards and ESCAPE dialect issues. */
function queryHistoryContainsFragment(pathLower: string): string {
  return `contains(${queryHistoryStatementExpr()}, '${sqlLiteral(pathLower)}')`;
}

/**
 * Optional SQL fragment for `system_tables.query.query_history` when T3 scope is narrow.
 * Up to `maxGroups` tables: match `catalog.schema.table` (backticks stripped).
 * Larger scopes: match `catalog.schema.` so the warehouse filter stays small.
 */
export function buildQueryHistoryStatementSqlFilter(
  objects: Array<{ catalog_name: string | null; schema_name: string | null; object_name?: string | null }>,
  maxGroups = 40,
): string | null {
  const tableKeys = new Set<string>();
  let unnamed = false;
  for (const o of objects) {
    const catalog = (o.catalog_name ?? '').toLowerCase();
    const schema = (o.schema_name ?? '').toLowerCase();
    const table = (o.object_name ?? '').toLowerCase();
    if (!schema || !table) {
      if (catalog || schema) unnamed = true;
      continue;
    }
    tableKeys.add(catalog ? `${catalog}.${schema}.${table}` : `${schema}.${table}`);
  }
  if (!unnamed && tableKeys.size > 0 && tableKeys.size <= maxGroups) {
    const clauses = [...tableKeys].map(k => queryHistoryContainsFragment(k));
    return `AND (${clauses.join(' OR ')})`;
  }

  const schemaKeys = new Set<string>();
  for (const o of objects) {
    if (o.catalog_name && o.schema_name) {
      schemaKeys.add(`${o.catalog_name}.${o.schema_name}`.toLowerCase());
    }
  }
  if (schemaKeys.size === 0) return null;
  const keys = [...schemaKeys].slice(0, maxGroups);
  const clauses = keys.map(k => queryHistoryContainsFragment(`${k}.`));
  return `AND (${clauses.join(' OR ')})`;
}

/**
 * Optional SQL fragment for `system.access.table_lineage` / `column_lineage`.
 * Up to 200 tables: exact full-name match. Larger sets: `catalog.schema.` prefix
 * so unrelated catalogs cannot fill the row cap.
 */
export function buildLineageTableSqlFilter(
  objects: Array<{ full_path: string; catalog_name?: string | null; schema_name?: string | null }>,
  maxExact = 200,
): string | null {
  const names = [...new Set(objects.map(o => o.full_path.trim().toLowerCase()).filter(Boolean))];
  if (names.length === 0) return null;
  if (names.length <= maxExact) {
    const list = names.map(n => `'${sqlLiteral(n)}'`).join(', ');
    return `AND (LOWER(source_table_full_name) IN (${list}) OR LOWER(target_table_full_name) IN (${list}))`;
  }

  const schemas = new Set<string>();
  for (const o of objects) {
    const catalog = (o.catalog_name ?? '').toLowerCase();
    const schema = (o.schema_name ?? '').toLowerCase();
    if (catalog && schema) {
      schemas.add(`${catalog}.${schema}`);
      continue;
    }
    const parts = o.full_path.toLowerCase().split('.');
    if (parts.length >= 2) schemas.add(`${parts[0]}.${parts[1]}`);
  }
  const keys = [...schemas].slice(0, 40);
  if (keys.length === 0) return null;
  const clauses = keys.flatMap(k => {
    const like = `'${sqlLikeLiteral(k)}.%'`;
    return [
      `LOWER(source_table_full_name) LIKE ${like} ESCAPE '\\'`,
      `LOWER(target_table_full_name) LIKE ${like} ESCAPE '\\'`,
    ];
  });
  return `AND (${clauses.join(' OR ')})`;
}

export function prefilterHistoryRowsForObjects<T extends { statement_text?: string | null }>(
  rows: T[],
  objects: Array<{
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
  }>,
): T[] {
  if (objects.length === 0) return [];
  return rows.filter(row =>
    objects.some(obj => statementReferencesObject(row.statement_text ?? '', obj)),
  );
}

export function resolveEffectiveScope(scope: Record<string, unknown>): {
  excludeSchemas: string[];
  includePatterns: string[];
} {
  const excludeSchemas = Array.isArray(scope.excludeSchemas)
    ? (scope.excludeSchemas as string[])
    : [];
  let includePatterns = Array.isArray(scope.includePatterns)
    ? [...(scope.includePatterns as string[])]
    : [];
  const path = typeof scope.path === 'string' ? scope.path.trim() : '';
  if (path && includePatterns.length === 0) {
    includePatterns = [pathToIncludePattern(path)];
  }
  return { excludeSchemas, includePatterns };
}
