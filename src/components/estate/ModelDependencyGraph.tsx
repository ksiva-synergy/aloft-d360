'use client';

/**
 * Power BI model graph views for Estate (Architecture v2 L1 + L0).
 *
 * - MeasureDependencyGraph: one measure's dependency chain, laid out left → right from warehouse
 *   columns through Power Query columns, calculated columns and measures to the measure itself.
 *   Fidelity issues are outlined (red = blocks recreation, amber = warning); every measure on the
 *   chain shows its recreation status. Click a node for its DAX, lineage and suggested fix.
 * - ModelHealthPanel: node counts, source systems and fidelity issues with the measures they block.
 *
 * Data: GET /api/agent-lab/powerbi/models/:id/graph[?measure=Name] (see model-graph-view.ts).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { ModelOverviewGraph } from '@/components/estate/ModelOverviewGraph';
import { CodeBlock, Tag, TONE_COLOR, type Tone } from '@/components/estate/object-ui';
import type {
  GraphViewNode,
  MeasureSubgraph,
  ModelGraphSummary,
} from '@/lib/powerbi/model-graph-view';

// ── shared ───────────────────────────────────────────────────────────────────

type Kind = GraphViewNode['kind'];

const KIND_META: Record<Kind, { label: string; glyph: string; color: string }> = {
  warehouse: { label: 'Warehouse column', glyph: '▦', color: '#5B6B82' },
  table: { label: 'Table', glyph: '▤', color: '#5B6B82' },
  column: { label: 'Power Query column', glyph: '│', color: TONE_COLOR.blue },
  calc_column: { label: 'Calculated column', glyph: 'ƒ', color: TONE_COLOR.violet },
  calc_table: { label: 'Calculated table', glyph: '⊞', color: TONE_COLOR.violet },
  measure: { label: 'Measure', glyph: 'Σ', color: TONE_COLOR.amber },
  missing: { label: 'Unresolved reference', glyph: '?', color: TONE_COLOR.red },
};

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  recreated: { label: 'recreated', tone: 'green' },
  sql: { label: 'SQL, not verified', tone: 'blue' },
  blocked: { label: 'blocked by gate', tone: 'red' },
  no_sql: { label: 'no SQL', tone: 'neutral' },
};

const ISSUE_LABEL: Record<string, string> = {
  replica_drift: 'Replica schema drift',
  dax_parse_error: 'DAX does not parse',
  empty_measure: 'Empty measure',
  tmdl_leak: 'TMDL text in DAX',
  unresolved_reference: 'Unresolved reference',
  pq_unsupported: 'Power Query step not modeled',
};

const SOURCE_LABEL: Record<string, string> = {
  databricks: 'Databricks',
  snowflake: 'Snowflake',
  sql_server: 'SQL Server',
  native_query: 'Native query',
  dataflow: 'Dataflow',
  embedded: 'Entered data',
  file: 'File',
  web: 'Web',
  dax_calculated: 'DAX calculated',
  unknown: 'Unknown',
};

/** Fetch JSON for `url`; loading is derived (the stored result belongs to a different URL). */
export function useJson<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({
    url: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        return json as T;
      })
      .then((data) => alive && setState({ url, data, error: null }))
      .catch((e: unknown) => alive && setState({ url, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [url]);
  const current = state.url === url;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: Boolean(url) && !current };
}

function Loading({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-4 text-caption text-[var(--estate-text-muted)]">
      <Loader2 className="size-3.5 animate-spin" aria-hidden /> {text}
    </p>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-3 text-caption text-[var(--estate-status-error-text)]">
      <AlertTriangle className="size-3.5" aria-hidden /> {text}
    </p>
  );
}

// ── measure dependency graph ─────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 54;

type FlowData = { node: GraphViewNode; focus: boolean; selected: boolean };

function severityOf(n: GraphViewNode): 'block' | 'warn' | null {
  if (n.issues.some((i) => i.severity === 'block')) return 'block';
  return n.issues.length ? 'warn' : null;
}

function GraphNodeCard({ data }: NodeProps) {
  const { node, focus, selected } = data as FlowData;
  const meta = KIND_META[node.kind];
  const sev = severityOf(node);
  const ring = sev === 'block' ? TONE_COLOR.red : sev === 'warn' ? TONE_COLOR.amber : focus ? meta.color : null;
  const status = node.status ? STATUS_META[node.status] : null;
  const statusColor = status && status.tone !== 'neutral' ? TONE_COLOR[status.tone as Exclude<Tone, 'neutral' | 'brand'>] : '#8A93A6';
  return (
    <div
      title={node.label}
      style={{
        width: NODE_W,
        height: NODE_H,
        borderRadius: 6,
        padding: '6px 9px',
        background: focus
          ? `color-mix(in srgb, ${meta.color} 14%, var(--estate-surface))`
          : 'var(--estate-surface)',
        border: `1px solid ${ring ?? 'var(--estate-border)'}`,
        boxShadow: selected ? `0 0 0 2px var(--brand-a)` : ring && sev ? `0 0 0 1px ${ring}` : 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <span
        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide"
        style={{ color: meta.color }}
      >
        <span aria-hidden>{meta.glyph}</span>
        {meta.label}
        {status && (
          <span
            aria-label={status.label}
            title={status.label}
            className="ml-auto inline-block size-2 rounded-full"
            style={{ background: statusColor }}
          />
        )}
        {sev && <AlertTriangle className="size-3" style={{ color: ring! }} aria-label="has fidelity issue" />}
      </span>
      <span className="truncate text-caption text-[var(--estate-ink)]">{node.label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { pbiNode: GraphNodeCard };

function layout(g: MeasureSubgraph, selectedId: string | null): { nodes: Node<FlowData>[]; edges: Edge[] } {
  const dg = new dagre.graphlib.Graph();
  dg.setDefaultEdgeLabel(() => ({}));
  dg.setGraph({ rankdir: 'LR', ranksep: 70, nodesep: 14, marginx: 10, marginy: 10 });
  for (const n of g.nodes) dg.setNode(n.id, { width: NODE_W, height: NODE_H });
  const present = new Set(g.nodes.map((n) => n.id));
  const edgeKeys = new Set<string>();
  const edges: Edge[] = [];
  for (const e of g.edges) {
    const key = `${e.from}->${e.to}`;
    if (!present.has(e.from) || !present.has(e.to) || edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    dg.setEdge(e.from, e.to);
    const target = g.nodes.find((n) => n.id === e.to)!;
    const source = g.nodes.find((n) => n.id === e.from)!;
    const bad = severityOf(source) === 'block' || severityOf(target) === 'block';
    edges.push({
      id: key,
      source: e.from,
      target: e.to,
      style: { stroke: bad ? TONE_COLOR.red : 'var(--estate-text-dim)', strokeWidth: bad ? 1.6 : 1.1, opacity: bad ? 0.9 : 0.55 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: bad ? TONE_COLOR.red : undefined },
    });
  }
  dagre.layout(dg);
  const nodes: Node<FlowData>[] = g.nodes.map((n) => {
    const p = dg.node(n.id);
    return {
      id: n.id,
      type: 'pbiNode',
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      data: { node: n, focus: n.id === g.focus, selected: n.id === selectedId },
    };
  });
  return { nodes, edges };
}

function NodeDetail({ node }: { node: GraphViewNode }) {
  const meta = KIND_META[node.kind];
  const status = node.status ? STATUS_META[node.status] : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-caption uppercase" style={{ color: meta.color }}>
          {meta.glyph} {meta.label}
        </span>
        {status && <Tag tone={status.tone}>{status.label}</Tag>}
      </div>
      <p className="break-words text-ui font-medium text-[var(--estate-ink)]">{node.label}</p>
      {node.issues.map((iss, i) => (
        <div
          key={i}
          className="rounded-md border px-2.5 py-2 text-caption"
          style={{
            borderColor: iss.severity === 'block' ? 'var(--estate-status-error-border)' : 'var(--estate-status-warning-border)',
            background: iss.severity === 'block' ? 'var(--estate-status-error-bg)' : 'var(--estate-status-warning-bg)',
          }}
        >
          <p
            className="font-medium"
            style={{
              color: iss.severity === 'block' ? 'var(--estate-status-error-text)' : 'var(--estate-status-warning-text)',
            }}
          >
            {ISSUE_LABEL[iss.kind] ?? iss.kind}
            {iss.severity === 'block' ? ' — blocks recreation' : ''}
          </p>
          <p className="mt-0.5 text-[var(--estate-text-secondary)]">{iss.detail}</p>
          {iss.suggestion && <p className="mt-1 text-[var(--estate-ink)]">Fix: {iss.suggestion}</p>}
        </div>
      ))}
      {node.detail.source_column && (
        <p className="text-caption text-[var(--estate-text-secondary)]">
          Source column <span className="font-mono">{node.detail.source_column}</span>
          {node.detail.uc && (
            <>
              {' '}
              of <span className="font-mono">{node.detail.uc}</span>
            </>
          )}
        </p>
      )}
      {node.kind === 'warehouse' && node.detail.uc && (
        <p className="text-caption text-[var(--estate-text-secondary)]">
          Column of <span className="font-mono">{node.detail.uc}</span>
        </p>
      )}
      {node.detail.data_type && (
        <p className="text-caption text-[var(--estate-text-muted)]">Type: {node.detail.data_type}</p>
      )}
      {node.detail.lineage_sql && (
        <>
          <p className="text-caption text-[var(--estate-text-muted)]">Computed in Power Query as (SQL):</p>
          <CodeBlock code={node.detail.lineage_sql} maxHeight={140} />
        </>
      )}
      {node.detail.code && <CodeBlock code={node.detail.code} maxHeight={260} />}
    </div>
  );
}

export function MeasureDependencyGraph({ modelId, measure }: { modelId: string; measure: string }) {
  const url = `/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/graph?measure=${encodeURIComponent(measure)}`;
  const { data, error, loading } = useJson<{ subgraph: MeasureSubgraph }>(url);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graph = data?.subgraph ?? null;
  const flow = useMemo(() => (graph ? layout(graph, selectedId) : null), [graph, selectedId]);

  if (loading) return <Loading text="Building dependency graph…" />;
  if (error) return <ErrorLine text={`Dependency graph unavailable: ${error}`} />;
  if (!graph || !flow) return null;

  const selected = graph.nodes.find((n) => n.id === (selectedId ?? graph.focus)) ?? null;
  const counts = graph.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  const blocking = graph.nodes.filter((n) => severityOf(n) === 'block').length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--estate-text-muted)]">
        <span>
          Depends on {graph.nodes.length - 1} objects
          {(['measure', 'calc_column', 'column', 'warehouse', 'calc_table'] as Kind[])
            .filter((k) => counts[k])
            .map((k) => ` · ${counts[k] ?? 0} ${KIND_META[k].label.toLowerCase()}${(counts[k] ?? 0) > 1 ? 's' : ''}`)
            .join('')}
        </span>
        {blocking > 0 && (
          <span className="text-[var(--estate-status-error-text)]">
            {blocking} object{blocking > 1 ? 's' : ''} block recreation
          </span>
        )}
        {graph.truncated && <span>(showing the nearest {graph.nodes.length})</span>}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          className="overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-bg)]"
          style={{ height: 'min(60vh, 640px)', minHeight: 360 }}
        >
          <ReactFlowProvider>
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.15}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_e, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
            >
              <Background gap={18} color="rgba(136,146,164,0.14)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
        <aside
          className="overflow-y-auto rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3"
          style={{ maxHeight: 'min(60vh, 640px)', minHeight: 360 }}
        >
          {selected ? <NodeDetail node={selected} /> : null}
        </aside>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-[var(--estate-text-muted)]">
      <span>Flow: warehouse → Power Query → calculated → measure</span>
      {Object.entries(STATUS_META).map(([k, s]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: s.tone === 'neutral' ? '#8A93A6' : TONE_COLOR[s.tone as Exclude<Tone, 'neutral' | 'brand'>] }}
          />
          {s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-sm border" style={{ borderColor: TONE_COLOR.red }} /> blocks recreation
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-sm border" style={{ borderColor: TONE_COLOR.amber }} /> warning
      </span>
    </div>
  );
}

// ── model health ─────────────────────────────────────────────────────────────

export function ModelHealthPanel({
  modelId,
  onOpenMeasure,
}: {
  modelId: string;
  onOpenMeasure: (name: string) => void;
}) {
  const { data, error, loading } = useJson<{ summary: ModelGraphSummary }>(
    `/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/graph`,
  );
  const [showUnused, setShowUnused] = useState(false);
  const [graphFocus, setGraphFocus] = useState<{ id: string; seq: number } | null>(null);
  const showOnGraph = (nodeId: string) => {
    setGraphFocus((prev) => ({ id: nodeId, seq: (prev?.seq ?? 0) + 1 }));
    document.getElementById(`model-overview-${modelId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (loading) return <Loading text="Checking model fidelity…" />;
  if (error) return <ErrorLine text={`Model health unavailable: ${error}`} />;
  const s = data?.summary;
  if (!s) return null;

  const used = s.issues.filter((i) => i.measures.length > 0);
  const unused = s.issues.filter((i) => i.measures.length === 0);
  const countLabel: [string, number | undefined][] = [
    ['measures', s.counts.measure],
    ['calculated columns', s.counts.calc_column],
    ['Power Query columns', s.counts.column],
    ['calculated tables', s.counts.calc_table],
    ['tables', s.counts.table],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Measures blocked by input defects" value={s.blocked} tone={s.blocked ? 'red' : 'green'} />
        <Stat label="Issues affecting measures" value={used.length} tone={used.length ? 'amber' : 'green'} />
        <Stat label="Warnings" value={s.warnings} tone="neutral" />
      </div>

      <section id={`model-overview-${modelId}`} className="space-y-2">
        <h4 className="text-ui font-medium text-[var(--estate-ink)]">Model graph</h4>
        <ModelOverviewGraph key={modelId} modelId={modelId} focus={graphFocus} onOpenMeasure={onOpenMeasure} />
      </section>

      <div className="rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3 text-caption text-[var(--estate-text-secondary)]">
        <p>
          <span className="text-[var(--estate-ink)]">Objects:</span>{' '}
          {countLabel
            .filter(([, n]) => n)
            .map(([l, n]) => `${n} ${l}`)
            .join(' · ')}
          {s.counts.missing ? ` · ${s.counts.missing} unresolved references` : ''}
        </p>
        <p className="mt-1">
          <span className="text-[var(--estate-ink)]">Sources:</span>{' '}
          {Object.entries(s.sources)
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`)
            .join(' · ')}
        </p>
      </div>

      {used.length === 0 ? (
        <p className="text-ui-regular text-[var(--estate-text-muted)]">
          No input defects affect any measure. Every measure can go to the compiler.
        </p>
      ) : (
        <ul className="space-y-2">
          {used.map((iss, i) => (
            <IssueRow key={i} issue={iss} onOpenMeasure={onOpenMeasure} onShowOnGraph={showOnGraph} />
          ))}
        </ul>
      )}

      {unused.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUnused((v) => !v)}
            className="text-caption text-[var(--estate-text-muted)] underline-offset-2 hover:underline"
          >
            {showUnused ? 'Hide' : 'Show'} {unused.length} issues on objects no measure uses
          </button>
          {showUnused && (
            <ul className="mt-2 space-y-2">
              {unused.map((iss, i) => (
                <IssueRow key={i} issue={iss} onOpenMeasure={onOpenMeasure} onShowOnGraph={showOnGraph} />
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-caption text-[var(--estate-text-dim)]">Fidelity gate {s.gate_version}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const color = tone === 'neutral' || tone === 'brand' ? 'var(--estate-ink)' : TONE_COLOR[tone];
  return (
    <div className="rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2">
      <p className="text-title-section tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="text-caption text-[var(--estate-text-muted)]">{label}</p>
    </div>
  );
}

function IssueRow({
  issue,
  onOpenMeasure,
  onShowOnGraph,
}: {
  issue: ModelGraphSummary['issues'][number];
  onOpenMeasure: (name: string) => void;
  onShowOnGraph: (nodeId: string) => void;
}) {
  const block = issue.severity === 'block';
  const [all, setAll] = useState(false);
  const shown = all ? issue.measures : issue.measures.slice(0, 10);
  return (
    <li className="rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={block ? 'red' : 'amber'}>{ISSUE_LABEL[issue.kind] ?? issue.kind}</Tag>
        <span className="font-mono text-caption text-[var(--estate-ink)]">{issue.object}</span>
        <button
          type="button"
          onClick={() => onShowOnGraph(issue.node)}
          className="ml-auto text-caption text-[var(--estate-text-muted)] underline-offset-2 hover:text-[var(--estate-ink)] hover:underline"
        >
          Show on graph
        </button>
      </div>
      <p className="mt-1 text-caption text-[var(--estate-text-secondary)]">{issue.detail}</p>
      {issue.suggestion && <p className="mt-1 text-caption text-[var(--estate-ink)]">Fix: {issue.suggestion}</p>}
      {issue.measures.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-[var(--estate-text-muted)]">
          {block ? 'Blocks' : 'Affects'} {issue.measures.length} measure{issue.measures.length > 1 ? 's' : ''}:
          {shown.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onOpenMeasure(m)}
              className="rounded border border-[var(--estate-border)] px-1.5 text-[var(--estate-ink)] hover:bg-[var(--estate-hover)]"
              title="Open this measure and its dependency graph"
            >
              {m}
            </button>
          ))}
          {issue.measures.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="underline-offset-2 hover:underline">
              +{issue.measures.length - shown.length} more
            </button>
          )}
        </p>
      )}
    </li>
  );
}
