/**
 * Differential testing of DAX function translations: Power BI evaluates the function on
 * generated edge-case inputs (`EVALUATE ADDCOLUMNS(DATATABLE(…), …)` — no model data
 * involved) and Databricks evaluates the compiler's SQL for the same rows. A translation is
 * accepted only when every row matches. Pure — building queries and comparing results.
 */

import { compileRowExpressionsToSql } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import type { RuleSet } from '@/lib/powerbi/rule-registry';

export type ArgKind = 'number' | 'int' | 'date' | 'string' | 'bool';

/** One argument of the function under test. `literals` = inline constants (raw DAX tokens). */
export type ArgSpec = { kind: ArgKind; literals?: string[] };

export type FunctionTestSpec = { name: string; args: ArgSpec[] };

const EDGE_VALUES: Record<ArgKind, (string | null)[]> = {
  number: ['0', '1', '-1', '2.5', '-2.5', '0.125', '1000000', null],
  int: ['0', '1', '-1', '7', '100', null],
  date: ['2024-01-01', '2024-02-29', '2024-12-31', '2025-01-01', '2026-01-04', '2027-01-01', '2028-02-29', '1999-12-31', null],
  string: ['abc', '  Hello   World ', '', 'MiXeD Case', 'a,b,c', null],
  bool: ['TRUE', 'FALSE', null],
};

const DAX_TYPE: Record<ArgKind, string> = {
  number: 'DOUBLE',
  int: 'INTEGER',
  date: 'DATETIME',
  string: 'STRING',
  bool: 'BOOLEAN',
};

export const DIFFTEST_TABLE = '__difftest';
const ID = '__id';

function daxLiteral(kind: ArgKind, v: string | null): string {
  if (v === null) return 'BLANK()';
  if (kind === 'string' || kind === 'date') return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export type DiffTestPlan = {
  spec: FunctionTestSpec;
  /** Column-argument indexes (non-literal args) in DATATABLE order. */
  columnArgs: number[];
  rows: { id: number; values: (string | null)[] }[];
  /** One combination of literal tokens per result column r0, r1, … */
  literalCombos: string[][];
  datatableDax: string;
  powerBiQuery: string;
  /** DAX row expressions (over the DIFFTEST_TABLE) the compiler turns into SQL. */
  rowExpressions: string[];
};

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])), [[]]);
}

/** Deterministic row generation; when the full product is too large every value still appears. */
export function buildDiffTestPlan(input: FunctionTestSpec, maxRows = 64, maxCombos = 12): DiffTestPlan {
  // An empty `literals` list (what the LLM returns for a free argument) means "varies", not
  // "constant with no values". Treating it as a constant gave zero combinations and an ADDCOLUMNS
  // with no columns (found 2026-11-16, CEILING synthesis).
  const spec: FunctionTestSpec = {
    ...input,
    args: input.args.map((a) => (a.literals?.length ? a : { kind: a.kind })),
  };
  const columnArgs = spec.args.map((a, i) => (a.literals ? -1 : i)).filter((i) => i >= 0);
  const valueLists = columnArgs.map((i) => EDGE_VALUES[spec.args[i]!.kind]);
  let tuples: (string | null)[][];
  const full = valueLists.reduce((n, l) => n * l.length, 1);
  if (valueLists.length === 0) {
    tuples = [[]];
  } else if (full <= maxRows) {
    tuples = cartesian(valueLists);
  } else {
    const strides = [1, 3, 5, 7, 11, 13];
    tuples = Array.from({ length: maxRows }, (_, r) =>
      valueLists.map((l, j) => l[(r * strides[j % strides.length]! + j) % l.length]!),
    );
  }
  const rows = tuples.map((values, i) => ({ id: i + 1, values }));

  const literalLists = spec.args.map((a) => a.literals ?? []);
  const literalArgs = spec.args.map((a, i) => (a.literals ? i : -1)).filter((i) => i >= 0);
  const literalCombos = literalArgs.length
    ? cartesian(literalArgs.map((i) => literalLists[i]!)).slice(0, maxCombos)
    : [[]];

  const colDefs = [`"${ID}", INTEGER`, ...columnArgs.map((i) => `"a${i}", ${DAX_TYPE[spec.args[i]!.kind]}`)];
  const dataRows = rows.map(
    (r) => `{${[String(r.id), ...r.values.map((v, j) => daxLiteral(spec.args[columnArgs[j]!]!.kind, v))].join(', ')}}`,
  );
  const datatableDax = `DATATABLE(${colDefs.join(', ')}, {${dataRows.join(', ')}})`;

  const call = (colRef: (i: number) => string, combo: string[]) => {
    let li = 0;
    const args = spec.args.map((a, i) => (a.literals ? combo[li++]! : colRef(i)));
    return `${spec.name}(${args.join(', ')})`;
  };
  // Power BI fails the whole query on one bad input (e.g. CEILING with mixed signs), so each result
  // is wrapped: the value becomes BLANK on error and an error flag marks the row as not comparable.
  const pbiCols = literalCombos.flatMap((combo, k) => {
    const expr = call((i) => `[a${i}]`, combo);
    return [`"r${k}", IFERROR(${expr}, BLANK())`, `"e${k}", ISERROR(${expr})`];
  });
  const powerBiQuery = `EVALUATE ADDCOLUMNS(${datatableDax}, ${pbiCols.join(', ')})`;
  const rowExpressions = literalCombos.map((combo) => call((i) => `'${DIFFTEST_TABLE}'[a${i}]`, combo));

  return { spec, columnArgs, rows, literalCombos, datatableDax, powerBiQuery, rowExpressions };
}

/** Compile the plan's row expressions with the real compiler (built-ins + registry rules). */
export function compileDiffTestSql(plan: DiffTestPlan, rules?: RuleSet): { ok: true; sql: string } | { ok: false; reason: string } {
  const catalog: MeasureLogicCatalog = {
    columnsByTable: new Map(),
    tableMeta: new Map([
      [DIFFTEST_TABLE, { displayName: DIFFTEST_TABLE, uc_full_path: null, source_m: plan.datatableDax }],
    ]),
    measures: new Map(),
    relationships: [],
    rules,
  };
  const out = compileRowExpressionsToSql({
    tableName: DIFFTEST_TABLE,
    exprs: plan.rowExpressions,
    idColumn: ID,
    catalog,
  });
  return out.ok ? out : { ok: false, reason: out.reason };
}

// ---------------------------------------------------------------- comparison

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v === '');
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return null;
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function asDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(DATE_RE);
  return m ? `${m[1]}T${m[2] ?? '00:00'}:${m[3] ?? '00'}` : null;
}

/** Strict value equality (functions must match exactly; numbers to 1e-9 relative). */
export function valuesMatch(pbi: unknown, sql: unknown): boolean {
  if (isBlank(pbi) && isBlank(sql)) return true;
  if (isBlank(pbi) || isBlank(sql)) return false;
  const pb = asBool(pbi);
  const sb = asBool(sql);
  if (pb !== null && sb !== null) return pb === sb;
  const pn = asNumber(pbi);
  const sn = asNumber(sql);
  if (pn !== null && sn !== null) return Math.abs(pn - sn) <= 1e-9 * Math.max(1, Math.abs(pn), Math.abs(sn));
  const pd = asDate(pbi);
  const sd = asDate(sql);
  if (pd && sd) return pd === sd;
  return String(pbi) === String(sql);
}

export type DiffTestMismatch = {
  inputs: (string | null)[];
  literals: string[];
  powerBi: unknown;
  sql: unknown;
};

export type DiffTestResult = {
  name: string;
  pass: boolean;
  compared: number;
  mismatches: DiffTestMismatch[];
  /** Input combinations where Power BI itself raises an error; excluded from the comparison. */
  powerBiErrors?: number;
  error?: string;
};

export function compareDiffTest(
  plan: DiffTestPlan,
  powerBiRows: Record<string, unknown>[],
  sqlRows: Record<string, unknown>[],
): DiffTestResult {
  const byIdPbi = new Map(powerBiRows.map((r) => [Number(r[`[${ID}]`] ?? r[ID]), r]));
  const byIdSql = new Map(sqlRows.map((r) => [Number(r[ID]), r]));
  const mismatches: DiffTestMismatch[] = [];
  let compared = 0;
  let powerBiErrors = 0;
  for (const row of plan.rows) {
    const p = byIdPbi.get(row.id);
    const s = byIdSql.get(row.id);
    plan.literalCombos.forEach((combo, k) => {
      // Power BI raised an error for this input: the function's result is undefined here, so
      // there is nothing to compare. Every other row still has to match.
      if (p && asBool(p[`[e${k}]`] ?? p[`e${k}`]) === true) {
        powerBiErrors += 1;
        return;
      }
      compared += 1;
      const pv = p ? (p[`[r${k}]`] ?? p[`r${k}`] ?? null) : undefined;
      const sv = s ? (s[`r${k}`] ?? null) : undefined;
      if (pv === undefined || sv === undefined || !valuesMatch(pv, sv)) {
        mismatches.push({
          inputs: row.values,
          literals: combo,
          powerBi: pv === undefined ? '(missing row)' : pv,
          sql: sv === undefined ? '(missing row)' : sv,
        });
      }
    });
  }
  // A test where Power BI errored on every input compared nothing and proves nothing.
  return {
    name: plan.spec.name,
    pass: mismatches.length === 0 && compared > 0,
    compared,
    mismatches,
    powerBiErrors,
    ...(compared === 0 ? { error: 'no input could be compared: Power BI errored on every case' } : {}),
  };
}
