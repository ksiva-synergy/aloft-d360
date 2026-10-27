/** Default Catalog → Jobs pipeline for one schema (or whole catalog). */

export const CATALOG_PIPELINE_KINDS = ['t0_structural', 't1_profile', 't2_semantic'] as const;

export function schemaIncludePattern(catalog: string, schema: string): string {
  return `${catalog}.${schema}.*`;
}

export function catalogIncludePattern(catalog: string): string {
  return `${catalog}.*`;
}

export function resolveCatalogPipelineScope(
  catalog: string,
  schema?: string,
): { includePatterns: string[]; label: string } {
  if (schema) {
    return {
      includePatterns: [schemaIncludePattern(catalog, schema)],
      label: `${catalog}.${schema}`,
    };
  }
  return {
    includePatterns: [catalogIncludePattern(catalog)],
    label: catalog,
  };
}

export interface CatalogPipelineLaunchBody {
  kinds: string[];
  includePatterns: string[];
  sequential: boolean;
  sourceId?: string;
  excludeSchemas: string[];
}

export function buildCatalogPipelineLaunchBody(
  catalog: string,
  schema?: string,
  sourceId?: string,
): CatalogPipelineLaunchBody {
  const { includePatterns } = resolveCatalogPipelineScope(catalog, schema);
  return {
    kinds: [...CATALOG_PIPELINE_KINDS],
    includePatterns,
    sequential: true,
    excludeSchemas: [],
    ...(sourceId ? { sourceId } : {}),
  };
}
