import { describe, expect, it } from 'vitest';
import { filterQueryRowIndices } from '@/lib/workbench/query-table-filter';

describe('filterQueryRowIndices', () => {
  const columns = [{ name: 'vessel' }, { name: 'status' }];
  const rows = [
    { vessel: 'ALPHA', status: 'open' },
    { vessel: 'BRAVO', status: 'closed' },
  ];

  it('returns all indices when filter is empty', () => {
    expect(filterQueryRowIndices(rows, columns, '')).toEqual([0, 1]);
  });

  it('matches any column', () => {
    expect(filterQueryRowIndices(rows, columns, 'brav')).toEqual([1]);
  });
});
