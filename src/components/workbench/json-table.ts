/**
 * Detect JSON that is a table of records (array of flat objects, or an object
 * that wraps one such array). Nested documents stay null so the caller keeps
 * the raw JSON block.
 */

export type JsonTable = {
  labels: string[];
  aligns: Array<'left' | 'right'>;
  rows: string[][];
  total: number;
  truncated: boolean;
};

const MAX_ROWS = 80;
const MAX_COLS = 12;
const MIN_COLS = 2;
const MAX_SOURCE_ROWS = 500;

function isPrimitive(value: unknown): boolean {
  return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function labelForKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function cellText(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 80 ? serialized : '—';
  } catch {
    return '—';
  }
}

function unwrapList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const arrays = entries.filter(([, entry]) => Array.isArray(entry));
  if (arrays.length !== 1) return null;
  const scalarsOnly = entries.every(([, entry]) => Array.isArray(entry) || isPrimitive(entry));
  if (!scalarsOnly) return null;
  return arrays[0][1] as unknown[];
}

function asRecords(value: unknown): Record<string, unknown>[] | null {
  const list = unwrapList(value);
  if (!list || list.length === 0 || list.length > MAX_SOURCE_ROWS) return null;
  if (!list.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) return null;
  return list as Record<string, unknown>[];
}

export function recordsFromJson(raw: string): JsonTable | null {
  const text = raw.trim();
  if (!text || (text[0] !== '[' && text[0] !== '{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const records = asRecords(parsed);
  if (!records) return null;

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of records) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (keys.length > MAX_COLS) return null;
    }
  }
  if (keys.length < MIN_COLS) return null;

  let nested = 0;
  let cells = 0;
  for (const row of records) {
    for (const key of keys) {
      cells += 1;
      if (!isPrimitive(row[key])) nested += 1;
    }
  }
  if (cells === 0 || nested / cells > 0.2) return null;

  const sliced = records.slice(0, MAX_ROWS);
  const rows = sliced.map((row) => keys.map((key) => cellText(row[key])));
  const aligns = keys.map((_, index) => {
    const values = rows.map((row) => row[index]).filter((cell) => cell !== '—');
    if (values.length === 0) return 'left' as const;
    const numeric = values.every((cell) => /^-?\d[\d,]*(\.\d+)?%?$/.test(cell));
    return numeric ? 'right' as const : 'left' as const;
  });

  return {
    labels: keys.map(labelForKey),
    aligns,
    rows,
    total: records.length,
    truncated: records.length > MAX_ROWS,
  };
}
