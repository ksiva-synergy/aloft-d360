import { prisma } from '@/lib/prisma';
import { createId } from '@paralleldrive/cuid2';
import { getDefaultOrg } from '@/lib/org';
import type { TracePayload } from './types';
import { truncatePayload } from './types';

// ── In-flight promise registry — for flushPendingWrites() ────────────────────

const _inflight: Set<Promise<unknown>> = new Set();

function track(p: Promise<unknown>): void {
  _inflight.add(p);
  p.finally(() => _inflight.delete(p));
}

// ── Fire-and-forget node write ────────────────────────────────────────────────

function writeNode(data: {
  id: string;
  orgId: string;
  sessionId: string;
  agentClass?: string;
  nodeType: string;
  payload: TracePayload;
}): void {
  const safe = truncatePayload(data.payload);
  const p = prisma.platformTraceNode.create({
    data: {
      id:         data.id,
      orgId:      data.orgId,
      sessionId:  data.sessionId,
      agentClass: data.agentClass,
      nodeType:   data.nodeType,
      payload:    safe as object,
    },
  }).catch((err: unknown) => {
    console.error('[trace/capture] node write failed:', err);
  });
  track(p);
}

// ── Fire-and-forget edge write ────────────────────────────────────────────────

function writeEdge(data: {
  id: string;
  orgId: string;
  sessionId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
}): void {
  const p = prisma.platformTraceEdge.create({ data }).catch((err: unknown) => {
    console.error('[trace/capture] edge write failed:', err);
  });
  track(p);
}

// ── TraceWriter ───────────────────────────────────────────────────────────────

export interface TraceWriter {
  /** Record a tool invocation. Returns the generated node id synchronously. */
  action(payload: TracePayload): string;

  /**
   * Record the outcome of a prior action.
   * Writes node + LED_TO edge from fromNodeId → this node.
   */
  outcome(payload: TracePayload, opts: { fromNodeId: string }): string;

  /**
   * Record a correction applied to a prior node.
   * Writes node + CORRECTED_BY edge from correctsNodeId → this node.
   */
  correction(payload: TracePayload, opts: { correctsNodeId: string }): string;

  /** Record a source reference node. Returns the generated node id synchronously. */
  source(payload: TracePayload): string;

  /**
   * Record a dead-end (failed path).
   * Optionally writes a LED_TO edge from fromNodeId → this node.
   */
  deadEnd(payload: TracePayload, opts?: { fromNodeId?: string }): string;
}

// ── openSession ───────────────────────────────────────────────────────────────

export function openSession(sessionId: string, agentClass?: string): TraceWriter {
  const orgId = getDefaultOrg().id;

  function makeNodeId(): string {
    return createId();
  }

  return {
    action(payload) {
      const id = makeNodeId();
      writeNode({ id, orgId, sessionId, agentClass, nodeType: 'ACTION', payload });
      return id;
    },

    outcome(payload, { fromNodeId }) {
      const id = makeNodeId();
      writeNode({ id, orgId, sessionId, agentClass, nodeType: 'OUTCOME', payload });
      writeEdge({
        id:         createId(),
        orgId,
        sessionId,
        fromNodeId,
        toNodeId:   id,
        edgeType:   'LED_TO',
      });
      return id;
    },

    correction(payload, { correctsNodeId }) {
      const id = makeNodeId();
      writeNode({ id, orgId, sessionId, agentClass, nodeType: 'CORRECTION', payload });
      writeEdge({
        id:         createId(),
        orgId,
        sessionId,
        fromNodeId: correctsNodeId,
        toNodeId:   id,
        edgeType:   'CORRECTED_BY',
      });
      return id;
    },

    source(payload) {
      const id = makeNodeId();
      writeNode({ id, orgId, sessionId, agentClass, nodeType: 'SOURCE', payload });
      return id;
    },

    deadEnd(payload, opts) {
      const id = makeNodeId();
      writeNode({ id, orgId, sessionId, agentClass, nodeType: 'DEAD_END', payload });
      if (opts?.fromNodeId) {
        writeEdge({
          id:         createId(),
          orgId,
          sessionId,
          fromNodeId: opts.fromNodeId,
          toNodeId:   id,
          edgeType:   'LED_TO',
        });
      }
      return id;
    },
  };
}

// ── flushPendingWrites ────────────────────────────────────────────────────────
// Awaits all in-flight detached promises. For use in verify scripts and tests
// only — never call this on a hot production path.

export function flushPendingWrites(): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled([..._inflight]);
}
