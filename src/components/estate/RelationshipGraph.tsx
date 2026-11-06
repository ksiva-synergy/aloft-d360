'use client';

// RelationshipGraph — redesigned (UX pass).
//
// Key changes from original:
//   - Container height increased from 340 → 420px
//   - Dagre layout switched to TB (top-bottom) with more generous spacing
//   - Larger, cleaner nodes (180×52px) with kind icon and better typography
//   - Edge legend strip beneath the graph
//   - Co-objects (T3 usage) shown as an integrated sidebar panel alongside graph
//   - "focusFull" prop retained for compatibility
//
// Relationship sources remain the same four (entity_group, fk_candidate, object_link, co_object).

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { useRouter } from '@/lib/navigation';
import { Card } from './object-ui';
import { type } from '@/lib/typography/tokens';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FkCandidate {
  column: string;
  likely_target: string;
  confidence: number;
}

export interface ObjectLinkItem {
  id: string;
  left_object_id: string;
  right_object_id: string;
  link_kind: string;
  score: number | null;
  signals: unknown;
  llm_verdict: unknown;
  status: string;
  /** Both ends, included by getObjectAggregate so nodes show names, not ids. */
  left_object?: { id: string; full_path: string; object_name: string | null; object_kind?: string } | null;
  right_object?: { id: string; full_path: string; object_name: string | null; object_kind?: string } | null;
}

export interface EntityGroupObject {
  id: string;
  full_path: string;
  object_name: string | null;
  object_kind: string;
}

export interface CoObjectItem {
  full_path: string;
  object_id?: string;
  co_count?: number;
}

export interface RelationshipGraphProps {
  focusObjectId: string;
  focusObjectName: string;
  focusObjectKind: string;
  focusFull: string;
  entityGroupObjects: EntityGroupObject[];
  fkCandidates: FkCandidate[];
  objectLinks: ObjectLinkItem[];
  coObjects: CoObjectItem[];
}

// ── Node / edge build helpers ──────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 52;

type GraphNodeData = {
  label: string;
  kind: string;
  objectId: string | null;
  isFocus: boolean;
  sources: string[];
};

type GraphEdgeData = {
  linkKind: string;
  trust: EdgeTreatment;
  score: number | null;
  count: number;
  linkId?: string;
  sourceType: 'entity_group' | 'fk_candidate' | 'object_link' | 'co_object';
};

type EdgeTreatment = 'confirmed' | 'assumed' | 'co_query' | 'silo';

function trustFromStatus(status: string, linkKind: string): EdgeTreatment {
  if (status === 'confirmed') return 'confirmed';
  if (linkKind === 'co_query' || linkKind === 'co-query') return 'co_query';
  if (linkKind === 'silo' || linkKind.includes('silo')) return 'silo';
  return 'assumed';
}

const EDGE_STYLES: Record<EdgeTreatment, React.CSSProperties & { strokeDasharray?: string }> = {
  confirmed: { stroke: '#3B7A4B', strokeWidth: 2 },
  assumed:   { stroke: 'var(--brand-a)', strokeWidth: 2 },
  co_query:  { stroke: '#2F6DB0', strokeWidth: 1.5, strokeDasharray: '3,4' },
  silo:      { stroke: '#C25A2E', strokeWidth: 2,   strokeDasharray: '6,5' },
};

function edgeStyle(treatment: EdgeTreatment) {
  return EDGE_STYLES[treatment];
}

function shortLabel(fullPath: string, objectName: string | null): string {
  if (objectName) return objectName;
  const parts = fullPath.split('.');
  return parts[parts.length - 1] || fullPath;
}

function buildGraph(props: RelationshipGraphProps): {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
} {
  const {
    focusObjectId, focusObjectName, focusObjectKind, focusFull,
    entityGroupObjects, fkCandidates, objectLinks, coObjects,
  } = props;

  const nodeMap = new Map<string, GraphNodeData & { key: string }>();
  nodeMap.set(focusObjectId, {
    key: focusObjectId,
    label: focusObjectName || focusFull.split('.').pop() || 'this object',
    kind: focusObjectKind,
    objectId: focusObjectId,
    isFocus: true,
    sources: ['focus'],
  });

  function ensureNode(key: string, label: string, kind: string, objectId: string | null, source: string) {
    if (nodeMap.has(key)) {
      const n = nodeMap.get(key)!;
      if (!n.sources.includes(source)) n.sources.push(source);
      return key;
    }
    nodeMap.set(key, { key, label, kind, objectId, isFocus: false, sources: [source] });
    return key;
  }

  const edgeMap = new Map<string, GraphEdgeData & { src: string; dst: string; edgeKey: string }>();

  function ensureEdge(srcKey: string, dstKey: string, data: Omit<GraphEdgeData, 'count'>) {
    const edgeKey = `${srcKey}::${dstKey}::${data.linkKind}`;
    const rev = `${dstKey}::${srcKey}::${data.linkKind}`;
    const existingKey = edgeMap.has(edgeKey) ? edgeKey : edgeMap.has(rev) ? rev : null;
    if (existingKey) {
      edgeMap.get(existingKey)!.count += 1;
    } else {
      edgeMap.set(edgeKey, { ...data, count: 1, src: srcKey, dst: dstKey, edgeKey });
    }
  }

  for (const sib of entityGroupObjects) {
    ensureNode(sib.id, shortLabel(sib.full_path, sib.object_name), sib.object_kind, sib.id, 'entity_group');
    ensureEdge(focusObjectId, sib.id, { linkKind: 'entity_group', trust: 'confirmed', score: null, sourceType: 'entity_group' });
  }

  for (const fk of fkCandidates) {
    const key = `fk::${fk.likely_target}`;
    const label = fk.likely_target.split('.').pop() ?? fk.likely_target;
    ensureNode(key, label, 'table', null, 'fk_candidate');
    ensureEdge(focusObjectId, key, {
      linkKind: 'fk_candidate',
      trust: fk.confidence >= 0.8 ? 'confirmed' : 'assumed',
      score: fk.confidence,
      sourceType: 'fk_candidate',
    });
  }

  for (const link of objectLinks) {
    const isLeft = link.left_object_id === focusObjectId;
    const targetId = isLeft ? link.right_object_id : link.left_object_id;
    // getObjectAggregate includes both ends; fall back to a short id for older payloads.
    const named = (isLeft ? link.right_object : link.left_object) ?? null;
    if (!nodeMap.has(targetId)) {
      ensureNode(
        targetId,
        named ? shortLabel(named.full_path, named.object_name) : targetId.slice(0, 8) + '…',
        named?.object_kind ?? 'table',
        targetId,
        'object_link',
      );
    } else {
      const n = nodeMap.get(targetId)!;
      if (!n.sources.includes('object_link')) n.sources.push('object_link');
    }
    ensureEdge(focusObjectId, targetId, {
      linkKind: link.link_kind,
      trust: trustFromStatus(link.status, link.link_kind),
      score: link.score,
      linkId: link.id,
      sourceType: 'object_link',
    });
  }

  // Co-objects shown in sidebar, still added to graph as lightweight nodes
  for (const co of coObjects) {
    const key = co.object_id ?? `co::${co.full_path}`;
    const label = co.full_path.split('.').pop() ?? co.full_path;
    if (!nodeMap.has(key)) {
      ensureNode(key, label, 'table', co.object_id ?? null, 'co_object');
    } else {
      const n = nodeMap.get(key)!;
      if (!n.sources.includes('co_object')) n.sources.push('co_object');
    }
    ensureEdge(focusObjectId, key, {
      linkKind: 'co_object',
      trust: 'co_query',
      score: co.co_count ? Math.min(co.co_count / 100, 1) : null,
      sourceType: 'co_object',
    });
  }

  // Dagre layout — LR with more generous spacing
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 40 });

  for (const [key] of nodeMap) {
    g.setNode(key, { width: NODE_W, height: NODE_H });
  }
  for (const [, e] of edgeMap) {
    g.setEdge(e.src, e.dst);
  }
  dagre.layout(g);

  const rfNodes: Node<GraphNodeData>[] = [];
  for (const [key, nodeData] of nodeMap) {
    const pos = g.node(key);
    rfNodes.push({
      id: key,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: {
        label: nodeData.label,
        kind: nodeData.kind,
        objectId: nodeData.objectId,
        isFocus: nodeData.isFocus,
        sources: nodeData.sources,
      },
      type: 'relationNode',
      draggable: true,
    });
  }

  const rfEdges: Edge<GraphEdgeData>[] = [];
  let edgeIdx = 0;
  for (const [, e] of edgeMap) {
    const style = edgeStyle(e.trust);
    rfEdges.push({
      id: `e-${edgeIdx++}`,
      source: e.src,
      target: e.dst,
      data: {
        linkKind: e.linkKind,
        trust: e.trust,
        score: e.score,
        count: e.count,
        linkId: e.linkId,
        sourceType: e.sourceType,
      },
      style,
      markerEnd: e.trust !== 'silo'
        ? { type: MarkerType.ArrowClosed, color: style.stroke as string, width: 12, height: 12 }
        : undefined,
      animated: e.trust === 'assumed',
      label: e.count > 1
        ? `×${e.count}`
        : e.sourceType === 'fk_candidate' && e.score != null
          ? `${Math.round(e.score * 100)}%`
          : undefined,
    } as Edge<GraphEdgeData>);
  }

  return { nodes: rfNodes, edges: rfEdges };
}

/// ── Source labels / colours ────────────────────────────────────────────────
const SOURCE_META: Record<string, { label: string; color: string }> = {
  entity_group: { label: 'entity_group', color: '#3B7A4B' },
  fk_candidate: { label: 'fk_candidate', color: '#2F6DB0' },
  object_link:  { label: 'object_link',  color: 'var(--brand-a)' },
  co_object:    { label: 'co_object',    color: '#B4801A' },
};

// ── Custom node component ──────────────────────────────────────────────────
function RelationNode({ data }: { data: GraphNodeData }) {
  const sources = data.sources.filter((s) => s !== 'focus');
  const clickable = !data.isFocus && !!data.objectId;
  const handleStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    border: 'none',
    background: 'transparent',
  };

  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: data.isFocus ? 'var(--brand-a)' : 'var(--estate-raised)',
        border: data.isFocus ? '1px solid var(--brand-a)' : '1px solid var(--estate-border)',
        borderRadius: 10,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        boxShadow: data.isFocus
          ? '0 6px 18px color-mix(in srgb, var(--brand-a) 30%, transparent)'
          : '0 1px 2px rgba(17,19,34,0.06)',
        cursor: clickable ? 'pointer' : 'default',
      }}
      title={clickable ? `Open ${data.label}` : data.label}
    >
      {!data.isFocus && (
        <Handle type="target" position={Position.Left} style={handleStyle} />
      )}
      {data.isFocus && (
        <Handle type="source" position={Position.Right} style={handleStyle} />
      )}
      <span
        style={{
          ...type.ui,
          fontWeight: 600,
          color: data.isFocus ? '#fff' : 'var(--estate-ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...type.caption, color: data.isFocus ? 'rgba(255,255,255,0.8)' : 'var(--estate-text-muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {data.isFocus ? (
          'This table'
        ) : (
          <>
            {sources.map((s) => (
              <span key={s} aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: SOURCE_META[s]?.color ?? 'var(--estate-text-muted)', flexShrink: 0 }} />
            ))}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sources.map((s) => SOURCE_META[s]?.label ?? s).join(' · ')}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

const nodeTypes: NodeTypes = { relationNode: RelationNode };

// ── Edge legend ────────────────────────────────────────────────────────────
const LEGEND_ITEMS = [
  { color: '#3B7A4B',       dash: undefined, label: 'confirmed' },
  { color: 'var(--brand-a)', dash: undefined, label: 'proposed' },
  { color: '#2F6DB0',       dash: '3,4',     label: 'co_query' },
  { color: '#C25A2E',       dash: '6,5',     label: 'silo (duplicate candidate)' },
] as const;

function EdgeLegend() {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 18px',
        padding: '10px 20px',
        borderTop: '1px solid var(--estate-border)',
      }}
    >
      {LEGEND_ITEMS.map(({ color, dash, label }) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width={22} height={4} aria-hidden="true" style={{ flexShrink: 0 }}>
            <line x1={0} y1={2} x2={22} y2={2} stroke={color} strokeWidth={2} strokeDasharray={dash} />
          </svg>
          <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{label}</span>
        </span>
      ))}
      <span style={{ ...type.caption, color: 'var(--estate-text-muted)', marginLeft: 'auto' }}>
        Click a table to open it · drag to rearrange
      </span>
    </div>
  );
}

// ── Inner graph component ──────────────────────────────────────────────────
function GraphInner(props: RelationshipGraphProps) {
  const router = useRouter();
  const { fitView } = useReactFlow();

  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildGraph(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.focusObjectId, props.entityGroupObjects, props.fkCandidates, props.objectLinks, props.coObjects],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    setNodes(initNodes);
    setEdges(initEdges);
  }, [initNodes, initEdges, setNodes, setEdges]);

  useEffect(() => {
    const timeout = setTimeout(() => fitView({ padding: 0.25 }), 80);
    return () => clearTimeout(timeout);
  }, [fitView, initNodes, initEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<GraphNodeData>) => {
      if (node.data.isFocus) return;
      if (node.data.objectId && !node.id.startsWith('fk::') && !node.id.startsWith('co::')) {
        router.push(`/agent-lab/estate/object/${node.data.objectId}`);
      }
    },
    [router],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      nodesDraggable
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.3}
      maxZoom={2.5}
      style={{ background: 'transparent' }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="color-mix(in srgb, var(--ink-1) 8%, transparent)" gap={20} size={1} />
      <Controls
        showInteractive={false}
        style={{
          background: 'var(--estate-raised)',
          border: '1px solid var(--estate-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      />
    </ReactFlow>
  );
}

// ── Public component ───────────────────────────────────────────────────────

export default function RelationshipGraph(props: RelationshipGraphProps) {
  const nodeCount = new Set([
    ...props.entityGroupObjects.map((o) => o.id),
    ...props.fkCandidates.map((f) => `fk::${f.likely_target}`),
    ...props.objectLinks.map((l) => (l.left_object_id === props.focusObjectId ? l.right_object_id : l.left_object_id)),
    ...props.coObjects.map((c) => c.object_id ?? `co::${c.full_path}`),
  ]).size;

  // The list below carries the empty state — no second empty box here.
  if (nodeCount === 0) return null;

  const height = Math.min(520, Math.max(280, 120 + nodeCount * 36));

  return (
    <Card title="Relationship map" meta={`${nodeCount} connected table${nodeCount === 1 ? '' : 's'}`} flush>
      <div style={{ height, background: 'var(--estate-bg)' }}>
        <ReactFlowProvider>
          <GraphInner {...props} />
        </ReactFlowProvider>
      </div>
      <EdgeLegend />
    </Card>
  );
}
