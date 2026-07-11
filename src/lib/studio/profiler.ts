import type { ColumnProfile, ProfileResult } from './types';

const SKIP_TYPES = new Set(['ARRAY', 'MAP', 'STRUCT']);
const COLUMN_CAP = 50;
const STATS_SAMPLE_CAP = 5_000;
// For string columns: stop cardinality tracking once we know it is 'text' (> 50 distinct)
const STR_CARDINALITY_BAIL = 51;
// For numeric columns: stop exact cardinality tracking beyond this threshold
const NUM_CARDINALITY_BAIL = 200;

type KindPrior = ColumnProfile['kind'];

function kindPrior(typeName: string): KindPrior {
  switch (typeName) {
    case 'LONG': case 'INT': case 'INTEGER':
    case 'DECIMAL': case 'DOUBLE': case 'FLOAT':
    case 'SHORT': case 'BYTE':
      return 'numeric_continuous';
    case 'DATE': case 'TIMESTAMP':
      return 'temporal';
    case 'BOOLEAN':
      return 'boolean';
    default:
      return 'categorical';
  }
}

// Fast ISO prefix check before running the full regex
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
function isIso(s: string): boolean {
  const len = s.length;
  if (len < 10 || len > 30) return false;
  const c0 = s.charCodeAt(0);
  if (c0 < 48 || c0 > 57) return false;
  return ISO_RE.test(s);
}

export function profileResultSet(
  columns: { name: string; type_name: string }[],
  rows: Record<string, unknown>[]
): ProfileResult {
  const scalarColumns = columns.filter(c => !SKIP_TYPES.has(c.type_name));

  const columnsTruncated = scalarColumns.length > COLUMN_CAP;
  const cappedColumns = columnsTruncated ? scalarColumns.slice(0, COLUMN_CAP) : scalarColumns;

  const rowCount = rows.length;
  const statsSampleStep = rowCount > STATS_SAMPLE_CAP
    ? Math.floor(rowCount / STATS_SAMPLE_CAP)
    : 1;

  const profiles: ColumnProfile[] = cappedColumns.map(col => {
    const prior = kindPrior(col.type_name);
    const isNumericPrior = prior === 'numeric_continuous';
    const isTemporalPrior = prior === 'temporal';
    const isStringPrior = prior === 'categorical';

    let nullCount = 0;

    // ── Numeric path ─────────────────────────────────────────────────────────
    if (isNumericPrior) {
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      let prev: number | null = null;
      let sortedAsc = true;
      let sortedDesc = true;
      let sortPairsSeen = 0;
      let sampleCount = 0;
      const sample: number[] = [];
      const cardSet = new Set<number>();
      let cardBailed = false;

      for (let r = 0; r < rowCount; r++) {
        const raw = rows[r][col.name];
        if (raw === null || raw === undefined || raw === '') { nullCount++; continue; }

        const n = typeof raw === 'number' ? raw : Number(raw);
        if (isNaN(n)) { nullCount++; continue; }

        sum += n;
        if (n < min) min = n;
        if (n > max) max = n;
        sampleCount++;
        if (r % statsSampleStep === 0) sample.push(n);

        if (!cardBailed) {
          cardSet.add(n);
          if (cardSet.size >= NUM_CARDINALITY_BAIL) cardBailed = true;
        }

        if (prev !== null) {
          sortPairsSeen++;
          if (n < prev) sortedAsc = false;
          if (n > prev) sortedDesc = false;
        }
        prev = n;
      }

      const nonNullCount = rowCount - nullCount;
      const nullRate = rowCount > 0 ? nullCount / rowCount : 0;
      const cardinality = cardBailed ? NUM_CARDINALITY_BAIL : cardSet.size;

      let stats: ColumnProfile['stats'] | undefined;
      let minVal: number | undefined;
      let maxVal: number | undefined;
      let sorted: ColumnProfile['sorted'] | undefined;

      if (sample.length > 0) {
        const mean = sampleCount > 0 ? sum / sampleCount : 0;
        const s = sample.slice().sort((a, b) => a - b);
        stats = { mean, median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)] };
        minVal = min === Infinity ? undefined : min;
        maxVal = max === -Infinity ? undefined : max;
        sorted = sortPairsSeen === 0 ? 'none'
          : (sortedAsc && !sortedDesc ? 'asc' : sortedDesc && !sortedAsc ? 'desc' : 'none');
      }

      let topValues: { value: string; count: number }[] | undefined;
      if (cardinality <= 40) {
        const freqMap = new Map<number, number>();
        for (let r = 0; r < rowCount; r++) {
          const raw = rows[r][col.name];
          if (raw === null || raw === undefined || raw === '') continue;
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!isNaN(n)) freqMap.set(n, (freqMap.get(n) ?? 0) + 1);
        }
        const sorted2 = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);
        topValues = sorted2.slice(0, 5).map(([v, c]) => ({ value: String(v), count: c }));
      }

      // Refinement rules
      let kind: KindPrior = prior;

      // Rule 1: identifier — unique integers, no nulls
      if (rowCount > 0 && nonNullCount === rowCount && cardinality === rowCount && !cardBailed
          && sample.every(v => Number.isInteger(v))) {
        kind = 'identifier';
      }
      // Rule 2: numeric_discrete
      if (kind === 'numeric_continuous' && cardinality <= 12) kind = 'numeric_discrete';

      return {
        name: col.name,
        declaredType: col.type_name,
        kind,
        cardinality,
        nullRate,
        ...(minVal !== undefined ? { min: minVal } : {}),
        ...(maxVal !== undefined ? { max: maxVal } : {}),
        ...(topValues && topValues.length > 0 ? { topValues } : {}),
        ...(stats !== undefined ? { stats } : {}),
        ...(sorted !== undefined ? { sorted } : {}),
      };
    }

    // ── Temporal path ─────────────────────────────────────────────────────────
    if (isTemporalPrior) {
      let prev: number | null = null;
      let sortedAsc = true;
      let sortedDesc = true;
      let sortPairsSeen = 0;
      let sampleCount = 0;
      const sample: number[] = [];

      for (let r = 0; r < rowCount; r++) {
        const raw = rows[r][col.name];
        if (raw === null || raw === undefined || raw === '') { nullCount++; continue; }
        const ts = Date.parse(String(raw));
        if (isNaN(ts)) { nullCount++; continue; }
        sampleCount++;
        if (r % statsSampleStep === 0) sample.push(ts);
        if (prev !== null) {
          sortPairsSeen++;
          if (ts < prev) sortedAsc = false;
          if (ts > prev) sortedDesc = false;
        }
        prev = ts;
      }

      const cardinality = sampleCount; // approximate — each parse is unique typically
      const sorted: ColumnProfile['sorted'] = sortPairsSeen === 0 ? 'none'
        : (sortedAsc && !sortedDesc ? 'asc' : sortedDesc && !sortedAsc ? 'desc' : 'none');

      return {
        name: col.name,
        declaredType: col.type_name,
        kind: 'temporal',
        cardinality,
        nullRate: rowCount > 0 ? nullCount / rowCount : 0,
        sorted,
      };
    }

    // ── String / boolean / categorical path ──────────────────────────────────
    {
      const strCardSet = new Set<string>();
      const freqMap = new Map<string, number>();
      let cardBailed = false;
      let isoCount = 0;
      let nonNullCount2 = 0;

      for (let r = 0; r < rowCount; r++) {
        const raw = rows[r][col.name];
        if (raw === null || raw === undefined || raw === '') { nullCount++; continue; }
        nonNullCount2++;
        const s = typeof raw === 'string' ? raw : String(raw);

        if (!cardBailed) {
          if (!strCardSet.has(s)) {
            strCardSet.add(s);
            freqMap.set(s, 1);
            if (isStringPrior && strCardSet.size >= STR_CARDINALITY_BAIL) {
              cardBailed = true;
            }
          } else {
            freqMap.set(s, (freqMap.get(s) as number) + 1);
          }
          // ISO check only while still resolving (not yet bailed to text)
          if (isStringPrior && !cardBailed) {
            if (isIso(s)) isoCount++;
          }
        }
      }

      const cardinality = cardBailed ? STR_CARDINALITY_BAIL : strCardSet.size;
      const nullRate = rowCount > 0 ? nullCount / rowCount : 0;

      const topValues: { value: string; count: number }[] = [];
      if (!cardBailed && freqMap.size > 0) {
        const sorted = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);
        sorted.slice(0, 5).forEach(([v, c]) => topValues.push({ value: v, count: c }));
      }

      let kind: KindPrior = prior; // 'categorical' for STRING, 'boolean' for BOOLEAN

      if (isStringPrior) {
        // Rule 3: ISO temporal
        if (nonNullCount2 > 0 && isoCount / nonNullCount2 >= 0.95) {
          kind = 'temporal';
        }
        // Rule 5: boolean (before rule 4)
        else if (!cardBailed && cardinality === 2) {
          const BOOL_RE = /^(true|false|yes|no|y|n|0|1)$/i;
          const vals = [...strCardSet];
          if (vals.every(v => BOOL_RE.test(v))) kind = 'boolean';
        }
        // Rule 4: text if > 50 distinct
        if (kind === 'categorical' && (cardBailed || cardinality > 50)) {
          kind = 'text';
        }
      }

      return {
        name: col.name,
        declaredType: col.type_name,
        kind,
        cardinality,
        nullRate,
        ...(topValues.length > 0 ? { topValues } : {}),
      };
    }
  });

  return { profiles, columnsTruncated, rowsSampled: rowCount };
}
