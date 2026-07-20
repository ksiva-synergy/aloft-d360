/**
 * src/lib/inspector/teach-candidate-store.ts
 *
 * Teach Phase 3 (capture-shape commit) — the WRITE side of the typed candidate
 * feed. Persists the learning envelope the Reflect loop currently only emits over
 * SSE (type / state / verification / conflict / resolution / session) into the
 * companion table `platform_teach_candidate`, 1:1 with the personal rule row
 * (`platform_agent_memory`) it annotates.
 *
 * WHY A COMPANION TABLE (lane-invariance): the memory-retrieval path
 * (retrieve.ts selectPhase1a + appendPersonalTaughtLane) reads ONLY memory-row
 * columns and NONE of this table. So persisting the envelope here leaves the
 * personal-taught lane byte-for-byte identical. The single exception is a
 * REJECTION (resolveCandidateByMemoryId → keep_existing), which flips the memory
 * row to status='SUPERSEDED' — the pre-existing soft-delete the lane already
 * filters out (identical to teach.ts retireMyRule) — so a rejected candidate
 * leaves BOTH the feed and recall through mechanisms that already exist.
 *
 * All writers are BEST-EFFORT from the loop's perspective (the dispatcher wraps
 * each call in try/catch): a persistence failure never blocks a capture (C2).
 * This module is the ENGINE — it is server-only and lazy-imported by
 * reflect-tools' DEFAULT_DEPS, so the pure dispatcher stays unit-testable.
 *
 * READ-ONLY PROJECTION is deliberately NOT here — it lives in the Phase-3
 * read-only module (teach-feed.ts). This file only writes.
 */

import 'server-only';
import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import {
  nextStateForResolution,
  type PersistCandidateArgs,
  type AttachVerificationArgs,
  type ConflictChoice,
  type ConflictResolution,
  type LearningState,
} from './reflect-tools';

/** DB NULL for an absent JSON envelope field (vs. a JSON `null` literal). */
function jsonOrDbNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/**
 * Persist a captured learning's typed envelope, 1:1 with its memory row. Called
 * right after teachRule() writes the rule. Idempotent-ish: the unique index on
 * memory_id means a re-capture of the same row would collide — callers capture
 * once per learning, so a collision is a programming error, surfaced by throw
 * (the dispatcher swallows it; the memory row still stands).
 */
export async function persistCapturedCandidate(args: PersistCandidateArgs): Promise<void> {
  await prisma.platformTeachCandidate.create({
    data: {
      id: createId(),
      orgId: args.orgId,
      authorUserId: args.authorUserId,
      sessionId: args.sessionId ?? null,
      memoryId: args.memoryId,
      learningType: args.learningType,
      state: args.state,
      conflict: jsonOrDbNull(args.conflict),
      verification: Prisma.DbNull,
      resolution: Prisma.DbNull,
    },
  });
}

/**
 * Attach a verification outcome (and the resulting card state) to a candidate,
 * keyed by its memory row id. Fail-closed: scoped to (org, author, memory) so a
 * caller can only ever annotate their OWN candidate. No-op (count 0) if the
 * candidate isn't found — never throws on a missing row.
 */
export async function attachVerificationToCandidate(args: AttachVerificationArgs): Promise<void> {
  await prisma.platformTeachCandidate.updateMany({
    where: { memoryId: args.memoryId, authorUserId: args.authorUserId, orgId: args.orgId },
    data: {
      verification: args.verification as unknown as Prisma.InputJsonValue,
      state: args.state,
      updatedAt: new Date(),
    },
  });
}

export interface ResolveCandidateArgs {
  orgId: string;
  authorUserId: string;
  memoryId: string;
  choice: ConflictChoice;
  scopeNote?: string;
}

export interface ResolveCandidateResult {
  ok: boolean;
  state: LearningState;
  /** true when the memory row was soft-deleted (status='SUPERSEDED') — the
   *  keep_existing / reject path that removes it from BOTH feed and recall. */
  superseded: boolean;
  reason?: string;
}

/**
 * Resolve a conflicted candidate (the user's decision), persisting the outcome
 * WITHOUT promoting or writing governed memory (Build commits later). Reuses the
 * shared `nextStateForResolution` transition so the card and the store never
 * drift.
 *
 *   keep_new / scope_by_context → state advances to 'proposed' (+ resolution)
 *   keep_existing               → state 'rejected'; the memory row is soft-deleted
 *                                 (status='SUPERSEDED'), removing it from the feed
 *                                 AND from the personal-taught recall lane.
 *
 * Fail-closed: every write is scoped to the caller as author — a caller can
 * neither resolve nor supersede another user's candidate.
 */
export async function resolveCandidateByMemoryId(args: ResolveCandidateArgs): Promise<ResolveCandidateResult> {
  const state = nextStateForResolution(args.choice);
  const resolution: ConflictResolution = {
    choice: args.choice,
    scopeNote: args.scopeNote,
    resolvedAt: new Date().toISOString(),
  };

  const updated = await prisma.platformTeachCandidate.updateMany({
    where: { memoryId: args.memoryId, authorUserId: args.authorUserId, orgId: args.orgId },
    data: {
      state,
      resolution: resolution as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    return { ok: false, state, superseded: false, reason: 'candidate not found for caller' };
  }

  let superseded = false;
  if (state === 'rejected') {
    // Soft-delete the rule so it leaves recall (the lane filters status='ACTIVE')
    // and the feed (projection filters status='ACTIVE'). Scoped to the author.
    const soft = await prisma.platformAgentMemory.updateMany({
      where: { id: args.memoryId, orgId: args.orgId, createdBy: args.authorUserId },
      data: { status: 'SUPERSEDED', updatedAt: new Date() },
    });
    superseded = soft.count > 0;
  }

  return { ok: true, state, superseded };
}
