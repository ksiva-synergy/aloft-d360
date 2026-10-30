import { describe, expect, it } from 'vitest';

/** Mirrors catalog.schema keys collected in runEstateInventory before the remove diff. */
function inventoriedSchemaKeys(
  rows: { table_catalog: string; table_schema: string }[],
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(`${row.table_catalog}.${row.table_schema}`);
  }
  return Array.from(seen);
}

describe('estate inventory remove diff scope', () => {
  it('limits soft-delete to schemas upserted in the run, not whole catalogs', () => {
    const keys = inventoriedSchemaKeys([
      { table_catalog: 'open_analytics_zone', table_schema: 'ash_scratchpad' },
    ]);
    expect(keys).toEqual(['open_analytics_zone.ash_scratchpad']);
    expect(keys.some(k => k.endsWith('.qhse'))).toBe(false);
  });
});
