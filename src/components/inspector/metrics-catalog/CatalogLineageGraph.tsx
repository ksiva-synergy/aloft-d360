'use client';

import React from 'react';
import {
  ReactFlow,
  Background,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  ReactFlowProvider,
  MarkerType,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { MONO, MUTED, INK, BORDER } from './mc-ui';

/**
 * Compact lineage graph for the detail drawer. Consumes the focus subgraph from
 * GET /api/inspector/semantic/lineage?focus=<nodeId> (LineageGraph) and lays it
 * out LR: physical table → dimensions/measures → consumers. Mirrors the
 * xyflow + dagre pattern in estate/RelationshipGraph.tsx. Upstream nodes are
 * clickable to refocus. Small by construction — one item's neighborhood.
 */

// Client mirror of the lineage payload (see src/lib/semantic/lineage.ts).
export interface LineageNodeDTO {
  id: string;
  kind: 'estate' | 'dimension' | 'measure' | 'consumer';
  label: string;
  status?: string;
}
export interface LineageEdgeDTO {
  from: string;
  to: string;
  kind: 'membership' | 'join' | 'consumes';
  candidate?: boolean;
}
export interface LineageGraphDTO {
  nodes: LineageNodeDTO[];
  edges: LineageEdgeDTO[];
}

const NODE_W = 168;
const NODE_H = 46;

const kindColor = (kind: LineageNodeDTO['kind']): string =>
  kind === 'estate'
    ? 'var(--mc-kind-entity)'
    : kind === 'measure'
      ? 'var(--mc-kind-measure)'
      : kind === 'dimension'
        ? 'var(--mc-kind-dimension)'
        : 'var(--wb-muted, #8892A4)';

const kindGlyph: Record<LineageNodeDTO['kind'], string> = {
  estate: '▦',
  measure: 'Σ',
  dimension: '◈',
  consumer: '▤',
};

type NodeData = { label: string; kind: LineageNodeDTO['kind']; focus: boolean; candidate: boolean };

function LineageNode({ data }: NodeProps) {
  const d = data as NodeData;
  const c = kindColor(d.kind);
  return (
    <div
      style={{
        width: NODE_W, height: NODE_H, borderRadius: 5, padding: '6px 9px',
        border: `1px solid ${d.focus ? c : BORDER}`,
        background: d.focus ? `color-mix(in srgb, ${c} 16%, var(--card,#0d1520))` : 'var(--card,#0d1520)',
        display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden',
        boxShadow: d.focus ? `0 0 0 1px ${c}` : 'none',
        opacity: d.candidate ? 0.85 : 1,
      }}
    >
      <span style={{ ...MONO, fontSize: 8, color: c, letterSpacing: '0.04em' }}>
        {kindGlyph[d.kind]} {d.kind.toUpperCase()}{d.candidate ? ' · CAND' : ''}
      </span>
      <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 11, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {d.label}
      </span>
    </div>
  );
}

const nodeTypes: NodeTypes = { lineageNode: LineageNode };

function layout(graph: LineageGraphDTO, focusId: string): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 24, marginx: 8, marginy: 8 });

  const present = new Set(graph.nodes.map((n) => n.id));
  for (const n of graph.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of graph.edges) if (present.has(e.from) && present.has(e.to)) g.setEdge(e.from, e.to);
  dagre.layout(g);

  const nodes: Node<NodeData>[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: 'lineageNode',
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      data: { label: n.label, kind: n.kind, focus: n.id === focusId, candidate: n.status === 'candidate' },
    };
  });

  const edges: Edge[] = graph.edges
    .filter((e) => present.has(e.from) && present.has(e.to))
    .map((e, i) => ({
      id: `${e.from}->${e.to}-${i}`,
      source: e.from,
      target: e.to,
      animated: false,
      style: { stroke: e.candidate ? 'var(--mc-status-candidate)' : 'var(--wb-muted,#8892A4)', strokeWidth: 1.5, strokeDasharray: e.candidate ? '5,4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));

  return { nodes, edges };
}

interface Props {
  graph: LineageGraphDTO;
  focusId: string;
  onRefocus: (nodeId: string) => void;
}

export function CatalogLineageGraph({ graph, focusId, onRefocus }: Props) {
  const { nodes, edges } = React.useMemo(() => layout(graph, focusId), [graph, focusId]);

  if (!graph.nodes.length) {
    return <div style={{ ...MONO, fontSize: 10, color: MUTED, padding: 12 }}>No lineage for this definition.</div>;
  }

  return (
    <div style={{ height: 260, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_e, node) => { if (node.id !== focusId) onRefocus(node.id); }}
        >
          <Background gap={16} color="rgba(136,146,164,0.12)" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
