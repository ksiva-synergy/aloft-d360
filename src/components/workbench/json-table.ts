/**
 * Detect JSON that is a table of records (array of objects, optionally nested —
 * flattened for display). Also unwraps common `{ rows: [...] }` envelopes.
 *
 * Columns are split three ways so wide records stay readable:
 * - `labels` / `rows`: short, varying fields shown as table columns
 * - `shared`: fields with the same value on every row (shown once above the table)
 * - `details`: long text, list-valued, empty, or overflow fields (shown per row on expand)
 */

/** `records` values hold a JSON array of objects, shown as a small table. */
export type DetailKind = 'text' | 'records';

export type JsonTable = {
  labels: string[];
  aligns: Array<'left' | 'right'>;
  rows: string[][];
  details: { labels: string[]; kinds: DetailKind[]; rows: string[][] };
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

type FieldMeta = { parent: string | null; leaf: string; list: boolean; records?: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenRecord(row: Record<string, unknown>, meta: Map<string, FieldMeta>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const put = (key: string, value: unknown, parent: string | null, leaf: string) => {
    if (isPrimitive(value)) {
      out[key] = value;
      if (!meta.has(key)) meta.set(key, { parent, leaf, list: false });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && value.every(isPlainObject)) {
        out[key] = JSON.stringify(value);
        meta.set(key, { parent, leaf, list: true, records: true });
        return;
      }
      out[key] = value.map((entry) => (typeof entry === 'string' ? entry : cellText(entry))).join('; ');
      if (!meta.get(key)?.records) meta.set(key, { parent, leaf, list: true });
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

export type DetailTone = 'issue' | 'action' | 'neutral';

export function detailTone(label: string): DetailTone {
  const l = label.toLowerCase();
  if (
    /\b(gaps?|issues?|problems?|missing|errors?|warnings?|risks?|blockers?|concerns?|flags?|alerts?|failures?|exceptions?|violations?|findings?|observations?|deficienc\w*|discrepanc\w*|non.?conformit\w*)\b/
      .test(l)
  ) return 'issue';
  if (/\b(actions?|recommend\w*|next steps?|todo|to do|remediation|mitigations?|follow.?ups?|fix(es)?)\b/.test(l)) return 'action';
  return 'neutral';
}

const MAX_NESTED_COLS = 10;
const MAX_NESTED_ROWS = 50;

/** A `records` detail value as a small table: flattened one object per row. */
export function nestedRecords(value: string): { labels: string[]; rows: string[][]; total: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isPlainObject)) return null;

  const meta = new Map<string, FieldMeta>();
  const flat = parsed.map((row) => flattenRecord(row, meta));
  const keys: string[] = [];
  for (const row of flat) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  const shown = keys.slice(0, MAX_NESTED_COLS);
  const labels = columnLabels(shown, meta);

  return {
    labels: shown.map((key) => labels.get(key)!),
    rows: flat.slice(0, MAX_NESTED_ROWS).map((row) => shown.map((key) => {
      const v = row[key];
      return meta.get(key)?.records && typeof v === 'string' ? `${(JSON.parse(v) as unknown[]).length} items` : cellText(v);
    })),
    total: parsed.length,
  };
}

export type JsonRecord = {
  /** Short scalar fields, shown together as label/value pairs. */
  overview: Array<{ label: string; value: string }>;
  /** Long text, lists, nested records and empty fields, each in its own section. */
  sections: Array<{ label: string; value: string; kind: DetailKind }>;
};

/** One JSON object (not a list) shown as a record card instead of raw JSON. */
export function recordFromJson(raw: string): JsonRecord | null {
  const text = raw.trim();
  if (!text.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const meta = new Map<string, FieldMeta>();
  const flat = flattenRecord(parsed, meta);
  const keys = Object.keys(flat);
  if (keys.length < MIN_COLS || keys.length > MAX_TOTAL_COLS) return null;
  const labels = columnLabels(keys, meta);

  const overview: JsonRecord['overview'] = [];
  const sections: JsonRecord['sections'] = [];
  for (const key of keys) {
    const m = meta.get(key);
    const value = cellText(flat[key]);
    const label = labels.get(key)!;
    if (m?.records) sections.push({ label, value, kind: 'records' });
    else if (m?.list || value === EMPTY || value.length > LONG_CELL_CHARS) sections.push({ label, value, kind: 'text' });
    else overview.push({ label, value });
  }
  return { overview, sections };
}

/**
 * Split a `; `-joined detail value into items, ignoring separators inside brackets so
 * `unclosed (no closed_by; closure date unusable)` stays one item.
 */
export function splitDetailItems(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (ch === ';' && value[i + 1] === ' ' && depth === 0) {
      items.push(value.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  items.push(value.slice(start));
  return items.map((s) => s.trim()).filter(Boolean);
}

/**
 * Split a detail item such as `target_date 2026-12-31` or `audit_by=SIRE` into a key and value.
 * A space-separated item only splits when the value is a number, date or yes/no, so prose
 * like `sire_reference_no blank` stays one phrase.
 */
export function splitDetailItem(item: string): { key: string; value: string } | null {
  const m = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*(=|:|\s)\s*(.+)$/.exec(item.trim());
  if (!m) return null;
  const [, key, sep, value] = m;
  if (sep.trim() || /^(-?\d[\d,.:-]*%?|yes|no|true|false)$/i.test(value)) return { key, value };
  return null;
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
  const isRecords = (key: string) => meta.get(key)?.records === true;
  while (primary.length < MIN_COLS) {
    const next = detail.findIndex((key) => !isRecords(key));
    if (next < 0) break;
    primary.push(detail.splice(next, 1)[0]);
  }
  if (primary.length === 0 || (primary.length < MIN_COLS && !detail.some(isRecords))) return null;

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
      kinds: detail.map((key) => (meta.get(key)?.records ? 'records' as const : 'text' as const)),
      rows: sliced.map((_, ri) => detail.map((key) => cells.get(key)![ri])),
    },
    shared,
    total: records.length,
    truncated: records.length > MAX_ROWS,
  };
}
