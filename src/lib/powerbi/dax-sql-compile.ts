/**
 * DAX measure → Spark SQL compiler driven only by the harvested model:
 * calculated-column DAX, Power Query lineage (renames, transforms, row filters),
 * column data types, relationships and other measures. No table/column names are
 * special-cased; anything not modeled fails with an explicit reason.
 *
 * Evaluation model (oracle = measure evaluated with an empty filter context):
 *   - each PBI table → base CTE `tN` exposing PBI column names over its warehouse source
 *     (native query or UC table) with Power Query filters / de-dup applied;
 *   - calculated columns → staged CTEs `tN_k` (top-level VARs materialized as columns so
 *     correlated subqueries only reference the immediate outer row);
 *   - aggregations / iterators → scalar subqueries over the table's latest CTE, filtered by
 *     the current filter context (CALCULATE / FILTER / ALL / boolean filters);
 *   - filter propagation and context transition follow single-hop relationships; multi-hop
 *     paths are rejected rather than ignored.
 */

import { collectColumnRefs, parseDax, type DaxNode } from '@/lib/powerbi/dax-parse';
import {
  JOIN_REF_RE,
  parseMLineage,
  quoteIdent as q,
  sqlString,
  type MColumnExpr,
  type MJoin,
  type MLineage,
} from '@/lib/powerbi/m-lineage';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { renderTemplate, ruleKey, type CapabilityGap } from '@/lib/powerbi/rule-registry';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

/**
 * Bump whenever compiled SQL can change for the same DAX + model (semantics, plan shape, rules).
 * Translate checkpoints are keyed on it, so a bump recompiles every measure once.
 */
export const COMPILER_VERSION = '2026-11-15.relationship-cardinality';

export type DaxCompileOptions = {
  /** tableKey → warehouse leaf column (lower) → replacement column (from warehouse errors). */
  columnOverrides?: Record<string, Record<string, string>>;
  /** How `=` / `<>` compare a text operand with a numeric one. */
  mixedTypeCompare?: 'string' | 'number';
};

export type DaxCompileSuccess = {
  ok: true;
  sql: string;
  tables: string[];
  calc_columns: string[];
  measures_inlined: string[];
  notes: string[];
  /** Source alias in base CTEs (`src_N`) → table key — maps warehouse errors back to tables. */
  source_aliases: Record<string, string>;
  /** Faithful SQL exists but Power BI's own result is not deterministic (e.g. keyed Table.Distinct). */
  warnings: string[];
  /** Static kind of the measure value (text measures cannot be compared numerically). */
  result_kind: 'number' | 'string' | 'date' | 'bool' | 'unknown';
};

export type DaxCompileFailure = {
  ok: false;
  reason: string;
  notes: string[];
  /** Structured missing capability, when the failure is one (backlog unit). */
  gap?: CapabilityGap;
};

export type DaxCompileResult = DaxCompileSuccess | DaxCompileFailure;

export type CompileRelationship = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  both: boolean;
  active: boolean;
  /** TMDL cardinality `<from>_to_<to>`; absent = many_to_one (the TMDL default). */
  cardinality?: string;
};

/** The relationship's "to" column is unique (one side): many_to_one / one_to_one. */
const toSideUnique = (r: { cardinality?: string }) => !r.cardinality || /_to_one$/.test(r.cardinality);
/** The relationship's "from" column is unique: one_to_one / one_to_many. */
const fromSideUnique = (r: { cardinality?: string }) => /^one_to_/.test(r.cardinality ?? '');

class CompileError extends Error {
  constructor(
    message: string,
    readonly gap?: CapabilityGap,
  ) {
    super(message);
  }
}

type Kind = 'number' | 'string' | 'date' | 'bool' | 'unknown';
type Sql = { sql: string; kind: Kind; literal?: boolean };
/** Row context. `cols` set = iteration over VALUES/ALL(columns): only those columns exist. */
type RowScope = { table: string; alias: string; cols?: string[] };
type Pred = {
  table: string;
  cols: string[] | null;
  build: (alias: string) => string;
  /**
   * Set when the predicate is the current value of a per-value iterator (`T[c] = g.c` from
   * SUMX/FILTER over VALUES(T[c])): aggregates under it can be evaluated grouped by T[c].
   */
  group?: { alias: string; table: string; col: string; outerRef: string };
};
type Ctx = {
  scopes: RowScope[];
  filters: Pred[];
  transitions: RowScope[];
  env: Map<string, Sql>;
};
type TableSel = {
  table: string;
  preds: Pred[];
  all: boolean;
  ctx: Ctx;
  /** VALUES(T[c…]) / ALL(T[c…]): iterate distinct values of these columns. */
  distinctCols?: string[];
  /** VALUES / ALL include the relationship blank row (DISTINCT / ALLNOBLANKROW do not). */
  blankRow?: boolean;
  /** TOPN(1, …, order): keep rows whose order value is the max/min (DAX keeps ties). */
  top1?: { order: DaxNode; desc: boolean };
};

type TableState = {
  key: string;
  name: string;
  uc: string;
  lineage: MLineage;
  base: string;
  srcAlias: string;
  latest: string;
  stageNo: number;
  baseCols: Map<string, { name: string; expr: MColumnExpr }>;
  materialized: Map<string, Kind>;
  inProgress: Set<string>;
  known: Set<string>;
  knownNorm: Map<string, string>;
  /** DAX calculated table: produced column name (lower) → name + kind. */
  calcTable: Map<string, { name: string; kind: Kind }> | null;
  /** Rows come from another table of the model (Power Query query reference). */
  baseSt: TableState | null;
  /** Merged queries (Table.NestedJoin): join alias → joined table. */
  joinSts: Map<string, TableState>;
  /**
   * Row identity for context transition on the current row (CALCULATE in a row context of this
   * table): lineage expressions of every column, hashed into ROW_HASH in the base CTE.
   */
  rowHash: MColumnExpr[] | null;
};

/** Key text for BLANK in grouped evaluation (NULL keys and the relationship blank row). */
const BLANK_KEY = '__blank__';

/** Operands shorter than this stay inline (sharing them saves nothing). */
const SHARE_MIN_CHARS = 120;

/**
 * True when every table alias the SQL references is also introduced inside it
 * (`FROM <relation> a12`), i.e. it reads no outer row. Aliases defined by the SQL's own
 * subqueries (relationship hops `r62`, `(SELECT MAX(a1.x) FROM t1 a1)`) do not make it
 * correlated; `cur` (a calculated column's row) always does.
 */
export function isUncorrelatedSql(sql: string): boolean {
  const referenced = new Set([...sql.matchAll(/\b(cur|[agrxmo]\d+)\.`/g)].map((m) => m[1]!));
  if (!referenced.size) return true;
  const defined = new Set(
    [...sql.matchAll(/\b(?:FROM|JOIN)\s+(?:\([^()]*\)|[\w`.]+)\s+([agrxmo]\d+)\b/gi)].map((m) => m[1]!),
  );
  for (const a of referenced) if (!defined.has(a)) return false;
  return true;
}

/**
 * The usual BLANK-aware form `CASE WHEN a IS NULL AND b IS NULL THEN NULL ELSE coalesce(a,0)+coalesce(b,0) END`
 * repeats every operand, so nested arithmetic over correlated (unshareable) operands grows
 * exponentially (CII CountA_Exclusion: 1.3 MB). Use the single-reference form when an operand is large.
 */
function needsLinearBlankSum(ops: Sql[]): boolean {
  return ops.some(
    (o) => !o.literal && (o.sql.length >= SHARE_MIN_CHARS || (/\bSELECT\b/i.test(o.sql) && !isUncorrelatedSql(o.sql))),
  );
}

/**
 * DAX `a + b - c …` with BLANK as 0 and BLANK only when every term is BLANK, referencing each
 * term once: aggregate(array(terms), NULL, (acc, x) -> CASE WHEN x IS NULL THEN acc ELSE coalesce(acc, 0) + x END).
 */
function blankSum(terms: { sign: '+' | '-'; sql: Sql }[]): Sql {
  const items = terms.map((t) => `CAST(${t.sign === '-' ? `-(${t.sql.sql})` : t.sql.sql} AS DOUBLE)`);
  return {
    sql: `aggregate(array(${items.join(', ')}), CAST(NULL AS DOUBLE), (acc, x) -> CASE WHEN x IS NULL THEN acc ELSE coalesce(acc, 0D) + x END)`,
    kind: 'number',
  };
}

/** Row identity column: DAX context transition keeps the rows identical to the current row. */
const ROW_HASH = '__rowhash';

/** Projected name of a Power Query column read from a referenced / merged table. */
const pqCol = (name: string) => `__pq_${name}`;
const JOIN_SQL: Record<MJoin['kind'], string> = { left: 'LEFT', inner: 'INNER', right: 'RIGHT', full: 'FULL' };

const NUMERIC_TYPES = /^(int|integer|int64|int32|double|decimal|currency|number|single|float)/i;

function kindOfDataType(dt: string | null | undefined): Kind {
  if (!dt) return 'unknown';
  const t = dt.toLowerCase();
  if (NUMERIC_TYPES.test(t)) return 'number';
  if (t === 'string' || t === 'text') return 'string';
  if (t.startsWith('date')) return 'date';
  if (t === 'boolean' || t === 'logical') return 'bool';
  return 'unknown';
}

function tkey(name: string): string {
  return normalizePbiTableName(name).toLowerCase();
}

function normCol(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function ucToFrom(uc: string): string {
  return uc
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(q)
    .join('.');
}

const DATEDIFF_UNITS = new Set(['SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']);

/** DAX FORMAT string → Spark expression producing text. */
function formatSql(x: Sql, fmt: string): Sql {
  const f = fmt.trim();
  const num = f.match(/^([#,0]*0|#)(?:\.([0#]+))?(%?)$/);
  if (num) {
    const decimals = num[2]?.length ?? 0;
    const pct = num[3] === '%';
    const v = pct ? `(${x.sql}) * 100` : x.sql;
    const body = num[1]!.includes(',')
      ? `format_number(${v}, ${decimals})`
      : `format_string('%.${decimals}f', CAST(${v} AS DOUBLE))`;
    return { sql: `coalesce(${pct ? `concat(${body}, '%')` : body}, '')`, kind: 'string' };
  }
  const named: Record<string, string> = {
    'short date': 'M/d/yyyy',
    'long date': 'EEEE, MMMM d, yyyy',
    'short time': 'HH:mm',
    'long time': 'h:mm:ss a',
  };
  const pattern = named[f.toLowerCase()] ?? daxDatePattern(f);
  if (!pattern) throw new CompileError(`FORMAT string "${fmt}" not supported`);
  return { sql: `coalesce(date_format(${x.sql}, ${sqlString(pattern)}), '')`, kind: 'string' };
}

function daxDatePattern(fmt: string): string | null {
  const ampm = /am\/pm/i.test(fmt);
  const src = fmt.replace(/am\/pm/gi, '\u0001');
  let out = '';
  let prevHour = false;
  let i = 0;
  let sawToken = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\u0001') {
      out += 'a';
      i += 1;
      continue;
    }
    const lc = c.toLowerCase();
    if (lc === 'q') {
      out += 'Q';
      sawToken = true;
      prevHour = false;
      i += 1;
      continue;
    }
    if ('ymdhns'.includes(lc)) {
      let n = 1;
      while (src[i + n]?.toLowerCase() === lc) n += 1;
      sawToken = true;
      if (lc === 'y') out += n <= 2 ? 'yy' : 'yyyy';
      else if (lc === 'd') out += n === 1 ? 'd' : n === 2 ? 'dd' : n === 3 ? 'EEE' : 'EEEE';
      else if (lc === 'h') out += ampm ? (n === 1 ? 'h' : 'hh') : n === 1 ? 'H' : 'HH';
      else if (lc === 'n') out += n === 1 ? 'm' : 'mm';
      else if (lc === 's') out += n === 1 ? 's' : 'ss';
      else if (lc === 'm') {
        const nextIsSec = /^\W*s/i.test(src.slice(i + n));
        if (prevHour || nextIsSec) out += n === 1 ? 'm' : 'mm';
        else out += n === 1 ? 'M' : n === 2 ? 'MM' : n === 3 ? 'MMM' : 'MMMM';
      }
      prevHour = lc === 'h';
      i += n;
      continue;
    }
    if (/[A-Za-z]/.test(c)) out += `'${c}'`;
    else out += c;
    if (!/\s|:/.test(c)) prevHour = false;
    i += 1;
  }
  return sawToken ? out : null;
}

function isBlankCall(n: DaxNode): boolean {
  return n.k === 'call' && n.fn === 'BLANK' && n.args.length === 0;
}

function noLetters(s: Sql): boolean {
  return Boolean(s.literal) && !/[A-Za-z]/.test(s.sql);
}

class Compiler {
  private readonly ctes: { name: string; build: () => string }[] = [];
  /** Grouped (decorrelated) aggregate CTEs by body text. */
  private readonly groupedCtes = new Map<string, string>();
  /** Iterator aliases whose SQL assembly attaches grouped joins (see takeIteratorJoins). */
  private readonly joinCapable = new Set<string>();
  /** Grouped CTEs joined into an iterator: outer alias → joins. */
  private readonly iteratorJoins = new Map<string, { name: string; alias: string; outerRef: string }[]>();
  /** Tables whose Power Query references are being resolved (cycle guard). */
  private readonly resolving = new Set<string>();
  private readonly tables = new Map<string, TableState>();
  private readonly measuresInProgress = new Set<string>();
  private readonly measuresInlined = new Set<string>();
  /** Shared scalar CTEs: measure / VAR values that don't depend on a row context. */
  private readonly sharedScalars = new Map<string, Sql>();
  private sharedNo = 0;
  private readonly calcColumns = new Set<string>();
  readonly notes: string[] = [];
  private aliasNo = 0;
  private varNo = 0;
  private readonly rels: CompileRelationship[];

  constructor(
    private readonly catalog: MeasureLogicCatalog,
    private readonly opts: DaxCompileOptions,
  ) {
    this.rels = (catalog.relationships ?? []).filter((r) => r.active);
  }

  // ---------------------------------------------------------------- tables / columns

  private table(nameOrKey: string): TableState {
    const key = tkey(nameOrKey);
    const hit = this.tables.get(key);
    if (hit) return hit;
    const meta = this.catalog.tableMeta.get(key);
    if (!meta) throw new CompileError(`Table '${nameOrKey}' is not in the harvested model`);
    if (!meta.uc_full_path) {
      // pre-fix harvests stored `calculated source = <DAX>` (or lost a fenced body)
      const daxTable = meta.source_m?.trim().replace(/^calculated\s+source\s*=\s*/i, '').trim();
      if (daxTable === '```') {
        throw new CompileError(
          `Calculated table '${meta.displayName}' lost its DAX in harvest — re-run pbi_parse (force_parse)`,
        );
      }
      if (daxTable && !/^let\b/i.test(daxTable) && !/\bTable\.\w+\s*\(/.test(daxTable)) {
        return this.calculatedTable(key, meta.displayName, daxTable);
      }
      const derived = parseMLineage(meta.source_m, this.catalog.rules);
      if (!derived.baseTable && !derived.embedded) {
        throw new CompileError(`Table '${meta.displayName}' has no Unity Catalog binding`);
      }
    }
    const lineage = parseMLineage(meta.source_m, this.catalog.rules);
    if (lineage.unsupported.length) {
      const first = lineage.unsupported[0]!;
      const fnMatch = first.match(/unsupported M function ([\w.#]+)/);
      const stepMatch = first.match(/:\s*(Table\.\w+)/);
      throw new CompileError(
        `Power Query steps of '${meta.displayName}' are not modeled: ${lineage.unsupported.join('; ')}`,
        fnMatch
          ? { kind: 'm_fn', name: fnMatch[1]! }
          : stepMatch
            ? { kind: 'm_step', name: stepMatch[1]! }
            : undefined,
      );
    }
    // Power Query references to other tables of the model (Source = OtherQuery, merged queries):
    // build them first so their CTEs precede this table's.
    if (this.resolving.has(key)) throw new CompileError(`Power Query reference cycle at '${meta.displayName}'`);
    this.resolving.add(key);
    let baseSt: TableState | null = null;
    const joinSts = new Map<string, TableState>();
    try {
      if (lineage.baseTable) baseSt = this.referencedTable(lineage.baseTable, meta.displayName);
      for (const j of lineage.joins) joinSts.set(j.alias, this.referencedTable(j.table, meta.displayName));
    } finally {
      this.resolving.delete(key);
    }
    const n = this.tables.size + 1;
    const known = new Set<string>();
    const knownNorm = new Map<string, string>();
    for (const c of meta.warehouse_columns ?? []) {
      known.add(c.toLowerCase());
      knownNorm.set(normCol(c), c);
    }
    const st: TableState = {
      key,
      name: meta.displayName,
      uc: meta.uc_full_path ?? '',
      lineage,
      base: `t${n}`,
      srcAlias: `src_${n}`,
      latest: `t${n}`,
      stageNo: 0,
      baseCols: new Map(),
      materialized: new Map(),
      inProgress: new Set(),
      known,
      knownNorm,
      calcTable: null,
      baseSt,
      joinSts,
      rowHash: null,
    };
    this.tables.set(key, st);
    // Columns the row filters, de-dup keys and join keys read from referenced / merged tables.
    for (const j of lineage.joins) {
      const right = joinSts.get(j.alias)!;
      for (const k of j.rightKeys) this.ensureBase(right, pqCol(k), k);
      for (const k of j.leftKeys) this.registerRefs(st, k.sql);
    }
    for (const w of lineage.where) this.registerRefs(st, w.sql);
    for (const k of lineage.dedupe?.keySql ?? []) this.registerRefs(st, k);
    this.ctes.push({ name: st.base, build: () => this.buildBaseCte(st) });
    for (const note of lineage.notes) this.notes.push(`${st.name}: ${note}`);
    return st;
  }

  /** DAX calculated table (CALENDAR / ADDCOLUMNS / SELECTCOLUMNS) → base CTE. */
  private calculatedTable(key: string, name: string, dax: string): TableState {
    let ast: DaxNode;
    try {
      ast = parseDax(dax);
    } catch (e) {
      throw new CompileError(`Cannot parse calculated table '${name}': ${(e as Error).message}`);
    }
    const n = this.tables.size + 1;
    const st: TableState = {
      key,
      name,
      uc: '',
      lineage: parseMLineage(null),
      base: `t${n}`,
      srcAlias: `src_${n}`,
      latest: `t${n}`,
      stageNo: 0,
      baseCols: new Map(),
      materialized: new Map(),
      inProgress: new Set(),
      known: new Set(),
      knownNorm: new Map(),
      calcTable: new Map(),
      baseSt: null,
      joinSts: new Map(),
      rowHash: null,
    };
    this.tables.set(key, st);
    const sql = this.tableRelation(st, ast);
    this.ctes.push({ name: st.base, build: () => sql });
    return st;
  }

  private tableRelation(st: TableState, node: DaxNode): string {
    const empty: Ctx = { scopes: [], filters: [], transitions: [], env: new Map() };
    if (node.k === 'call' && node.fn === 'CALENDAR') {
      if (node.args.length !== 2) throw new CompileError('CALENDAR needs start and end dates');
      const start = this.scalar(node.args[0]!, empty).sql;
      const end = this.scalar(node.args[1]!, empty).sql;
      st.calcTable!.set('date', { name: 'Date', kind: 'date' });
      return `SELECT explode(sequence(CAST(${start} AS DATE), CAST(${end} AS DATE), INTERVAL 1 DAY)) AS ${q('Date')}`;
    }
    if (node.k === 'call' && (node.fn === 'ADDCOLUMNS' || node.fn === 'SELECTCOLUMNS')) {
      const inner = this.tableRelation(st, node.args[0]!);
      const ctx: Ctx = { ...empty, scopes: [{ table: st.key, alias: 'cur' }] };
      const added: { name: string; sql: Sql }[] = [];
      for (let i = 1; i + 1 < node.args.length; i += 2) {
        const label = node.args[i]!;
        if (label.k !== 'str') throw new CompileError(`${node.fn} column names must be string literals`);
        added.push({ name: label.v, sql: this.scalar(node.args[i + 1]!, ctx) });
      }
      // DAX: new columns cannot see each other within the same ADDCOLUMNS call
      if (node.fn === 'SELECTCOLUMNS') st.calcTable!.clear();
      for (const a of added) st.calcTable!.set(a.name.toLowerCase(), { name: a.name, kind: a.sql.kind });
      const cols = added.map((a) => `${a.sql.sql} AS ${q(a.name)}`).join(',\n    ');
      return `SELECT ${node.fn === 'ADDCOLUMNS' ? 'cur.*, ' : ''}${cols}\n  FROM (\n${inner}\n) cur`;
    }
    if (node.k === 'call' && node.fn === 'DATATABLE') {
      const list = node.args[node.args.length - 1];
      if (list?.k !== 'list') throw new CompileError('DATATABLE needs a row list');
      const cols: { name: string; kind: Kind; sqlType: string }[] = [];
      for (let i = 0; i + 1 < node.args.length - 1; i += 2) {
        const n = node.args[i]!;
        const t = node.args[i + 1]!;
        if (n.k !== 'str') throw new CompileError('DATATABLE column names must be strings');
        const type = t.k === 'ref' ? t.name.toUpperCase() : '';
        const sqlType = /STRING/.test(type)
          ? 'STRING'
          : /DATE/.test(type)
            ? 'TIMESTAMP'
            : /BOOL/.test(type)
              ? 'BOOLEAN'
              : /INTEGER/.test(type)
                ? 'BIGINT'
                : /CURRENCY/.test(type)
                  ? 'DECIMAL(19,4)'
                  : 'DOUBLE';
        cols.push({
          name: n.v,
          kind: /STRING/.test(type) ? 'string' : /DATE/.test(type) ? 'date' : /BOOL/.test(type) ? 'bool' : 'number',
          sqlType,
        });
      }
      // values carry the declared column type (DATETIME "2024-01-01" is a timestamp, not text)
      const rows = list.items.map((row) => {
        if (row.k !== 'list') throw new CompileError('DATATABLE rows must be lists');
        return `(${row.items
          .map((v, j) => `TRY_CAST(${this.scalar(v, empty).sql} AS ${cols[j]?.sqlType ?? 'STRING'})`)
          .join(', ')})`;
      });
      for (const c of cols) st.calcTable!.set(c.name.toLowerCase(), c);
      return `SELECT * FROM VALUES ${rows.join(', ')} AS v(${cols.map((c) => q(c.name)).join(', ')})`;
    }
    if (node.k === 'call' && node.fn === 'SUMMARIZE') {
      const src = this.tableNameOf(node.args[0]!, empty);
      if (!src) throw new CompileError('SUMMARIZE over a table expression is not supported');
      const groupCols: string[] = [];
      let i = 1;
      for (; i < node.args.length && node.args[i]!.k === 'col'; i++) {
        const c = node.args[i] as Extract<DaxNode, { k: 'col' }>;
        if (c.table && tkey(c.table) !== src) throw new CompileError('SUMMARIZE group-by across tables not supported');
        groupCols.push(this.canonicalColumnName(this.table(src), c.column));
      }
      // extension columns are evaluated in the filter context of each group
      const groupCtx = this.applyFilterArgs(
        { ...empty, scopes: [{ table: src, alias: 'cur', cols: groupCols }] },
        [],
      );
      const ext: { name: string; sql: Sql }[] = [];
      for (; i + 1 < node.args.length; i += 2) {
        const label = node.args[i]!;
        if (label.k !== 'str') throw new CompileError('SUMMARIZE column names must be string literals');
        ext.push({ name: label.v, sql: this.scalar(node.args[i + 1]!, groupCtx) });
      }
      const x = this.alias('x');
      const proj = groupCols.map((c) => {
        const ref = this.colRef(src, c, x);
        st.calcTable!.set(c.toLowerCase(), { name: c, kind: ref.kind });
        return `${ref.sql} AS ${q(c)}`;
      });
      for (const e of ext) st.calcTable!.set(e.name.toLowerCase(), { name: e.name, kind: e.sql.kind });
      const inner = `SELECT DISTINCT ${proj.join(', ')} FROM ${this.table(src).latest} ${x}`;
      const extSql = ext.map((e) => `, ${e.sql.sql} AS ${q(e.name)}`).join('');
      return `SELECT cur.*${extSql}\n  FROM (${inner}) cur`;
    }
    const fn = node.k === 'call' ? `${node.fn}(…)` : node.k;
    throw new CompileError(`Calculated table '${st.name}' uses ${fn} (not supported)`);
  }

  /** Stored column key for a DAX column name (exact, case-insensitive, then trailing-space tolerant). */
  private findColumnKey(tableKey: string, column: string): string | null {
    const cols = this.catalog.columnsByTable.get(tableKey);
    if (!cols) return null;
    if (cols.has(column)) return column;
    if (cols.has(column.toLowerCase())) return column.toLowerCase();
    const want = column.trim().toLowerCase();
    for (const k of cols.keys()) if (k.trim().toLowerCase() === want) return k;
    return null;
  }

  private columnMeta(st: TableState, column: string) {
    const key = this.findColumnKey(st.key, column);
    return key ? this.catalog.columnsByTable.get(st.key)!.get(key)! : null;
  }

  private hasColumn(tableKey: string, column: string): boolean {
    if (this.tables.get(tableKey)?.calcTable?.has(column.toLowerCase())) return true;
    return this.findColumnKey(tableKey, column) !== null;
  }

  private colRef(tableName: string, column: string, alias: string): Sql {
    const st = this.table(tableName);
    const meta = this.columnMeta(st, column);
    const produced = st.calcTable?.get(column.toLowerCase());
    if (produced && !meta?.calculated_dax?.trim()) {
      return { sql: `${alias}.${q(produced.name)}`, kind: produced.kind };
    }
    if (st.calcTable && !meta?.calculated_dax?.trim()) {
      throw new CompileError(`Column '${st.name}'[${column}] is not produced by the calculated table expression`);
    }
    if (!meta) throw new CompileError(`Column '${st.name}'[${column}] is not in the harvested model`);
    const pbiName = this.canonicalColumnName(st, column);
    if (meta.calculated_dax?.trim()) {
      const kind = this.ensureCalc(st, pbiName, meta.calculated_dax, meta.data_type ?? null);
      return { sql: `${alias}.${q(pbiName)}`, kind };
    }
    this.ensureBase(st, pbiName, meta.source_column ?? null);
    return { sql: `${alias}.${q(pbiName)}`, kind: kindOfDataType(meta.data_type) };
  }

  private canonicalColumnName(st: TableState, column: string): string {
    const cols = this.catalog.columnsByTable.get(st.key);
    if (cols?.has(column)) return column;
    const want = column.trim().toLowerCase();
    let fallback: string | null = null;
    for (const k of cols?.keys() ?? []) {
      if (k.trim().toLowerCase() !== want) continue;
      if (k !== k.toLowerCase()) return k;
      fallback = k;
    }
    return fallback ?? column;
  }

  private ensureBase(st: TableState, pbiName: string, sourceColumn: string | null) {
    const lk = pbiName.toLowerCase();
    if (st.baseCols.has(lk)) return;
    const expr = st.lineage.column(sourceColumn?.trim() || pbiName);
    if ('error' in expr) throw new CompileError(expr.error);
    st.baseCols.set(lk, { name: pbiName, expr });
    this.registerRefs(st, expr.sql);
  }

  /** Row identity over every column of the table (see ROW_HASH); registered before CTEs are built. */
  private enableRowHash(st: TableState) {
    if (st.rowHash) return;
    const cols = this.catalog.columnsByTable.get(st.key);
    const exprs: MColumnExpr[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const [name, meta] of cols ?? []) {
      const lk = name.toLowerCase();
      if (seen.has(lk) || meta.calculated_dax?.trim()) continue; // calculated columns follow from the row
      seen.add(lk);
      const expr = st.lineage.column(meta.source_column?.trim() || name);
      if ('error' in expr) {
        skipped.push(name);
        continue;
      }
      // A column whose source is missing from the warehouse (replica drift) cannot be compared.
      if (st.known.size && expr.leaves.some((l) => !st.known.has(l.toLowerCase()) && !st.knownNorm.has(normCol(l)))) {
        skipped.push(name);
        continue;
      }
      exprs.push(expr);
      this.registerRefs(st, expr.sql);
    }
    if (!exprs.length) {
      throw new CompileError(`Context transition on '${st.name}': no comparable columns for row identity`, {
        kind: 'semantic',
        name: 'calculate_row_transition',
      });
    }
    st.rowHash = exprs;
    this.notes.push(
      `${st.name}: context transition on the current row compares all ${exprs.length} columns (row hash)` +
        (skipped.length ? `; ${skipped.length} column(s) without warehouse source left out: ${skipped.slice(0, 5).join(', ')}` : ''),
    );
  }

  /** A table read by this table's Power Query (query reference or merge), with context on failure. */
  private referencedTable(name: string, from: string): TableState {
    try {
      return this.table(name);
    } catch (e) {
      if (e instanceof CompileError && /not in the harvested model/.test(e.message)) {
        throw new CompileError(`Power Query of '${from}' reads query '${name}', which is not loaded into the model`, {
          kind: 'm_step',
          name: 'query reference',
        });
      }
      throw e;
    }
  }

  /**
   * Make the columns a lineage expression reads from referenced / merged tables available in
   * their base CTEs (those CTEs are built before this table's, so this must happen up front).
   */
  private registerRefs(st: TableState, sql: string) {
    if (st.baseSt) {
      for (const m of sql.matchAll(/`((?:[^`]|``)+)`/g)) {
        const leaf = m[1]!.replace(/``/g, '`');
        this.ensureBase(st.baseSt, pqCol(leaf), leaf);
      }
    }
    for (const m of sql.matchAll(JOIN_REF_RE)) {
      const right = st.joinSts.get(m[1]!);
      if (!right) throw new CompileError(`'${st.name}': merged query ${m[1]} is not resolved`);
      this.ensureBase(right, pqCol(m[2]!), m[2]!);
    }
  }

  private resolveLeaf(st: TableState, leaf: string): string {
    const override = this.opts.columnOverrides?.[st.key]?.[leaf.toLowerCase()];
    if (override) return override;
    if (st.known.size === 0 || st.known.has(leaf.toLowerCase())) return leaf;
    const norm = st.knownNorm.get(normCol(leaf));
    if (norm) {
      this.notes.push(`${st.name}: source column ${leaf} resolved to warehouse column ${norm}`);
      return norm;
    }
    this.notes.push(`${st.name}: source column ${leaf} not in UC catalog (left as-is)`);
    return leaf;
  }

  /** Qualify warehouse leaf columns in a lineage expression with the source alias. */
  private qualifyLeaves(st: TableState, sql: string): string {
    const leaves = sql.replace(/`((?:[^`]|``)+)`/g, (_m, inner: string) => {
      const leaf = inner.replace(/``/g, '`');
      if (st.baseSt) return `${st.srcAlias}.${q(pqCol(leaf))}`;
      if (st.lineage.embedded) return `${st.srcAlias}.${q(leaf)}`;
      return `${st.srcAlias}.${q(this.resolveLeaf(st, leaf))}`;
    });
    // markers contain no backticks, so they are qualified after the leaves
    return leaves.replace(JOIN_REF_RE, (_m, alias: string, col: string) => `${st.srcAlias}_${alias}.${q(pqCol(col))}`);
  }

  /** "Enter data" rows as an inline VALUES relation (all text, as Power Query stores them). */
  private embeddedRelation(e: NonNullable<MLineage['embedded']>): string {
    const cols = e.columns.map((c) => q(c)).join(', ');
    if (!e.rows.length) {
      return `(SELECT ${e.columns.map((c) => `CAST(NULL AS STRING) AS ${q(c)}`).join(', ')} WHERE FALSE)`;
    }
    const rows = e.rows.map((r) => `(${r.map((v) => (v === null ? 'CAST(NULL AS STRING)' : sqlString(v))).join(', ')})`);
    return `(SELECT * FROM VALUES\n    ${rows.join(',\n    ')}\n  AS e(${cols}))`;
  }

  private buildBaseCte(st: TableState): string {
    const proj = [...st.baseCols.values()].map(
      (c) => `${this.qualifyLeaves(st, c.expr.sql)} AS ${q(c.name)}`,
    );
    if (st.rowHash) {
      // null flags keep (1, NULL) and (NULL, 1) apart — xxhash64 skips NULL inputs
      const parts = st.rowHash.flatMap((e) => {
        const v = this.qualifyLeaves(st, e.sql);
        return [v, `${v} IS NULL`];
      });
      proj.push(`xxhash64(${parts.join(', ')}) AS ${q(ROW_HASH)}`);
    }
    if (!proj.length) proj.push(`1 AS ${q('__row')}`);
    let from = st.lineage.embedded
      ? this.embeddedRelation(st.lineage.embedded)
      : st.baseSt
        ? st.baseSt.base
        : st.lineage.nativeSql
          ? `(\n${st.lineage.nativeSql}\n)`
          : ucToFrom(st.uc);
    const dedupe = st.lineage.dedupe;
    if (dedupe && !dedupe.keySql) from = `(SELECT DISTINCT * FROM ${from} ${st.srcAlias}_d)`;
    const where = st.lineage.where.map((w) => this.qualifyLeaves(st, w.sql));
    let sql = `SELECT ${proj.join(',\n    ')}\n  FROM ${from} ${st.srcAlias}`;
    for (const j of st.lineage.joins) {
      const right = st.joinSts.get(j.alias)!;
      const alias = `${st.srcAlias}_${j.alias}`;
      const on = j.leftKeys
        .map((k, i) => `${this.qualifyLeaves(st, k.sql)} = ${alias}.${q(pqCol(j.rightKeys[i]!))}`)
        .join(' AND ');
      sql += `\n  ${JOIN_SQL[j.kind]} JOIN ${right.base} ${alias} ON ${on}`;
    }
    if (where.length) sql += `\n  WHERE ${where.join('\n    AND ')}`;
    if (dedupe?.keySql) {
      const keys = dedupe.keySql.map((k) => this.qualifyLeaves(st, k)).join(', ');
      sql += `\n  QUALIFY ROW_NUMBER() OVER (PARTITION BY ${keys} ORDER BY ${keys}) = 1`;
    }
    return sql;
  }

  private addStage(st: TableState, column: string, sql: string) {
    st.stageNo += 1;
    const name = `${st.base}_${st.stageNo}`;
    const from = st.latest;
    this.ctes.push({ name, build: () => `SELECT cur.*, ${sql} AS ${q(column)}\n  FROM ${from} cur` });
    st.latest = name;
  }

  private ensureCalc(st: TableState, column: string, dax: string, dataType: string | null): Kind {
    const lk = column.toLowerCase();
    const done = st.materialized.get(lk);
    if (done) return done;
    if (st.inProgress.has(lk)) {
      throw new CompileError(`Circular calculated column dependency at '${st.name}'[${column}]`);
    }
    st.inProgress.add(lk);
    let ast: DaxNode;
    try {
      ast = parseDax(dax);
    } catch (e) {
      throw new CompileError(`Cannot parse '${st.name}'[${column}]: ${(e as Error).message}`);
    }
    const ctx: Ctx = {
      scopes: [{ table: st.key, alias: 'cur' }],
      filters: [],
      transitions: [],
      env: new Map(),
    };
    let node = ast;
    while (node.k === 'var') {
      for (const d of node.decls) {
        const v = this.scalar(d.e, ctx);
        if (/\bSELECT\b/i.test(v.sql)) {
          const col = `__v${++this.varNo}`;
          this.addStage(st, col, v.sql);
          ctx.env.set(d.name.toLowerCase(), { sql: `cur.${q(col)}`, kind: v.kind });
        } else {
          ctx.env.set(d.name.toLowerCase(), v);
        }
      }
      node = node.body;
    }
    const result = this.scalar(node, ctx);
    this.addStage(st, column, result.sql);
    const kind = dataType ? kindOfDataType(dataType) : result.kind;
    st.inProgress.delete(lk);
    st.materialized.set(lk, kind);
    this.calcColumns.add(`${st.name}[${column}]`);
    return kind;
  }

  // ---------------------------------------------------------------- relationships

  /** Shortest filter-propagation path (list of hops) from `from` to `to`, or null. */
  private flowPath(from: string, to: string): { from: string; to: string; toCol: string; fromCol: string }[] | null {
    const prev = new Map<string, { node: string; hop: { from: string; to: string; toCol: string; fromCol: string } }>();
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) break;
      for (const r of this.rels) {
        const ft = tkey(r.fromTable);
        const tt = tkey(r.toTable);
        const edges: { next: string; toCol: string; fromCol: string }[] = [];
        // one-to-one relationships always filter in both directions in Power BI
        const both = r.both || r.cardinality === 'one_to_one';
        if (tt === cur) edges.push({ next: ft, toCol: r.fromColumn, fromCol: r.toColumn });
        if (both && ft === cur) edges.push({ next: tt, toCol: r.toColumn, fromCol: r.fromColumn });
        for (const e of edges) {
          if (seen.has(e.next)) continue;
          seen.add(e.next);
          prev.set(e.next, { node: cur, hop: { from: cur, to: e.next, toCol: e.toCol, fromCol: e.fromCol } });
          queue.push(e.next);
        }
      }
    }
    if (!prev.has(to)) return null;
    const hops: { from: string; to: string; toCol: string; fromCol: string }[] = [];
    let n = to;
    while (n !== from) {
      const p = prev.get(n)!;
      hops.unshift(p.hop);
      n = p.node;
    }
    return hops;
  }

  /**
   * `target.col IN (SELECT … FROM hop … WHERE … IN (SELECT … FROM source WHERE preds))`, or for a
   * row-context transition the innermost hop compares with the current row's column.
   */
  private propagate(
    hops: { from: string; to: string; toCol: string; fromCol: string }[],
    targetAlias: string,
    source: { preds: Pred[] } | { row: RowScope },
  ): string {
    // Relationship keys share a type in Power BI, but warehouse types can differ (e.g. IMO as
    // BIGINT on one table, text on another). Compare non-date keys as text.
    const keyPair = (a: Sql, b: Sql): [string, string] =>
      a.kind === 'date' || b.kind === 'date'
        ? [a.sql, b.sql]
        : [`CAST(${a.sql} AS STRING)`, `CAST(${b.sql} AS STRING)`];
    const cond = (i: number, toAlias: string): string => {
      const hop = hops[i]!;
      const toRef = this.colRef(hop.to, hop.toCol, toAlias);
      if (i === 0 && 'row' in source) {
        const [t, f] = keyPair(toRef, this.colRef(hop.from, hop.fromCol, source.row.alias));
        return `${t} = ${f}`;
      }
      const r = this.alias('r');
      const [toCol, fromCol] = keyPair(toRef, this.colRef(hop.from, hop.fromCol, r));
      const inner = i === 0 ? (source as { preds: Pred[] }).preds.map((p) => p.build(r)) : [cond(i - 1, r)];
      return `${toCol} IN (SELECT ${fromCol} FROM ${this.table(hop.from).latest} ${r}${inner.length ? ` WHERE ${inner.join(' AND ')}` : ''})`;
    };
    return cond(hops.length - 1, targetAlias);
  }

  // ---------------------------------------------------------------- filter context

  private contextPreds(ctx: Ctx, target: string, alias: string): string[] {
    const out: string[] = [];
    const byTable = new Map<string, Pred[]>();
    for (const p of ctx.filters) {
      if (p.table === target) out.push(p.build(alias));
      else byTable.set(p.table, [...(byTable.get(p.table) ?? []), p]);
    }
    for (const [src, preds] of byTable) {
      const path = this.flowPath(src, target);
      const srcName = this.catalog.tableMeta.get(src)?.displayName ?? src;
      const tgtName = this.catalog.tableMeta.get(target)?.displayName ?? target;
      if (path) {
        out.push(this.propagate(path, alias, { preds }));
        if (path.length > 1) {
          this.notes.push(`Filter on '${srcName}' reaches '${tgtName}' through ${path.length} relationships`);
        }
      } else {
        this.notes.push(`Filter on '${srcName}' has no relationship path to '${tgtName}' — no effect (as in DAX)`);
      }
    }
    for (const s of ctx.transitions) {
      const tgtName = this.catalog.tableMeta.get(target)?.displayName ?? target;
      if (s.table === target) {
        // DAX: the row context becomes a filter on every column — rows identical to the current
        // row (duplicates included). Compared through a row hash computed once per table.
        const st = this.table(target);
        if (st.calcTable) {
          throw new CompileError(
            `CALCULATE context transition on the current row of calculated table '${tgtName}' (not modeled)`,
            { kind: 'semantic', name: 'calculate_row_transition' },
          );
        }
        this.enableRowHash(st);
        out.push(`${alias}.${q(ROW_HASH)} = ${s.alias}.${q(ROW_HASH)}`);
        continue;
      }
      const path = this.flowPath(s.table, target);
      if (path) out.push(this.propagate(path, alias, { row: s }));
    }
    return out;
  }

  private alias(prefix = 'a'): string {
    this.aliasNo += 1;
    return `${prefix}${this.aliasNo}`;
  }

  private aggregate(sel: TableSel, select: (alias: string, inner: Ctx) => string): string {
    if (sel.distinctCols) return this.aggregateDistinct(sel, select);
    const grouped = this.groupedAggregate(sel, select);
    if (grouped) return grouped;
    const alias = this.alias();
    this.joinCapable.add(alias);
    const inner: Ctx = { ...sel.ctx, scopes: [...sel.ctx.scopes, { table: sel.table, alias }] };
    const selectSql = select(alias, inner);
    const where = sel.preds.map((p) => p.build(alias));
    if (!sel.all) where.push(...this.contextPreds(sel.ctx, sel.table, alias));
    if (sel.top1) {
      const { order, desc } = sel.top1;
      const best = this.aggregate({ ...sel, top1: undefined }, (_a, innerCtx) =>
        `${desc ? 'MAX' : 'MIN'}(${this.scalar(order, innerCtx).sql})`,
      );
      where.push(`${this.scalar(order, inner).sql} = ${best}`);
    }
    const from = this.table(sel.table).latest;
    const joins = this.takeIteratorJoins(alias);
    return `(SELECT ${selectSql} FROM ${from} ${alias}${joins}${where.length ? ` WHERE ${where.join(' AND ')}` : ''})`;
  }

  /**
   * Decorrelation (grouped evaluation). Inside a per-value iterator (SUMX / FILTER / COUNTX over
   * VALUES(T[c])) an aggregate is filtered by `T[c] = current value`; emitted as a correlated
   * subquery per value it nests inside the iterator, and Spark cannot plan deep nests
   * (INTERNAL_ERROR on Vessel ReportStatus_Count & co., 200 KB+ CII statements). Instead the
   * aggregate is computed once for every key value —
   *   gN AS (SELECT key AS k, agg AS v FROM F LEFT JOIN … T GROUP BY k)
   * — and the iterator looks its value up with a flat equality: (SELECT v FROM gN WHERE gN.k = g.c).
   * The key reaches F along the relationship path only through unique ("one") sides, so the
   * joins never duplicate F rows; LEFT JOIN keeps orphan rows, which form DAX's BLANK key.
   * Returns null (caller keeps the correlated form) whenever any condition does not hold.
   */
  private groupedAggregate(sel: TableSel, select: (alias: string, inner: Ctx) => string): string | null {
    if (sel.all || sel.top1 || sel.distinctCols) return null;
    const groups = sel.ctx.filters.filter((p) => p.group);
    if (groups.length !== 1 || sel.ctx.transitions.length) return null;
    const gp = groups[0]!;
    const { alias: outer, table: keyTable, col: keyCol, outerRef } = gp.group!;
    if (sel.ctx.scopes.some((s) => s.alias !== outer && !s.cols)) return null; // other row contexts

    // key expression on the aggregated table: joins along the relationship path
    const path = keyTable === sel.table ? [] : this.flowPath(keyTable, sel.table);
    if (!path) return null;
    const chain = (fAlias: string): { joins: string[]; keySql: string; unique: boolean } | null => {
      const joins: string[] = [];
      let unique = true;
      let cur = { table: sel.table, alias: fAlias };
      for (let i = path.length - 1; i >= 0; i--) {
        const hop = path[i]!;
        if (hop.to !== cur.table) return null;
        if (!this.isUniqueSide(hop.from, hop.fromCol)) unique = false;
        const j = this.alias('a');
        joins.push(
          `LEFT JOIN ${this.table(hop.from).latest} ${j} ON CAST(${this.colRef(hop.to, hop.toCol, cur.alias).sql} AS STRING) = CAST(${this.colRef(hop.from, hop.fromCol, j).sql} AS STRING)`,
        );
        cur = { table: hop.from, alias: j };
      }
      if (cur.table !== keyTable) return null;
      return { joins, keySql: this.colRef(keyTable, keyCol, cur.alias).sql, unique };
    };
    const alias = this.alias();
    const direct = chain(alias);
    if (!direct) return null;
    let joins = direct.joins;
    let keySql = direct.keySql;
    let pairJoin: string | null = null;
    if (!direct.unique) {
      // Pair mode: the path crosses a non-unique side (e.g. a bidirectional many→one hop), so a
      // join would repeat rows. Build the DISTINCT (key, row identity) pairs once and aggregate
      // the table joined to them — each row counts once per key it belongs to.
      const idOf = (a: string): string | null => {
        const k = this.relationshipKeyOf(sel.table);
        if (k) return `CAST(${this.colRef(sel.table, k, a).sql} AS STRING)`;
        const st = this.table(sel.table);
        if (st.calcTable) return null;
        this.enableRowHash(st);
        return `CAST(${a}.${q(ROW_HASH)} AS STRING)`;
      };
      const pf = this.alias('a');
      const pc = chain(pf);
      const idInner = idOf(pf);
      const idOuter = idOf(alias);
      if (!pc || !idInner || !idOuter) return null;
      const pairs =
        `(SELECT DISTINCT coalesce(CAST(${pc.keySql} AS STRING), '${BLANK_KEY}') AS k, ${idInner} AS id ` +
        `FROM ${this.table(sel.table).latest} ${pf} ${pc.joins.join(' ')})`;
      pairJoin = `JOIN ${pairs} pk ON pk.id = ${idOuter}`;
      joins = [];
      keySql = '';
    }

    const ctx: Ctx = { ...sel.ctx, filters: sel.ctx.filters.filter((p) => p !== gp) };
    const inner: Ctx = { ...ctx, scopes: [...ctx.scopes.filter((s) => s.alias !== outer), { table: sel.table, alias }] };
    let selectSql: string;
    let where: string[];
    try {
      selectSql = select(alias, inner);
      where = [...sel.preds.map((p) => p.build(alias)), ...this.contextPreds(ctx, sel.table, alias)];
    } catch (e) {
      if (e instanceof CompileError) return null;
      throw e;
    }
    const key = pairJoin ? 'pk.k' : `coalesce(CAST(${keySql} AS STRING), '${BLANK_KEY}')`;
    let body =
      `SELECT ${key} AS k, ${selectSql} AS v FROM ${this.table(sel.table).latest} ${alias}` +
      (pairJoin ? `\n    ${pairJoin}` : '') +
      (joins.length ? `\n    ${joins.join('\n    ')}` : '') +
      (where.length ? `\n    WHERE ${where.join(' AND ')}` : '') +
      `\n    GROUP BY 1`;
    // Filters built in the outer context can still read the iterator's current key (e.g.
    // FILTER(ALL(T), T[k] IN VALUES(T[k])) inside a per-key iteration). Every row aggregated into
    // group k had outer key = k, so the outer key is the row's own key: substitute it. Only with
    // unique-side joins (one key per row); pair mode keeps the correlated fallback.
    if (!pairJoin && keySql && body.includes(outerRef)) body = body.split(outerRef).join(`(${keySql})`);
    if (!isUncorrelatedSql(body)) return null; // still reads another outer row
    let name = this.groupedCtes.get(body);
    if (!name) {
      name = `grp${++this.sharedNo}`;
      this.groupedCtes.set(body, name);
      this.ctes.push({ name, build: () => body });
      this.notes.push(`Per-value iteration over ${keyTable}[${keyCol}] evaluated grouped (decorrelated)`);
    }
    if (this.joinCapable.has(outer)) {
      // Join the grouped result into the iterator itself: no correlated subquery remains
      // (correlated lookups into grouped CTEs hit Spark optimizer bugs on Vessel: INTERNAL_ERROR /
      // PHOTON_EXPR_COMPILATION_FAILED).
      const list = this.iteratorJoins.get(outer) ?? [];
      let j = list.find((x) => x.name === name && x.outerRef === outerRef);
      if (!j) {
        j = { name, alias: this.alias('x'), outerRef };
        list.push(j);
        this.iteratorJoins.set(outer, list);
      }
      return `${j.alias}.${q('v')}`;
    }
    // k is unique (GROUP BY key), so MAX(v) is v; Spark requires a correlated scalar subquery
    // to be aggregated (MUST_AGGREGATE_CORRELATED_SCALAR_SUBQUERY).
    return `(SELECT MAX(v) FROM ${name} WHERE ${name}.k = coalesce(CAST(${outerRef} AS STRING), '${BLANK_KEY}'))`;
  }

  /** LEFT JOINs of grouped results requested while compiling the iterator `alias` (k is unique: no fan-out). */
  private takeIteratorJoins(alias: string): string {
    const list = this.iteratorJoins.get(alias) ?? [];
    this.iteratorJoins.delete(alias);
    return list
      .map((j) => ` LEFT JOIN ${j.name} ${j.alias} ON ${j.alias}.k = coalesce(CAST(${j.outerRef} AS STRING), '${BLANK_KEY}')`)
      .join('');
  }

  /** A column of the table that is the unique ("one") side of an active model relationship. */
  private uniqueKeyOf(table: string): string | null {
    const meta = this.catalog.tableMeta.get(table);
    if (!meta || this.tables.get(table)?.calcTable) return null;
    return uniqueColumnOf(
      (this.catalog.relationships ?? []).filter((x) => x.active),
      table,
    );
  }

  /** The table's column on the unique side of any model relationship (calculated tables too). */
  private relationshipKeyOf(table: string): string | null {
    return uniqueColumnOf(this.catalog.relationships ?? [], table);
  }

  /** The column is the unique ("one") side of a model relationship. */
  private isUniqueSide(table: string, column: string): boolean {
    const c = column.toLowerCase();
    return (this.catalog.relationships ?? []).some(
      (r) =>
        (toSideUnique(r) && tkey(r.toTable) === table && r.toColumn.toLowerCase() === c) ||
        (fromSideUnique(r) && tkey(r.fromTable) === table && r.fromColumn.toLowerCase() === c),
    );
  }

  /** Iterate distinct values of columns (VALUES / ALL(T[c])) under the filter context. */
  private aggregateDistinct(sel: TableSel, select: (alias: string, inner: Ctx) => string): string {
    if (sel.top1) throw new CompileError('TOPN over VALUES/ALL(columns) not supported');
    const cols = sel.distinctCols!;
    const g = this.alias('g');
    this.joinCapable.add(g);
    const inner: Ctx = {
      ...sel.ctx,
      scopes: [...sel.ctx.scopes, { table: sel.table, alias: g, cols }],
    };
    const selectSql = select(g, inner);
    const where = sel.preds.map((p) => p.build(g));
    const x = this.alias('x');
    const proj = cols.map((c) => `${this.colRef(sel.table, c, x).sql} AS ${q(c)}`);
    const xWhere = sel.all ? [] : this.contextPreds(sel.ctx, sel.table, x);
    let rel = `SELECT DISTINCT ${proj.join(', ')} FROM ${this.table(sel.table).latest} ${x}${xWhere.length ? ` WHERE ${xWhere.join(' AND ')}` : ''}`;
    // The blank row is visible while no filter is placed on this table.
    const filtered = !sel.all && sel.ctx.filters.some((p) => p.table === sel.table);
    const orphans = sel.blankRow && !filtered ? this.blankRowSource(sel.table) : null;
    if (orphans) {
      rel += `\n  UNION SELECT ${cols.map((c) => `NULL AS ${q(c)}`).join(', ')} FROM ${orphans}`;
    }
    const from = `(${rel})`;
    const joins = this.takeIteratorJoins(g);
    return `(SELECT ${selectSql} FROM ${from} ${g}${joins}${where.length ? ` WHERE ${where.join(' AND ')}` : ''})`;
  }

  /**
   * DAX adds a blank row to the one side of a relationship when many-side rows have no match.
   * Returns a relation with one row when such orphans exist (none otherwise), or null when no
   * relationship points at the table.
   */
  private blankRowSource(table: string): string | null {
    // A row-producing anti-join, not an EXISTS predicate: Spark's optimizer fails
    // (INTERNAL_ERROR) on `FROM (SELECT 1) one WHERE EXISTS (… NOT EXISTS …)` once it sits inside
    // an iterator (Vessel VIA_Check_Count, Audit>90_Count, Nex_Audit_Status_Count).
    const parts: string[] = [];
    for (const r of this.rels) {
      if (tkey(r.toTable) !== table || tkey(r.fromTable) === table) continue;
      // only regular (to-one) relationships add a blank row; many-to-many ones are limited
      if (!toSideUnique(r)) continue;
      const many = tkey(r.fromTable);
      if (!this.catalog.tableMeta.get(many)) continue;
      try {
        const m = this.alias('m');
        const o = this.alias('o');
        const fk = this.colRef(many, r.fromColumn, m).sql;
        const pk = this.colRef(table, r.toColumn, o).sql;
        parts.push(
          `SELECT 1 AS one FROM ${this.table(many).latest} ${m} LEFT ANTI JOIN ${this.table(table).latest} ${o} ON CAST(${pk} AS STRING) = CAST(${fk} AS STRING)`,
        );
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        // many side not compilable (e.g. unbound) — cannot tell; assume no blank row
      }
    }
    return parts.length ? `(SELECT 1 AS one FROM (${parts.join(' UNION ALL ')}) orphan LIMIT 1) blank_row` : null;
  }

  /**
   * Context transition of the current row contexts. Iteration over VALUES/ALL(columns)
   * becomes a column filter (T[c] = current value) that propagates through relationships;
   * full-row contexts stay transitions.
   */
  private transition(ctx: Ctx): { filters: Pred[]; transitions: RowScope[] } {
    const filters: Pred[] = [];
    const transitions: RowScope[] = [...ctx.transitions];
    for (const s of ctx.scopes) {
      if (!s.cols) {
        // A full row of a table with a unique key (the "one" side of a relationship) is that key:
        // the transition becomes `T[key] = current key`, which also allows grouped evaluation.
        const key = this.uniqueKeyOf(s.table);
        if (key) {
          const outerRef = this.colRef(s.table, key, s.alias).sql;
          filters.push({
            table: s.table,
            cols: [key.toLowerCase()],
            build: (alias) => `${this.colRef(s.table, key, alias).sql} <=> ${outerRef}`,
            group: { alias: s.alias, table: s.table, col: key, outerRef },
          });
          continue;
        }
        transitions.push(s);
        continue;
      }
      const cols = s.cols;
      filters.push({
        table: s.table,
        cols: cols.map((c) => c.toLowerCase()),
        build: (alias) =>
          cols.map((c) => `${this.colRef(s.table, c, alias).sql} <=> ${s.alias}.${q(c)}`).join(' AND '),
        ...(cols.length === 1
          ? { group: { alias: s.alias, table: s.table, col: cols[0]!, outerRef: `${s.alias}.${q(cols[0]!)}` } }
          : {}),
      });
    }
    return { filters, transitions };
  }

  private makePred(
    table: string,
    cols: string[] | null,
    cond: DaxNode,
    ctx: Ctx,
    scopeCols?: string[],
  ): Pred {
    return {
      table,
      cols,
      build: (alias) =>
        this.scalar(cond, { ...ctx, scopes: [...ctx.scopes, { table, alias, cols: scopeCols }] }).sql,
    };
  }

  private tableNameOf(node: DaxNode, ctx: Ctx): string | null {
    if (node.k === 'tbl') return tkey(node.name);
    if (node.k === 'ref' && node.name && !ctx.env.has(node.name.toLowerCase())) {
      const key = tkey(node.name);
      if (this.catalog.tableMeta.has(key)) return key;
    }
    return null;
  }

  private tableExpr(node: DaxNode, ctx: Ctx): TableSel {
    const direct = this.tableNameOf(node, ctx);
    if (direct) {
      this.table(direct);
      return { table: direct, preds: [], all: false, ctx };
    }
    if (node.k === 'call') {
      const [a0, ...rest] = node.args;
      switch (node.fn) {
        case 'FILTER': {
          if (!a0 || !rest[0]) throw new CompileError('FILTER needs a table and a condition');
          const sel = this.tableExpr(a0, ctx);
          return {
            ...sel,
            preds: [...sel.preds, this.makePred(sel.table, null, rest[0], ctx, sel.distinctCols)],
          };
        }
        case 'ALL':
        case 'ALLNOBLANKROW':
        case 'REMOVEFILTERS': {
          const t = a0 ? this.tableNameOf(a0, ctx) : null;
          if (t) {
            this.table(t);
            return { table: t, preds: [], all: true, ctx };
          }
          const cols = this.sameTableColumns(node.args, node.fn);
          return {
            table: cols.table,
            preds: [],
            all: true,
            ctx,
            distinctCols: cols.columns,
            blankRow: node.fn !== 'ALLNOBLANKROW',
          };
        }
        case 'TOPN': {
          const n = a0;
          if (n?.k !== 'num' || Number(n.v) !== 1) throw new CompileError('TOPN is supported only with N = 1');
          if (!rest[0] || !rest[1]) throw new CompileError('TOPN needs a table and an order expression');
          if (rest.length > 3) throw new CompileError('TOPN with several order expressions not supported');
          const ord = rest[2];
          const asc =
            (ord?.k === 'ref' && ord.name.toUpperCase() === 'ASC') ||
            (ord?.k === 'num' && Number(ord.v) === 1) ||
            (ord?.k === 'call' && ord.fn === 'TRUE');
          const sel = this.tableExpr(rest[0], ctx);
          return { ...sel, top1: { order: rest[1], desc: !asc } };
        }
        case 'CALCULATETABLE': {
          if (!a0) throw new CompileError('CALCULATETABLE needs a table');
          return this.tableExpr(a0, this.applyFilterArgs(ctx, rest, false));
        }
        case 'VALUES':
        case 'DISTINCT': {
          if (a0?.k === 'col' && a0.table) {
            const cols = this.sameTableColumns(node.args, node.fn);
            return {
              table: cols.table,
              preds: [],
              all: false,
              ctx,
              distinctCols: cols.columns,
              blankRow: node.fn === 'VALUES',
            };
          }
          break;
        }
        default:
          break;
      }
      throw new CompileError(`Table expression ${node.fn}(…) not supported`, {
        kind: 'table_expr',
        name: node.fn,
      });
    }
    throw new CompileError('Expected a table expression');
  }

  private sameTableColumns(args: DaxNode[], fn: string): { table: string; columns: string[] } {
    const cols = args.filter((a): a is Extract<DaxNode, { k: 'col' }> => a.k === 'col' && Boolean(a.table));
    if (!cols.length || cols.length !== args.length) throw new CompileError(`${fn} argument form not supported`);
    const t = tkey(cols[0]!.table!);
    if (cols.some((c) => tkey(c.table!) !== t)) throw new CompileError(`${fn} over several tables not supported`);
    const st = this.table(t);
    return { table: t, columns: cols.map((c) => this.canonicalColumnName(st, c.column)) };
  }

  private applyFilterArgs(ctx: Ctx, args: DaxNode[], transition = true): Ctx {
    const tr = transition ? this.transition(ctx) : { filters: [], transitions: [...ctx.transitions] };
    let filters = [...ctx.filters, ...tr.filters];
    let transitions = tr.transitions;
    for (const raw of args) {
      let arg = raw;
      let keep = false;
      if (arg.k === 'call' && arg.fn === 'KEEPFILTERS' && arg.args[0]) {
        keep = true;
        arg = arg.args[0];
      }
      if (arg.k === 'call' && (arg.fn === 'ALL' || arg.fn === 'REMOVEFILTERS' || arg.fn === 'ALLNOBLANKROW')) {
        if (arg.args.length === 0) {
          filters = [];
          transitions = [];
          continue;
        }
        const t = this.tableNameOf(arg.args[0]!, ctx);
        if (t) {
          filters = filters.filter((p) => p.table !== t);
          transitions = transitions.filter((s) => s.table !== t);
          continue;
        }
        const colArgs = arg.args.filter((a): a is Extract<DaxNode, { k: 'col' }> => a.k === 'col');
        if (colArgs.length === arg.args.length && colArgs.every((c) => c.table)) {
          for (const c of colArgs) {
            const t2 = tkey(c.table!);
            const col = c.column.toLowerCase();
            filters = filters.filter(
              (p) => !(p.table === t2 && p.cols && p.cols.every((x) => x === col)),
            );
          }
          continue;
        }
        throw new CompileError(`${arg.fn} argument form not supported`);
      }
      if (arg.k === 'call' && (arg.fn === 'DATESYTD' || arg.fn === 'DATESBETWEEN')) {
        const { table, column } = this.colArg(arg.args[0], arg.fn);
        let lo: string;
        let hi: string;
        if (arg.fn === 'DATESYTD') {
          // last date visible in the outer filter context
          hi = this.aggregate({ table, preds: [], all: false, ctx }, (a) =>
            `MAX(${this.colRef(table, column, a).sql})`,
          );
          lo = `make_date(year(${hi}), 1, 1)`;
        } else {
          lo = this.scalar(arg.args[1]!, ctx).sql;
          hi = this.scalar(arg.args[2]!, ctx).sql;
        }
        const col = column.toLowerCase();
        if (!keep) filters = filters.filter((p) => !(p.table === table && p.cols?.every((c) => c === col)));
        filters.push({
          table,
          cols: [col],
          build: (alias) => {
            const c = this.colRef(table, column, alias).sql;
            return `((${lo}) IS NULL OR ${c} >= ${lo}) AND ((${hi}) IS NULL OR ${c} <= ${hi})`;
          },
        });
        continue;
      }
      if (arg.k === 'call' && ['USERELATIONSHIP', 'CROSSFILTER', 'ALLEXCEPT', 'ALLSELECTED'].includes(arg.fn)) {
        throw new CompileError(`CALCULATE modifier ${arg.fn} not supported`);
      }
      const isTable =
        this.tableNameOf(arg, ctx) !== null ||
        (arg.k === 'call' && ['FILTER', 'CALCULATETABLE', 'VALUES', 'DISTINCT'].includes(arg.fn));
      if (isTable) {
        const sel = this.tableExpr(arg, ctx);
        if (sel.top1) throw new CompileError('TOPN as a CALCULATE filter not supported');
        if (sel.distinctCols) {
          // FILTER(ALL(T[c]), cond) / VALUES(T[c]): a filter on those columns only
          const cols = sel.distinctCols.map((c) => c.toLowerCase());
          if (!keep && sel.all) {
            filters = filters.filter((p) => !(p.table === sel.table && p.cols?.every((c) => cols.includes(c))));
          }
          filters.push(...sel.preds.map((p) => ({ ...p, cols })));
          continue;
        }
        if (keep) {
          filters.push(...sel.preds);
        } else if (sel.all) {
          filters = [...filters.filter((p) => p.table !== sel.table), ...sel.preds];
          transitions = transitions.filter((s) => s.table !== sel.table);
        } else {
          const outer = ctx.filters.filter((p) => p.table === sel.table);
          filters = [...filters.filter((p) => p.table !== sel.table), ...outer, ...sel.preds];
          transitions = transitions.filter((s) => s.table !== sel.table);
        }
        continue;
      }
      // Boolean filter: FILTER(ALL(T[cols]), expr)
      const refs = collectColumnRefs(arg).filter((r) => r.table);
      const tablesInArg = [...new Set(refs.map((r) => tkey(r.table!)))];
      if (tablesInArg.length !== 1 || refs.length === 0) {
        throw new CompileError('Boolean CALCULATE filter must reference columns of exactly one table');
      }
      const t = tablesInArg[0]!;
      const cols = [...new Set(refs.map((r) => r.column.toLowerCase()))];
      if (!keep) {
        filters = filters.filter(
          (p) => !(p.table === t && p.cols && p.cols.every((c) => cols.includes(c))),
        );
      }
      filters.push(this.makePred(t, cols, arg, { ...ctx, scopes: [] }));
    }
    return { ...ctx, filters, transitions };
  }

  // ---------------------------------------------------------------- measures

  private measureRef(name: string, ctx: Ctx): Sql {
    const m =
      this.catalog.measures?.get(name.toLowerCase()) ?? this.catalog.measures?.get(name.trim().toLowerCase());
    if (!m) throw new CompileError(`[${name}] is neither a column in row context nor a known measure`);
    if (this.measuresInProgress.has(m.name.toLowerCase())) {
      throw new CompileError(`Circular measure reference at [${m.name}]`);
    }
    this.measuresInProgress.add(m.name.toLowerCase());
    let ast: DaxNode;
    try {
      ast = parseDax(m.dax);
    } catch (e) {
      throw new CompileError(`Cannot parse measure [${m.name}]: ${(e as Error).message}`);
    }
    const tr = this.transition(ctx);
    const inner: Ctx = {
      scopes: [],
      env: new Map(),
      filters: [...ctx.filters, ...tr.filters],
      transitions: tr.transitions,
    };
    // Without a row context the measure has one value per filter context: compile it once as a
    // shared CTE and reference it, instead of pasting its SQL at every reference (CII measure
    // chains produced 150–390 KB statements Spark could not plan).
    const shareKey = this.isRowFree(inner) ? `measure:${m.name.toLowerCase()}|${this.filterSignature(inner)}` : null;
    const cached = shareKey ? this.sharedScalars.get(shareKey) : undefined;
    if (cached) {
      this.measuresInProgress.delete(m.name.toLowerCase());
      return cached;
    }
    const out = this.scalar(ast, inner);
    this.measuresInProgress.delete(m.name.toLowerCase());
    this.measuresInlined.add(m.name);
    return shareKey ? this.shareScalar(shareKey, out) : out;
  }

  /**
   * No outer row can be referenced: the value is a constant for the query. Filters can carry
   * correlation too — inside SUMX(VALUES(T[c]), [M]) the measure is filtered by `T[c] = g.c`
   * (current value of the outer iteration), so such a measure must stay inline, not become a
   * standalone CTE. Any alias reference in the filter text (other than the signature alias)
   * conservatively counts as correlated.
   */
  private isRowFree(ctx: Ctx): boolean {
    if (ctx.scopes.length !== 0 || ctx.transitions.length !== 0) return false;
    return isUncorrelatedSql(this.filterSignature(ctx));
  }

  /**
   * BLANK-aware arithmetic repeats each operand (IS NULL test + coalesce), so nested arithmetic
   * doubles at every level (CII: 152 KB statements). An operand that is an uncorrelated scalar
   * subquery is computed once as a shared CTE and referenced by a short `(SELECT v FROM mN)`.
   */
  private shareOperand(v: Sql): Sql {
    if (v.literal || v.sql.length < SHARE_MIN_CHARS || !/\bSELECT\b/i.test(v.sql)) return v;
    if (!isUncorrelatedSql(v.sql)) return v;
    const key = `expr:${v.sql}`;
    return this.sharedScalars.get(key) ?? this.shareScalar(key, v);
  }

  /** Stable text of the filter context (preds rendered over a fixed alias). */
  private filterSignature(ctx: Ctx): string {
    return ctx.filters
      .map((p) => `${p.table}:${p.build('__sig')}`)
      .sort()
      .join('|');
  }

  /** Materialize an uncorrelated scalar as `mN AS (SELECT <sql> AS v)`; reuse by key. */
  private shareScalar(key: string, value: Sql): Sql {
    if (value.literal || !/\bSELECT\b/i.test(value.sql)) return value; // cheap: keep inline
    const name = `m${++this.sharedNo}`;
    const sql = value.sql;
    this.ctes.push({ name, build: () => `SELECT ${sql} AS v` });
    const ref: Sql = { sql: `(SELECT v FROM ${name})`, kind: value.kind };
    this.sharedScalars.set(key, ref);
    return ref;
  }

  // ---------------------------------------------------------------- scalar expressions

  scalar(node: DaxNode, ctx: Ctx): Sql {
    switch (node.k) {
      case 'num':
        return { sql: node.v.replace(/^0+(?=\d)/, ''), kind: 'number', literal: true };
      case 'str':
        return { sql: sqlString(node.v), kind: 'string', literal: true };
      case 'ref': {
        const v = ctx.env.get(node.name.toLowerCase());
        if (v) return v;
        if (!node.name) return { sql: 'NULL', kind: 'unknown' };
        throw new CompileError(`Unknown identifier ${node.name}`);
      }
      case 'tbl':
        throw new CompileError(`Table '${node.name}' used where a scalar is expected`);
      case 'list':
        throw new CompileError('List literal used where a scalar is expected');
      case 'col':
        return this.column(node, ctx);
      case 'un': {
        const e = this.scalar(node.e, ctx);
        if (node.op === 'NOT') return { sql: `(NOT ${e.sql})`, kind: 'bool' };
        return { sql: node.op === '-' ? `(-${e.sql})` : e.sql, kind: e.kind };
      }
      case 'var': {
        const env = new Map(ctx.env);
        const inner: Ctx = { ...ctx, env };
        for (const d of node.decls) {
          const v = this.scalar(d.e, inner);
          // a row-free VAR is evaluated once: share it instead of pasting it at each use
          env.set(
            d.name.toLowerCase(),
            this.isRowFree(inner) ? this.shareScalar(`var:${++this.sharedNo}`, v) : v,
          );
        }
        return this.scalar(node.body, inner);
      }
      case 'bin':
        return this.binary(node, ctx);
      case 'call':
        return this.call(node, ctx);
      default:
        throw new CompileError('Unsupported expression');
    }
  }

  private column(node: Extract<DaxNode, { k: 'col' }>, ctx: Ctx): Sql {
    if (node.level) {
      // Auto date/time hierarchy level of a date column ('T'[Date].[Year]).
      const base = this.column({ ...node, level: undefined }, ctx);
      switch (node.level.toLowerCase()) {
        case 'date':
          return base;
        case 'year':
          return { sql: `year(${base.sql})`, kind: 'number' };
        case 'quarter':
          return { sql: `concat('Qtr ', quarter(${base.sql}))`, kind: 'string' };
        case 'quarterno':
          return { sql: `quarter(${base.sql})`, kind: 'number' };
        case 'month':
          return { sql: `date_format(${base.sql}, 'MMMM')`, kind: 'string' };
        case 'monthno':
          return { sql: `month(${base.sql})`, kind: 'number' };
        case 'day':
          return { sql: `day(${base.sql})`, kind: 'number' };
        default:
          throw new CompileError(`Date hierarchy level [${node.level}] not supported`);
      }
    }
    if (node.table === null) {
      for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        const s = ctx.scopes[i]!;
        if (this.hasColumn(s.table, node.column)) return this.colRef(s.table, node.column, s.alias);
      }
      return this.measureRef(node.column, ctx);
    }
    const t = tkey(node.table);
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      const s = ctx.scopes[i]!;
      if (s.table === t) return this.colRef(t, node.column, s.alias);
    }
    if (!this.hasColumn(t, node.column) && this.catalog.measures?.has(node.column.toLowerCase())) {
      return this.measureRef(node.column, ctx);
    }
    throw new CompileError(
      `Column '${node.table}'[${node.column}] used outside a row context of '${node.table}' (needs an aggregation, RELATED or an iterator)`,
    );
  }

  /**
   * DAX comparison semantics: BLANK compares as the type's zero (0, "", 1899-12-30, FALSE), so
   * BLANK = BLANK, BLANK = 0 and BLANK = "" are TRUE and `BLANK <= 90` is TRUE — unlike SQL NULL.
   * Text compares case-insensitively.
   */
  private compare(op: string, l: Sql, r: Sql): Sql {
    if (op === '==') return { sql: `(${l.sql} <=> ${r.sql})`, kind: 'bool' };
    const sqlOp = op === '=' ? '=' : op;
    const textual = l.kind === 'string' || r.kind === 'string';
    if (textual) {
      const mixed = (l.kind === 'number') !== (r.kind === 'number');
      if (mixed && (op === '=' || op === '<>') && this.opts.mixedTypeCompare === 'number') {
        const num = (s: Sql) =>
          s.literal ? s.sql : `coalesce(${s.kind === 'number' ? s.sql : `TRY_CAST(${s.sql} AS DOUBLE)`}, 0)`;
        return { sql: `(${num(l)} ${sqlOp} ${num(r)})`, kind: 'bool' };
      }
      const str = (s: Sql) =>
        s.literal && s.kind === 'string'
          ? s.sql
          : `coalesce(${s.kind === 'string' ? s.sql : `CAST(${s.sql} AS STRING)`}, '')`;
      const fold = !noLetters(l) && !noLetters(r) && l.kind !== 'number' && r.kind !== 'number';
      const w = (s: Sql) => (fold ? `lower(${str(s)})` : str(s));
      return { sql: `(${w(l)} ${sqlOp} ${w(r)})`, kind: 'bool' };
    }
    const kind: Kind = l.kind !== 'unknown' ? l.kind : r.kind;
    if (kind === 'unknown') {
      // types unknown: at least make BLANK = BLANK hold for equality
      if (op === '=') return { sql: `(${l.sql} <=> ${r.sql})`, kind: 'bool' };
      if (op === '<>') return { sql: `(NOT (${l.sql} <=> ${r.sql}))`, kind: 'bool' };
      return { sql: `(${l.sql} ${sqlOp} ${r.sql})`, kind: 'bool' };
    }
    return { sql: `(${this.blankAs(l, kind)} ${sqlOp} ${this.blankAs(r, kind)})`, kind: 'bool' };
  }

  /** DAX BLANK → the zero value of `kind` (for comparisons). */
  private blankAs(s: Sql, kind: Kind): string {
    if (s.literal) return s.sql;
    switch (kind) {
      case 'number':
        return `coalesce(${s.sql}, 0)`;
      case 'date':
        return `coalesce(CAST(${s.sql} AS TIMESTAMP), TIMESTAMP'1899-12-30 00:00:00')`;
      case 'bool':
        return `coalesce(${s.sql}, FALSE)`;
      default:
        return s.sql;
    }
  }

  private binary(node: Extract<DaxNode, { k: 'bin' }>, ctx: Ctx): Sql {
    const op = node.op;
    if (op === 'IN') {
      const l = this.scalar(node.l, ctx);
      if (node.r.k !== 'list') {
        // x IN VALUES(T[c]) / DISTINCT(T[c]) under the current filter context
        const sel = this.tableExpr(node.r, ctx);
        if (sel.distinctCols?.length !== 1) {
          throw new CompileError('IN over a multi-column table expression not supported');
        }
        const col = sel.distinctCols[0]!;
        const sub = this.aggregate({ ...sel, distinctCols: undefined }, (alias) =>
          `DISTINCT ${this.colRef(sel.table, col, alias).sql}`,
        );
        return { sql: `(${l.sql} IN ${sub})`, kind: 'bool' };
      }
      const items = node.r.items.map((i) => this.scalar(i, ctx).sql);
      return { sql: `(${l.sql} IN (${items.join(', ')}))`, kind: 'bool' };
    }
    if (['=', '==', '<>', '<', '>', '<=', '>='].includes(op)) {
      if (op !== '==' && (isBlankCall(node.r) || isBlankCall(node.l))) {
        const other = this.scalar(isBlankCall(node.r) ? node.l : node.r, ctx);
        // DAX: x = BLANK() is also TRUE for 0 and "" (ISBLANK is the strict test)
        const isBlankish =
          other.kind === 'number'
            ? `(coalesce(${other.sql}, 0) = 0)`
            : other.kind === 'string'
              ? `(coalesce(${other.sql}, '') = '')`
              : `(${other.sql} IS NULL)`;
        if (op === '=') return { sql: isBlankish, kind: 'bool' };
        if (op === '<>') return { sql: `(NOT ${isBlankish})`, kind: 'bool' };
      }
      return this.compare(op, this.scalar(node.l, ctx), this.scalar(node.r, ctx));
    }
    if ((op === '+' || op === '-') && node.l.k === 'bin' && (node.l.op === '+' || node.l.op === '-')) {
      const chain = this.additiveChain(node, ctx);
      if (chain) return chain;
    }
    const l = this.scalar(node.l, ctx);
    const r = this.scalar(node.r, ctx);
    switch (op) {
      case '&&':
        return { sql: `(${l.sql} AND ${r.sql})`, kind: 'bool' };
      case '||':
        return { sql: `(${l.sql} OR ${r.sql})`, kind: 'bool' };
      case '&':
        return { sql: `concat(${this.text(l)}, ${this.text(r)})`, kind: 'string' };
      case '+':
      case '-': {
        if (l.kind === 'date' || r.kind === 'date') return this.dateArithmetic(op, this.shareOperand(l), this.shareOperand(r));
        const numeric = l.kind === 'number' || r.kind === 'number';
        if (!numeric) return { sql: `(${l.sql} ${op} ${r.sql})`, kind: 'unknown' };
        // DAX: BLANK behaves as 0 in + / - unless both operands are BLANK
        const ls = this.shareOperand(l);
        const rs = this.shareOperand(r);
        const lz = ls.literal ? ls.sql : `coalesce(${ls.sql}, 0)`;
        const rz = rs.literal ? rs.sql : `coalesce(${rs.sql}, 0)`;
        if (ls.literal || rs.literal) return { sql: `(${lz} ${op} ${rz})`, kind: 'number' };
        if (needsLinearBlankSum([ls, rs])) {
          return blankSum([
            { sign: '+', sql: ls },
            { sign: op as '+' | '-', sql: rs },
          ]);
        }
        return {
          sql: `(CASE WHEN ${ls.sql} IS NULL AND ${rs.sql} IS NULL THEN NULL ELSE ${lz} ${op} ${rz} END)`,
          kind: 'number',
        };
      }
      case '*':
        return { sql: `(${l.sql} * ${r.sql})`, kind: 'number' };
      case '/':
        return { sql: `try_divide(${l.sql}, ${r.sql})`, kind: 'number' };
      case '^':
        return { sql: `power(${l.sql}, ${r.sql})`, kind: 'number' };
      default:
        throw new CompileError(`Operator ${op} not supported`);
    }
  }

  /**
   * Numeric `a + b - c + …` as one expression. DAX evaluates left to right with BLANK as 0, and
   * the result is BLANK only when every term is BLANK — so the chain is exactly
   * `CASE WHEN coalesce(a, b, …) IS NULL THEN NULL ELSE coalesce(a,0) + coalesce(b,0) - … END`.
   * Size grows linearly; pairwise translation doubled the SQL with every term.
   * Returns null (caller falls back to pairwise) for date arithmetic or non-numeric chains.
   */
  private additiveChain(node: Extract<DaxNode, { k: 'bin' }>, ctx: Ctx): Sql | null {
    const terms: { sign: '+' | '-'; node: DaxNode }[] = [];
    const walk = (n: DaxNode, sign: '+' | '-') => {
      if (n.k === 'bin' && (n.op === '+' || n.op === '-')) {
        walk(n.l, sign);
        terms.push({ sign: n.op as '+' | '-', node: n.r });
      } else {
        terms.push({ sign, node: n });
      }
    };
    walk(node, '+');
    const compiled = terms.map((t) => ({ sign: t.sign, sql: this.scalar(t.node, ctx) }));
    if (compiled.some((t) => t.sql.kind === 'date')) return null;
    for (const t of compiled) t.sql = this.shareOperand(t.sql);
    if (!compiled.some((t) => t.sql.literal) && needsLinearBlankSum(compiled.map((t) => t.sql))) {
      return blankSum(compiled);
    }
    if (!compiled.some((t) => t.sql.kind === 'number')) return null;
    const body = compiled
      .map((t, i) => {
        const v = t.sql.literal ? t.sql.sql : `coalesce(${t.sql.sql}, 0)`;
        return i === 0 ? v : `${t.sign} ${v}`;
      })
      .join(' ');
    if (compiled.some((t) => t.sql.literal)) return { sql: `(${body})`, kind: 'number' };
    const allNull = `coalesce(${compiled.map((t) => t.sql.sql).join(', ')}) IS NULL`;
    return { sql: `(CASE WHEN ${allNull} THEN NULL ELSE ${body} END)`, kind: 'number' };
  }

  /**
   * DAX date arithmetic: date ± number adds days (fractions = time), date − date is a day
   * count, and BLANK behaves as day 0 (1899-12-30) unless both operands are BLANK.
   */
  private dateArithmetic(op: string, l: Sql, r: Sql): Sql {
    const zero = `TIMESTAMP'1899-12-30 00:00:00'`;
    const both = (expr: string) =>
      l.literal || r.literal ? expr : `(CASE WHEN ${l.sql} IS NULL AND ${r.sql} IS NULL THEN NULL ELSE ${expr} END)`;
    const ts = (s: Sql) => (s.literal ? s.sql : `coalesce(CAST(${s.sql} AS TIMESTAMP), ${zero})`);
    const days = (s: Sql) => (s.literal ? s.sql : `coalesce(${s.sql}, 0)`);
    const addDays = (t: Sql, n: string) =>
      `timestampadd(SECOND, CAST(round((${n}) * 86400) AS BIGINT), ${ts(t)})`;
    if (l.kind === 'date' && r.kind === 'date') {
      const diff = `(unix_timestamp(${ts(l)}) - unix_timestamp(${ts(r)})) / 86400.0`;
      return op === '-'
        ? { sql: both(diff), kind: 'number' }
        : { sql: both(`(unix_timestamp(${ts(l)}) + unix_timestamp(${ts(r)}) - 2 * unix_timestamp(${zero})) / 86400.0`), kind: 'number' };
    }
    if (l.kind === 'date') {
      return { sql: both(addDays(l, op === '-' ? `-${days(r)}` : days(r))), kind: 'date' };
    }
    if (op === '+') return { sql: both(addDays(r, days(l))), kind: 'date' };
    // number − date: DAX serial arithmetic → number of days
    return {
      sql: both(`(${days(l)} - (unix_timestamp(${ts(r)}) - unix_timestamp(${zero})) / 86400.0)`),
      kind: 'number',
    };
  }

  /** DAX text coercion: BLANK → "". */
  private text(s: Sql): string {
    if (s.literal && s.kind === 'string') return s.sql;
    return s.kind === 'string' ? `coalesce(${s.sql}, '')` : `coalesce(CAST(${s.sql} AS STRING), '')`;
  }

  private colArg(node: DaxNode | undefined, fn: string): { table: string; column: string } {
    if (node?.k === 'col' && node.table) return { table: tkey(node.table), column: node.column };
    throw new CompileError(`${fn} expects a 'Table'[Column] argument`);
  }

  private call(node: Extract<DaxNode, { k: 'call' }>, ctx: Ctx): Sql {
    const fn = node.fn;
    const args = node.args;
    const s = (i: number) => this.scalar(args[i]!, ctx);
    const opt = (i: number) => (args[i] && !(args[i]!.k === 'ref' && !(args[i] as { name: string }).name) ? s(i) : null);

    switch (fn) {
      // ---- column aggregations
      case 'SUM':
      case 'AVERAGE':
      case 'MIN':
      case 'MAX':
      case 'COUNT':
      case 'COUNTA':
      case 'COUNTBLANK':
      case 'DISTINCTCOUNT':
      case 'DISTINCTCOUNTNOBLANK': {
        if ((fn === 'MIN' || fn === 'MAX') && args.length === 2) {
          const a = s(0);
          const b = s(1);
          return { sql: `${fn === 'MIN' ? 'least' : 'greatest'}(${a.sql}, ${b.sql})`, kind: a.kind };
        }
        const { table, column } = this.colArg(args[0], fn);
        let kind: Kind = 'number';
        const colNode = args[0] as Extract<DaxNode, { k: 'col' }>;
        const sql = this.aggregate({ table, preds: [], all: false, ctx }, (alias, inner) => {
          // through the row scope so hierarchy levels ('T'[Date].[Year]) apply
          const c = colNode.level ? this.scalar(colNode, inner) : this.colRef(table, column, alias);
          if (fn === 'MIN' || fn === 'MAX') kind = c.kind;
          return this.aggExpr(fn, c);
        });
        return { sql, kind };
      }
      case 'SUMX':
      case 'AVERAGEX':
      case 'MINX':
      case 'MAXX':
      case 'COUNTX':
      case 'COUNTAX': {
        if (!args[0] || !args[1]) throw new CompileError(`${fn} needs a table and an expression`);
        const sel = this.tableExpr(args[0], ctx);
        let kind: Kind = 'number';
        const sql = this.aggregate(sel, (_alias, inner) => {
          const e = this.scalar(args[1]!, inner);
          if (fn === 'MINX' || fn === 'MAXX') kind = e.kind;
          const map: Record<string, string> = {
            SUMX: 'SUM',
            AVERAGEX: 'AVERAGE',
            MINX: 'MIN',
            MAXX: 'MAX',
            COUNTX: 'COUNT',
            COUNTAX: 'COUNT',
          };
          return this.aggExpr(map[fn]!, e);
        });
        return { sql, kind };
      }
      case 'COUNTROWS': {
        if (!args[0]) throw new CompileError('COUNTROWS() without a table not supported');
        const sel = this.tableExpr(args[0], ctx);
        return { sql: this.aggregate(sel, () => 'NULLIF(COUNT(*), 0)'), kind: 'number' };
      }
      case 'SELECTEDVALUE':
      case 'HASONEVALUE': {
        const { table, column } = this.colArg(args[0], fn);
        const alt = fn === 'SELECTEDVALUE' ? opt(1) : null;
        let kind: Kind = 'unknown';
        const sql = this.aggregate({ table, preds: [], all: false, ctx }, (alias) => {
          const c = this.colRef(table, column, alias);
          kind = c.kind;
          return fn === 'HASONEVALUE'
            ? `(COUNT(DISTINCT ${c.sql}) = 1)`
            : `CASE WHEN COUNT(DISTINCT ${c.sql}) = 1 THEN MAX(${c.sql}) ELSE ${alt?.sql ?? 'NULL'} END`;
        });
        return { sql, kind: fn === 'HASONEVALUE' ? 'bool' : kind };
      }
      case 'ISINSCOPE':
        // grand-total evaluation: no group-by is in scope
        return { sql: 'FALSE', kind: 'bool', literal: true };
      case 'HASONEFILTER': {
        const { table, column } = this.colArg(args[0], fn);
        const hit = ctx.filters.some(
          (p) => p.table === table && p.cols !== null && p.cols.includes(column.toLowerCase()),
        );
        return { sql: hit ? 'TRUE' : 'FALSE', kind: 'bool', literal: true };
      }
      case 'ERROR':
        return { sql: `raise_error(${s(0).sql})`, kind: 'unknown' };
      case 'IFERROR': {
        // SQL here uses error-free operators (try_divide / TRY_CAST); DAX errors become NULL.
        this.notes.push('IFERROR: fallback value applies only where SQL yields NULL from an error-free operator');
        return s(0);
      }
      case 'COMBINEVALUES': {
        const parts = args.slice(1).map((_, i) => this.text(s(i + 1)));
        return { sql: `concat_ws(${s(0).sql}, ${parts.join(', ')})`, kind: 'string' };
      }
      case 'WEEKNUM': {
        const d = s(0).sql;
        const type = args[1]?.k === 'num' ? Number(args[1].v) : 1;
        if (type === 21) return { sql: `weekofyear(${d})`, kind: 'number' };
        // first day of week as Spark dayofweek (1 = Sunday … 7 = Saturday)
        const start: Record<number, number> = { 1: 1, 17: 1, 2: 2, 11: 2, 12: 3, 13: 4, 14: 5, 15: 6, 16: 7 };
        const s0 = start[type];
        if (!s0) throw new CompileError(`WEEKNUM return type ${type} not supported`);
        return {
          sql: `(floor((dayofyear(${d}) - 1 + pmod(dayofweek(make_date(year(${d}), 1, 1)) - ${s0}, 7)) / 7) + 1)`,
          kind: 'number',
        };
      }
      case 'ISFILTERED': {
        const { table, column } = this.colArg(args[0], fn);
        const hit = ctx.filters.some(
          (p) => p.table === table && (p.cols === null || p.cols.includes(column.toLowerCase())),
        );
        return { sql: hit ? 'TRUE' : 'FALSE', kind: 'bool' };
      }
      case 'TOTALYTD': {
        if (!args[0] || !args[1]) throw new CompileError('TOTALYTD needs an expression and dates');
        return this.scalar(
          {
            k: 'call',
            fn: 'CALCULATE',
            args: [args[0], { k: 'call', fn: 'DATESYTD', args: [args[1]] }, ...args.slice(2, 3)],
          },
          ctx,
        );
      }
      case 'CALCULATE': {
        if (!args[0]) throw new CompileError('CALCULATE needs an expression');
        return this.scalar(args[0], this.applyFilterArgs(ctx, args.slice(1)));
      }
      case 'RELATED': {
        const { table, column } = this.colArg(args[0], fn);
        for (let i = ctx.scopes.length - 1; i >= 0; i--) {
          const sc = ctx.scopes[i]!;
          const rel = this.rels.find((r) => tkey(r.fromTable) === sc.table && tkey(r.toTable) === table);
          if (!rel) continue;
          const r = this.alias('r');
          const val = this.colRef(table, column, r);
          const pk = this.colRef(table, rel.toColumn, r).sql;
          const fk = this.colRef(sc.table, rel.fromColumn, sc.alias).sql;
          return {
            sql: `(SELECT MAX(${val.sql}) FROM ${this.table(table).latest} ${r} WHERE ${pk} = ${fk})`,
            kind: val.kind,
          };
        }
        throw new CompileError(`RELATED('${table}'…) has no many-to-one relationship from the row context`);
      }
      case 'LOOKUPVALUE': {
        const res = this.colArg(args[0], fn);
        const r = this.alias('r');
        const val = this.colRef(res.table, res.column, r);
        const conds: string[] = [];
        let i = 1;
        for (; i + 1 < args.length; i += 2) {
          const sc = this.colArg(args[i], fn);
          if (sc.table !== res.table) throw new CompileError('LOOKUPVALUE across tables not supported');
          conds.push(this.compare('=', this.colRef(sc.table, sc.column, r), s(i + 1)).sql);
        }
        const alt = i < args.length ? s(i) : null;
        const sub = `(SELECT MAX(${val.sql}) FROM ${this.table(res.table).latest} ${r}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''})`;
        return { sql: alt ? `coalesce(${sub}, ${alt.sql})` : sub, kind: val.kind };
      }
      case 'EARLIER':
      case 'EARLIEST': {
        const { table, column } = this.colArg(args[0], fn);
        const matches = ctx.scopes.filter((x) => x.table === table);
        const depth = fn === 'EARLIEST' ? matches.length - 1 : Number(args[1]?.k === 'num' ? args[1].v : 1);
        const sc = matches[matches.length - 1 - depth];
        if (!sc) throw new CompileError(`${fn} has no outer row context on '${table}'`);
        return this.colRef(table, column, sc.alias);
      }

      // ---- logic
      case 'IF':
      case 'IF.EAGER': {
        const c = s(0);
        const a = s(1);
        const b = opt(2);
        return { sql: `(CASE WHEN ${c.sql} THEN ${a.sql} ELSE ${b?.sql ?? 'NULL'} END)`, kind: a.kind === 'unknown' ? (b?.kind ?? 'unknown') : a.kind };
      }
      case 'SWITCH': {
        const subject = args[0]!;
        const isTrue = subject.k === 'call' && subject.fn === 'TRUE';
        const subj = isTrue ? null : s(0);
        const parts: string[] = [];
        let kind: Kind = 'unknown';
        let i = 1;
        for (; i + 1 < args.length; i += 2) {
          const v = s(i);
          const r = s(i + 1);
          if (kind === 'unknown') kind = r.kind;
          parts.push(`WHEN ${subj ? this.compare('=', subj, v).sql : v.sql} THEN ${r.sql}`);
        }
        const els = i < args.length ? s(i).sql : 'NULL';
        return { sql: `(CASE ${parts.join(' ')} ELSE ${els} END)`, kind };
      }
      case 'AND':
        return { sql: `(${s(0).sql} AND ${s(1).sql})`, kind: 'bool' };
      case 'OR':
        return { sql: `(${s(0).sql} OR ${s(1).sql})`, kind: 'bool' };
      case 'TRUE':
        return { sql: 'TRUE', kind: 'bool', literal: true };
      case 'FALSE':
        return { sql: 'FALSE', kind: 'bool', literal: true };
      case 'BLANK':
        return { sql: 'NULL', kind: 'unknown' };
      case 'ISBLANK':
        return { sql: `(${s(0).sql} IS NULL)`, kind: 'bool' };
      case 'COALESCE': {
        const parts = args.map((_, i) => s(i));
        return { sql: `coalesce(${parts.map((p) => p.sql).join(', ')})`, kind: parts[0]?.kind ?? 'unknown' };
      }
      case 'DIVIDE': {
        const a = s(0);
        const b = s(1);
        const alt = opt(2);
        return {
          sql: `(CASE WHEN ${b.sql} IS NULL OR ${b.sql} = 0 THEN ${alt?.sql ?? 'NULL'} ELSE ${a.sql} / ${b.sql} END)`,
          kind: 'number',
        };
      }

      // ---- math
      case 'ABS':
        return { sql: `abs(${s(0).sql})`, kind: 'number' };
      case 'ROUND':
        return { sql: `round(${s(0).sql}, ${opt(1)?.sql ?? '0'})`, kind: 'number' };
      case 'ROUNDUP':
        return { sql: `ceil(${s(0).sql}, ${opt(1)?.sql ?? '0'})`, kind: 'number' };
      case 'ROUNDDOWN':
      case 'TRUNC':
        return { sql: `(CASE WHEN ${s(0).sql} < 0 THEN ceil(${s(0).sql}, ${opt(1)?.sql ?? '0'}) ELSE floor(${s(0).sql}, ${opt(1)?.sql ?? '0'}) END)`, kind: 'number' };
      case 'INT':
        return { sql: `floor(${s(0).sql})`, kind: 'number' };
      case 'MOD': {
        // differential-tested: result takes the divisor's sign (MOD(1, -3) = -2), like Excel
        const a = s(0).sql;
        const b = s(1).sql;
        return { sql: `(${a} - ${b} * floor(${a} / ${b}))`, kind: 'number' };
      }
      case 'POWER':
        return { sql: `power(${s(0).sql}, ${s(1).sql})`, kind: 'number' };
      case 'SQRT':
        return { sql: `sqrt(${s(0).sql})`, kind: 'number' };
      case 'VALUE':
        return { sql: `TRY_CAST(${s(0).sql} AS DOUBLE)`, kind: 'number' };

      // ---- dates
      case 'TODAY':
        return { sql: 'current_date()', kind: 'date' };
      case 'NOW':
      case 'UTCNOW':
        return { sql: 'current_timestamp()', kind: 'date' };
      case 'UTCTODAY':
        return { sql: 'current_date()', kind: 'date' };
      case 'DATE':
        return { sql: `make_date(${s(0).sql}, ${s(1).sql}, ${s(2).sql})`, kind: 'date' };
      case 'DATEVALUE':
        return { sql: `TRY_CAST(${s(0).sql} AS DATE)`, kind: 'date' };
      case 'YEAR':
      case 'MONTH':
      case 'DAY':
      case 'HOUR':
      case 'MINUTE':
      case 'SECOND':
      case 'QUARTER':
        return { sql: `${fn.toLowerCase()}(${s(0).sql})`, kind: 'number' };
      case 'WEEKDAY':
        return { sql: `dayofweek(${s(0).sql})`, kind: 'number' };
      case 'EDATE':
        return { sql: `add_months(${s(0).sql}, ${s(1).sql})`, kind: 'date' };
      case 'EOMONTH':
        return { sql: `last_day(add_months(${s(0).sql}, ${s(1).sql}))`, kind: 'date' };
      case 'DATEDIFF': {
        const a = s(0).sql;
        const b = s(1).sql;
        const unitNode = args[2];
        const unit = unitNode?.k === 'ref' ? unitNode.name.toUpperCase() : '';
        if (!DATEDIFF_UNITS.has(unit)) throw new CompileError(`DATEDIFF unit ${unit || '?'} not supported`);
        // DAX counts interval boundaries crossed between start and end
        const ut = (x: string, div: number) => `floor(unix_timestamp(${x}) / ${div})`;
        const sql: Record<string, string> = {
          SECOND: `(unix_timestamp(${b}) - unix_timestamp(${a}))`,
          MINUTE: `(${ut(b, 60)} - ${ut(a, 60)})`,
          HOUR: `(${ut(b, 3600)} - ${ut(a, 3600)})`,
          DAY: `datediff(CAST(${b} AS DATE), CAST(${a} AS DATE))`,
          WEEK: `(floor(datediff(CAST(${b} AS DATE), DATE'1899-12-31') / 7) - floor(datediff(CAST(${a} AS DATE), DATE'1899-12-31') / 7))`,
          MONTH: `((year(${b}) * 12 + month(${b})) - (year(${a}) * 12 + month(${a})))`,
          QUARTER: `((year(${b}) * 4 + quarter(${b})) - (year(${a}) * 4 + quarter(${a})))`,
          YEAR: `(year(${b}) - year(${a}))`,
        };
        return { sql: sql[unit]!, kind: 'number' };
      }

      // ---- text
      case 'TRIM':
        // DAX TRIM also collapses internal runs of spaces
        return { sql: `regexp_replace(trim(${this.text(s(0))}), ' {2,}', ' ')`, kind: 'string' };
      case 'UPPER':
        return { sql: `upper(${this.text(s(0))})`, kind: 'string' };
      case 'LOWER':
        return { sql: `lower(${this.text(s(0))})`, kind: 'string' };
      case 'LEN':
        // differential-tested: LEN(BLANK) is BLANK (not 0); LEN("") is 0
        return { sql: `length(${s(0).kind === 'string' ? s(0).sql : `CAST(${s(0).sql} AS STRING)`})`, kind: 'number' };
      case 'LEFT':
        return { sql: `left(${this.text(s(0))}, ${opt(1)?.sql ?? '1'})`, kind: 'string' };
      case 'RIGHT':
        return { sql: `right(${this.text(s(0))}, ${opt(1)?.sql ?? '1'})`, kind: 'string' };
      case 'MID':
        return { sql: `substring(${this.text(s(0))}, ${s(1).sql}, ${s(2).sql})`, kind: 'string' };
      case 'SUBSTITUTE':
        return { sql: `replace(${this.text(s(0))}, ${s(1).sql}, ${s(2).sql})`, kind: 'string' };
      case 'CONCATENATE':
        return { sql: `concat(${this.text(s(0))}, ${this.text(s(1))})`, kind: 'string' };
      case 'CONTAINSSTRING': {
        // differential-tested: an empty / BLANK within_text never contains anything (even "")
        const within = this.text(s(0));
        return {
          sql: `(length(${within}) > 0 AND instr(lower(${within}), lower(${this.text(s(1))})) > 0)`,
          kind: 'bool',
        };
      }
      case 'SEARCH': {
        const pos = `instr(lower(${this.text(s(1))}), lower(${this.text(s(0))}))`;
        const nf = opt(3);
        return { sql: nf ? `(CASE WHEN ${pos} = 0 THEN ${nf.sql} ELSE ${pos} END)` : pos, kind: 'number' };
      }
      case 'FORMAT': {
        const fmt = args[1];
        if (fmt?.k !== 'str') throw new CompileError('FORMAT needs a literal format string');
        return formatSql(s(0), fmt.v);
      }
      default: {
        const rule = this.catalog.rules?.get(ruleKey('dax_fn', fn, args.length));
        if (rule) {
          return { sql: renderTemplate(rule.sqlTemplate, args.map((_, i) => s(i).sql)), kind: rule.resultKind };
        }
        throw new CompileError(`DAX function ${fn} not supported`, {
          kind: 'dax_fn',
          name: fn,
          arity: args.length,
        });
      }
    }
  }

  private aggExpr(fn: string, c: Sql): string {
    const distinctVal = c.kind === 'string' ? `lower(${c.sql})` : c.sql;
    switch (fn) {
      case 'SUM':
        return `SUM(${c.sql})`;
      case 'AVERAGE':
        return `AVG(${c.sql})`;
      case 'MIN':
        return `MIN(${c.sql})`;
      case 'MAX':
        return `MAX(${c.sql})`;
      case 'COUNT':
      case 'COUNTA':
        return `NULLIF(COUNT(${c.sql}), 0)`;
      case 'COUNTBLANK':
        return `NULLIF(SUM(CASE WHEN ${c.sql} IS NULL THEN 1 ELSE 0 END), 0)`;
      case 'DISTINCTCOUNT':
        // DAX counts BLANK as one distinct value; text compares case-insensitively
        return `NULLIF(COUNT(DISTINCT ${distinctVal}) + MAX(CASE WHEN ${c.sql} IS NULL THEN 1 ELSE 0 END), 0)`;
      case 'DISTINCTCOUNTNOBLANK':
        return `NULLIF(COUNT(DISTINCT ${distinctVal}), 0)`;
      default:
        throw new CompileError(`Aggregation ${fn} not supported`);
    }
  }

  // ---------------------------------------------------------------- entry

  compileMeasure(dax: string): DaxCompileSuccess {
    if (!dax.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(\/\/|--).*$/gm, '').trim()) {
      throw new CompileError('Measure DAX is empty or fully commented out');
    }
    let ast: DaxNode;
    try {
      ast = parseDax(dax);
    } catch (e) {
      throw new CompileError(`Cannot parse measure DAX: ${(e as Error).message}`);
    }
    ast = this.stripPresentationFormat(ast);
    const ctx: Ctx = { scopes: [], filters: [], transitions: [], env: new Map() };
    const value = this.scalar(ast, ctx);
    const ctes = this.ctes.map((c) => `${c.name} AS (\n  ${c.build()}\n)`);
    const warnings: string[] = [];
    for (const t of this.tables.values()) {
      const keys = t.lineage.dedupe?.keySql;
      if (!keys) continue;
      const nonKey = [...t.baseCols.values()].filter((c) => !keys.includes(c.expr.sql)).map((c) => c.name);
      if (nonKey.length) {
        warnings.push(
          `'${t.name}': Power Query Table.Distinct keeps the first row per key in source order; this measure reads non-key columns [${nonKey.join(', ')}], so Power BI's own value depends on Databricks row order`,
        );
      }
    }
    const select = `SELECT ${value.sql} AS value`;
    const sql = ctes.length ? `WITH ${ctes.join(',\n')}\n${select}` : select;
    return {
      ok: true,
      sql,
      tables: [...this.tables.values()].map((t) => t.name),
      calc_columns: [...this.calcColumns],
      measures_inlined: [...this.measuresInlined],
      notes: [...new Set(this.notes)],
      source_aliases: Object.fromEntries([...this.tables.values()].map((t) => [t.srcAlias, t.key])),
      warnings,
      result_kind: value.kind,
    };
  }

  /** Compile DAX row expressions evaluated in the row context of `tableName` (one column each). */
  compileRows(tableName: string, exprs: string[], idColumn: string | null): string {
    const st = this.table(tableName);
    const ctx: Ctx = { scopes: [{ table: st.key, alias: 'cur' }], filters: [], transitions: [], env: new Map() };
    const id = idColumn ? this.colRef(st.key, idColumn, 'cur').sql : null;
    const cols = exprs.map((e, i) => {
      let ast: DaxNode;
      try {
        ast = parseDax(e);
      } catch (err) {
        throw new CompileError(`Cannot parse row expression ${i}: ${(err as Error).message}`);
      }
      return `${this.scalar(ast, ctx).sql} AS ${q(`r${i}`)}`;
    });
    const ctes = this.ctes.map((c) => `${c.name} AS (\n  ${c.build()}\n)`);
    const select = `SELECT ${id ? `${id} AS ${q(idColumn!)}, ` : ''}${cols.join(', ')}\nFROM ${st.latest} cur`;
    return ctes.length ? `WITH ${ctes.join(',\n')}\n${select}` : select;
  }

  /**
   * Top-level `FORMAT(x, "0.00") & " days"` is presentation: parity compares numbers,
   * so emit ROUND(x, decimals) instead of text.
   */
  private stripPresentationFormat(node: DaxNode): DaxNode {
    if (node.k === 'var') return { ...node, body: this.stripPresentationFormat(node.body) };
    if (node.k === 'bin' && node.op === '&') {
      if (node.r.k === 'str') {
        const inner = this.stripPresentationFormat(node.l);
        if (inner !== node.l) return inner;
      }
      if (node.l.k === 'str') {
        const inner = this.stripPresentationFormat(node.r);
        if (inner !== node.r) return inner;
      }
      return node;
    }
    if (node.k === 'call' && node.fn === 'FORMAT' && node.args[1]?.k === 'str') {
      const m = node.args[1].v.trim().match(/^[#,0]*0(?:\.(0+))?$/);
      if (m && node.args[0]) {
        this.notes.push('Presentation FORMAT dropped; value rounded for parity');
        return { k: 'call', fn: 'ROUND', args: [node.args[0], { k: 'num', v: String(m[1]?.length ?? 0) }] };
      }
    }
    return node;
  }
}

/** Row-level compile used by the differential test harness (built-ins and registry rules). */
export function compileRowExpressionsToSql(input: {
  tableName: string;
  exprs: string[];
  idColumn: string | null;
  catalog: MeasureLogicCatalog;
}): { ok: true; sql: string } | DaxCompileFailure {
  const c = new Compiler(input.catalog, {});
  try {
    return { ok: true, sql: c.compileRows(input.tableName, input.exprs, input.idColumn) };
  } catch (e) {
    if (e instanceof CompileError) {
      return { ok: false, reason: e.message, notes: [...new Set(c.notes)], ...(e.gap ? { gap: e.gap } : {}) };
    }
    throw e;
  }
}

export function compileMeasureToSql(input: {
  measureDax: string;
  catalog: MeasureLogicCatalog;
  options?: DaxCompileOptions;
}): DaxCompileResult {
  const c = new Compiler(input.catalog, input.options ?? {});
  try {
    return c.compileMeasure(input.measureDax);
  } catch (e) {
    if (e instanceof CompileError) {
      return { ok: false, reason: e.message, notes: [...new Set(c.notes)], ...(e.gap ? { gap: e.gap } : {}) };
    }
    throw e;
  }
}

/** A column of `table` that is the unique side of one of `rels` (cardinality-aware). */
function uniqueColumnOf(rels: CompileRelationship[], table: string): string | null {
  for (const r of rels) {
    if (toSideUnique(r) && tkey(r.toTable) === table) return r.toColumn;
    if (fromSideUnique(r) && tkey(r.fromTable) === table) return r.fromColumn;
  }
  return null;
}
