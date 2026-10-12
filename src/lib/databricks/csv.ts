/**
 * Minimal CSV helpers for Inspector export streaming.
 */

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvHeaderLine(columns: { name: string }[]): string {
  return columns.map(c => escapeCsvCell(c.name)).join(',') + '\n';
}

export function csvDataLine(values: unknown[]): string {
  return values.map(escapeCsvCell).join(',') + '\n';
}
