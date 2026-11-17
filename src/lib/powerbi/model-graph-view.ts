/**
 * UI views over the L1 model graph + L0 fidelity report (Estate → Power BI → model).
 *
 * - measureSubgraph: one measure's dependency chain, from the external source through every
 *   Power Query step and warehouse column, calculated columns and measures, out to reports
 *   that name the measure. Fidelity issues and recreation status sit on the same nodes.
 * - modelGraphSummary: node counts, source systems and every blocking issue with the measures
 *   it blocks.
 * Pure: built from the catalog, graph and report.
 */

import type { FidelityIssue, FidelityReport, SourceSystem } from '@/lib/powerbi/fidelity-gate';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { type GraphNodeKind, type ModelGraph, measureNodeId, tableNodeId } from '@/lib/powerbi/model-graph';
import { describeOrigin, describeSourceOrigins, originTitle } from '@/lib/powerbi/source-origin';

export type MeasureStatus = 'recreated' | 'sql' | 'blocked' | 'no_sql';

export type GraphViewNode = {
  id: string;
  kind: GraphNodeKind | 'warehouse' | 'source' | 'pq_step' | 'report';
  label: string;
  table: string | null;
  /** DAX (measure / calc column / calc table), PQ expression or warehouse object. */
  detail: {
    code?: string;
    source_column?: string;
    lineage_sql?: string;
    uc?: string | null;
    data_type?: string | null;
    /** Plain-language source, step, or report note. */
    summary?: string;
  };
  issues: Pick<FidelityIssue, 'kind' | 'severity' | 'detail' | 'suggestion'>[];
  status: MeasureStatus | null;
};

/** A report harvested for this model. `measures` are the measure names its visuals reference. */
export type ReportConsumer = { id: string; name: string; measures: string[] };

export type GraphViewEdge = { from: string; to: string };

export type MeasureSubgraph = {
  focus: string;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  truncated: boolean;
};

export type ModelGraphSummary = {
  counts: Partial<Record<GraphNodeKind, number>>;
  sources: Partial<Record<SourceSystem, number>>;
  issues: (FidelityIssue & { measures: string[] })[];
  blocked: number;
  warnings: number;
  gate_version: string;
};

const tableKeyOf = (id: string) => id.slice(2).split('/')[0]!;

export function measureSubgraph(input: {
  catalog: MeasureLogicCatalog;
  graph: ModelGraph;
  report: FidelityReport;
  measure: string;
  status?: Map<string, MeasureStatus>;
  /** Reports on this model. Only those whose visuals name `measure` are drawn, downstream of it. */
  reports?: ReportConsumer[];
  maxNodes?: number;
}): MeasureSubgraph | null {
  const { catalog, graph, report } = input;
  const focus = measureNodeId(input.measure);
  if (!graph.nodes.has(focus)) return null;
  const maxNodes = input.maxNodes ?? 220;

  const issuesByNode = new Map<string, FidelityIssue[]>();
  for (const iss of report.issues) {
    const list = issuesByNode.get(iss.node) ?? [];
    list.push(iss);
    issuesByNode.set(iss.node, list);
  }
  const lineageByTable = new Map<string, ReturnType<typeof parseMLineage> | null>();
  const lineageOf = (tk: string) => {
    if (!lineageByTable.has(tk)) {
      const meta = catalog.tableMeta.get(tk);
      lineageByTable.set(tk, meta?.uc_full_path && meta.source_m ? parseMLineage(meta.source_m, catalog.rules, { culture: catalog.queryCulture }) : null);
    }
    return lineageByTable.get(tk)!;
  };

  const nodes: GraphViewNode[] = [];
  const edges: GraphViewEdge[] = [];
  const shown = new Set<string>();
  let truncated = false;

  // Plain tables are context, not logic: shown only when they carry an issue (e.g. a drifted
  // row filter). Calculated tables are logic and always shown.
  const visible = (id: string) => {
    const n = graph.nodes.get(id);
    if (!n) return false;
    return n.kind !== 'table' || (issuesByNode.get(id)?.length ?? 0) > 0;
  };
  // Closure order: focus first, then breadth-first, so truncation keeps the nearest nodes.
  const ordered: string[] = [];
  const seen = new Set<string>([focus]);
  const queue = [focus];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const d of graph.nodes.get(id)?.deps ?? []) {
      if (!seen.has(d)) {
        seen.add(d);
        queue.push(d);
      }
    }
  }

  for (const id of ordered) {
    if (!visible(id)) continue;
    if (shown.size >= maxNodes) {
      truncated = true;
      break;
    }
    const n = graph.nodes.get(id)!;
    const tk = n.kind === 'measure' || n.kind === 'missing' ? null : tableKeyOf(id);
    const colMeta =
      tk && (n.kind === 'column' || n.kind === 'calc_column') ? catalog.columnsByTable.get(tk)?.get(n.name) : undefined;
    const tableMeta = tk ? catalog.tableMeta.get(tk) : undefined;
    const detail: GraphViewNode['detail'] = {};
    if (n.kind === 'measure') detail.code = catalog.measures?.get(n.name.toLowerCase())?.dax;
    if (n.kind === 'calc_column') detail.code = colMeta?.calculated_dax ?? undefined;
    if (n.kind === 'calc_table') detail.code = tableMeta?.source_m?.replace(/^calculated\s+source\s*=\s*/i, '') ?? undefined;
    if (n.kind === 'column') {
      detail.source_column = colMeta?.source_column ?? n.name;
      detail.uc = tableMeta?.uc_full_path ?? null;
    }
    if (colMeta?.data_type) detail.data_type = colMeta.data_type;
    nodes.push({
      id,
      kind: n.kind,
      label: n.kind === 'measure' || n.kind === 'calc_table' || n.kind === 'table' ? n.name : `${n.table ?? ''}[${n.name}]`,
      table: n.table,
      detail,
      issues: (issuesByNode.get(id) ?? []).map(({ kind, severity, detail: d, suggestion }) => ({
        kind,
        severity,
        detail: d,
        suggestion,
      })),
      status: n.kind === 'measure' ? (input.status?.get(n.name.toLowerCase()) ?? null) : null,
    });
    shown.add(id);

    // Warehouse leaves of a Power Query column: how the column is computed from the source.
    if (n.kind === 'column' && tk) {
      const lineage = lineageOf(tk);
      const expr = lineage?.column(colMeta?.source_column?.trim() || n.name);
      if (expr && !('error' in expr)) {
        if (expr.sql !== `\`${expr.leaves[0]}\`` || expr.leaves.length !== 1) detail.lineage_sql = expr.sql;
        for (const leaf of new Set(expr.leaves)) {
          const wid = `w:${tk}/${leaf.toLowerCase()}`;
          if (!shown.has(wid)) {
            const drift = (issuesByNode.get(id) ?? []).filter((i) => i.kind === 'replica_drift' && i.detail.includes(` ${leaf},`));
            nodes.push({
              id: wid,
              kind: 'warehouse',
              label: leaf,
              table: tableMeta?.uc_full_path ?? null,
              detail: { uc: tableMeta?.uc_full_path ?? null },
              issues: drift.map(({ kind, severity, detail: d, suggestion }) => ({ kind, severity, detail: d, suggestion })),
              status: null,
            });
            shown.add(wid);
          }
          edges.push({ from: wid, to: id });
        }
      }
    }
  }

  // Edges: dependency → dependent, between visible nodes. A column's hidden plain table is skipped.
  for (const id of shown) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    for (const d of n.deps) if (shown.has(d)) edges.push({ from: d, to: id });
  }

  attachSourceAndSteps({ catalog, nodes, edges, shown, maxNodes, onTruncate: () => { truncated = true; } });
  attachReports({ measure: input.measure, focus, reports: input.reports ?? [], nodes, edges, shown, maxNodes, onTruncate: () => { truncated = true; } });

  return { focus, nodes, edges, truncated };
}

/** External source and every Power Query step, in evaluation order, in front of the table's columns. */
function attachSourceAndSteps(input: {
  catalog: MeasureLogicCatalog;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  shown: Set<string>;
  maxNodes: number;
  onTruncate: () => void;
}) {
  const { catalog, nodes, edges, shown, maxNodes } = input;
  const tableKeys = new Set<string>();
  for (const n of nodes) {
    if (n.kind === 'column' || n.kind === 'calc_column' || n.kind === 'warehouse') tableKeys.add(tableKeyOf(n.id));
  }

  const room = (id: string): boolean => {
    if (shown.has(id)) return true;
    if (shown.size >= maxNodes) {
      input.onTruncate();
      return false;
    }
    return true;
  };

  for (const tk of tableKeys) {
    const meta = catalog.tableMeta.get(tk);
    if (!meta) continue;
    const lineage = meta.source_m ? parseMLineage(meta.source_m, catalog.rules, { culture: catalog.queryCulture }) : null;
    const origins = meta.source_m
      ? describeSourceOrigins(meta.source_m, catalog.sourceQueries, { selfName: meta.displayName })
      : [];

    const sourceIds: string[] = [];
    if (origins.length) {
      origins.forEach((origin, i) => {
        const id = `src:${tk}:${i}`;
        if (!room(id)) return;
        if (!shown.has(id)) {
          nodes.push({
            id,
            kind: 'source',
            label: originTitle(origin),
            table: meta.displayName,
            detail: { summary: describeOrigin(origin), uc: meta.uc_full_path },
            issues: [],
            status: null,
          });
          shown.add(id);
        }
        sourceIds.push(id);
      });
    } else if (meta.uc_full_path) {
      const id = `src:${tk}:0`;
      if (room(id) && !shown.has(id)) {
        nodes.push({
          id,
          kind: 'source',
          label: meta.uc_full_path,
          table: meta.displayName,
          detail: { summary: 'Unity Catalog table', uc: meta.uc_full_path },
          issues: [],
          status: null,
        });
        shown.add(id);
        sourceIds.push(id);
      } else if (shown.has(id)) sourceIds.push(id);
    }

    const stepIds: string[] = [];
    for (const [i, step] of (lineage?.steps ?? []).entries()) {
      const id = `pq:${tk}:${i}`;
      if (!room(id)) break;
      if (!shown.has(id)) {
        nodes.push({
          id,
          kind: 'pq_step',
          label: step.name,
          table: meta.displayName,
          detail: { summary: step.fn ?? 'Step reference' },
          issues: step.modeled
            ? []
            : [{ kind: 'pq_unsupported', severity: 'warn', detail: step.detail ?? `${step.name} is not modeled`, suggestion: 'Extend Power Query lineage for this step.' }],
          status: null,
        });
        shown.add(id);
      }
      stepIds.push(id);
    }

    const warehouses = nodes.filter((n) => n.kind === 'warehouse' && n.id.startsWith(`w:${tk}/`));
    const pqCols = nodes.filter((n) => n.kind === 'column' && tableKeyOf(n.id) === tk);
    const calcCols = nodes.filter((n) => n.kind === 'calc_column' && tableKeyOf(n.id) === tk);
    const targets = warehouses.length ? warehouses : pqCols.length ? pqCols : calcCols;
    const head = stepIds.length ? [stepIds[0]!] : targets.map((t) => t.id);
    for (const src of sourceIds) for (const to of head) edges.push({ from: src, to });
    for (let i = 0; i < stepIds.length - 1; i++) edges.push({ from: stepIds[i]!, to: stepIds[i + 1]! });
    const tail = stepIds.length ? stepIds[stepIds.length - 1]! : null;
    if (tail) for (const t of targets) edges.push({ from: tail, to: t.id });
  }
}

function attachReports(input: {
  measure: string;
  focus: string;
  reports: ReportConsumer[];
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  shown: Set<string>;
  maxNodes: number;
  onTruncate: () => void;
}) {
  const want = input.measure.trim().toLowerCase();
  for (const report of input.reports) {
    if (!report.measures.some((m) => m.trim().toLowerCase() === want)) continue;
    const id = `rep:${report.id}`;
    if (!input.shown.has(id) && input.shown.size >= input.maxNodes) {
      input.onTruncate();
      break;
    }
    if (!input.shown.has(id)) {
      input.nodes.push({
        id,
        kind: 'report',
        label: report.name,
        table: null,
        detail: { summary: 'Visuals in this report use this measure.' },
        issues: [],
        status: null,
      });
      input.shown.add(id);
    }
    input.edges.push({ from: input.focus, to: id });
  }
}

// ── Model overview: every object, grouped by table (client expands groups and runs impact) ──

export type OverviewGroup = {
  id: string;
  name: string;
  kind: 'table' | 'calc_table' | 'unresolved';
  source: SourceSystem | null;
  uc: string | null;
  counts: { measure: number; calc_column: number; column: number };
  status: Record<MeasureStatus, number>;
  issues: { block: number; warn: number };
};

export type OverviewNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  group: string;
  status: MeasureStatus | null;
  sev: 'block' | 'warn' | null;
  issue: string | null;
};

export type ModelOverview = {
  groups: OverviewGroup[];
  nodes: OverviewNode[];
  /** Node-level dependency edges: [dependency, dependent]. */
  edges: [string, string][];
  /** Filter propagation between tables (one side → many side). */
  relationships: { from: string; to: string; active: boolean; both: boolean }[];
};

export function modelOverview(input: {
  catalog: MeasureLogicCatalog;
  graph: ModelGraph;
  report: FidelityReport;
  status?: Map<string, MeasureStatus>;
}): ModelOverview {
  const { catalog, graph, report } = input;
  const issuesByNode = new Map<string, FidelityIssue[]>();
  for (const iss of report.issues) issuesByNode.set(iss.node, [...(issuesByNode.get(iss.node) ?? []), iss]);

  const groups = new Map<string, OverviewGroup>();
  const ensureGroup = (id: string, name: string, kind: OverviewGroup['kind']): OverviewGroup => {
    let g = groups.get(id);
    if (!g) {
      const meta = id.startsWith('t:') ? catalog.tableMeta.get(id.slice(2)) : undefined;
      g = {
        id,
        name: meta?.displayName ?? name,
        kind,
        source: meta ? (report.sources[meta.displayName] ?? null) : null,
        uc: meta?.uc_full_path ?? null,
        counts: { measure: 0, calc_column: 0, column: 0 },
        status: { recreated: 0, sql: 0, blocked: 0, no_sql: 0 },
        issues: { block: 0, warn: 0 },
      };
      groups.set(id, g);
    }
    return g;
  };

  const nodes: OverviewNode[] = [];
  for (const n of graph.nodes.values()) {
    let groupId: string;
    if (n.kind === 'table' || n.kind === 'calc_table') {
      groupId = n.id;
      ensureGroup(groupId, n.name, n.kind);
    } else if (n.kind === 'column' || n.kind === 'calc_column') {
      groupId = `t:${tableKeyOf(n.id)}`;
      ensureGroup(groupId, n.table ?? groupId.slice(2), 'table');
    } else if (n.kind === 'measure') {
      groupId = tableNodeId(n.table ?? 'Measures');
      ensureGroup(groupId, n.table ?? 'Measures', 'table');
    } else {
      groupId = 'x:unresolved';
      ensureGroup(groupId, 'Unresolved references', 'unresolved');
    }
    const iss = issuesByNode.get(n.id) ?? [];
    const sev = iss.some((i) => i.severity === 'block') ? 'block' : iss.length ? 'warn' : null;
    const status = n.kind === 'measure' ? (input.status?.get(n.name.toLowerCase()) ?? null) : null;
    nodes.push({
      id: n.id,
      kind: n.kind,
      name: n.name,
      group: groupId,
      status,
      sev,
      issue: iss[0] ? `${iss[0].detail}${iss[0].suggestion ? ` — ${iss[0].suggestion}` : ''}` : null,
    });
    const g = groups.get(groupId)!;
    if (n.kind === 'measure' || n.kind === 'calc_column' || n.kind === 'column') g.counts[n.kind] += 1;
    if (status) g.status[status] += 1;
    if (sev) g.issues[sev] += 1;
  }

  const edges: [string, string][] = [];
  for (const n of graph.nodes.values()) for (const d of n.deps) edges.push([d, n.id]);

  const relationships = (catalog.relationships ?? [])
    .map((r) => ({ from: tableNodeId(r.toTable), to: tableNodeId(r.fromTable), active: r.active, both: r.both }))
    .filter((r) => groups.has(r.from) && groups.has(r.to) && r.from !== r.to);

  return { groups: [...groups.values()], nodes, edges, relationships };
}

export function modelGraphSummary(input: {
  catalog: MeasureLogicCatalog;
  graph: ModelGraph;
  report: FidelityReport;
}): ModelGraphSummary {
  const { catalog, graph, report } = input;
  const counts: Partial<Record<GraphNodeKind, number>> = {};
  for (const n of graph.nodes.values()) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  const sources: Partial<Record<SourceSystem, number>> = {};
  for (const s of Object.values(report.sources)) sources[s] = (sources[s] ?? 0) + 1;
  const measuresByIssue = new Map<number, string[]>();
  for (const [key, idx] of Object.entries(report.byMeasure)) {
    const name = catalog.measures?.get(key)?.name ?? key;
    for (const i of idx) measuresByIssue.set(i, [...(measuresByIssue.get(i) ?? []), name]);
  }
  const issues = report.issues
    .map((iss, i) => ({ ...iss, measures: (measuresByIssue.get(i) ?? []).sort() }))
    // Most impactful first; issues on objects no measure uses go last.
    .sort((a, b) =>
      a.severity !== b.severity ? (a.severity === 'block' ? -1 : 1) : b.measures.length - a.measures.length,
    );
  return {
    counts,
    sources,
    issues,
    blocked: report.blocked.length,
    warnings: report.issues.filter((i) => i.severity === 'warn').length,
    gate_version: report.version,
  };
}
