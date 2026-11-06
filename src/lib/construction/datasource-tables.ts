import type { ConstructionState } from './constructionState';

export type Datasource = ConstructionState['tools']['datasources'][number];

/** Matches harvested `catalog.schema.table` paths (lowercase segments). */
export const QUALIFIED_TABLE_PATH = /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/i;

/** Databricks warehouse connection label shown in the workbench (matches runtime prompts). */
export const WAREHOUSE_CONNECTION_LABEL = 'synergy_dwh';

function splitScopeTables(scope: string | null | undefined): string[] {
  if (!scope?.trim()) return [];
  return scope
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => QUALIFIED_TABLE_PATH.test(s));
}

/** Collect unique table paths from datasource rows (handles legacy connection + scope blobs). */
export function datasourceTableRefs(items: Datasource[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of items) {
    if (d.kind !== 'databricks') continue;
    if (QUALIFIED_TABLE_PATH.test(d.ref)) {
      const key = d.ref.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(d.ref);
      }
      continue;
    }
    for (const t of splitScopeTables(d.scope)) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

export function countDatasourceTables(items: Datasource[]): number {
  return datasourceTableRefs(items).length;
}

/** Non-Databricks datasource rows (kb, mcp, api) and unrecognized databricks rows. */
export function otherDatasourceRows(items: Datasource[]): Datasource[] {
  return items.filter((d) => {
    if (d.kind !== 'databricks') return true;
    if (QUALIFIED_TABLE_PATH.test(d.ref)) return false;
    return splitScopeTables(d.scope).length === 0;
  });
}

export function tablesToDatabricksDatasources(tables: string[]): Datasource[] {
  const seen = new Set<string>();
  const out: Datasource[] = [];
  for (const ref of tables) {
    const key = ref.toLowerCase();
    if (!QUALIFIED_TABLE_PATH.test(ref) || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'databricks', ref, scope: null });
  }
  return out;
}

/** Merge normalized table rows with any non-table datasource entries. */
export function mergeDatasourceTables(items: Datasource[], tables: string[]): Datasource[] {
  return [...tablesToDatabricksDatasources(tables), ...otherDatasourceRows(items)];
}
