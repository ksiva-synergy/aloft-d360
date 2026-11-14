/**
 * Power Query (M) lineage for one PBI table partition.
 *
 * Walks the `let … in` step chain that produces the table and derives, without any
 * table- or column-specific knowledge:
 *   - the base relation (Value.NativeQuery SQL, else the bound UC table),
 *   - for every M output column, a Spark SQL expression over the base relation
 *     (reverses Table.RenameColumns, folds Text.Trim / type casts / ReplaceValue /
 *     AddColumn / DuplicateColumn),
 *   - row filters (Table.SelectRows) as Spark SQL with M null semantics,
 *   - row de-duplication (Table.Distinct),
 *   - steps that change rows or columns in ways we do not model (reported, never guessed).
 */

import { inflateRawSync } from 'node:zlib';

import { renderTemplate, ruleKey, type RuleSet } from '@/lib/powerbi/rule-registry';

export type MColumnExpr = { sql: string; leaves: string[] };

export type MLineage = {
  /** SQL text of Value.NativeQuery when the partition is a native query. */
  nativeSql: string | null;
  /** Spark SQL predicates over the base relation (unqualified column refs). */
  where: MColumnExpr[];
  /** Table.Distinct: keySql = null means full-row distinct (SQL over the base relation). */
  dedupe: { keySql: string[] | null } | null;
  /** Cleaned M predicate text of each Table.SelectRows step (display / analysis). */
  filterTexts: string[];
  notes: string[];
  /** Row/column-changing steps that are not modeled — SQL from this lineage is not faithful. */
  unsupported: string[];
  /** Resolve an M output column name to a SQL expression over the base relation. */
  column: (name: string) => MColumnExpr | { error: string };
  /**
   * Rows come from another query (table) of the model instead of a warehouse object, e.g.
   * `Source = Table.NestedJoin(IMO_MASTER_LIST, …)` or `Source = OtherQuery`.
   */
  baseTable: string | null;
  /** "Enter data" rows embedded in the M source (Table.FromRows over compressed JSON). */
  embedded: { columns: string[]; rows: (string | null)[][] } | null;
  /**
   * Merged queries (Table.NestedJoin + Table.ExpandTableColumn). Expanded columns appear in
   * column SQL as join markers (see joinRef) that the compiler qualifies with the join alias.
   */
  joins: MJoin[];
};

export type MJoin = {
  alias: string;
  /** The joined query (a table of the model). */
  table: string;
  leftKeys: MColumnExpr[];
  rightKeys: string[];
  kind: 'left' | 'inner' | 'right' | 'full';
};

/** Marker for a column of a merged query inside lineage SQL: §alias§column§. */
export const JOIN_REF_RE = /§(j\d+)§([^§]+)§/g;
export const joinRef = (alias: string, column: string) => `§${alias}§${column}§`;

/**
 * Decode an "Enter data" table: Table.FromRows(Json.Document(Binary.Decompress(
 * Binary.FromText("…", BinaryEncoding.Base64), Compression.Deflate)), let _t = … in type table [A = _t, …]).
 */
export function decodeEmbeddedTable(sourceM: string): { columns: string[]; rows: (string | null)[][] } | null {
  const b64 = sourceM.match(/Binary\.FromText\s*\(\s*"([A-Za-z0-9+/=\s]+)"/i)?.[1];
  const typeTable = sourceM.match(/type\s+table\s*\[([\s\S]*?)\]\s*\)/i)?.[1];
  if (!b64 || typeTable === undefined) return null;
  const columns = splitTopLevel(typeTable)
    .map((part) => part.split('=')[0]!.trim())
    .filter(Boolean)
    .map((n) => (n.startsWith('#"') ? decodeMString(n.slice(1)) : n));
  let rows: unknown;
  try {
    const raw = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    const compressed = /Compression\.Deflate/i.test(sourceM);
    const text = compressed ? inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return {
    columns,
    rows: rows.map((r) =>
      Array.isArray(r)
        ? columns.map((_, i) => (r[i] === null || r[i] === undefined ? null : String(r[i])))
        : columns.map(() => null),
    ),
  };
}

export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

export function sqlString(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ---------------------------------------------------------------------------
// Lexical helpers
// ---------------------------------------------------------------------------

/** Remove // and /* *\/ comments outside string literals. */
export function stripMComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"') {
      const end = scanMString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Index just past the closing quote of an M string starting at `start` ("" escapes). */
function scanMString(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '"') {
      if (src[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return src.length;
}

export function decodeMString(lit: string): string {
  const inner = lit.trim().replace(/^#?"/, '').replace(/"$/, '');
  return inner
    .replace(/""/g, '"')
    .replace(/#\(cr,lf\)/gi, '\n')
    .replace(/#\(lf\)/gi, '\n')
    .replace(/#\(cr\)/gi, '\r')
    .replace(/#\(tab\)/gi, '\t');
}

/** Split on `sep` at nesting depth 0 (parens, braces, brackets, strings). */
export function splitTopLevel(src: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"') {
      const end = scanMString(src, i);
      cur += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    if (depth === 0 && c === sep) {
      parts.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}

/** Index of the first top-level occurrence of `ch` (not in strings / nested). */
function indexTopLevel(src: string, ch: string): number {
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"') {
      i = scanMString(src, i);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (depth === 0 && c === ch) {
      // `=` that is part of `<=`, `>=`, `=>` is not an assignment
      if (ch === '=' && (src[i - 1] === '<' || src[i - 1] === '>' || src[i + 1] === '>')) {
        i += 1;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

function normalizeStepName(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('#"')) return decodeMString(t.slice(1));
  return t;
}

type MStep = { name: string; expr: string };

function parseLet(src: string): { steps: MStep[]; output: string | null } {
  const text = stripMComments(src).trim();
  let body = text;
  let output: string | null = null;
  const letM = text.match(/^let\b/i);
  if (letM) {
    // last top-level `in`
    let depth = 0;
    let lastIn = -1;
    let i = 3;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        i = scanMString(text, i);
        continue;
      }
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') depth -= 1;
      else if (
        depth === 0 &&
        /\s/.test(text[i - 1] ?? ' ') &&
        text.slice(i, i + 2).toLowerCase() === 'in' &&
        /\s|#|$/.test(text[i + 2] ?? '')
      ) {
        lastIn = i;
      }
      i += 1;
    }
    if (lastIn > 0) {
      body = text.slice(3, lastIn);
      output = normalizeStepName(text.slice(lastIn + 2));
    } else {
      body = text.slice(3);
    }
  }
  const steps: MStep[] = [];
  for (const part of splitTopLevel(body)) {
    const eq = indexTopLevel(part, '=');
    if (eq <= 0) continue;
    steps.push({ name: normalizeStepName(part.slice(0, eq)), expr: part.slice(eq + 1).trim() });
  }
  if (!output && steps.length) output = steps[steps.length - 1]!.name;
  return { steps, output };
}

type MCall = { fn: string; args: string[] };

function parseCall(expr: string): MCall | null {
  const m = expr.match(/^([A-Za-z_][\w.]*)\s*\(/);
  if (!m) return null;
  const open = m[0].length - 1;
  let depth = 0;
  let i = open;
  while (i < expr.length) {
    const c = expr[i]!;
    if (c === '"') {
      i = scanMString(expr, i);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }
  return { fn: m[1]!, args: splitTopLevel(expr.slice(open + 1, i)) };
}

/** `{{"a","b"},{"c","d"}}` or `{"a","b"}` → [["a","b"], …] (string items only). */
function parseListOfLists(src: string): string[][] {
  const t = src.trim();
  if (!t.startsWith('{')) return [];
  const inner = t.slice(1, -1).trim();
  const items = splitTopLevel(inner);
  if (items.length && items.every((x) => x.startsWith('{'))) {
    return items.map((x) => splitTopLevel(x.trim().slice(1, -1)));
  }
  return [items];
}

function parseStringList(src: string): string[] {
  const t = src.trim();
  if (t.startsWith('"')) return [decodeMString(t)];
  if (!t.startsWith('{')) return [];
  return splitTopLevel(t.slice(1, -1))
    .filter((x) => x.startsWith('"'))
    .map(decodeMString);
}

// ---------------------------------------------------------------------------
// M expression → SQL (predicates, AddColumn, TransformColumns lambdas)
// ---------------------------------------------------------------------------

type MTok =
  | { t: 'field'; v: string }
  | { t: 'str'; v: string }
  | { t: 'num'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

function lexM(src: string): MTok[] {
  const out: MTok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '"') {
      const end = scanMString(src, i);
      out.push({ t: 'str', v: decodeMString(src.slice(i, end)) });
      i = end;
      continue;
    }
    if (c === '[') {
      const end = src.indexOf(']', i);
      let name = src.slice(i + 1, end < 0 ? src.length : end).trim();
      if (name.startsWith('#"')) name = decodeMString(name.slice(1));
      out.push({ t: 'field', v: name });
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    const num = src.slice(i).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (num) {
      out.push({ t: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = src.slice(i).match(/^#?[A-Za-z_][\w.]*/);
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = src.slice(i).match(/^(<>|<=|>=|=>|[=<>&+\-*/(),{}])/);
    if (op) {
      out.push({ t: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    throw new Error(`unexpected character '${c}' in M expression`);
  }
  out.push({ t: 'eof' });
  return out;
}

type MExprSql = { sql: string; leaves: string[]; isNull?: boolean };

/** Verified registry rules for the duration of one (synchronous) parseMLineage call. */
let activeRules: RuleSet | null = null;

class MExprCompiler {
  private pos = 0;
  constructor(
    private readonly toks: MTok[],
    private readonly fieldExpr: (name: string) => MColumnExpr,
    private readonly underscore: MColumnExpr | null,
  ) {}

  compile(): MExprSql {
    const e = this.or();
    if (this.peek().t !== 'eof') throw new Error('trailing tokens in M expression');
    return e;
  }

  private peek(): MTok {
    return this.toks[this.pos]!;
  }
  private next(): MTok {
    return this.toks[this.pos++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t.t === 'id' && t.v.toLowerCase() === v;
  }
  private expectOp(v: string) {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new Error(`expected '${v}' in M expression`);
  }

  private or(): MExprSql {
    let l = this.and();
    while (this.isKw('or')) {
      this.next();
      const r = this.and();
      l = { sql: `(${l.sql} OR ${r.sql})`, leaves: [...l.leaves, ...r.leaves] };
    }
    return l;
  }
  private and(): MExprSql {
    let l = this.equality();
    while (this.isKw('and')) {
      this.next();
      const r = this.equality();
      l = { sql: `(${l.sql} AND ${r.sql})`, leaves: [...l.leaves, ...r.leaves] };
    }
    return l;
  }
  private equality(): MExprSql {
    let l = this.relational();
    while (this.isOp('=') || this.isOp('<>')) {
      const op = (this.next() as { v: string }).v;
      const r = this.relational();
      const leaves = [...l.leaves, ...r.leaves];
      // M: null = x is false (not null), null <> x is true → null-safe comparison
      if (r.isNull || l.isNull) {
        const other = r.isNull ? l : r;
        l = { sql: `(${other.sql} IS ${op === '=' ? '' : 'NOT '}NULL)`, leaves };
      } else {
        l = {
          sql: op === '=' ? `(${l.sql} <=> ${r.sql})` : `(NOT (${l.sql} <=> ${r.sql}))`,
          leaves,
        };
      }
    }
    return l;
  }
  private relational(): MExprSql {
    let l = this.additive();
    while (this.isOp('<') || this.isOp('>') || this.isOp('<=') || this.isOp('>=')) {
      const op = (this.next() as { v: string }).v;
      const r = this.additive();
      l = { sql: `(${l.sql} ${op} ${r.sql})`, leaves: [...l.leaves, ...r.leaves] };
    }
    return l;
  }
  private additive(): MExprSql {
    let l = this.multiplicative();
    while (this.isOp('+') || this.isOp('-') || this.isOp('&')) {
      const op = (this.next() as { v: string }).v;
      const r = this.multiplicative();
      const leaves = [...l.leaves, ...r.leaves];
      l =
        op === '&'
          ? { sql: `concat(${l.sql}, ${r.sql})`, leaves }
          : { sql: `(${l.sql} ${op} ${r.sql})`, leaves };
    }
    return l;
  }
  private multiplicative(): MExprSql {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as { v: string }).v;
      const r = this.unary();
      l = { sql: `(${l.sql} ${op} ${r.sql})`, leaves: [...l.leaves, ...r.leaves] };
    }
    return l;
  }
  private unary(): MExprSql {
    if (this.isKw('not')) {
      this.next();
      const e = this.unary();
      return { sql: `(NOT ${e.sql})`, leaves: e.leaves };
    }
    if (this.isOp('-')) {
      this.next();
      const e = this.unary();
      return { sql: `(-${e.sql})`, leaves: e.leaves };
    }
    return this.primary();
  }
  private primary(): MExprSql {
    if (this.isKw('if')) {
      // M conditional: if c then a else b
      this.next();
      const c = this.or();
      if (!this.isKw('then')) throw new Error("expected 'then' in M if-expression");
      this.next();
      const a = this.or();
      if (!this.isKw('else')) throw new Error("expected 'else' in M if-expression");
      this.next();
      const b = this.or();
      return {
        sql: `(CASE WHEN ${c.sql} THEN ${a.sql} ELSE ${b.sql} END)`,
        leaves: [...c.leaves, ...a.leaves, ...b.leaves],
      };
    }
    const t = this.next();
    if (t.t === 'op' && t.v === '(') {
      const e = this.or();
      this.expectOp(')');
      return e.isNull ? e : { sql: `(${e.sql})`, leaves: e.leaves };
    }
    if (t.t === 'field') {
      const c = this.fieldExpr(t.v);
      return { sql: c.sql, leaves: c.leaves };
    }
    if (t.t === 'str') return { sql: sqlString(t.v), leaves: [] };
    if (t.t === 'num') return { sql: t.v, leaves: [] };
    if (t.t === 'op' && t.v === '{') {
      const items: MExprSql[] = [];
      while (!this.isOp('}')) {
        items.push(this.or());
        if (this.isOp(',')) this.next();
      }
      this.next();
      return { sql: `(${items.map((x) => x.sql).join(', ')})`, leaves: items.flatMap((x) => x.leaves) };
    }
    if (t.t === 'id') {
      const lower = t.v.toLowerCase();
      if (lower === 'null') return { sql: 'NULL', leaves: [], isNull: true };
      if (lower === 'true') return { sql: 'TRUE', leaves: [] };
      if (lower === 'false') return { sql: 'FALSE', leaves: [] };
      if (t.v === '_') {
        if (!this.underscore) throw new Error('`_` outside each-lambda');
        return { sql: this.underscore.sql, leaves: this.underscore.leaves };
      }
      if (this.isOp('(')) {
        this.next();
        const args: MExprSql[] = [];
        while (!this.isOp(')')) {
          args.push(this.or());
          if (this.isOp(',')) this.next();
          else if (!this.isOp(')')) throw new Error(`bad argument list for ${t.v}`);
        }
        this.next();
        return mFunctionSql(t.v, args);
      }
      throw new Error(`unsupported M identifier ${t.v}`);
    }
    throw new Error('unsupported M expression');
  }
}

function mFunctionSql(fn: string, args: MExprSql[]): MExprSql {
  const leaves = args.flatMap((a) => a.leaves);
  const a = args.map((x) => x.sql);
  const f = fn.toLowerCase();
  const one = (sql: string) => ({ sql, leaves });
  switch (f) {
    case 'text.trim':
      return one(`trim(${a[0]})`);
    case 'text.upper':
      return one(`upper(${a[0]})`);
    case 'text.lower':
      return one(`lower(${a[0]})`);
    case 'text.proper':
      return one(`initcap(${a[0]})`);
    case 'text.clean':
      return one(`regexp_replace(${a[0]}, '\\\\p{Cntrl}', '')`);
    case 'text.length':
      return one(`length(${a[0]})`);
    case 'text.from':
      return one(`CAST(${a[0]} AS STRING)`);
    case 'text.contains':
      return one(`(instr(${a[0]}, ${a[1]}) > 0)`);
    case 'text.startswith':
      return one(`startswith(${a[0]}, ${a[1]})`);
    case 'text.endswith':
      return one(`endswith(${a[0]}, ${a[1]})`);
    case 'text.beforedelimiter':
      return one(`substring_index(${a[0]}, ${a[1]}, 1)`);
    case 'text.start':
      return one(`left(${a[0]}, ${a[1]})`);
    case 'text.end':
      return one(`right(${a[0]}, ${a[1]})`);
    case 'number.from':
      return one(`TRY_CAST(${a[0]} AS DOUBLE)`);
    case 'date.from':
      return one(`TRY_CAST(${a[0]} AS DATE)`);
    case 'datetime.from':
      return one(`TRY_CAST(${a[0]} AS TIMESTAMP)`);
    case 'date.year':
      return one(`year(${a[0]})`);
    case 'date.month':
      return one(`month(${a[0]})`);
    case 'date.day':
      return one(`day(${a[0]})`);
    case 'date.adddays':
      return one(`date_add(${a[0]}, ${a[1]})`);
    case 'datetime.localnow':
    case 'datetime.fixedlocalnow':
      return one('current_timestamp()');
    case '#date':
      return one(`make_date(${a[0]}, ${a[1]}, ${a[2]})`);
    case '#datetime':
      return one(`make_timestamp(${a.slice(0, 6).join(', ')})`);
    case 'number.round':
      // M rounds half to even by default
      return one(a.length > 1 ? `bround(${a[0]}, ${a[1]})` : `bround(${a[0]})`);
    case 'number.roundup':
      return one(a.length > 1 ? `ceil(${a[0]}, ${a[1]})` : `ceil(${a[0]})`);
    case 'number.rounddown':
      return one(a.length > 1 ? `floor(${a[0]}, ${a[1]})` : `floor(${a[0]})`);
    case 'number.roundtowardzero':
      return one(`(CASE WHEN ${a[0]} < 0 THEN ceil(${a[0]}${a[1] ? `, ${a[1]}` : ''}) ELSE floor(${a[0]}${a[1] ? `, ${a[1]}` : ''}) END)`);
    case 'number.abs':
      return one(`abs(${a[0]})`);
    case 'number.power':
      return one(`power(${a[0]}, ${a[1]})`);
    case 'number.sqrt':
      return one(`sqrt(${a[0]})`);
    case 'number.mod':
      return one(`(${a[0]} % ${a[1]})`);
    case 'number.integerdivide':
      return one(`(${a[0]} div ${a[1]})`);
    case 'list.contains':
      return one(`(${a[1]} IN ${a[0]})`);
    default: {
      const rule = activeRules?.get(ruleKey('m_fn', fn, args.length));
      if (rule) return one(renderTemplate(rule.sqlTemplate, a));
      throw new Error(`unsupported M function ${fn}`);
    }
  }
}

function compileMExpr(
  src: string,
  fieldExpr: (name: string) => MColumnExpr,
  underscore: MColumnExpr | null = null,
): MExprSql {
  const body = src.trim().replace(/^each\b/i, '').trim();
  return new MExprCompiler(lexM(body), fieldExpr, underscore).compile();
}

const M_TYPE_SQL: Record<string, string> = {
  'int64.type': 'BIGINT',
  'int32.type': 'INT',
  'int16.type': 'SMALLINT',
  'int8.type': 'TINYINT',
  'number.type': 'DOUBLE',
  'type number': 'DOUBLE',
  'currency.type': 'DECIMAL(19,4)',
  'percentage.type': 'DOUBLE',
  'decimal.type': 'DOUBLE',
  'double.type': 'DOUBLE',
  'single.type': 'DOUBLE',
  'text.type': 'STRING',
  'type text': 'STRING',
  'date.type': 'DATE',
  'type date': 'DATE',
  'datetime.type': 'TIMESTAMP',
  'type datetime': 'TIMESTAMP',
  'datetimezone.type': 'TIMESTAMP',
  'type datetimezone': 'TIMESTAMP',
  'logical.type': 'BOOLEAN',
  'type logical': 'BOOLEAN',
};

const ROW_NEUTRAL_FNS = new Set([
  'table.removecolumns',
  'table.selectcolumns',
  'table.reordercolumns',
  'table.sort',
  'table.buffer',
  'table.addindexcolumn',
]);

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

export function parseMLineage(sourceM: string | null | undefined, rules?: RuleSet | null): MLineage {
  const previous = activeRules;
  activeRules = rules ?? null;
  try {
    return parseMLineageInner(sourceM);
  } finally {
    activeRules = previous;
  }
}

function parseMLineageInner(sourceM: string | null | undefined): MLineage {
  const exprs = new Map<string, MColumnExpr | { error: string }>();
  const where: MColumnExpr[] = [];
  const filterTexts: string[] = [];
  const notes: string[] = [];
  const unsupported: string[] = [];
  let dedupe: MLineage['dedupe'] = null;
  let nativeSql: string | null = null;
  let baseTable: string | null = null;
  let embedded: MLineage['embedded'] = null;
  const joins: MJoin[] = [];
  /** NestedJoin output column name → join, waiting for Table.ExpandTableColumn. */
  const pendingNested = new Map<string, MJoin>();

  const lookup = (name: string): MColumnExpr | { error: string } => {
    const hit = exprs.get(name) ?? exprs.get(name.toLowerCase());
    if (hit) return hit;
    return { sql: quoteIdent(name), leaves: [name] };
  };
  const set = (name: string, v: MColumnExpr | { error: string }) => {
    exprs.set(name, v);
    exprs.set(name.toLowerCase(), v);
  };
  const del = (name: string) => {
    exprs.delete(name);
    exprs.delete(name.toLowerCase());
  };
  const field = (name: string): MColumnExpr => {
    const r = lookup(name);
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  const result = (): MLineage => ({
    nativeSql,
    where,
    dedupe,
    filterTexts,
    notes,
    unsupported,
    column: lookup,
    baseTable,
    embedded,
    joins,
  });

  if (!sourceM?.trim()) return result();

  const { steps, output } = parseLet(sourceM);
  const byName = new Map(steps.map((s) => [s.name, s]));

  // Follow the chain from the output step back to the source.
  const chain: { step: MStep; call: MCall | null }[] = [];
  const seen = new Set<string>();
  let cursor = output;
  const isRef = (src: string) => /^(#"(?:[^"]|"")*"|[A-Za-z_][\w.]*)$/.test(src.trim());
  while (cursor && byName.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const step = byName.get(cursor)!;
    const call = parseCall(step.expr);
    chain.push({ step, call });
    if (call && /^table\./i.test(call.fn) && call.args[0]) {
      // A table argument can itself be a Table.* call (e.g. SplitColumn(TransformColumnTypes(prev, …), …)):
      // walk into it as an anonymous step so nothing before it is lost.
      let arg = call.args[0];
      let inner = parseCall(arg.trim());
      let depth = 0;
      while (inner && /^table\./i.test(inner.fn) && inner.args[0]) {
        depth += 1;
        chain.push({ step: { name: `${step.name} (inner ${depth})`, expr: arg }, call: inner });
        arg = inner.args[0];
        inner = parseCall(arg.trim());
      }
      cursor = normalizeStepName(arg);
      if (!byName.has(cursor) && isRef(arg)) baseTable = cursor; // another query of the model
    } else if (isRef(step.expr) && byName.has(normalizeStepName(step.expr))) {
      cursor = normalizeStepName(step.expr);
    } else {
      if (isRef(step.expr) && !/^(true|false|null)$/i.test(step.expr.trim())) baseTable = normalizeStepName(step.expr);
      cursor = null;
    }
  }
  chain.reverse();
  if (/Binary\.FromText/i.test(sourceM) && /Table\.FromRows/i.test(sourceM)) {
    embedded = decodeEmbeddedTable(sourceM);
    if (!embedded) unsupported.push('Source: embedded table could not be decoded');
  }

  // Steps not on the chain may still hold the native query (e.g. Source = Value.NativeQuery(...)).
  for (const s of steps) {
    const m = s.expr.match(/Value\.NativeQuery\s*\(/i);
    if (!m) continue;
    const call = parseCall(s.expr.slice(m.index));
    const sqlArg = call?.args[1];
    if (sqlArg?.trim().startsWith('"')) {
      nativeSql = decodeMString(sqlArg).trim().replace(/;\s*$/, '');
      break;
    }
  }

  for (const { step, call } of chain) {
    if (!call || !/^table\./i.test(call.fn)) continue; // source / navigation / aliases
    const fn = call.fn.toLowerCase();
    const args = call.args;
    try {
      switch (fn) {
        case 'table.renamecolumns': {
          const pairs = parseListOfLists(args[1] ?? '');
          const resolved = pairs
            .filter((p) => p.length >= 2)
            .map((p) => [decodeMString(p[0]!), decodeMString(p[1]!)] as const);
          const before = resolved.map(([from]) => lookup(from));
          for (const [from] of resolved) del(from);
          resolved.forEach(([, to], i) => set(to, before[i]!));
          break;
        }
        case 'table.duplicatecolumn': {
          const from = decodeMString(args[1] ?? '""');
          const to = decodeMString(args[2] ?? '""');
          set(to, lookup(from));
          break;
        }
        case 'table.transformcolumntypes': {
          for (const pair of parseListOfLists(args[1] ?? '')) {
            if (pair.length < 2) continue;
            const col = decodeMString(pair[0]!);
            const type = pair[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
            const target = M_TYPE_SQL[type];
            const cur = lookup(col);
            if ('error' in cur) continue;
            if (!target) {
              notes.push(`${step.name}: type ${pair[1]} on [${col}] not mapped (kept as-is)`);
              continue;
            }
            set(col, { sql: `TRY_CAST(${cur.sql} AS ${target})`, leaves: cur.leaves });
          }
          break;
        }
        case 'table.transformcolumns': {
          for (const pair of parseListOfLists(args[1] ?? '')) {
            if (pair.length < 2) continue;
            const col = decodeMString(pair[0]!);
            const cur = lookup(col);
            if ('error' in cur) continue;
            const fnSrc = pair[1]!.trim();
            const lambda = /^each\b/i.test(fnSrc) ? fnSrc : `each ${fnSrc}(_)`;
            const compiled = compileMExpr(lambda, field, cur);
            set(col, { sql: compiled.sql, leaves: [...new Set([...cur.leaves, ...compiled.leaves])] });
          }
          break;
        }
        case 'table.replacevalue': {
          const oldV = (args[1] ?? '').trim();
          const newV = (args[2] ?? '').trim();
          const replacer = (args[3] ?? '').toLowerCase();
          const cols = parseStringList(args[4] ?? '');
          const lit = (s: string) =>
            s.toLowerCase() === 'null' ? 'NULL' : s.startsWith('"') ? sqlString(decodeMString(s)) : s;
          for (const col of cols) {
            const cur = lookup(col);
            if ('error' in cur) continue;
            const sql = replacer.includes('replacetext')
              ? `replace(${cur.sql}, ${lit(oldV)}, ${lit(newV)})`
              : `CASE WHEN ${cur.sql} <=> ${lit(oldV)} THEN ${lit(newV)} ELSE ${cur.sql} END`;
            set(col, { sql, leaves: cur.leaves });
          }
          break;
        }
        case 'table.addcolumn': {
          const name = decodeMString(args[1] ?? '""');
          try {
            const compiled = compileMExpr(args[2] ?? '', field);
            let sql = compiled.sql;
            const type = (args[3] ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (M_TYPE_SQL[type]) sql = `TRY_CAST(${sql} AS ${M_TYPE_SQL[type]})`;
            set(name, { sql, leaves: compiled.leaves });
          } catch (e) {
            set(name, {
              error: `Power Query column [${name}] (${step.name}) is not translatable: ${(e as Error).message}`,
            });
          }
          break;
        }
        case 'table.selectrows': {
          const predSrc = (args[1] ?? '').trim();
          const text = predSrc.replace(/^each\b/i, '').replace(/\s+/g, ' ').trim();
          if (/^\(?\s*true\s*\)?$/i.test(text)) break;
          filterTexts.push(text);
          const compiled = compileMExpr(predSrc, field);
          where.push({ sql: compiled.sql, leaves: compiled.leaves });
          if (dedupe) notes.push(`${step.name}: row filter after Table.Distinct applied before de-dup`);
          break;
        }
        case 'table.splitcolumn': {
          const col = decodeMString(args[1] ?? '""');
          const cur = field(col);
          const splitter = (args[2] ?? '').trim();
          const dm = splitter.match(/^Splitter\.SplitTextByDelimiter\s*\(\s*("(?:[^"]|"")*")/i);
          if (!dm) throw new Error(`splitter ${splitter.slice(0, 60)} not modeled`);
          const delim = decodeMString(dm[1]!);
          const names = parseStringList(args[3] ?? '');
          if (!names.length) throw new Error('split without explicit column names not modeled');
          // Spark split() takes a Java regex: escape the delimiter. M returns null for a missing part.
          const pattern = delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const text = `CAST(${cur.sql} AS STRING)`;
          names.forEach((n, i) => {
            set(n, { sql: `try_element_at(split(${text}, ${sqlString(pattern)}), ${i + 1})`, leaves: cur.leaves });
          });
          del(col);
          notes.push(
            `${step.name}: [${col}] split on ${JSON.stringify(delim)}; text uses Spark's default formatting (culture-specific formatting not reproduced)`,
          );
          break;
        }
        case 'table.nestedjoin': {
          const right = normalizeStepName(args[2] ?? '');
          if (!right || byName.has(right)) throw new Error('self-join within one query not modeled');
          const kindSrc = (args[5] ?? 'JoinKind.LeftOuter').toLowerCase();
          const kind: MJoin['kind'] | null = /leftouter/.test(kindSrc)
            ? 'left'
            : /inner/.test(kindSrc)
              ? 'inner'
              : /rightouter/.test(kindSrc)
                ? 'right'
                : /fullouter/.test(kindSrc)
                  ? 'full'
                  : null;
          if (!kind) throw new Error(`join kind ${args[5]} not modeled`);
          const join: MJoin = {
            alias: `j${joins.length + 1}`,
            table: right,
            leftKeys: parseStringList(args[1] ?? '').map((k) => field(k)),
            rightKeys: parseStringList(args[3] ?? ''),
            kind,
          };
          if (!join.leftKeys.length || join.leftKeys.length !== join.rightKeys.length) {
            throw new Error('join keys not modeled');
          }
          joins.push(join);
          pendingNested.set(decodeMString(args[4] ?? '""'), join);
          break;
        }
        case 'table.expandtablecolumn': {
          const nested = decodeMString(args[1] ?? '""');
          const join = pendingNested.get(nested);
          if (!join) throw new Error(`[${nested}] is not a merged query of this table`);
          const names = parseStringList(args[2] ?? '');
          const renamed = args[3] ? parseStringList(args[3]) : names;
          names.forEach((n, i) => set(renamed[i] ?? n, { sql: joinRef(join.alias, n), leaves: [] }));
          del(nested);
          break;
        }
        case 'table.fromrows':
          // "Enter data" source: rows decoded above into `embedded`.
          if (!embedded) throw new Error('embedded rows could not be decoded');
          break;
        case 'table.distinct': {
          const keys = args[1] ? parseStringList(args[1]) : [];
          dedupe = { keySql: keys.length ? keys.map((k) => field(k).sql) : null };
          break;
        }
        default:
          if (ROW_NEUTRAL_FNS.has(fn)) break;
          unsupported.push(`${step.name}: ${call.fn}`);
      }
    } catch (e) {
      unsupported.push(`${step.name}: ${call.fn} (${(e as Error).message})`);
    }
  }

  return result();
}

/** All Table.SelectRows predicate texts (comments stripped, balanced parens). */
export function extractMRowFilterTexts(sourceM: string | null | undefined): string[] {
  if (!sourceM?.trim()) return [];
  const out: string[] = [];
  const { steps } = parseLet(sourceM);
  for (const s of steps) {
    const call = parseCall(s.expr);
    if (!call || call.fn.toLowerCase() !== 'table.selectrows') continue;
    const text = (call.args[1] ?? '').replace(/^each\b/i, '').replace(/\s+/g, ' ').trim();
    if (!text || /^\(?\s*true\s*\)?$/i.test(text)) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}
