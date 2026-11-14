'use client';

/**
 * One connected picture of a Power BI model (Estate → model → Model health).
 *
 * - Overview: one node per table / calculated table with its measures' recreation health;
 *   edges = dependencies between tables (calculated columns, measure references, columns read).
 * - Expand in place: double-click a table to open it into its measures, calculated columns and
 *   used columns (double-click the frame to collapse).
 * - Impact: click any node to light up everything that uses it (downstream) or everything it
 *   reads (upstream), with the affected measures listed.
 *
 * Data: GET /api/agent-lab/powerbi/models/:id/graph?view=overview (model-graph-view.ts).
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
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Loader2, Maximize2, Minimize2 } from 'lucide-react';

import { Tag, TONE_COLOR } from '@/components/estate/object-ui';
import { buildAdjacency, reach } from '@/lib/powerbi/graph-impact';
import { gridLayout } from '@/lib/powerbi/graph-layout';
import type {
  MeasureStatus,
  ModelOverview,
  OverviewGroup,
  OverviewNode,
} from '@/lib/powerbi/model-graph-view';

const STATUS_COLOR: Record<MeasureStatus, string> = {
  recreated: TONE_COLOR.green,
  sql: TONE_COLOR.blue,
  blocked: TONE_COLOR.red,
  no_sql: '#8A93A6',
};
const STATUS_LABEL: Record<MeasureStatus, string> = {
  recreated: 'recreated',
  sql: 'SQL, not verified',
  blocked: 'blocked by gate',
  no_sql: 'no SQL',
};
const KIND: Record<string, { label: string; glyph: string; color: string }> = {
  table: { label: 'Table', glyph: '▤', color: '#5B6B82' },
  calc_table: { label: 'Calculated table', glyph: '⊞', color: TONE_COLOR.violet },
  column: { label: 'Column', glyph: '│', color: TONE_COLOR.blue },
  calc_column: { label: 'Calculated column', glyph: 'ƒ', color: TONE_COLOR.violet },
  measure: { label: 'Measure', glyph: 'Σ', color: TONE_COLOR.amber },
  missing: { label: 'Unresolved reference', glyph: '?', color: TONE_COLOR.red },
  unresolved: { label: 'Unresolved references', glyph: '?', color: TONE_COLOR.red },
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
  dax_calculated: 'DAX',
  unknown: 'Unknown source',
};

const GW = 230;
const GH = 74;
const MW = 200;
const MH = 44;
const MAX_MEMBERS = 80;
const FRAME_PAD = 12;
const FRAME_HEAD = 30;
/** Inline canvas — tall enough to read labels without fit-view crushing everything. */
const GRAPH_INLINE_H = 'min(72vh, 880px)';

// ── node renderers ───────────────────────────────────────────────────────────

type GroupData = { group: OverviewGroup; dim: boolean; selected: boolean; hit: boolean };
type MemberData = { node: OverviewNode; dim: boolean; selected: boolean; hit: boolean };
type FrameData = { group: OverviewGroup; dim: boolean; selected: boolean; hidden: number };

const hidden = { opacity: 0, pointerEvents: 'none' as const };

function StatusBar({ status }: { status: Record<MeasureStatus, number> }) {
  const total = Object.values(status).reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--estate-border)]">
      {(Object.keys(STATUS_COLOR) as MeasureStatus[]).map((k) =>
        status[k] ? (
          <span key={k} style={{ width: `${(status[k] / total) * 100}%`, background: STATUS_COLOR[k] }} />
        ) : null,
      )}
    </div>
  );
}

function ringStyle(sel: boolean, hit: boolean, sev: boolean): React.CSSProperties {
  return {
    border: `1px solid ${sev ? TONE_COLOR.red : 'var(--estate-border)'}`,
    boxShadow: sel ? '0 0 0 2px var(--brand-a)' : hit ? `0 0 0 2px ${TONE_COLOR.amber}` : 'none',
  };
}

function GroupNode({ data }: NodeProps) {
  const { group, dim, selected, hit } = data as GroupData;
  const k = KIND[group.kind] ?? KIND.table!;
  const parts = [
    group.counts.measure && `${group.counts.measure} measures`,
    group.counts.calc_column && `${group.counts.calc_column} calc cols`,
  ].filter(Boolean);
  return (
    <div
      title={`${group.name} — double-click to expand`}
      className="flex flex-col justify-center gap-1 rounded-md bg-[var(--estate-surface)] px-2.5 py-1.5"
      style={{ width: GW, height: GH, opacity: dim ? 0.25 : 1, cursor: 'pointer', ...ringStyle(selected, hit, group.issues.block > 0) }}
    >
      <Handle type="target" position={Position.Left} style={hidden} />
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide" style={{ color: k.color }}>
        {k.glyph} {group.source ? (SOURCE_LABEL[group.source] ?? group.source) : k.label}
        {group.issues.block > 0 && <AlertTriangle className="ml-auto size-3" style={{ color: TONE_COLOR.red }} aria-label="blocking issue" />}
      </span>
      <span className="truncate text-caption font-medium text-[var(--estate-ink)]">{group.name}</span>
      <span className="truncate text-[10px] text-[var(--estate-text-muted)]">{parts.join(' · ') || 'no measures'}</span>
      <StatusBar status={group.status} />
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function MemberNode({ data }: NodeProps) {
  const { node, dim, selected, hit } = data as MemberData;
  const k = KIND[node.kind] ?? KIND.column!;
  return (
    <div
      title={node.name}
      className="flex flex-col justify-center gap-0.5 rounded-md bg-[var(--estate-surface)] px-2 py-1"
      style={{ width: MW, height: MH, opacity: dim ? 0.25 : 1, cursor: 'pointer', ...ringStyle(selected, hit, node.sev === 'block') }}
    >
      <Handle type="target" position={Position.Left} style={hidden} />
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase" style={{ color: k.color }}>
        {k.glyph} {k.label}
        {node.status && (
          <span className="ml-auto inline-block size-2 rounded-full" style={{ background: STATUS_COLOR[node.status] }} />
        )}
        {node.sev && (
          <AlertTriangle className={node.status ? 'size-3' : 'ml-auto size-3'} style={{ color: node.sev === 'block' ? TONE_COLOR.red : TONE_COLOR.amber }} />
        )}
      </span>
      <span className="truncate text-caption text-[var(--estate-ink)]">{node.name}</span>
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function FrameNode({ data }: NodeProps) {
  const { group, dim, selected, hidden: hiddenCount } = data as FrameData;
  const k = KIND[group.kind] ?? KIND.table!;
  return (
    <div
      className="h-full w-full rounded-lg"
      style={{
        border: `1px dashed ${selected ? 'var(--brand-a)' : k.color}`,
        background: `color-mix(in srgb, ${k.color} 6%, transparent)`,
        opacity: dim ? 0.35 : 1,
      }}
      title="Double-click to collapse"
    >
      <div className="flex items-center gap-2 px-2.5 pt-1.5 font-mono text-[10px] uppercase tracking-wide" style={{ color: k.color }}>
        {k.glyph} {group.name}
        {hiddenCount > 0 && (
          <span className="normal-case text-[var(--estate-text-muted)]">· {hiddenCount} unused columns hidden</span>
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { group: GroupNode, member: MemberNode, frame: FrameNode };

// ── layout ───────────────────────────────────────────────────────────────────

type Built = { nodes: Node[]; edges: Edge[] };

function FitOnChange({ token }: { token: string }) {
  const rf = useReactFlow();
  useEffect(() => {
    const t = requestAnimationFrame(() => rf.fitView({ padding: 0.1, duration: 250 }));
    return () => cancelAnimationFrame(t);
  }, [token, rf]);
  return null;
}

// ── main component ───────────────────────────────────────────────────────────

export function ModelOverviewGraph({
  modelId,
  focus,
  onOpenMeasure,
}: {
  modelId: string;
  /** Node to expand + select (e.g. from an issue row); `seq` re-triggers. */
  focus: { id: string; seq: number } | null;
  onOpenMeasure: (name: string) => void;
}) {
  const [data, setData] = useState<ModelOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'down' | 'up'>('down');
  const [showRels, setShowRels] = useState(false);
  const [expandedView, setExpandedView] = useState(false);

  useEffect(() => {
    if (!expandedView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedView(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedView]);

  // Fresh state per model: the parent keys this component by modelId.
  useEffect(() => {
    let alive = true;
    fetch(`/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/graph?view=overview`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { overview?: ModelOverview; error?: string };
        if (!res.ok || !json.overview) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!alive) return;
        setData(json.overview);
        setExpanded(new Set());
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [modelId]);

  const idx = useMemo(() => {
    if (!data) return null;
    const groupById = new Map(data.groups.map((g) => [g.id, g]));
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    const membersByGroup = new Map<string, OverviewNode[]>();
    for (const n of data.nodes) membersByGroup.set(n.group, [...(membersByGroup.get(n.group) ?? []), n]);
    const adj = buildAdjacency(data.edges);
    // Groups with no measures, no cross-table edges and no issues are noise in the overview.
    const crossing = new Set<string>();
    for (const [a, b] of data.edges) {
      const ga = nodeById.get(a)?.group;
      const gb = nodeById.get(b)?.group;
      if (ga && gb && ga !== gb) {
        crossing.add(ga);
        crossing.add(gb);
      }
    }
    const hiddenGroups = new Set(
      data.groups
        .filter((g) => !g.counts.measure && !crossing.has(g.id) && !g.issues.block && !g.issues.warn)
        .map((g) => g.id),
    );
    /** Members shown when a group is expanded: logic and used columns, issues first. */
    const visibleMembers = (gid: string): { shown: Set<string>; hidden: number } => {
      const all = membersByGroup.get(gid) ?? [];
      const rank = (n: OverviewNode) =>
        (n.sev === 'block' ? 0 : 10) + ({ measure: 1, calc_column: 2, calc_table: 3, missing: 3, column: 4, table: 5 }[n.kind] ?? 6);
      const candidates = all.filter(
        (n) =>
          n.kind === 'measure' ||
          n.kind === 'calc_column' ||
          n.kind === 'calc_table' ||
          n.kind === 'missing' ||
          n.sev !== null ||
          (n.kind === 'column' && (adj.down.get(n.id)?.length ?? 0) > 0),
      );
      const shown = new Set(candidates.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_MEMBERS).map((n) => n.id));
      return { shown, hidden: all.filter((n) => n.kind === 'column').length - [...shown].filter((id) => nodeById.get(id)?.kind === 'column').length };
    };
    return { groupById, nodeById, membersByGroup, adj, hiddenGroups, visibleMembers };
  }, [data]);

  // Focus requests from outside (issue rows): expand the node's group and select the node.
  // Adjusted during render (once per request seq), as React recommends over an effect.
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  if (focus && idx && focus.seq !== handledFocus) {
    setHandledFocus(focus.seq);
    const n = idx.nodeById.get(focus.id);
    const gid = n?.group ?? (idx.groupById.has(focus.id) ? focus.id : null);
    if (gid) {
      setExpanded((prev) => new Set(prev).add(gid));
      setSelected(n ? focus.id : gid);
      setMode('down');
    }
  }

  const view = useMemo(() => {
    if (!data || !idx) return null;
    const membersShown = new Map<string, { shown: Set<string>; hidden: number }>();
    for (const gid of expanded) membersShown.set(gid, idx.visibleMembers(gid));
    const vis = (id: string): string | null => {
      const n = idx.nodeById.get(id);
      const gid = n?.group ?? id;
      if (idx.hiddenGroups.has(gid)) return null;
      const m = membersShown.get(gid);
      if (!m) return gid;
      return m.shown.has(id) ? id : null;
    };

    // Impact
    // A table's impact is the impact of everything in it; a single object's is its own.
    const startNodes = !selected
      ? []
      : idx.groupById.has(selected)
        ? [selected, ...(idx.membersByGroup.get(selected) ?? []).map((n) => n.id)]
        : [selected];
    const reached = selected ? reach(startNodes, idx.adj, mode) : new Set<string>();
    const hitVis = new Set<string>();
    for (const id of reached) {
      const v = vis(id);
      if (v) hitVis.add(v);
    }
    const selVis = selected ? vis(selected) ?? selected : null;
    const dimOn = Boolean(selected);

    // Layout
    // Layout in two passes: members of an open table go in a compact grid (columns by dependency
    // depth inside the table, wrapped at MAX_ROWS), then dagre places tables and frames as blocks.
    const groupsShown = data.groups.filter((gr) => !idx.hiddenGroups.has(gr.id));
    const frames = new Map<string, { w: number; h: number; pos: Map<string, { x: number; y: number }> }>();
    for (const gr of groupsShown) {
      const m = membersShown.get(gr.id);
      if (m && m.shown.size > 0) frames.set(gr.id, gridLayout([...m.shown], idx.adj.up, { cellW: MW, cellH: MH }));
    }
    const layoutId = (visId: string): string => {
      const gid = idx.nodeById.get(visId)?.group;
      return gid && frames.has(gid) && visId !== gid ? `frame:${gid}` : frames.has(visId) ? `frame:${visId}` : visId;
    };

    const weights = new Map<string, number>();
    for (const [d, n] of data.edges) {
      const a = vis(d);
      const b = vis(n);
      if (!a || !b || a === b) continue;
      const key = `${a}->${b}`;
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 18, marginx: 16, marginy: 16 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const gr of groupsShown) {
      const f = frames.get(gr.id);
      if (f) g.setNode(`frame:${gr.id}`, { width: f.w + FRAME_PAD * 2, height: f.h + FRAME_PAD + FRAME_HEAD });
      else g.setNode(gr.id, { width: GW, height: GH });
    }
    for (const key of weights.keys()) {
      const [a, b] = key.split('->') as [string, string];
      const la = layoutId(a);
      const lb = layoutId(b);
      if (la !== lb && g.hasNode(la) && g.hasNode(lb)) g.setEdge(la, lb);
    }
    const rels = showRels
      ? data.relationships.filter(
          (r) => !frames.has(r.from) && !frames.has(r.to) && g.hasNode(r.from) && g.hasNode(r.to) && !weights.has(`${r.from}->${r.to}`),
        )
      : [];
    for (const r of rels) g.setEdge(r.from, r.to);
    dagre.layout(g);

    const nodes: Node[] = [];
    for (const gr of groupsShown) {
      const f = frames.get(gr.id);
      const m = membersShown.get(gr.id);
      if (f && m) {
        const c = g.node(`frame:${gr.id}`);
        const fw = f.w + FRAME_PAD * 2;
        const fh = f.h + FRAME_PAD + FRAME_HEAD;
        nodes.push({
          id: `frame:${gr.id}`,
          type: 'frame',
          position: { x: c.x - fw / 2, y: c.y - fh / 2 },
          style: { width: fw, height: fh },
          data: {
            group: gr,
            dim: dimOn && selVis !== gr.id && ![...m.shown].some((id) => hitVis.has(id) || id === selVis),
            selected: selected === gr.id,
            hidden: m.hidden,
          } satisfies FrameData,
          zIndex: -1,
        });
        for (const id of m.shown) {
          const p = f.pos.get(id)!;
          nodes.push({
            id,
            type: 'member',
            parentId: `frame:${gr.id}`,
            position: { x: FRAME_PAD + p.x, y: FRAME_HEAD + p.y },
            data: {
              node: idx.nodeById.get(id)!,
              dim: dimOn && id !== selVis && !hitVis.has(id),
              selected: id === selVis,
              hit: hitVis.has(id),
            } satisfies MemberData,
          });
        }
      } else {
        const p = g.node(gr.id);
        nodes.push({
          id: gr.id,
          type: 'group',
          position: { x: p.x - GW / 2, y: p.y - GH / 2 },
          data: { group: gr, dim: dimOn && gr.id !== selVis && !hitVis.has(gr.id), selected: gr.id === selVis, hit: hitVis.has(gr.id) } satisfies GroupData,
        });
      }
    }

    const maxW = Math.max(1, ...weights.values());
    const edges: Edge[] = [];
    for (const [key, w] of weights) {
      const [a, b] = key.split('->') as [string, string];
      const lit = dimOn && (a === selVis || hitVis.has(a)) && (b === selVis || hitVis.has(b));
      edges.push({
        id: key,
        source: a,
        target: b,
        style: {
          stroke: lit ? TONE_COLOR.amber : 'var(--estate-text-dim)',
          strokeWidth: 1 + (w / maxW) * 2.5,
          opacity: dimOn && !lit ? 0.12 : lit ? 0.95 : 0.5,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: lit ? TONE_COLOR.amber : undefined },
        zIndex: lit ? 1 : 0,
      });
    }
    for (const r of rels) {
      edges.push({
        id: `rel:${r.from}->${r.to}`,
        source: r.from,
        target: r.to,
        style: { stroke: 'var(--estate-text-dim)', strokeDasharray: '4 4', opacity: dimOn ? 0.1 : r.active ? 0.45 : 0.2 },
      });
    }

    const affected = [...reached]
      .map((id) => idx.nodeById.get(id))
      .filter((n): n is OverviewNode => Boolean(n));
    return {
      built: { nodes, edges } satisfies Built,
      affected,
      hiddenGroups: idx.hiddenGroups.size,
      token: `${[...expanded].sort().join('|')}#${showRels}#${expandedView}`,
    };
  }, [data, idx, expanded, selected, mode, showRels, expandedView]);

  if (error) {
    return (
      <p className="flex items-center gap-2 py-3 text-caption text-[var(--estate-status-error-text)]">
        <AlertTriangle className="size-3.5" aria-hidden /> Model graph unavailable: {error}
      </p>
    );
  }
  if (!data || !idx || !view) {
    return (
      <p className="flex items-center gap-2 py-4 text-caption text-[var(--estate-text-muted)]">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Building model graph…
      </p>
    );
  }

  const toggle = (gid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  const selGroup = selected ? idx.groupById.get(selected) : undefined;
  const selNode = selected && !selGroup ? idx.nodeById.get(selected) : undefined;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 text-caption text-[var(--estate-text-muted)]">
      <div role="radiogroup" aria-label="Impact direction" className="inline-flex overflow-hidden rounded-md border border-[var(--estate-border)]">
        {(['down', 'up'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={
              'px-2.5 py-1 ' +
              (mode === m ? 'bg-[var(--estate-active-bg)] text-[var(--estate-ink)]' : 'hover:bg-[var(--estate-hover)]')
            }
          >
            {m === 'down' ? 'Impact: what uses it' : 'Sources: what it reads'}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={showRels} onChange={(e) => setShowRels(e.target.checked)} /> Relationships
      </label>
      {expanded.size > 0 && (
        <button type="button" onClick={() => setExpanded(new Set())} className="underline-offset-2 hover:underline">
          Collapse all
        </button>
      )}
      <button
        type="button"
        onClick={() => setExpandedView((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-[var(--estate-border)] px-2 py-1 text-[var(--estate-ink)] hover:bg-[var(--estate-hover)]"
      >
        {expandedView ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
        {expandedView ? 'Exit full view (Esc)' : 'Expand graph'}
      </button>
      <span className={expandedView ? undefined : 'ml-auto'}>
        Click a node for impact · double-click a table to open it
        {view.hiddenGroups > 0 && ` · ${view.hiddenGroups} unused tables hidden`}
      </span>
    </div>
  );

  return (
    <div className="space-y-2">
      {!expandedView && toolbar}

      <div
        className={
          expandedView
            ? 'fixed inset-0 z-[200] flex flex-col gap-2 bg-[var(--estate-bg)] p-4 pt-3'
            : undefined
        }
      >
      {expandedView && toolbar}
      <div
        className={
          expandedView
            ? 'grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]'
            : 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]'
        }
      >
        <div
          className="overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-bg)]"
          style={{ height: expandedView ? '100%' : GRAPH_INLINE_H, minHeight: expandedView ? undefined : 420 }}
        >
          <ReactFlowProvider>
            <ReactFlow
              nodes={view.built.nodes}
              edges={view.built.edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.1}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_e, n) => setSelected(n.id.startsWith('frame:') ? n.id.slice(6) : n.id)}
              onNodeDoubleClick={(_e, n) => {
                if (n.id.startsWith('frame:')) toggle(n.id.slice(6));
                else if (idx.groupById.has(n.id)) toggle(n.id);
              }}
              onPaneClick={() => setSelected(null)}
              zoomOnDoubleClick={false}
            >
              <Background gap={18} color="rgba(136,146,164,0.14)" />
              <Controls showInteractive={false} />
              <FitOnChange token={view.token} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        <aside
          className="space-y-3 overflow-y-auto rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3 text-caption"
          style={expandedView ? { maxHeight: '100%' } : { maxHeight: GRAPH_INLINE_H, minHeight: 420 }}
        >
          {!selected && <OverviewHelp />}
          {selGroup && (
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase" style={{ color: (KIND[selGroup.kind] ?? KIND.table!).color }}>
                {(KIND[selGroup.kind] ?? KIND.table!).label}
                {selGroup.source && ` · ${SOURCE_LABEL[selGroup.source] ?? selGroup.source}`}
              </p>
              <p className="text-ui font-medium text-[var(--estate-ink)]">{selGroup.name}</p>
              {selGroup.uc && <p className="break-all font-mono text-[var(--estate-text-muted)]">{selGroup.uc}</p>}
              <p className="text-[var(--estate-text-secondary)]">
                {selGroup.counts.measure} measures · {selGroup.counts.calc_column} calculated columns · {selGroup.counts.column} columns
              </p>
              <StatusBreakdown status={selGroup.status} />
              {(selGroup.issues.block > 0 || selGroup.issues.warn > 0) && (
                <p style={{ color: selGroup.issues.block ? TONE_COLOR.red : TONE_COLOR.amber }}>
                  {selGroup.issues.block} blocking · {selGroup.issues.warn} warning issues inside
                </p>
              )}
              <button type="button" onClick={() => toggle(selGroup.id)} className="rounded border border-[var(--estate-border)] px-2 py-0.5 text-[var(--estate-ink)] hover:bg-[var(--estate-hover)]">
                {expanded.has(selGroup.id) ? 'Collapse table' : 'Open table'}
              </button>
            </div>
          )}
          {selNode && (
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase" style={{ color: (KIND[selNode.kind] ?? KIND.column!).color }}>
                {(KIND[selNode.kind] ?? KIND.column!).label} · {idx.groupById.get(selNode.group)?.name}
              </p>
              <p className="break-words text-ui font-medium text-[var(--estate-ink)]">{selNode.name}</p>
              {selNode.status && <Tag tone={selNode.status === 'recreated' ? 'green' : selNode.status === 'blocked' ? 'red' : selNode.status === 'sql' ? 'blue' : 'neutral'}>{STATUS_LABEL[selNode.status]}</Tag>}
              {selNode.issue && (
                <p
                  className="rounded-md border px-2 py-1.5"
                  style={{
                    color: 'var(--estate-text-secondary)',
                    borderColor: selNode.sev === 'block' ? 'var(--estate-status-error-border)' : 'var(--estate-status-warning-border)',
                    background: selNode.sev === 'block' ? 'var(--estate-status-error-bg)' : 'var(--estate-status-warning-bg)',
                  }}
                >
                  {selNode.issue}
                </p>
              )}
              {selNode.kind === 'measure' && (
                <button type="button" onClick={() => onOpenMeasure(selNode.name)} className="rounded border border-[var(--estate-border)] px-2 py-0.5 text-[var(--estate-ink)] hover:bg-[var(--estate-hover)]">
                  Open measure with its dependency graph
                </button>
              )}
            </div>
          )}
          {selected && <ImpactList affected={view.affected} mode={mode} onOpenMeasure={onOpenMeasure} />}
        </aside>
      </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-[var(--estate-text-muted)]">
        {(Object.keys(STATUS_COLOR) as MeasureStatus[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ background: STATUS_COLOR[k] }} /> {STATUS_LABEL[k]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm border" style={{ borderColor: TONE_COLOR.red }} /> blocking issue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: TONE_COLOR.amber }} /> impact path
        </span>
        <span>Edge width = number of dependencies</span>
      </div>
    </div>
  );
}

function OverviewHelp() {
  return (
    <div className="space-y-1.5 text-[var(--estate-text-secondary)]">
      <p className="text-ui font-medium text-[var(--estate-ink)]">Whole model</p>
      <p>Each box is a table. The bar shows how many of its measures are recreated. Arrows point from what is read to what reads it.</p>
      <p>Click any box to see everything it affects, or switch to “Sources” to see what it depends on. Double-click a table to open its measures and calculated columns in place.</p>
    </div>
  );
}

function StatusBreakdown({ status }: { status: Record<MeasureStatus, number> }) {
  const entries = (Object.keys(STATUS_COLOR) as MeasureStatus[]).filter((k) => status[k]);
  if (!entries.length) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[var(--estate-text-secondary)]">
      {entries.map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-full" style={{ background: STATUS_COLOR[k] }} />
          {status[k]} {STATUS_LABEL[k]}
        </span>
      ))}
    </p>
  );
}

function ImpactList({
  affected,
  mode,
  onOpenMeasure,
}: {
  affected: OverviewNode[];
  mode: 'down' | 'up';
  onOpenMeasure: (name: string) => void;
}) {
  const measures = affected.filter((n) => n.kind === 'measure').sort((a, b) => a.name.localeCompare(b.name));
  const others = affected.length - measures.length;
  const byStatus = measures.reduce<Partial<Record<MeasureStatus, number>>>((acc, m) => {
    if (m.status) acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="space-y-1.5 border-t border-[var(--estate-border)] pt-2">
      <p className="font-medium text-[var(--estate-ink)]">
        {mode === 'down'
          ? `Used by ${measures.length} measure${measures.length === 1 ? '' : 's'}`
          : `Reads ${measures.length} measure${measures.length === 1 ? '' : 's'}`}
        {others > 0 && <span className="font-normal text-[var(--estate-text-muted)]"> · {others} other objects</span>}
      </p>
      {measures.length > 0 && (
        <p className="flex flex-wrap gap-x-3 text-[var(--estate-text-muted)]">
          {(Object.keys(byStatus) as MeasureStatus[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full" style={{ background: STATUS_COLOR[k] }} /> {byStatus[k]} {STATUS_LABEL[k]}
            </span>
          ))}
        </p>
      )}
      <ul className="space-y-0.5">
        {measures.slice(0, 60).map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onOpenMeasure(m.name)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[var(--estate-ink)] hover:bg-[var(--estate-hover)]">
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: m.status ? STATUS_COLOR[m.status] : '#8A93A6' }} />
              <span className="truncate">{m.name}</span>
            </button>
          </li>
        ))}
        {measures.length > 60 && <li className="text-[var(--estate-text-muted)]">+{measures.length - 60} more</li>}
      </ul>
    </div>
  );
}
