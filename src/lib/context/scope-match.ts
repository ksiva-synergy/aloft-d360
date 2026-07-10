/**
 * scope-match.ts — Shared scope include/exclude predicate for Databricks paths.
 *
 * Extracted from databricks-adapter.ts so it can be used in sentinel-runtime
 * code (deepScan.ts, verify scripts) which cannot import databricks-adapter.ts
 * because that file carries `import 'server-only'`.
 *
 * Single source of truth for the three-part glob matching that was originally
 * fixed in the FM-02 cross-catalog exclude-bleed incident (see ops doc):
 *   - Patterns are matched against the FULL three-part path (catalog.schema.table)
 *   - Uses minimatch with dot:true so leading-dot names are included
 *   - A path is in-scope iff it matches at least one include AND no exclude
 *
 * databricks-adapter.ts's resolveScope() imports from this module — so any
 * change here is tested by the harvester's existing test coverage.
 */

// minimatch v3 — no bundled types, @types/minimatch not installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const minimatch = require('minimatch') as (p: string, pattern: string, opts?: { dot?: boolean }) => boolean;

export { minimatch };

/**
 * Returns true iff `fullPath` matches at least one include pattern AND
 * does not match any exclude pattern.
 *
 * `fullPath` must be in the form `catalog.schema.table` produced by
 * buildFullPath() — all lower-cased, trimmed. Patterns follow the same
 * three-part shape; a bare `schema.*` pattern will NOT match because the
 * first segment (catalog) won't align. This is intentional: it matches how
 * the harvester historically failed when exclude patterns were stored without
 * the catalog prefix.
 *
 * @param fullPath  e.g. "open_analytics_zone.sales.orders"
 * @param includes  scope_include from the source config; defaults to ['*.*.*']
 * @param excludes  scope_exclude from the source config; defaults to []
 */
export function matchesScope(
  fullPath: string,
  includes: string[],
  excludes: string[],
): boolean {
  const inc = includes.length > 0 ? includes : ['*.*.*'];
  const exc = excludes;

  const included = inc.some(pat => minimatch(fullPath, pat, { dot: true }));
  if (!included) return false;
  const excluded = exc.some(pat => minimatch(fullPath, pat, { dot: true }));
  return !excluded;
}

/**
 * Returns true iff the catalog itself could match the first segment of any
 * include pattern. Used to skip catalogs that are entirely outside scope
 * before issuing a Databricks query.
 *
 * Mirrors resolveScope()'s candidateCatalogs filter (line 94-96 in
 * databricks-adapter.ts).
 */
export function catalogMatchesIncludes(catalog: string, includes: string[]): boolean {
  const inc = includes.length > 0 ? includes : ['*.*.*'];
  return inc.some(pat => minimatch(catalog, pat.split('.')[0], { dot: true }));
}

/**
 * Returns true iff the schema within a catalog could match the second segment
 * of any include pattern for that catalog. Mirrors resolveScope()'s
 * candidateSchemas derivation.
 */
export function schemaMatchesIncludes(catalog: string, schema: string, includes: string[]): boolean {
  const inc = includes.length > 0 ? includes : ['*.*.*'];
  return inc
    .filter(pat => minimatch(catalog, pat.split('.')[0], { dot: true }))
    .some(pat => minimatch(schema, pat.split('.')[1] || '*', { dot: true }));
}
