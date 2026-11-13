/**
 * Extract Unity Catalog three-part paths from Spark SQL in Power BI native queries.
 */

export function normalizeThreePartPath(catalog: string, schema: string, table: string): string {
  return `${catalog}.${schema}.${table}`.toLowerCase();
}

/**
 * Returns deduplicated catalog.schema.table paths from FROM/JOIN clauses.
 */
export function extractTablePathsFromSql(sql: string): string[] {
  const text = sql.replace(/#\(lf\)/gi, '\n');
  const paths = new Set<string>();
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z0-9_#]+)\.([A-Za-z0-9_#]+)\.([A-Za-z0-9_#]+)/gi;
  for (const match of text.matchAll(re)) {
    const catalog = match[1];
    const schema = match[2];
    const table = match[3];
    if (catalog && schema && table) {
      paths.add(normalizeThreePartPath(catalog, schema, table));
    }
  }
  return [...paths];
}

function hostLabel(host: string): string {
  const t = host.trim().toLowerCase();
  try {
    if (t.includes('://')) return new URL(t).hostname;
  } catch {
    /* ignore */
  }
  return t.split('/')[0] ?? t;
}

export function pickDatabricksSourceId(
  host: string | null | undefined,
  sources: { id: string; connection_ref: string }[],
): string | null {
  if (!sources.length) return null;
  if (!host?.trim()) {
    return sources.length === 1 ? sources[0].id : null;
  }
  const h = hostLabel(host);
  for (const s of sources) {
    const ref = hostLabel(s.connection_ref);
    if (!ref) continue;
    if (ref === h || ref.includes(h) || h.includes(ref)) return s.id;
  }
  if (sources.length === 1) return sources[0].id;
  return null;
}

export type CatalogBindStatus = 'matched' | 'unscanned' | 'ambiguous' | 'non_uc' | 'pending';

export function resolveCatalogBind(input: {
  sql: string | null;
  pathIndex: Map<string, { id: string; source_id: string }[]>;
  databricksSourceId: string | null;
}): {
  status: CatalogBindStatus;
  ucPath: string | null;
  contextObjectId: string | null;
} {
  if (!input.sql?.trim()) {
    return { status: 'non_uc', ucPath: null, contextObjectId: null };
  }
  const paths = extractTablePathsFromSql(input.sql);
  if (paths.length === 0) {
    return { status: 'ambiguous', ucPath: null, contextObjectId: null };
  }
  const primary = paths[0];
  let candidates = input.pathIndex.get(primary) ?? [];
  if (input.databricksSourceId) {
    candidates = candidates.filter((c) => c.source_id === input.databricksSourceId);
  }
  if (candidates.length === 1) {
    return { status: 'matched', ucPath: primary, contextObjectId: candidates[0].id };
  }
  if (candidates.length === 0) {
    return { status: 'unscanned', ucPath: primary, contextObjectId: null };
  }
  return { status: 'ambiguous', ucPath: primary, contextObjectId: null };
}
