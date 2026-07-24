/**
 * Teach retention (Track A) — rail-rehydration projection units.
 *
 * Pure: exercises candidate → Learning mapping and the A3 invariants that keep a
 * reload honest (no re-fired verification, no phantom 'verifying', resolved folds
 * back to proposed) plus the newest-first → first-seen-first ordering flip.
 */

import { candidateToLearning, projectCandidatesToRail } from '../teach-rail';
import type { TeachCandidate } from '../teach-feed';

function candidate(over: Partial<TeachCandidate> = {}): TeachCandidate {
  return {
    id: 'mem1',
    type: 'metric_definition',
    statement: 'Revenue excludes intercompany sales',
    state: 'proposed',
    verification_result: null,
    conflict: null,
    resolution: null,
    author: 'userA',
    sessionId: 'sess-1',
    capturedAt: '2026-07-20T10:00:00.000Z',
    ...over,
  };
}

describe('candidateToLearning', () => {
  it('maps a proposed candidate into a rail Learning keyed on the memory id', () => {
    const l = candidateToLearning(candidate());
    expect(l).toEqual({
      id: 'mem1',
      type: 'metric_definition',
      statement: 'Revenue excludes intercompany sales',
      state: 'proposed',
      verification_result: null,
      related_memory_hits: [],
      conflict: null,
      memoryId: 'mem1',
      createdAt: '2026-07-20T10:00:00.000Z',
    });
  });

  it('carries a verified candidate\'s verification_result + verified state', () => {
    const v = { ok: true as const, state: 'confirmed' as const, rowCount: 3, sql: 'SELECT 1' };
    const l = candidateToLearning(candidate({ state: 'verified', verification_result: v }));
    expect(l.state).toBe('verified');
    expect(l.verification_result).toEqual(v);
  });

  it('A3: a resolved candidate folds back to proposed (LearningState has no resolved)', () => {
    const l = candidateToLearning(candidate({ state: 'resolved' }));
    expect(l.state).toBe('proposed');
  });

  it('A3: a card mid-verification comes back at its LAST STORED state, never verifying', () => {
    // The feed only ever yields persisted states — 'verifying' cannot appear — so
    // a re-fire on hydrate is structurally impossible. The card resolves to
    // whatever verification outcome was last written (here still proposed).
    const l = candidateToLearning(candidate({ state: 'proposed', verification_result: null }));
    expect(l.state).not.toBe('verifying');
    expect(l.state).toBe('proposed');
  });

  it('keeps a conflict candidate in conflict, carrying its conflict info', () => {
    const conflict = { existingMemoryId: 'mem0', existingStatement: 'Revenue includes intercompany', note: 'flip' };
    const l = candidateToLearning(candidate({ state: 'conflict', conflict }));
    expect(l.state).toBe('conflict');
    expect(l.conflict).toEqual(conflict);
  });
});

describe('projectCandidatesToRail', () => {
  it('reverses the feed (newest-first) into first-seen-first rail order', () => {
    // Feed is captured DESC; the rail renders oldest-first.
    const feed = [
      candidate({ id: 'c', capturedAt: '2026-07-20T12:00:00.000Z' }),
      candidate({ id: 'b', capturedAt: '2026-07-20T11:00:00.000Z' }),
      candidate({ id: 'a', capturedAt: '2026-07-20T10:00:00.000Z' }),
    ];
    const { learnings, order } = projectCandidatesToRail(feed);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(Object.keys(learnings).sort()).toEqual(['a', 'b', 'c']);
    expect(learnings.a.memoryId).toBe('a');
  });

  it('is a no-op on an empty feed', () => {
    expect(projectCandidatesToRail([])).toEqual({ learnings: {}, order: [] });
  });

  it('does not mutate the input array', () => {
    const feed = [candidate({ id: 'x' }), candidate({ id: 'y' })];
    const snapshot = feed.map((c) => c.id);
    projectCandidatesToRail(feed);
    expect(feed.map((c) => c.id)).toEqual(snapshot);
  });
});
