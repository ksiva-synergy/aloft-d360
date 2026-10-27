import { describe, expect, it } from 'vitest';
import {
  buildCatalogPipelineLaunchBody,
  catalogIncludePattern,
  resolveCatalogPipelineScope,
  schemaIncludePattern,
} from './catalog-pipeline';

describe('catalog-pipeline', () => {
  it('builds schema-scoped Limit glob', () => {
    expect(schemaIncludePattern('curated_db', 'my_schema')).toBe('curated_db.my_schema.*');
  });

  it('builds catalog-wide glob when schema omitted', () => {
    expect(catalogIncludePattern('curated_db')).toBe('curated_db.*');
  });

  it('launch body chains T0→T1→T2 sequentially', () => {
    const body = buildCatalogPipelineLaunchBody('curated_db', 'sales', 'src-1');
    expect(body.kinds).toEqual(['t0_structural', 't1_profile', 't2_semantic']);
    expect(body.sequential).toBe(true);
    expect(body.includePatterns).toEqual(['curated_db.sales.*']);
    expect(body.sourceId).toBe('src-1');
    expect(body.excludeSchemas).toEqual([]);
  });

  it('resolveCatalogPipelineScope labels scope for UI', () => {
    expect(resolveCatalogPipelineScope('c', 's').label).toBe('c.s');
    expect(resolveCatalogPipelineScope('c').label).toBe('c');
  });
});
