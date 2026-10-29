/**
 * Detect JSON that is a table of records (array of objects, optionally nested —
 * flattened for display). Also unwraps common `{ rows: [...] }` envelopes.
 *
 * Columns are split three ways so wide records stay readable:
 * - `labels` / `rows`: short, varying fields shown as table columns
 * - `shared`: fields with the same value on every row (shown once above the table)
 * - `details`: long text, list-valued, empty, or overflow fields (shown per row on expand)
 */

export type JsonTable = {
  labels: string[];
  aligns: Array<'left' | 'right'>;
  rows: string[][];
  details: { labels: string[]; rows: string[][] };
  shared: Array<{ label: string; value: string }>;
  total: number;
  truncated: boolean;
};

const MAX_ROWS = 80;
const MAX_PRIMARY_COLS = 7;
const MAX_TOTAL_COLS = 40;
const MIN_COLS = 2;
const MAX_SOURCE_ROWS = 500;
const LONG_CELL_CHARS = 48;
const EMPTY = '—';

const WRAPPED_ARRAY_KEYS = ['rows', 'results', 'data', 'items', 'records', 'reports', 'entries', 'list'];

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
  if (value == null || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : EMPTY;
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 80 ? serialized : EMPTY;
  } catch {
    return EMPTY;
  }
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_ROWS) return false;
  return value.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
}

function unwrapList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  for (const key of WRAPPED_ARRAY_KEYS) {
    const candidate = obj[key];
    if (isRecordArray(candidate)) return candidate;
  }

  const entries = Object.entries(obj);
  const arrays = entries.filter(([, entry]) => isRecordArray(entry));
  if (arrays.length === 0) return null;

  if (arrays.length === 1) {
    const scalarsOnly = entries.every(([, entry]) => Array.isArray(entry) || isPrimitive(entry));
    if (scalarsOnly) return arrays[0][1] as unknown[];
  }

  arrays.sort((a, b) => (b[1] as unknown[]).length - (a[1] as unknown[]).length);
  return arrays[0][1] as unknown[];
}

type FieldMeta = { parent: string | null; leaf: string; list: boolean };

function flattenRecord(row: Record<string, unknown>, meta: Map<string, FieldMeta>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const put = (key: string, value: unknown, parent: string | null, leaf: string) => {
    if (isPrimitive(value)) {
      out[key] = value;
      if (!meta.has(key)) meta.set(key, { parent, leaf, list: false });
      return;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((entry) => (typeof entry === 'string' ? entry : cellText(entry))).join('; ');
      meta.set(key, { parent, leaf, list: true });
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        put(`${key}_${childKey}`, childValue, key, childKey);
      }
    }
  };

  for (const [key, value] of Object.entries(row)) {
    put(key, value, null, key);
  }
  return out;
}

function asRecords(value: unknown): Record<string, unknown>[] | null {
  const list = unwrapList(value);
  if (!list || list.length === 0 || list.length > MAX_SOURCE_ROWS) return null;
  if (!list.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) return null;
  return list as Record<string, unknown>[];
}

function columnLabels(keys: string[], meta: Map<string, FieldMeta>): Map<string, string> {
  const leafCounts = new Map<string, number>();
  for (const key of keys) {
    const leaf = meta.get(key)?.leaf ?? key;
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const key of keys) {
    const m = meta.get(key);
    const descriptiveLeaf = m && m.parent && (m.leaf.includes('_') || m.leaf.length >= 8) && leafCounts.get(m.leaf) === 1;
    labels.set(key, labelForKey(descriptiveLeaf ? m.leaf : key));
  }
  return labels;
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

  const meta = new Map<string, FieldMeta>();
  const flatRecords = records.map((row) => flattenRecord(row, meta));
  const sliced = flatRecords.slice(0, MAX_ROWS);

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of flatRecords) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  if (keys.length < MIN_COLS || keys.length > MAX_TOTAL_COLS) return null;

  const labels = columnLabels(keys, meta);
  const cells = new Map<string, string[]>(keys.map((key) => [key, sliced.map((row) => cellText(row[key]))]));

  const rowCount = sliced.length;
  const stats = new Map(keys.map((key) => {
    const values = cells.get(key)!;
    const filled = values.filter((v) => v !== EMPTY);
    return [key, {
      fill: rowCount ? filled.length / rowCount : 0,
      distinct: rowCount ? new Set(filled).size / rowCount : 0,
      avgLen: filled.length ? filled.reduce((sum, v) => sum + v.length, 0) / filled.length : 0,
      dateLike: filled.length > 0 && filled.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v)),
      allSame: rowCount > 1 && values.every((v) => v === values[0]),
      list: meta.get(key)?.list === true,
    }];
  }));

  let candidates: string[] = [];
  const detailSet = new Set<string>();
  const sharedKeys: string[] = [];

  for (const key of keys) {
    const s = stats.get(key)!;
    if (s.list || s.avgLen > LONG_CELL_CHARS || (s.fill === 0 && rowCount === 1)) detailSet.add(key);
    else if (s.allSame) sharedKeys.push(key);
    else candidates.push(key);
  }
  if (candidates.length < MIN_COLS) {
    candidates = keys.filter((key) => candidates.includes(key) || sharedKeys.includes(key));
    sharedKeys.length = 0;
  }

  // Importance from the values alone: fields that tell rows apart and are always filled rank highest;
  // long values rank lower. Source order breaks ties.
  const importance = (key: string) => {
    const s = stats.get(key)!;
    return 0.5 * s.distinct + 0.35 * s.fill + 0.15 * (1 - Math.min(s.avgLen, LONG_CELL_CHARS) / LONG_CELL_CHARS);
  };
  const ranked = candidates
    .map((key, i) => ({ key, i, score: importance(key) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  // The row's label: the fully-filled, non-date field that best tells rows apart (earliest on ties).
  // Shown as the first column.
  const keyColumn = candidates
    .map((key, i) => ({ key, i, s: stats.get(key)! }))
    .filter(({ s }) => s.fill === 1 && !s.dateLike && (rowCount === 1 || s.distinct >= 0.5))
    .sort((a, b) => b.s.distinct - a.s.distinct || a.i - b.i)[0]?.key;

  const chosen = new Set(
    [...new Set([keyColumn, ...ranked.map((r) => r.key)].filter((k): k is string => !!k))].slice(0, MAX_PRIMARY_COLS),
  );
  for (const key of candidates) if (!chosen.has(key)) detailSet.add(key);

  const primary = [
    ...(keyColumn ? [keyColumn] : []),
    ...keys.filter((key) => chosen.has(key) && key !== keyColumn),
  ];
  const detail = keys.filter((key) => detailSet.has(key));
  while (primary.length < MIN_COLS && detail.length > 0) primary.push(detail.shift()!);
  if (primary.length < MIN_COLS) return null;

  const shared = sharedKeys.map((key) => ({ label: labels.get(key)!, value: cells.get(key)![0] }));

  const rows = sliced.map((_, ri) => primary.map((key) => cells.get(key)![ri]));
  const aligns = primary.map((key) => {
    const values = cells.get(key)!.filter((cell) => cell !== EMPTY);
    if (values.length === 0) return 'left' as const;
    return values.every((cell) => /^-?\d[\d,]*(\.\d+)?%?$/.test(cell)) ? 'right' as const : 'left' as const;
  });

  return {
    labels: primary.map((key) => labels.get(key)!),
    aligns,
    rows,
    details: {
      labels: detail.map((key) => labels.get(key)!),
      rows: sliced.map((_, ri) => detail.map((key) => cells.get(key)![ri])),
    },
    shared,
    total: records.length,
    truncated: records.length > MAX_ROWS,
  };
}
