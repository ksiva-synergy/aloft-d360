import { describe, expect, it } from 'vitest';
import { normalizeColumnName } from './column-admin';

describe('normalizeColumnName', () => {
  it('accepts spaces and hyphens like Databricks column names', () => {
    expect(normalizeColumnName('po number')).toBe('po number');
    expect(normalizeColumnName(' PO Number ')).toBe('po number');
    expect(normalizeColumnName('cost-center')).toBe('cost-center');
  });

  it('rejects dots and path separators', () => {
    expect(() => normalizeColumnName('a.b')).toThrow(/not a valid column name/);
  });
});
