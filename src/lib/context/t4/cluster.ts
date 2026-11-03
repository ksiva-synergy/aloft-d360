import { objectMatchesJobScope } from '../job-scope';

export interface T4EligibleObject {
  id: string;
  source_id: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
}

export interface T4SchemaCluster {
  catalog: string;
  schema: string;
  sourceId: string;
  objectIds: string[];
}

/** Keep T4 candidates inside the job Limit and exclude tree. Empty scope means the whole list. */
export function filterT4EligibleByScope(
  objects: T4EligibleObject[],
  scope?: { includePatterns?: string[]; excludeSchemas?: string[] },
): T4EligibleObject[] {
  const includePatterns = scope?.includePatterns ?? [];
  const excludeSchemas = scope?.excludeSchemas ?? [];
  if (includePatterns.length === 0 && excludeSchemas.length === 0) return objects;
  return objects.filter(o =>
    objectMatchesJobScope(o.full_path, o.catalog_name, o.schema_name, {
      includePatterns,
      excludeSchemas,
    }),
  );
}

export function groupObjectsBySchemaCluster(objects: T4EligibleObject[]): T4SchemaCluster[] {
  const map = new Map<string, T4SchemaCluster>();
  for (const o of objects) {
    const catalog = o.catalog_name ?? o.full_path.split('.')[0] ?? 'unknown';
    const schema = o.schema_name ?? o.full_path.split('.')[1] ?? 'unknown';
    const key = `${o.source_id}|${catalog}|${schema}`;
    const existing = map.get(key);
    if (existing) {
      existing.objectIds.push(o.id);
    } else {
      map.set(key, {
        catalog,
        schema,
        sourceId: o.source_id,
        objectIds: [o.id],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.catalog}.${a.schema}`.localeCompare(`${b.catalog}.${b.schema}`),
  );
}
