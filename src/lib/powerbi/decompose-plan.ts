/**
 * L5 differential decomposition — planning (Architecture v2, Phase 3). Pure.
 *
 * For a measure whose SQL value differs from Power BI, list the parts to evaluate on BOTH sides,
 * ordered from inputs to outputs so the first part that differs is the most upstream cause:
 *   1. row counts of the tables in the measure's dependency closure   COUNTROWS('T')
 *   2. distinct-value counts of the columns it iterates               COUNTROWS(VALUES('T'[c]))
 *      (catches the relationship blank row and key mismatches)
 *   3. the measures it calls, deepest first                           [M]
 *   4. each VAR of the measure, with the VARs before it kept          VAR a = … RETURN a
 * Every probe is plain DAX: Power BI evaluates it directly, the compiler turns it into SQL.
 */

import { parseDax, type DaxNode } from '@/lib/powerbi/dax-parse';
import { daxColumn, daxTable, printDax } from '@/lib/powerbi/dax-print';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { type ModelGraph, measureNodeId } from '@/lib/powerbi/model-graph';
import { decideTypedParity } from '@/lib/powerbi/parity-compare';

export type ProbeKind = 'row_count' | 'distinct_values' | 'measure' | 'var';

export type Probe = {
  id: string;
  kind: ProbeKind;
  /** Human label, e.g. "Rows in 'PSC'" or "[Base Count]". */
  label: string;
  dax: string;
};

export const PROBE_LIMITS: Record<ProbeKind, number> = { row_count: 8, distinct_values: 8, measure: 12, var: 10 };

const ITERATED_FNS = new Set(['VALUES', 'DISTINCT', 'ALL', 'ALLNOBLANKROW', 'FILTERS']);

function walk(node: DaxNode, visit: (n: DaxNode) => void): void {
  visit(node);
  switch (node.k) {
    case 'call':
      node.args.forEach((a) => walk(a, visit));
      break;
    case 'bin':
      walk(node.l, visit);
      walk(node.r, visit);
      break;
    case 'un':
      walk(node.e, visit);
      break;
    case 'list':
      node.items.forEach((a) => walk(a, visit));
      break;
    case 'var':
      node.decls.forEach((d) => walk(d.e, visit));
      walk(node.body, visit);
      break;
    default:
      break;
  }
}

function safeParse(dax: string): DaxNode | null {
  try {
    return parseDax(dax);
  } catch {
    return null;
  }
}

export function planDecomposition(input: {
  measure: string;
  catalog: MeasureLogicCatalog;
  graph: ModelGraph;
}): Probe[] {
  const { catalog, graph } = input;
  const focus = measureNodeId(input.measure);
  const focusNode = graph.nodes.get(focus);
  if (!focusNode) return [];
  const closure = graph.closure(focus);

  // 1. tables in the closure (warehouse-backed or calculated)
  const rowProbes: Probe[] = [];
  for (const id of closure) {
    const n = graph.nodes.get(id);
    if (!n || (n.kind !== 'table' && n.kind !== 'calc_table')) continue;
    rowProbes.push({ id: `rows:${id}`, kind: 'row_count', label: `Rows in ${daxTable(n.name)}`, dax: `COUNTROWS(${daxTable(n.name)})` });
  }

  // measures in the closure, deepest first (dependency depth from the leaves)
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let d = 0;
    for (const dep of graph.nodes.get(id)?.deps ?? []) {
      if (graph.nodes.get(dep)?.kind === 'measure') d = Math.max(d, depthOf(dep, seen) + 1);
    }
    depth.set(id, d);
    return d;
  };
  const measureIds = [...closure].filter((id) => id !== focus && graph.nodes.get(id)?.kind === 'measure');
  measureIds.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));

  // 2. columns iterated by VALUES/DISTINCT/ALL in the measure or any measure it calls
  const distinct = new Map<string, Probe>();
  for (const id of [focus, ...measureIds]) {
    const def = catalog.measures?.get(graph.nodes.get(id)!.name.toLowerCase());
    const ast = def ? safeParse(def.dax) : null;
    if (!ast) continue;
    walk(ast, (n) => {
      if (n.k !== 'call' || !ITERATED_FNS.has(n.fn.toUpperCase())) return;
      const arg = n.args[0];
      if (arg?.k !== 'col' || !arg.table) return;
      const key = `${arg.table.toLowerCase()}[${arg.column.toLowerCase()}]`;
      if (!distinct.has(key)) {
        const col = daxColumn(arg.table, arg.column);
        distinct.set(key, { id: `distinct:${key}`, kind: 'distinct_values', label: `Distinct ${col}`, dax: `COUNTROWS(VALUES(${col}))` });
      }
    });
  }

  // 3. called measures
  const measureProbes: Probe[] = measureIds.map((id) => {
    const name = graph.nodes.get(id)!.name;
    return { id: `measure:${id}`, kind: 'measure', label: daxColumn(null, name), dax: daxColumn(null, name) };
  });

  // 4. VARs of the measure itself
  const varProbes: Probe[] = [];
  const own = catalog.measures?.get(focusNode.name.toLowerCase());
  const ast = own ? safeParse(own.dax) : null;
  if (ast?.k === 'var') {
    ast.decls.forEach((d, i) => {
      const dax = printDax({ k: 'var', decls: ast.decls.slice(0, i + 1), body: { k: 'ref', name: d.name } });
      varProbes.push({ id: `var:${d.name}`, kind: 'var', label: `VAR ${d.name}`, dax });
    });
  }

  return [
    ...rowProbes.slice(0, PROBE_LIMITS.row_count),
    ...[...distinct.values()].slice(0, PROBE_LIMITS.distinct_values),
    ...measureProbes.slice(0, PROBE_LIMITS.measure),
    ...varProbes.slice(0, PROBE_LIMITS.var),
  ];
}

export type ProbeResult = Probe & {
  pbi: unknown;
  sql: unknown;
  /** match | differ | pbi_error (not a scalar / not evaluable in Power BI) | sql_error (did not compile or run). */
  status: 'match' | 'differ' | 'pbi_error' | 'sql_error';
  error?: string;
};

/** Counts must match exactly (one missing row is the finding); values use typed parity tolerance. */
export function probeMatches(p: Pick<Probe, 'kind'>, pbi: unknown, sql: unknown): boolean {
  if (p.kind === 'row_count' || p.kind === 'distinct_values') {
    const a = Number(pbi ?? 0);
    const b = Number(sql ?? 0);
    if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  }
  return decideTypedParity({ oracle: { present: true, raw: pbi }, sql: { present: true, raw: sql } }).verdict === 'pass';
}

/** First differing probe in plan order (most upstream) plus a one-line conclusion. */
export function concludeDecomposition(results: ProbeResult[]): {
  first_difference: ProbeResult | null;
  differing: string[];
  conclusion: string;
} {
  const differing = results.filter((r) => r.status === 'differ');
  const first = differing[0] ?? null;
  const fmt = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v ?? 'BLANK');
  };
  if (!first) {
    const evaluated = results.filter((r) => r.status === 'match').length;
    return {
      first_difference: null,
      differing: [],
      conclusion: evaluated
        ? `All ${evaluated} evaluated parts match — the difference is in the measure's own top-level expression (filter context or final arithmetic)`
        : 'No part could be evaluated on both sides',
    };
  }
  const hint: Record<ProbeKind, string> = {
    row_count: 'table rows differ: Power Query filters, lineage or refresh differ',
    distinct_values: 'distinct values differ: relationship blank row, key type or orphan keys',
    measure: 'this called measure already differs — investigate it first',
    var: 'this VAR is the first step that differs',
  };
  return {
    first_difference: first,
    differing: differing.map((d) => d.label),
    conclusion: `First difference: ${first.label} — Power BI ${fmt(first.pbi)}, SQL ${fmt(first.sql)} (${hint[first.kind]})`,
  };
}
