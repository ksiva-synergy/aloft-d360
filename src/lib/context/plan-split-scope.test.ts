import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/spend/record-spend-event', () => ({ recordHarvestJobSpend: vi.fn() }));

const queryRawUnsafe = vi.fn();
const contextFindMany = vi.fn();
const estateFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  default: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    platformContextObject: { findMany: (...args: unknown[]) => contextFindMany(...args) },
    platformEstateObject: { findMany: (...args: unknown[]) => estateFindMany(...args) },
  },
}));

import { planEstateSplit, planSplit } from './queue';

const SCHEMA_ROWS = [
  { catalog_name: 'open_analytics_zone', schema_name: 'ash_scratchpad', cnt: BigInt(7) },
  { catalog_name: 'open_analytics_zone', schema_name: 'other', cnt: BigInt(3) },
];
const OBJECTS = [
  { object_name: 'global_employee_master', full_path: 'open_analytics_zone.ash_scratchpad.global_employee_master' },
  { object_name: 'other_table', full_path: 'open_analytics_zone.ash_scratchpad.other_table' },
];
const TABLE = 'open_analytics_zone.ash_scratchpad.global_employee_master';

describe('planSplit / planEstateSplit with table-level Limit', () => {
  beforeEach(() => {
    queryRawUnsafe.mockReset().mockResolvedValue(SCHEMA_ROWS);
    contextFindMany.mockReset().mockResolvedValue(OBJECTS);
    estateFindMany.mockReset().mockResolvedValue(OBJECTS);
  });

  it('counts only the matching table for T1', async () => {
    const plan = await planSplit('org-1', 't1_profile', 'src-1', { includePatterns: [TABLE] });
    expect(plan.totalObjects).toBe(1);
    expect(contextFindMany).toHaveBeenCalledTimes(1);
    expect(contextFindMany.mock.calls[0][0].where.schema_name).toBe('ash_scratchpad');
  });

  it('counts only the matching table for T0', async () => {
    const plan = await planEstateSplit('org-1', 't0_structural', 'src-1', { includePatterns: [TABLE] });
    expect(plan.totalObjects).toBe(1);
  });

  it('keeps schema-level Limit counts without per-object lookups', async () => {
    const plan = await planSplit('org-1', 't1_profile', 'src-1', {
      includePatterns: ['open_analytics_zone.ash_scratchpad.*'],
    });
    expect(plan.totalObjects).toBe(7);
    expect(contextFindMany).not.toHaveBeenCalled();
  });
});
