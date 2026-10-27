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

/** Schema-level filter for plan split: catalog.schema and table-level Limit globs. */
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

export function pathMatchesIncludePatterns(fullPath: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  return patterns.some(pat => minimatch(fullPath, pat, { dot: true }));
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
  const sql = (statementText ?? '').toLowerCase();
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
