import { describe, it, expect } from 'vitest';
import {
  expandSqlForFullTable,
  needsFullTableWarehouseRefetch,
  parseTrailingSqlLimit,
} from '@/lib/inspector/sql-full-fetch';

describe('parseTrailingSqlLimit', () => {
  it('reads a trailing LIMIT', () => {
    expect(parseTrailingSqlLimit('SELECT * FROM t LIMIT 100')).toBe(100);
    expect(parseTrailingSqlLimit('SELECT * FROM t limit 25;')).toBe(25);
  });
  it('returns null when there is no LIMIT', () => {
    expect(parseTrailingSqlLimit('SELECT COUNT(*) FROM t')).toBeNull();
  });
});

describe('expandSqlForFullTable', () => {
  it('replaces a small sample LIMIT', () => {
    expect(expandSqlForFullTable('SELECT * FROM t LIMIT 100', 5000)).toBe('SELECT * FROM t LIMIT 5000');
  });
  it('leaves SQL without LIMIT unchanged', () => {
    const sql = 'SELECT a FROM t WHERE x = 1';
    expect(expandSqlForFullTable(sql, 5000)).toBe(sql);
  });
});

describe('needsFullTableWarehouseRefetch', () => {
  it('refetches when SQL used LIMIT 100', () => {
    expect(
      needsFullTableWarehouseRefetch({
        sql: 'SELECT * FROM employees LIMIT 100',
        rows: Array(100).fill({}),
        rowCount: 100,
        truncated: false,
      }),
    ).toBe(true);
  });
  it('skips when already loaded to the chat cap', () => {
    expect(
      needsFullTableWarehouseRefetch({
        sql: 'SELECT * FROM t LIMIT 5000',
        rows: Array(200).fill({}),
        rowCount: 200,
        truncated: false,
      }),
    ).toBe(false);
  });
});
