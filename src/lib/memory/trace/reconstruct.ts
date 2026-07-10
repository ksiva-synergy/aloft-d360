import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

// ── Return types ──────────────────────────────────────────────────────────────

export interface TraceWalkRow {
  id:          string;
  nodeType:    string;
  payload:     unknown;
  tokensIn:    number | null;
  tokensOut:   number | null;
  createdAt:   Date;
  fromNodeId:  string | null;
  edgeType:    string | null;
  depth:       number;
}

// Raw row returned by the CTE before camelCase mapping.
interface RawWalkRow {
  id:           string;
  node_type:    string;
  payload:      unknown;
  tokens_in:    number | null;
  tokens_out:   number | null;
  created_at:   Date;
  from_node_id: string | null;
  edge_type:    string | null;
  depth:        number;
}

// ── reconstructSession ────────────────────────────────────────────────────────
// Runs a depth-bounded recursive CTE (max depth 3) that walks the trace graph
// starting from root nodes (nodes with no incoming edges in this session).

export async function reconstructSession(
  orgId: string,
  sessionId: string,
): Promise<TraceWalkRow[]> {
  const rows = await prisma.$queryRaw<RawWalkRow[]>(
    Prisma.sql`
      WITH RECURSIVE walk AS (
        SELECT
          tn.id,
          tn.node_type,
          tn.payload,
          tn.tokens_in,
          tn.tokens_out,
          tn.created_at,
          NULL::text AS from_node_id,
          NULL::text AS edge_type,
          0           AS depth
        FROM platform_trace_nodes tn
        WHERE tn.org_id    = ${orgId}
          AND tn.session_id = ${sessionId}
          AND NOT EXISTS (
            SELECT 1
            FROM platform_trace_edges te
            WHERE te.to_node_id = tn.id
              AND te.org_id     = ${orgId}
          )
        UNION ALL
        SELECT
          tn.id,
          tn.node_type,
          tn.payload,
          tn.tokens_in,
          tn.tokens_out,
          tn.created_at,
          e.from_node_id,
          e.edge_type,
          w.depth + 1
        FROM walk w
        JOIN platform_trace_edges e
          ON  e.from_node_id = w.id
          AND e.org_id       = ${orgId}
        JOIN platform_trace_nodes tn
          ON  tn.id      = e.to_node_id
          AND tn.org_id  = ${orgId}
        WHERE w.depth < 3
      )
      SELECT * FROM walk ORDER BY created_at ASC
    `,
  );

  return rows.map((r) => ({
    id:         r.id,
    nodeType:   r.node_type,
    payload:    r.payload,
    tokensIn:   r.tokens_in,
    tokensOut:  r.tokens_out,
    createdAt:  r.created_at,
    fromNodeId: r.from_node_id,
    edgeType:   r.edge_type,
    depth:      Number(r.depth),
  }));
}

// ── getSessionNodes ───────────────────────────────────────────────────────────
// Lightweight flat list of all nodes in the session — no CTE, no edge traversal.

export async function getSessionNodes(orgId: string, sessionId: string) {
  return prisma.platformTraceNode.findMany({
    where:   { orgId, sessionId },
    orderBy: { createdAt: 'asc' },
  });
}
