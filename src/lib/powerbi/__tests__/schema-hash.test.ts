import { describe, expect, it } from 'vitest';
import { computeSchemaHash } from '@/lib/powerbi/schema-hash';

describe('schema hash', () => {
  it('changes when SQL changes', () => {
    const a = computeSchemaHash({
      tablesUsed: ['catalog.schema.table'],
      daxHash: 'dax1',
      sqlText: 'SELECT 1',
    });
    const b = computeSchemaHash({
      tablesUsed: ['catalog.schema.table'],
      daxHash: 'dax1',
      sqlText: 'SELECT 2',
    });
    expect(a).not.toBe(b);
  });
});
