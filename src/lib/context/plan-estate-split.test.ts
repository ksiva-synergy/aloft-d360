import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRawUnsafe = vi.fn().mockResolvedValue([]);
const findMany = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/db', () => ({
  default: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    platformContextObject: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

import { planEstateSplit } from './queue';
import { ESTATE_OBJECTS_BY_SOURCE_SQL } from './estate-source-sql';

describe('planEstateSplit', () => {
  beforeEach(() => {
    queryRawUnsafe.mockClear();
    findMany.mockClear();
  });

  it('estate source_id SQL uses text equality', () => {
    expect(ESTATE_OBJECTS_BY_SOURCE_SQL).toBe('source_id = $2');
    expect(ESTATE_OBJECTS_BY_SOURCE_SQL).not.toContain('::uuid');
  });

  it('queries platform_estate_objects without ::uuid on source_id bind', async () => {
    await planEstateSplit('org-1', 't0_structural', 'b491f1d6-944e-42d7-855b-dbd392bd7a3e', {});
    expect(queryRawUnsafe).toHaveBeenCalled();
    const sql = String(queryRawUnsafe.mock.calls[0][0]);
    expect(sql).toContain('platform_estate_objects');
    expect(sql).not.toMatch(/source_id\s*=\s*\$2::uuid/);
    expect(sql).toContain('source_id = $2');
  });
});
