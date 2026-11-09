/**
 * SQL column resolver for column protections (E8-T5; docs/access/pii-protection-backlog.md §7).
 *
 * Given one SQL statement and the column lists of the tables it reads, it reports every column use:
 *   output     shown in the result (SELECT list, including * and t.*)
 *   aggregate  only inside an aggregate function (SUM, AVG, COUNT, …)
 *   filter     anything else that can reveal values: WHERE, HAVING, QUALIFY, JOIN ON / USING,
 *              GROUP BY, ORDER BY, window PARTITION / ORDER, and SELECT items with comparisons or CASE
 * plus, for each result column, which source columns it is built from (for masking by position).
 *
 * Scope is deliberately one SELECT statement: FROM / JOIN with aliases, *, t.*, expressions, CASE,
 * window functions, aggregates, positional ORDER / GROUP BY. Anything else (WITH, sub-queries, UNION,
 * LATERAL VIEW, PIVOT, table functions, ambiguous names) returns { ok: false }; callers refuse the
 * query only when a table in it has protected columns (fail closed).
 *
 * Positions refer to the original text: comments and string contents are blanked to spaces in a
 * same-length copy before scanning, so `withMinGroupSize` can splice into the original SQL.
 */

export type ColumnUse = 'output' | 'filter' | 'aggregate';

export interface ColumnSource {
  table: string;
  column: string;
}

export interface ColumnRef extends ColumnSource {
  use: ColumnUse;
}

export interface OutputColumn {
  /** Name the item gets in the result when it can be predicted (alias or plain column), else null. */
  name: string | null;
  sources: ColumnSource[];
  /** The item is an aggregate over its sources (e.g. AVG(salary)). */
  aggregate: boolean;
}

export type ResolveResult =
  | {
      ok: true;
      tables: string[];
      refs: ColumnRef[];
      outputs: OutputColumn[];
      /** Splice positions in the original SQL for adding a minimum group size. */
      clauses: { having: { start: number; end: number } | null; insertAt: number };
    }
  | { ok: false; reason: string };

/* ── Scanning ──────────────────────────────────────────────────────────────── */

/** Same-length copy with comments and string contents replaced by spaces. */
export function blankNonCode(sql: string): string {
  const out = sql.split('');
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (; i < stop; i++) out[i] = sql[i] === '\n' ? '\n' : ' ';
    } else if (c === "'" || c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\') {
          out[i] = ' ';
          if (i + 1 < sql.length) out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            out[i] = ' ';
            out[i + 1] = ' ';
            i += 2;
            continue;
          }
          break;
        }
        out[i] = ' ';
        i++;
      }
      i++; // closing quote kept
    } else if (c === '`') {
      i++;
      while (i < sql.length && sql[i] !== '`') i++;
      i++;
    } else {
      i++;
    }
  }
  return out.join('');
}

type Tok =
  | { t: 'id'; v: string; quoted: boolean; s: number; e: number }
  | { t: 'num' | 'str' | 'op'; v: string; s: number; e: number }
  | { t: '(' | ')' | ',' | '.' | '*' | ';'; v: string; s: number; e: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const s = i;
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      const e = end === -1 ? src.length : end + 1;
      toks.push({ t: 'id', v: src.slice(i + 1, e - 1).toLowerCase(), quoted: true, s, e });
      i = e;
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) i++;
      toks.push({ t: 'id', v: src.slice(s, i).toLowerCase(), quoted: false, s, e: i });
    } else if (/[0-9]/.test(c)) {
      while (i < src.length && /[0-9.eE]/.test(src[i]!)) i++;
      toks.push({ t: 'num', v: src.slice(s, i), s, e: i });
    } else if (c === "'" || c === '"') {
      i++;
      while (i < src.length && src[i] !== c) i++;
      i++;
      toks.push({ t: 'str', v: '', s, e: i });
    } else if ('(),.*;'.includes(c)) {
      toks.push({ t: c as '(', v: c, s, e: i + 1 });
      i++;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '<>', '!=', '==', '||', '::', '->'].includes(two)) {
        toks.push({ t: 'op', v: two, s, e: i + 2 });
        i += 2;
      } else {
        toks.push({ t: 'op', v: c, s, e: i + 1 });
        i++;
      }
    }
  }
  return toks;
}

const AGGREGATES = new Set([
  'sum', 'avg', 'mean', 'count', 'min', 'max', 'stddev', 'stddev_pop', 'stddev_samp', 'std', 'variance', 'var_pop', 'var_samp',
  'approx_count_distinct', 'count_if', 'percentile', 'percentile_approx', 'approx_percentile', 'median', 'mode', 'any_value',
  'first', 'last', 'first_value', 'last_value', 'collect_list', 'collect_set', 'array_agg', 'string_agg', 'listagg', 'corr',
  'covar_pop', 'covar_samp', 'kurtosis', 'skewness', 'bool_and', 'bool_or', 'every', 'some', 'bit_and', 'bit_or', 'bit_xor',
  'max_by', 'min_by', 'regr_slope', 'regr_intercept', 'regr_count', 'regr_r2', 'sum_distinct',
]);
/**
 * Aggregates whose result never reveals one row's value. Only these satisfy "Totals only".
 * Everything else in AGGREGATES (min, max, collect_list, median, first, …) returns individual values,
 * so a protected column inside one is treated as output.
 */
export const TOTALS_SAFE = new Set([
  'sum', 'avg', 'mean', 'count', 'count_if', 'approx_count_distinct', 'sum_distinct',
  'stddev', 'stddev_pop', 'stddev_samp', 'std', 'variance', 'var_pop', 'var_samp',
]);
const COMPARISON = new Set(['=', '==', '<', '>', '<=', '>=', '<>', '!=', 'like', 'ilike', 'rlike', 'regexp', 'in', 'between', 'is']);
/** Words that are never column references. */
const RESERVED = new Set([
  'select', 'from', 'where', 'group', 'by', 'having', 'qualify', 'order', 'limit', 'offset', 'as', 'on', 'using', 'join', 'inner',
  'left', 'right', 'full', 'outer', 'cross', 'semi', 'anti', 'natural', 'and', 'or', 'not', 'null', 'true', 'false', 'is', 'in',
  'like', 'ilike', 'rlike', 'regexp', 'between', 'case', 'when', 'then', 'else', 'end', 'distinct', 'all', 'asc', 'desc', 'nulls',
  'over', 'partition', 'rows', 'range', 'unbounded', 'preceding', 'following', 'current', 'row', 'interval',
  'date', 'timestamp', 'escape', 'exists', 'within', 'filter', 'ignore', 'respect',
]);
const CLAUSE_START = new Set(['where', 'group', 'having', 'qualify', 'order', 'limit', 'window', 'cluster', 'distribute', 'sort', 'offset']);
const UNSUPPORTED = new Set(['with', 'union', 'intersect', 'except', 'minus', 'lateral', 'pivot', 'unpivot', 'values', 'tablesample', 'window', 'cluster', 'distribute', 'sort', 'transform']);
const JOIN_WORDS = new Set(['join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'semi', 'anti', 'natural']);

/* ── Resolving ─────────────────────────────────────────────────────────────── */

interface TableRef {
  path: string;
  alias: string | null;
}

class Unsure extends Error {}

export function resolveColumns(sql: string, columnsByTable: Map<string, string[]>): ResolveResult {
  try {
    return resolve(sql, columnsByTable);
  } catch (e) {
    if (e instanceof Unsure) return { ok: false, reason: e.message };
    throw e;
  }
}

function resolve(sql: string, columnsByTable: Map<string, string[]>): ResolveResult {
  let toks = tokenize(blankNonCode(sql));
  while (toks.length && toks[toks.length - 1]!.t === ';') toks = toks.slice(0, -1);
  if (toks.some((t) => t.t === ';')) throw new Unsure('More than one statement');
  if (!toks.length || toks[0]!.t !== 'id' || toks[0]!.v !== 'select') throw new Unsure('Only a single SELECT statement can be checked');

  // Depth of each token; reject unsupported constructs anywhere.
  const depth: number[] = [];
  let d = 0;
  let selects = 0;
  for (const t of toks) {
    if (t.t === ')') d--;
    depth.push(d);
    if (t.t === '(') d++;
    if (t.t === 'id' && !('quoted' in t && t.quoted)) {
      if (t.v === 'select') selects++;
      if (UNSUPPORTED.has(t.v)) throw new Unsure(`${t.v.toUpperCase()} is not supported here`);
    }
  }
  if (selects > 1) throw new Unsure('Sub-queries are not supported here');

  // Top-level clause boundaries.
  const kw = (i: number) => (toks[i]?.t === 'id' && !(toks[i] as { quoted: boolean }).quoted && depth[i] === 0 ? toks[i]!.v : null);
  let fromIdx = -1;
  const clauseIdx: Record<string, number> = {};
  for (let i = 1; i < toks.length; i++) {
    const w = kw(i);
    if (!w) continue;
    if (w === 'from' && fromIdx === -1) fromIdx = i;
    else if (CLAUSE_START.has(w) && fromIdx !== -1 && clauseIdx[w] === undefined) {
      if ((w === 'group' || w === 'order') && kw(i + 1) !== 'by') continue;
      clauseIdx[w] = i;
    }
  }

  // FROM / JOIN.
  const ends = Object.values(clauseIdx).sort((a, b) => a - b);
  const fromEnd = fromIdx === -1 ? toks.length : (ends.find((x) => x > fromIdx) ?? toks.length);
  const tables: TableRef[] = [];
  const joinCondRanges: [number, number][] = [];
  const refs: ColumnRef[] = [];
  const usingRefs: ColumnRef[] = [];
  if (fromIdx !== -1) {
    let i = fromIdx + 1;
    while (i < fromEnd) {
      const t = toks[i]!;
      if (t.t === ',' || (t.t === 'id' && JOIN_WORDS.has(t.v) && !(t as { quoted: boolean }).quoted)) {
        i++;
        continue;
      }
      if (t.t === '(') throw new Unsure('Sub-queries in FROM are not supported here');
      if (t.t !== 'id') throw new Unsure('Unexpected text in FROM');
      // catalog.schema.table
      const parts: string[] = [t.v];
      let j = i + 1;
      while (toks[j]?.t === '.' && toks[j + 1]?.t === 'id') {
        parts.push(toks[j + 1]!.v);
        j += 2;
      }
      if (toks[j]?.t === '(') throw new Unsure('Table functions are not supported here');
      if (parts.length !== 3) throw new Unsure('Use fully qualified catalog.schema.table names');
      const path = parts.join('.');
      let alias: string | null = null;
      if (toks[j]?.t === 'id' && toks[j]!.v === 'as') j++;
      const a = toks[j];
      if (a?.t === 'id' && !RESERVED.has(a.v) && !JOIN_WORDS.has(a.v)) {
        alias = a.v;
        j++;
      }
      tables.push({ path, alias });
      // ON <cond> until next join / comma (depth 0) / end; USING (cols)
      if (toks[j]?.t === 'id' && toks[j]!.v === 'on') {
        const start = j + 1;
        let k = start;
        while (k < fromEnd && !(depth[k] === 0 && (toks[k]!.t === ',' || (toks[k]!.t === 'id' && JOIN_WORDS.has(toks[k]!.v))))) k++;
        joinCondRanges.push([start, k]);
        j = k;
      } else if (toks[j]?.t === 'id' && toks[j]!.v === 'using') {
        const start = j + 1;
        let k = start;
        if (toks[k]?.t !== '(') throw new Unsure('Unexpected USING');
        let dd = 0;
        do {
          if (toks[k]!.t === '(') dd++;
          if (toks[k]!.t === ')') dd--;
          k++;
        } while (k < fromEnd && dd > 0);
        // USING (a, b): the named columns are used in every joined table that has them.
        for (let u = start; u < k; u++) {
          const tok = toks[u]!;
          if (tok.t !== 'id') continue;
          for (const tr of tables) {
            if ((columnsByTable.get(tr.path) ?? []).includes(tok.v)) usingRefs.push({ table: tr.path, column: tok.v, use: 'filter' });
          }
        }
        j = k;
      }
      i = j;
    }
  }

  const byAlias = new Map<string, string>();
  for (const t of tables) {
    for (const key of [t.alias, t.path.split('.')[2]!, t.path]) {
      if (!key) continue;
      const prev = byAlias.get(key);
      if (prev && prev !== t.path) byAlias.set(key, '\u0000ambiguous');
      else byAlias.set(key, t.path);
    }
  }
  const colsOf = (path: string) => columnsByTable.get(path) ?? [];

  /** Resolve an identifier chain to a source column, or null when it is not a column of these tables. */
  function lookup(chain: string[]): ColumnSource | null {
    if (chain.length === 1) {
      const hits = tables.filter((t) => colsOf(t.path).includes(chain[0]!));
      if (hits.length > 1) throw new Unsure(`Column ${chain[0]} is ambiguous; qualify it with a table alias`);
      return hits.length ? { table: hits[0]!.path, column: chain[0]! } : null;
    }
    // alias.col, table.col, catalog.schema.table.col, or struct access col.field
    for (let k = chain.length - 1; k >= 1; k--) {
      const qual = chain.slice(0, k).join('.');
      const path = byAlias.get(qual);
      if (path === '\u0000ambiguous') throw new Unsure(`${qual} is ambiguous`);
      if (path) {
        const col = chain[k]!;
        if (colsOf(path).includes(col) || colsOf(path).length === 0) return { table: path, column: col };
        return null;
      }
    }
    // Struct field on an unqualified column: col.field
    return lookup([chain[0]!]);
  }

  /** Collect references in toks[a, b) with a default use; aggregates and window specs adjust the use. */
  function collect(a: number, b: number, base: ColumnUse, out: ColumnRef[], aliases?: Map<string, OutputColumn>, outputs?: OutputColumn[]): void {
    // 'agg' = a totals-safe aggregate; 'pick' = an aggregate that returns individual values.
    const stack: ('agg' | 'pick' | 'win' | 'plain')[] = [];
    for (let i = a; i < b; i++) {
      const t = toks[i]!;
      if (t.t === '(') {
        const prev = toks[i - 1];
        const isFn = prev?.t === 'id' && !RESERVED.has(prev.v);
        // OVER (...) and FILTER (WHERE ...) can reveal values: treat their contents as filters.
        stack.push(
          prev?.t === 'id' && (prev.v === 'over' || prev.v === 'filter')
            ? 'win'
            : isFn && TOTALS_SAFE.has(prev.v)
              ? 'agg'
              : isFn && AGGREGATES.has(prev.v)
                ? 'pick'
                : 'plain',
        );
        continue;
      }
      if (t.t === ')') {
        stack.pop();
        continue;
      }
      if (t.t === 'num' && base === 'filter' && outputs && toks[i - 1] && (toks[i - 1]!.t === ',' || ['by'].includes(toks[i - 1]!.v)) && (toks[i + 1] === undefined || toks[i + 1]!.t === ',' || ['asc', 'desc', 'nulls'].includes(toks[i + 1]!.v ?? ''))) {
        // ORDER BY 2 / GROUP BY 1: positional reference to a result column.
        const o = outputs[Number(t.v) - 1];
        if (o) for (const src of o.sources) out.push({ ...src, use: 'filter' });
        continue;
      }
      if (t.t !== 'id') continue;
      if (toks[i + 1]?.t === '(') continue; // function name
      if (toks[i - 1]?.t === 'id' && toks[i - 1]!.v === 'as') continue; // alias or type name
      if (toks[i - 1]?.t === '.') continue; // handled with the chain head
      if (!(t as { quoted: boolean }).quoted && RESERVED.has(t.v)) continue;
      const chain = [t.v];
      let j = i;
      while (toks[j + 1]?.t === '.' && toks[j + 2]?.t === 'id') {
        chain.push(toks[j + 2]!.v);
        j += 2;
      }
      if (toks[j + 1]?.t === '.' && toks[j + 2]?.t === '*') continue; // t.* handled by the caller
      const inWin = stack.includes('win');
      const inAgg = stack.includes('agg') && !stack.includes('pick');
      const use: ColumnUse = base === 'filter' || inWin ? 'filter' : inAgg ? 'aggregate' : base;
      const src = lookup(chain);
      if (src) out.push({ ...src, use });
      else if (chain.length === 1 && aliases?.has(chain[0]!)) {
        for (const s of aliases.get(chain[0]!)!.sources) out.push({ ...s, use: 'filter' });
      }
      i = j;
    }
  }

  // SELECT list.
  let selStart = 1;
  if (toks[1]?.t === 'id' && (toks[1].v === 'distinct' || toks[1].v === 'all')) selStart = 2;
  const selEnd = fromIdx === -1 ? (ends[0] ?? toks.length) : fromIdx;
  const items: [number, number][] = [];
  let itemStart = selStart;
  for (let i = selStart; i <= selEnd; i++) {
    if (i === selEnd || (toks[i]!.t === ',' && depth[i] === 0)) {
      if (i > itemStart) items.push([itemStart, i]);
      itemStart = i + 1;
    }
  }

  const outputs: OutputColumn[] = [];
  const aliases = new Map<string, OutputColumn>();
  for (const [a, b] of items) {
    const first = toks[a]!;
    // *  or  t.*
    if (first.t === '*' && b === a + 1) {
      for (const t of tables) {
        const cols = colsOf(t.path);
        if (cols.length === 0) throw new Unsure(`Columns of ${t.path} are not known; list them instead of *`);
        for (const c of cols) {
          outputs.push({ name: c, sources: [{ table: t.path, column: c }], aggregate: false });
          refs.push({ table: t.path, column: c, use: 'output' });
        }
      }
      continue;
    }
    if (toks[b - 1]?.t === '*' && toks[b - 2]?.t === '.') {
      const qual = toks
        .slice(a, b - 2)
        .filter((x) => x.t === 'id')
        .map((x) => x.v)
        .join('.');
      const path = byAlias.get(qual);
      if (!path || path === '\u0000ambiguous') throw new Unsure(`Unknown table ${qual} in ${qual}.*`);
      const cols = colsOf(path);
      if (cols.length === 0) throw new Unsure(`Columns of ${path} are not known; list them instead of *`);
      for (const c of cols) {
        outputs.push({ name: c, sources: [{ table: path, column: c }], aggregate: false });
        refs.push({ table: path, column: c, use: 'output' });
      }
      continue;
    }
    // Expression [AS alias]
    let exprEnd = b;
    let name: string | null = null;
    if (b - a >= 2 && toks[b - 1]!.t === 'id' && toks[b - 2]!.t === 'id' && toks[b - 2]!.v === 'as') {
      name = toks[b - 1]!.v;
      exprEnd = b - 2;
    } else if (b - a >= 2 && toks[b - 1]!.t === 'id' && !RESERVED.has(toks[b - 1]!.v) && toks[b - 2]!.t !== '.' && toks[b - 2]!.t !== 'op' && toks[b - 2]!.t !== '(' && toks[b - 2]!.t !== ',') {
      name = toks[b - 1]!.v; // implicit alias: expr alias
      exprEnd = b - 1;
    }
    const hasComparison = toks.slice(a, exprEnd).some((x) => (x.t === 'op' && COMPARISON.has(x.v)) || (x.t === 'id' && (COMPARISON.has(x.v) || x.v === 'case')));
    const itemRefs: ColumnRef[] = [];
    collect(a, exprEnd, hasComparison ? 'filter' : 'output', itemRefs);
    refs.push(...itemRefs);
    if (!name && exprEnd - a === 1 && toks[a]!.t === 'id') name = toks[a]!.v;
    if (!name && exprEnd - a === 3 && toks[a + 1]?.t === '.') name = toks[a + 2]!.v;
    const sources = dedupe(itemRefs.map(({ table, column }) => ({ table, column })));
    const aggregate = itemRefs.length > 0 && itemRefs.every((r) => r.use === 'aggregate');
    const out: OutputColumn = { name, sources, aggregate };
    outputs.push(out);
    if (name) aliases.set(name, out);
  }

  // Filters: JOIN ON, WHERE, GROUP BY, HAVING, QUALIFY, ORDER BY.
  for (const [a, b] of joinCondRanges) collect(a, b, 'filter', refs);
  refs.push(...usingRefs);
  const clauseOrder = Object.entries(clauseIdx).sort((x, y) => x[1] - y[1]);
  for (let c = 0; c < clauseOrder.length; c++) {
    const [w, start] = clauseOrder[c]!;
    const end = clauseOrder[c + 1]?.[1] ?? toks.length;
    if (w === 'limit' || w === 'offset') continue;
    collect(start + (w === 'group' || w === 'order' ? 2 : 1), end, 'filter', refs, aliases, outputs);
  }

  // Where to add a minimum group size in the original SQL.
  const havingIdx = clauseIdx.having;
  const afterHaving = clauseOrder.find(([, i]) => havingIdx !== undefined && i > havingIdx)?.[1];
  const having =
    havingIdx !== undefined ? { start: toks[havingIdx]!.e, end: afterHaving !== undefined ? toks[afterHaving]!.s : (toks[toks.length - 1]?.e ?? sql.length) } : null;
  const nextAfterGroup = ['qualify', 'order', 'limit', 'offset'].map((w) => clauseIdx[w]).filter((x): x is number => x !== undefined).sort((x, y) => x - y)[0];
  const insertAt = nextAfterGroup !== undefined ? toks[nextAfterGroup]!.s : (toks[toks.length - 1]?.e ?? sql.length);

  return {
    ok: true,
    tables: [...new Set(tables.map((t) => t.path))],
    refs: dedupeRefs(refs),
    outputs,
    clauses: { having, insertAt },
  };
}

function dedupe(xs: ColumnSource[]): ColumnSource[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${x.table}.${x.column}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupeRefs(xs: ColumnRef[]): ColumnRef[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${x.table}.${x.column}.${x.use}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Add `COUNT(*) >= n` to HAVING (or a new HAVING) so totals never describe fewer than n rows. */
export function withMinGroupSize(sql: string, clauses: { having: { start: number; end: number } | null; insertAt: number }, n = 5): string {
  if (clauses.having) {
    const { start, end } = clauses.having;
    return `${sql.slice(0, start)} (${sql.slice(start, end).trim()}) AND COUNT(*) >= ${n} ${sql.slice(end)}`;
  }
  const rest = sql.slice(clauses.insertAt).replace(/^\s*;\s*$/, '');
  return `${sql.slice(0, clauses.insertAt).replace(/\s*;?\s*$/, '')} HAVING COUNT(*) >= ${n} ${rest}`.trim();
}
