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
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
  assumed:   { stroke: '#FDB515', strokeWidth: 2 },
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

const KIND_ICONS: Record<string, string> = {
  table: '▦',
  view:  '◫',
  schema: '⊞',
  catalog: '◉',
};

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
    if (!nodeMap.has(targetId)) {
      ensureNode(targetId, targetId.slice(0, 8) + '…', 'table', targetId, 'object_link');
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

// ── Source provenance colors ───────────────────────────────────────────────
const SOURCE_COLORS: Record<string, string> = {
  entity_group:  '#3B7A4B',
  fk_candidate:  '#2F6DB0',
  object_link:   '#FDB515',
  co_object:     '#8892A4',
};

// ── Custom node component ──────────────────────────────────────────────────
function RelationNode({ data }: { data: GraphNodeData }) {
  const inkColor = data.isFocus ? '#FDB515' : 'var(--estate-ink, #E8E6E1)';
  const bg = data.isFocus
    ? 'rgba(253,181,21,0.10)'
    : 'var(--estate-raised, rgba(13,27,42,0.9))';
  const border = data.isFocus ? '2px solid #FDB515' : '1px solid rgba(255,255,255,0.10)';
  const kindIcon = KIND_ICONS[data.kind] ?? '▦';

  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: bg,
        border,
        borderRadius: 6,
        padding: '7px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11, opacity: 0.55, color: inkColor }}>{kindIcon}</span>
        <span
          style={{
            fontFamily: '"Inter Tight", sans-serif',
            fontSize: 12,
            fontWeight: data.isFocus ? 700 : 500,
            color: inkColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={data.label}
        >
          {data.label}
        </span>
      </div>

      {/* Source provenance dots */}
      {!data.isFocus && data.sources.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginLeft: 20 }}>
          {data.sources.filter(s => s !== 'focus').map((src) => (
            <span
              key={src}
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: SOURCE_COLORS[src] ?? '#8892A4',
                display: 'inline-block',
                flexShrink: 0,
              }}
              title={src.replace(/_/g, ' ')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { relationNode: RelationNode };

// ── Edge legend component ──────────────────────────────────────────────────
const LEGEND_ITEMS = [
  { color: '#3B7A4B', dash: undefined,  label: 'Confirmed' },
  { color: '#FDB515', dash: undefined,  label: 'Proposed' },
  { color: '#2F6DB0', dash: '3,4',     label: 'Co-query' },
  { color: '#C25A2E', dash: '6,5',     label: 'Silo (duplicate candidate)' },
] as const;

function EdgeLegend() {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 16px',
      padding: '8px 12px',
      borderTop: '1px solid rgba(253,181,21,0.08)',
      background: 'var(--estate-bg, #0D1B2A)',
    }}>
      {LEGEND_ITEMS.map(({ color, dash, label }) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width={24} height={4} style={{ flexShrink: 0 }}>
            <line
              x1={0} y1={2} x2={24} y2={2}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={dash}
            />
          </svg>
          <span style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            color: 'var(--estate-text-muted, #8892A4)',
          }}>
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Co-objects sidebar panel ───────────────────────────────────────────────
function CoObjectsSidebar({ coObjects }: { coObjects: CoObjectItem[] }) {
  const total = coObjects.reduce((s, c) => s + (c.co_count ?? 0), 0);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--estate-border-gold, rgba(253,181,21,0.15))',
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--estate-raised, rgba(13,27,42,0.5))',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(253,181,21,0.08)',
        background: 'var(--estate-bg, #0D1B2A)',
      }}>
        <div style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--estate-text-secondary, #8892A4)',
        }}>
          Usage Co-objects
        </div>
        <div style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 10,
          color: 'var(--estate-text-muted, #8892A4)',
          marginTop: 2,
        }}>
          T3 · {coObjects.length} table{coObjects.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {coObjects.length === 0 ? (
          <div style={{
            padding: '16px 14px',
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            color: 'var(--estate-text-muted, #8892A4)',
            textAlign: 'center',
          }}>
            No co-objects recorded
          </div>
        ) : (
          coObjects.map((co, idx) => {
            const name = co.full_path.split('.').pop() ?? co.full_path;
            const n = co.co_count ?? 0;
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            const href = co.object_id ? `/agent-lab/estate/object/${co.object_id}` : null;

            return (
              <div
                key={idx}
                style={{
                  padding: '7px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  borderBottom: idx < coObjects.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {href ? (
                    <Link
                      href={href}
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 12,
                        color: 'var(--estate-ink, #E8E6E1)',
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      className="hover:text-[#FDB515] transition-colors"
                      title={co.full_path}
                    >
                      {name}
                    </Link>
                  ) : (
                    <span
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 12,
                        color: 'var(--estate-ink, #E8E6E1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      title={co.full_path}
                    >
                      {name}
                    </span>
                  )}
                  {n > 0 && (
                    <span style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 11,
                      color: '#FDB515',
                      flexShrink: 0,
                    }}>
                      {pct}%
                    </span>
                  )}
                </div>
                {/* Mini bar */}
                {n > 0 && (
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: '#2F6DB0',
                      borderRadius: 2,
                    }} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
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

  const [nodes, , onNodesChange] = useNodesState(initNodes);
  const [edges, , onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    const timeout = setTimeout(() => fitView({ padding: 0.25 }), 80);
    return () => clearTimeout(timeout);
  }, [fitView]);

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
      <Background color="rgba(255,255,255,0.03)" gap={24} />
      <Controls
        style={{
          background: 'var(--estate-raised, rgba(13,27,42,0.85))',
          border: '1px solid rgba(253,181,21,0.15)',
          borderRadius: 6,
        }}
      />
    </ReactFlow>
  );
}

// ── Public component ───────────────────────────────────────────────────────

export default function RelationshipGraph(props: RelationshipGraphProps) {
  const totalEdges =
    props.entityGroupObjects.length +
    props.fkCandidates.length +
    props.objectLinks.length +
    props.coObjects.length;

  const hasCoObjects = props.coObjects.length > 0;

  if (totalEdges === 0) {
    return (
      <div
        style={{
          height: 240,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px dashed rgba(253,181,21,0.2)',
          background: 'var(--estate-raised, rgba(13,27,42,0.4))',
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 12,
          color: '#8892A4',
        }}
      >
        No relationships found yet — run T3 usage or silo scan to discover connections.
      </div>
    );
  }

  return (
    <div>
      {/* Graph + Co-objects sidebar in a 2-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: hasCoObjects ? '1fr 260px' : '1fr', gap: 16 }}>
        {/* Graph area */}
        <div style={{
          borderRadius: 8,
          border: '1px solid rgba(253,181,21,0.12)',
          overflow: 'hidden',
          background: 'var(--estate-raised, rgba(13,27,42,0.7))',
        }}>
          <div style={{ height: 420 }}>
            <ReactFlowProvider>
              <GraphInner {...props} />
            </ReactFlowProvider>
          </div>
          <EdgeLegend />
        </div>

        {/* Co-objects sidebar */}
        {hasCoObjects && (
          <CoObjectsSidebar coObjects={props.coObjects} />
        )}
      </div>
    </div>
  );
}
