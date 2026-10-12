import { describe, it, expect } from 'vitest';
import { escapeCsvCell, csvHeaderLine, csvDataLine } from '@/lib/databricks/csv';
import { EXPORT_MAX_ROWS } from '@/lib/databricks/export-limits';

describe('csv helpers', () => {
  it('escapes quotes commas and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(42)).toBe('42');
  });

  it('builds header and data lines', () => {
    expect(csvHeaderLine([{ name: 'a' }, { name: 'b' }])).toBe('a,b\n');
    expect(csvDataLine(['x', 'y,z'])).toBe('x,"y,z"\n');
  });
});

describe('export limits', () => {
  it('caps at one lakh rows', () => {
    expect(EXPORT_MAX_ROWS).toBe(100_000);
  });
});
