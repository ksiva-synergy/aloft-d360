/**
 * src/lib/inspector/teach-feed.ts
 *
 * Teach Phase 3 — the READ-ONLY typed candidate feed and the hand-off contract.
 *
 * This is the boundary between Teach (which CAPTURES candidates) and a future
 * Build thread (which REVIEWS/RESOLVES/COMMITS them). `TeachCandidate` is that
 * contract: a stable, serializable projection of one captured personal learning.
 * Build codes against this shape without reading Teach's internals.
 *
 * STRICTLY READ-ONLY. Every function here is a projection: a `findMany`-shaped
 * read, fail-closed on author, no mutation, no promote, no credit. It does NOT
 * re-run verification or re-detect conflict — it reflects what capture persisted
 * (teach-candidate-store.ts). Re-execution would be a write-shaped side effect.
 *
 * SCOPING: a caller sees ONLY their own personal candidates. An unresolved caller
 * (null author) sees NONE — never another user's. Mirrors the Phase-2 personal-
 * lane visibility clause.
 *
 * EXCLUSIONS: a rejected candidate (keep_existing) has been soft-deleted on its
 * memory row (status='SUPERSEDED'); the join filters status='ACTIVE', so rejected
 * candidates are excluded from the feed — the same soft-delete that removes them
 * from the recall lane. Belt-and-braces, state<>'rejected' is also filtered.
 */

// NB: no `server-only` guard — this module mirrors retrieve.ts (prisma access
// without the RSC guard) so its PURE projection helpers (projectRow / deriveState
// / buildTeachFeed) stay unit-testable under vitest. The DB read (getTeachFeed) is
// still server-invoked only, via the GET route. The write-side store keeps its
// `server-only` guard (it is lazy-imported, never client-bundled).
import prisma from '@/lib/db';
import type {
  LearningType,
  VerificationResult,
  ConflictInfo,
  ConflictResolution,
} from './reflect-tools';

/** The feed's display state. Stored card state is proposed|verified|conflict|
 *  rejected; 'resolved' is DERIVED when a conflict carried a recorded resolution
 *  (the learning advanced out of conflict). rejected never reaches the feed. */
export type TeachCandidateState = 'proposed' | 'verified' | 'conflict' | 'resolved';

/**
 * THE HAND-OFF CONTRACT. A stable, serializable projection of one captured
 * candidate. This is the interface a future Build thread consumes.
 */
export interface TeachCandidate {
  /** platform_agent_memory.id — the durable id Build references. */
  id: string;
  type: LearningType;
  statement: string;
  state: TeachCandidateState;
  /** The recorded read-only verification outcome, incl. the honest
   *  not_verifiable (governed-gate) state. Null if never verified. */
  verification_result: VerificationResult | null;
  /** Existing-vs-new contradiction detected at capture. Null if none. */
  conflict: ConflictInfo | null;
  /** The user's recorded resolution choice, or null if unresolved. */
  resolution: ConflictResolution | null;
  /** created_by — the author this candidate is scoped to. */
  author: string;
  /** The Teach session that captured it; null if unresolved at capture. */
  sessionId: string | null;
  /** ISO capture timestamp. */
  capturedAt: string;
}

/** The ready-to-hand-off summary the Digest surfaces. */
export interface TeachFeed {
  candidates: TeachCandidate[];
  /** Candidates ready to hand off = verified + resolved + proposed. A `conflict`
   *  is NOT ready (awaits resolution); rejected are already excluded. */
  readyCount: number;
  /** Count still awaiting the user's conflict resolution. */
  conflictCount: number;
  total: number;
}

export interface FeedRow {
  memory_id: string;
  statement: string;
  author: string;
  session_id: string | null;
  learning_type: string;
  state: string;
  verification: unknown;
  conflict: unknown;
  resolution: unknown;
  captured_at: Date;
}

const LEARNING_TYPES = new Set<LearningType>([
  'metric_definition', 'enterprise_convention', 'estate_navigation', 'vocabulary_entity', 'other',
]);
function coerceType(v: string): LearningType {
  return LEARNING_TYPES.has(v as LearningType) ? (v as LearningType) : 'other';
}

/** Derive the feed's display state from the stored card state + resolution. */
export function deriveState(stored: string, resolution: ConflictResolution | null): TeachCandidateState {
  if (stored === 'conflict') return 'conflict';
  // A recorded resolution on a non-conflict card means it was resolved.
  if (resolution) return 'resolved';
  if (stored === 'verified') return 'verified';
  return 'proposed';
}

/** Pure summary: ready = verified + resolved + proposed (a conflict is NOT
 *  ready). Kept pure + exported so the ready-count semantics are unit-testable. */
export function buildTeachFeed(candidates: TeachCandidate[]): TeachFeed {
  const conflictCount = candidates.filter((c) => c.state === 'conflict').length;
  return {
    candidates,
    readyCount: candidates.length - conflictCount,
    conflictCount,
    total: candidates.length,
  };
}

export function projectRow(r: FeedRow): TeachCandidate {
  const resolution = (r.resolution as ConflictResolution | null) ?? null;
  return {
    id: r.memory_id,
    type: coerceType(r.learning_type),
    statement: r.statement,
    state: deriveState(r.state, resolution),
    verification_result: (r.verification as VerificationResult | null) ?? null,
    conflict: (r.conflict as ConflictInfo | null) ?? null,
    resolution,
    author: r.author,
    sessionId: r.session_id,
    capturedAt: r.captured_at.toISOString(),
  };
}

/**
 * Project this author's ACTIVE personal candidates into the typed feed. READ-ONLY.
 * Fail-closed: a null/empty author returns an empty feed WITHOUT querying — never
 * another user's candidates. Optionally scoped to a single Teach session.
 */
export async function getTeachFeed(
  orgId: string,
  authorUserId: string | null,
  opts: { sessionId?: string | null } = {},
): Promise<TeachFeed> {
  if (!authorUserId) {
    return { candidates: [], readyCount: 0, conflictCount: 0, total: 0 };
  }

  const sessionId = opts.sessionId ?? null;
  const rows = sessionId
    ? await prisma.$queryRaw<FeedRow[]>`
        SELECT m.id AS memory_id, m.rule_text AS statement, m.created_by AS author,
               tc.session_id, tc.learning_type, tc.state,
               tc.verification, tc.conflict, tc.resolution, tc.captured_at
        FROM platform_teach_candidate tc
        JOIN platform_agent_memory m ON m.id = tc.memory_id
        WHERE tc.org_id = ${orgId}
          AND tc.author_user_id = ${authorUserId}
          AND m.status = 'ACTIVE'
          AND m.visibility = 'personal'
          AND tc.state <> 'rejected'
          AND tc.session_id = ${sessionId}
        ORDER BY tc.captured_at DESC`
    : await prisma.$queryRaw<FeedRow[]>`
        SELECT m.id AS memory_id, m.rule_text AS statement, m.created_by AS author,
               tc.session_id, tc.learning_type, tc.state,
               tc.verification, tc.conflict, tc.resolution, tc.captured_at
        FROM platform_teach_candidate tc
        JOIN platform_agent_memory m ON m.id = tc.memory_id
        WHERE tc.org_id = ${orgId}
          AND tc.author_user_id = ${authorUserId}
          AND m.status = 'ACTIVE'
          AND m.visibility = 'personal'
          AND tc.state <> 'rejected'
        ORDER BY tc.captured_at DESC`;

  return buildTeachFeed(rows.map(projectRow));
}
