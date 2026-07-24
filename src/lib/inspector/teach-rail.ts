/**
 * src/lib/inspector/teach-rail.ts
 *
 * Teach retention (Track A) — the HYDRATE-side projection: persisted candidates
 * (teach-feed's TeachCandidate) → rail Learnings.
 *
 * CLIENT-SAFE BY CONSTRUCTION: this module imports ONLY types (all erased at
 * compile), so `useTeachChat` (a 'use client' hook) can import these VALUES
 * without pulling teach-feed's server-side prisma access into the client bundle.
 * Kept separate from teach-feed.ts precisely so that server/client boundary holds,
 * and so the projection invariants below are unit-testable without a DB.
 */
import type { Learning, LearningState } from './reflect-tools';
import type { TeachCandidate } from './teach-feed';

/**
 * Project one persisted candidate back into a rail Learning. Two invariants:
 *   - 'resolved' (a conflict the user resolved) maps back to 'proposed' — the
 *     LearningState machine has no 'resolved' member.
 *   - 'verifying' is transient and NEVER persisted, so it can never surface here.
 *     A card that was mid-verification when the tab closed comes back at its last
 *     stored outcome; hydrate never auto re-fires a verify query (plan §3, A3).
 */
export function candidateToLearning(c: TeachCandidate): Learning {
  const state: LearningState = c.state === 'resolved' ? 'proposed' : c.state;
  return {
    id: c.id,
    type: c.type,
    statement: c.statement,
    state,
    verification_result: c.verification_result,
    related_memory_hits: [],
    conflict: c.conflict,
    memoryId: c.id,
    createdAt: c.capturedAt,
  };
}

/**
 * Rebuild the rail's normalized map + insertion order from a feed. The feed is
 * captured DESC (newest-first); the rail renders first-seen-first, so we reverse
 * to ascending — matching the order the live learning_item stream produced.
 */
export function projectCandidatesToRail(
  candidates: TeachCandidate[],
): { learnings: Record<string, Learning>; order: string[] } {
  const learnings: Record<string, Learning> = {};
  const order: string[] = [];
  for (const c of [...candidates].reverse()) {
    const l = candidateToLearning(c);
    learnings[l.id] = l;
    order.push(l.id);
  }
  return { learnings, order };
}
