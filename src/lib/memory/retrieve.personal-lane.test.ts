/**
 * Teach Phase 2 — Step 1 (the retrieve fix) acceptance units.
 *
 * These map to acceptance checks 1 and 2 in the Phase-2 brief:
 *   1. Retrieve fix: with N>cap zero-score personal bullets for the caller, the
 *      caller's own freshly-taught rule IS returned in Phase 1a; a different user
 *      gets none (fail-closed preserved).
 *   2. Inspector-path invariance: for a non-personal caller the Phase-1a output is
 *      UNCHANGED by the fix — same bullets, same order, same count — asserted
 *      against a fixture; and the personal-lane query is never even issued for the
 *      NO_USER_SENTINEL caller.
 *
 * The fix lives in selectPhase1a: a small, recency-ordered, ADDITIVE lane that
 * surfaces the caller's own personal SCHEMA_MAP rules alongside (never reordering
 * or evicting) the net-helpful set. We mock prisma.$queryRawUnsafe and route by
 * the SQL shape of each phase / lane, and mock embedQuery to null so Phase 1b
 * short-circuits (no warehouse / Bedrock).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks (declared before importing the module under test) ──────────────────────

const queryRawUnsafe = vi.fn();
const updateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    platformAgentMemory: { updateMany: (...args: unknown[]) => updateMany(...args) },
  },
}));

// embedQuery → null makes Phase 1b return [] before any query (no Bedrock needed).
vi.mock('@/lib/context/embed', () => ({ embedQuery: vi.fn().mockResolvedValue(null) }));

import { selectMemoryAll } from './retrieve';

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const ORG = 'org1';
const CLASS = 'inspector';
const AUTHOR = 'userA';
const OTHER = 'userB';

/** Ten org SCHEMA_MAP bullets that fill the cap-10 with net-positive scores. */
function tenNetPositiveOrgBullets() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `org_${i}`,
    rule_text: `Org schema fact ${i}`,
    rule_type: 'SCHEMA_MAP',
    confidence: 0.9,
    helpful_count: 10 - i, // all net-positive, descending
    harmful_count: 0,
  }));
}

/** The caller's freshly-taught personal rule: helpful_count=0 → net-helpful 0. */
const FRESH_PERSONAL = {
  id: 'personal_fresh',
  rule_text: 'Fiscal year starts in April',
  rule_type: 'SCHEMA_MAP',
  confidence: 0.9,
  helpful_count: 0,
  harmful_count: 0,
};

// SQL routing: distinguish phase0 / phase1a-main / personal-lane by SQL shape.
function routeQuery(sql: string): 'phase0' | 'lane' | 'phase1a' | 'other' {
  if (sql.includes("rule_type   = 'HARD_RULE'")) return 'phase0';
  if (sql.includes("visibility  = 'personal'") && sql.includes('ORDER BY created_at DESC')) return 'lane';
  if (sql.includes("rule_type   = 'SCHEMA_MAP'")) return 'phase1a';
  return 'other';
}

/**
 * Wire the mock. Phase 0 returns no DB rows (code still adds the default
 * guardrail). Phase 1a main returns the ten net-positive org bullets. The
 * personal lane returns FRESH_PERSONAL only when the caller param === laneOwner
 * (fail-closed: a different caller gets nothing).
 */
function wireMock(laneOwner: string | null) {
  queryRawUnsafe.mockImplementation((...args: unknown[]) => {
    const sql = args[0] as string;
    const kind = routeQuery(sql);
    if (kind === 'phase0') return Promise.resolve([]);
    if (kind === 'phase1a') return Promise.resolve(tenNetPositiveOrgBullets());
    if (kind === 'lane') {
      // Personal-lane params: (orgId, agentClass, callerUserId, cap). $3 = caller.
      const callerParam = args[3] as string;
      if (laneOwner && callerParam === laneOwner) return Promise.resolve([FRESH_PERSONAL]);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  queryRawUnsafe.mockReset();
  updateMany.mockClear();
});

// ── Check 1 — the caller's own fresh rule is recalled; another user gets none ─────

describe('Check 1 — freshly-taught personal rule survives the net-helpful starvation', () => {
  it('the author gets their own fresh rule appended in Phase 1a even when the cap is full', async () => {
    wireMock(AUTHOR);
    const { phase1a } = await selectMemoryAll(ORG, CLASS, 'fiscal year', null, AUTHOR);

    const ids = phase1a.map((b) => b.id);
    expect(ids).toContain('personal_fresh');        // the starved rule is now recalled
    expect(ids.filter((x) => x === 'personal_fresh')).toHaveLength(1); // no double-listing
    // Additive: all ten net-positive org bullets are still present, unchanged order.
    expect(ids.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `org_${i}`));
  });

  it('a DIFFERENT user gets none of the author\'s personal rule (fail-closed)', async () => {
    wireMock(AUTHOR); // only AUTHOR owns the rule
    const { phase1a } = await selectMemoryAll(ORG, CLASS, 'fiscal year', null, OTHER);
    expect(phase1a.map((b) => b.id)).not.toContain('personal_fresh');
    expect(phase1a).toHaveLength(10); // exactly the org set, nothing leaked
  });
});

// ── Check 2 — Inspector-path invariance for a NON-personal caller ─────────────────

describe('Check 2 — non-personal caller output is byte-for-byte unchanged', () => {
  it('the NO_USER_SENTINEL (null) caller never even issues the personal-lane query', async () => {
    wireMock(AUTHOR);
    const { phase1a } = await selectMemoryAll(ORG, CLASS, 'fiscal year', null, null);

    // The lane must NOT run for the sentinel caller — assert no lane SQL was issued.
    const laneCalls = queryRawUnsafe.mock.calls.filter(
      (c) => routeQuery(c[0] as string) === 'lane',
    );
    expect(laneCalls).toHaveLength(0);
    // And the result is exactly the fixture: same ids, same order, same count.
    expect(phase1a.map((b) => b.id)).toEqual(Array.from({ length: 10 }, (_, i) => `org_${i}`));
    expect(phase1a).toHaveLength(10);
  });

  it('a resolved caller with ZERO personal rules gets the identical fixture output', async () => {
    // Baseline: the sentinel caller's Phase-1a.
    wireMock(null);
    const baseline = (await selectMemoryAll(ORG, CLASS, 'fiscal year', null, null)).phase1a;

    // Resolved caller, but they own no personal rules → lane returns [] → no-op.
    wireMock(null);
    const resolved = (await selectMemoryAll(ORG, CLASS, 'fiscal year', null, OTHER)).phase1a;

    expect(resolved).toEqual(baseline);          // same bullets, same order
    expect(resolved).toHaveLength(baseline.length); // same count
  });
});
