import { describe, expect, it } from 'vitest';
import { inferAllReportsLineageResume } from '@/lib/powerbi/resume-all-reports-lineage';

describe('inferAllReportsLineageResume', () => {
  const base = {
    reports: 100,
    definitions: 100,
    parsed_reports: 100,
    missing_models: 0,
    models: 50,
    parsed_models: 50,
    warehouse_tables: 200,
    unresolved_tables: 0,
    non_warehouse_tables: 0,
  };

  it('starts at inventory when there are no reports', () => {
    expect(inferAllReportsLineageResume({ ...base, reports: 0, definitions: 0, models: 0, parsed_models: 0, parsed_reports: 0 }))
      .toEqual({ startKind: 'pbi_inventory', chain: ['pbi_definitions', 'pbi_parse', 'pbi_catalog_link'] });
  });

  it('resumes definitions when report definitions are incomplete', () => {
    expect(inferAllReportsLineageResume({ ...base, definitions: 14 })).toEqual({
      startKind: 'pbi_definitions',
      chain: ['pbi_parse', 'pbi_catalog_link'],
    });
  });

  it('resumes parse when parses lag definitions', () => {
    expect(inferAllReportsLineageResume({ ...base, parsed_reports: 80, parsed_models: 40 })).toEqual({
      startKind: 'pbi_parse',
      chain: ['pbi_catalog_link'],
    });
  });

  it('runs catalog link when earlier stages are complete', () => {
    expect(inferAllReportsLineageResume(base)).toEqual({
      startKind: 'pbi_catalog_link',
      chain: [],
    });
  });
});