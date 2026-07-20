/**
 * Teach Phase 3 — read-only feed projection acceptance units (checks 1 & 4).
 *
 * Pure: exercises the projection mapping + ready-count semantics over constructed
 * rows, and the fail-closed short-circuit (a null author never queries). The
 * live DB read (getTeachFeed's SQL), read-only-ness, and cross-user scoping are
 * proven LIVE (check 5).
 */

import {
  projectRow,
  deriveState,
  buildTeachFeed,
  getTeachFeed,
  type FeedRow,
  type TeachCandidate,
} from '../teach-feed';

function row(over: Partial<FeedRow> = {}): FeedRow {
  return {
    memory_id: 'mem1',
    statement: 'Revenue excludes intercompany sales',
    author: 'userA',
    session_id: 'sess-1',
    learning_type: 'metric_definition',
    state: 'proposed',
    verification: null,
    conflict: null,
    resolution: null,
    captured_at: new Date('2026-07-20T10:00:00Z'),
    ...over,
  };
}

// ── Check 1 — projection populates every contract field from the row ──────────────

describe('Check 1 — projection', () => {
  it('maps a proposed candidate to the full TeachCandidate contract', () => {
    const c = projectRow(row());
    expect(c).toEqual<TeachCandidate>({
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
    });
  });

  it('a verified candidate carries its verification_result + verified state', () => {
    const c = projectRow(row({
      state: 'verified',
      verification: { ok: true, state: 'confirmed', rowCount: 41, sql: 'SELECT ...' },
    }));
    expect(c.state).toBe('verified');
    expect(c.verification_result).toMatchObject({ state: 'confirmed', rowCount: 41 });
  });

  it('a not_verifiable candidate keeps its typed state — NEVER a fabricated result', () => {
    const c = projectRow(row({
      state: 'proposed',
      verification: { ok: false, state: 'not_verifiable', reason: "model 'x' is candidate, not governed" },
    }));
    expect(c.verification_result?.state).toBe('not_verifiable');
    expect(c.state).toBe('proposed'); // not_verifiable never advanced to verified
  });

  it('an unresolved conflict projects state=conflict with existing-vs-new populated', () => {
    const c = projectRow(row({
      state: 'conflict',
      conflict: { existingMemoryId: 'memOLD', existingStatement: 'starts in January', note: 'differing month' },
    }));
    expect(c.state).toBe('conflict');
    expect(c.conflict).toMatchObject({ existingMemoryId: 'memOLD' });
  });

  it('a resolved conflict shows state=resolved and the recorded choice', () => {
    const c = projectRow(row({
      state: 'proposed', // resolveConflict advanced it out of conflict
      conflict: { existingMemoryId: 'memOLD', existingStatement: 'starts in January' },
      resolution: { choice: 'scope_by_context', scopeNote: 'FY reporting only', resolvedAt: '2026-07-20T11:00:00Z' },
    }));
    expect(c.state).toBe('resolved');
    expect(c.resolution?.choice).toBe('scope_by_context');
  });

  it('coerces an unknown learning_type to "other"', () => {
    expect(projectRow(row({ learning_type: 'garbage' })).type).toBe('other');
  });

  it('deriveState precedence: conflict > resolved > verified > proposed', () => {
    expect(deriveState('conflict', { choice: 'keep_new', resolvedAt: 'x' })).toBe('conflict');
    expect(deriveState('verified', { choice: 'keep_new', resolvedAt: 'x' })).toBe('resolved');
    expect(deriveState('verified', null)).toBe('verified');
    expect(deriveState('proposed', null)).toBe('proposed');
  });
});

// ── Check 4 — ready-count semantics (verified + resolved + proposed) ──────────────

describe('Check 4 — ready count', () => {
  it('ready = verified + resolved + proposed; conflict is NOT ready', () => {
    const feed = buildTeachFeed([
      projectRow(row({ memory_id: 'a', state: 'proposed' })),
      projectRow(row({ memory_id: 'b', state: 'verified', verification: { ok: true, state: 'confirmed', rowCount: 1 } })),
      projectRow(row({ memory_id: 'c', state: 'proposed', resolution: { choice: 'keep_new', resolvedAt: 'x' } })), // resolved
      projectRow(row({ memory_id: 'd', state: 'conflict', conflict: { existingMemoryId: 'z', existingStatement: 'q' } })),
    ]);
    expect(feed.total).toBe(4);
    expect(feed.conflictCount).toBe(1);
    expect(feed.readyCount).toBe(3); // a(proposed) + b(verified) + c(resolved)
  });

  it('empty feed → zero counts', () => {
    expect(buildTeachFeed([])).toEqual({ candidates: [], readyCount: 0, conflictCount: 0, total: 0 });
  });
});

// ── Check 2 (partial) — fail-closed: a null author never queries ──────────────────

describe('Check 2 — fail-closed scoping (null author short-circuits)', () => {
  it('returns an empty feed for a null author WITHOUT touching the database', async () => {
    // If this touched prisma it would need a DB; it must short-circuit instead.
    const feed = await getTeachFeed('org1', null);
    expect(feed).toEqual({ candidates: [], readyCount: 0, conflictCount: 0, total: 0 });
  });
});
