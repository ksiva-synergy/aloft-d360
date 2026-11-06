import { describe, expect, it } from 'vitest';
import { filterT4EligibleByScope, groupObjectsBySchemaCluster, type T4EligibleObject } from './cluster';

describe('groupObjectsBySchemaCluster', () => {
  it('groups by source + catalog + schema', () => {
    const objects: T4EligibleObject[] = [
      {
        id: 'a',
        source_id: 's1',
        full_path: 'c1.s1.t1',
        catalog_name: 'c1',
        schema_name: 's1',
        object_name: 't1',
      },
      {
        id: 'b',
        source_id: 's1',
        full_path: 'c1.s1.t2',
        catalog_name: 'c1',
        schema_name: 's1',
        object_name: 't2',
      },
      {
        id: 'c',
        source_id: 's1',
        full_path: 'c1.s2.t3',
        catalog_name: 'c1',
        schema_name: 's2',
        object_name: 't3',
      },
    ];
    const clusters = groupObjectsBySchemaCluster(objects);
    expect(clusters).toHaveLength(2);
    expect(clusters.find(c => c.schema === 's1')?.objectIds).toEqual(['a', 'b']);
  });
});

describe('filterT4EligibleByScope', () => {
  const objects: T4EligibleObject[] = [
    {
      id: 'a',
      source_id: 's1',
      full_path: 'landing_zone_dev.sire_2_0.sire_report',
      catalog_name: 'landing_zone_dev',
      schema_name: 'sire_2_0',
      object_name: 'sire_report',
    },
    {
      id: 'b',
      source_id: 's1',
      full_path: 'landing_zone_dev.sire_2_0.other',
      catalog_name: 'landing_zone_dev',
      schema_name: 'sire_2_0',
      object_name: 'other',
    },
  ];

  it('keeps only the Limit table', () => {
    const kept = filterT4EligibleByScope(objects, {
      includePatterns: ['landing_zone_dev.sire_2_0.sire_report'],
    });
    expect(kept.map(o => o.id)).toEqual(['a']);
  });

  it('returns every object when the job has no Limit', () => {
    expect(filterT4EligibleByScope(objects)).toHaveLength(2);
  });
});
