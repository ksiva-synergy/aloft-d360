/**
 * Teach / "Marcus Reflect" — Phase 1 acceptance tests.
 *
 * These map 1:1 to the five acceptance checks in the Phase-1 brief. They are pure
 * unit tests: the engine calls (teach/retrieve/executeSemanticQuery) and the
 * reputation-credit hook are dependency-injected, so the guardrails, the
 * learning_item event shape, and the reputation-timing decision are all asserted
 * without a live database — matching this repo's test discipline.
 */

import {
  buildReflectToolConfig,
  REFLECT_TOOL_NAMES,
  WITHHELD_MUTATION_TOOLS,
  isReflectToolAllowed,
  executeReflectTool,
  buildLearning,
  mapCaptureToTeachArgs,
  isVisibleToCaller,
  CAPTURE_CREDITS_REPUTATION,
  LEARNING_TYPES,
  LEARNING_STATES,
  type ReflectToolContext,
  type ReflectToolDeps,
} from '../reflect-tools';
import { MARCUS_REFLECT_SYSTEM_PROMPT } from '../reflect-prompt';
import { SemanticModelNotGovernedError } from '@/lib/semantic/errors';

// ── Test harness ────────────────────────────────────────────────────────────────

type Ev = Record<string, unknown> & { type: string };
function collect() {
  const events: Ev[] = [];
  const emit = (e: Record<string, unknown>) => { events.push(e as Ev); };
  return { emit, events };
}

const CTX: ReflectToolContext = { orgId: 'org1', userId: 'userA', connectionId: 'conn1' };

// A capture stub that echoes back a deterministic memory id (stands in for teachRule).
function captureStub(): Partial<ReflectToolDeps> {
  return {
    capture: async (a) => ({ id: `mem_${a.ruleText.length}`, ruleText: a.ruleText, ruleType: a.ruleType }),
  };
}

// ── Check 1 — Reflect decline is enforced at BOTH layers ─────────────────────────

describe('Check 1 — decline is both prompt (layer one) AND allowlist (layer two)', () => {
  it('layer one: the prompt instructs Marcus to decline task requests', () => {
    const p = MARCUS_REFLECT_SYSTEM_PROMPT.toLowerCase();
    expect(p).toContain('build me a dashboard'); // the canonical task request is named
    expect(p).toContain('decline');
    expect(p).toMatch(/do not.*(build|execute)/s);
  });

  it('layer two: the allowlist is exactly the 3 read/candidate tools — no mutation tool', () => {
    const names = (buildReflectToolConfig().tools ?? [])
      .map((t) => t.toolSpec?.name)
      .filter(Boolean) as string[];
    expect(names.slice().sort()).toEqual([...REFLECT_TOOL_NAMES].slice().sort());
    for (const withheld of WITHHELD_MUTATION_TOOLS) {
      expect(names).not.toContain(withheld);
      expect(isReflectToolAllowed(withheld)).toBe(false);
    }
    // emit_semantic_chart / emit_chart specifically are structurally absent.
    expect(names).not.toContain('emit_semantic_chart');
    expect(names).not.toContain('emit_chart');
  });

  it('layer two: the dispatcher refuses a withheld tool (defence in depth) and emits nothing productive', async () => {
    const { emit, events } = collect();
    const out = JSON.parse(
      await executeReflectTool('emit_semantic_chart', {}, 'c1', emit, CTX, captureStub()),
    );
    expect(out.error).toMatch(/not available in reflect mode/i);
    expect(events.some((e) => e.type === 'tool_call_error')).toBe(true);
    expect(events.some((e) => e.type === 'learning_item')).toBe(false);
    expect(events.some((e) => e.type === 'semantic_chart_result')).toBe(false);
  });
});

// ── Check 2 — a taught learning persists as a personal, injecting rule ────────────

describe('Check 2 — personal + injecting rule_type + fail-closed scoping', () => {
  it('capture maps to teachRule args: author-owned + SCHEMA_MAP (an injecting type)', () => {
    const args = mapCaptureToTeachArgs('org1', 'userA', 'Fiscal year starts in April');
    // SCHEMA_MAP is the ONLY rule type that reliably injects for a fresh bullet
    // (a HARD_RULE silently never injects until harmful_count >= 1).
    expect(args.ruleType).toBe('SCHEMA_MAP');
    expect(args.userId).toBe('userA'); // created_by = the author
    expect(args.orgId).toBe('org1');
    expect(args.agentClass).toBe('inspector');
  });

  it('capture_learning persists via the (teachRule) capture dep and returns the memory id', async () => {
    const captured: Array<ReturnType<typeof mapCaptureToTeachArgs>> = [];
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => { captured.push(a); return { id: 'mem1', ruleText: a.ruleText, ruleType: a.ruleType }; },
    };
    const { emit } = collect();
    const out = JSON.parse(
      await executeReflectTool(
        'capture_learning',
        { type: 'enterprise_convention', statement: 'Exclude internal test accounts' },
        'c1', emit, CTX, deps,
      ),
    );
    expect(out.ok).toBe(true);
    expect(out.memoryId).toBe('mem1');
    expect(captured).toHaveLength(1);
    expect(captured[0].ruleType).toBe('SCHEMA_MAP');
    expect(captured[0].userId).toBe('userA');
  });

  it('personal scoping is fail-closed (mirrors retrieve.ts visibilityClause + NO_USER_SENTINEL)', () => {
    const personal = { visibility: 'personal', createdBy: 'userA' };
    expect(isVisibleToCaller(personal, 'userA')).toBe(true);  // author sees it
    expect(isVisibleToCaller(personal, 'userB')).toBe(false); // another user does NOT
    expect(isVisibleToCaller(personal, null)).toBe(false);    // unresolved caller: fail-closed
    const org = { visibility: 'org', createdBy: 'userA' };
    expect(isVisibleToCaller(org, 'userB')).toBe(true);       // org-wide visible to all
    expect(isVisibleToCaller(org, null)).toBe(true);
  });

  it('capture without a resolved author is refused (cannot write a personal learning)', async () => {
    const { emit } = collect();
    const out = JSON.parse(
      await executeReflectTool(
        'capture_learning',
        { type: 'other', statement: 'x' },
        'c1', emit, { orgId: 'org1', userId: null, connectionId: null }, captureStub(),
      ),
    );
    expect(out.error).toMatch(/without a signed-in author/i);
  });
});

// ── Check 3 — learning_item events emit with all typed fields, one per learning ───

describe('Check 3 — typed learning_item emission', () => {
  it('buildLearning fills every card field with Phase-1 defaults', () => {
    const L = buildLearning({ id: 'c1', type: 'metric_definition', statement: 'ARR = MRR * 12', memoryId: 'mem1' });
    expect(L.state).toBe('proposed');
    expect(L.verification_result).toBeNull();
    expect(L.related_memory_hits).toEqual([]);
    expect(L.conflict).toBeNull();
    expect(L.memoryId).toBe('mem1');
    expect(typeof L.createdAt).toBe('string');
    // unknown type coerces to 'other' rather than leaking an invalid tag
    expect(buildLearning({ id: 'c2', type: 'nonsense', statement: 's' }).type).toBe('other');
  });

  it('emits exactly one fully-typed learning_item per captured learning', async () => {
    const { emit, events } = collect();
    await executeReflectTool('capture_learning', { type: 'metric_definition', statement: 'ARR = sum(MRR) * 12' }, 'c1', emit, CTX, captureStub());
    await executeReflectTool('capture_learning', { type: 'vocabulary_entity', statement: "'active' means status = 'A'" }, 'c2', emit, CTX, captureStub());

    const items = events.filter((e) => e.type === 'learning_item') as Array<{ type: string; learning: Record<string, unknown> }>;
    expect(items).toHaveLength(2);

    for (const ev of items) {
      const L = ev.learning;
      expect(LEARNING_TYPES).toContain(L.type as string);
      expect(typeof L.statement).toBe('string');
      expect(L.state).toBe('proposed');
      expect(LEARNING_STATES).toContain(L.state as string);
      expect(L.verification_result).toBeNull();
      expect(Array.isArray(L.related_memory_hits)).toBe(true);
      expect(L.conflict).toBeNull();
      expect(typeof L.memoryId).toBe('string');
      expect(typeof L.id).toBe('string');
      expect(typeof L.createdAt).toBe('string');
    }
    expect(items[0].learning.type).toBe('metric_definition');
    expect(items[1].learning.type).toBe('vocabulary_entity');
  });
});

// ── Check 4 — reputation timing: capture is NOT promotion → no credit ─────────────

describe('Check 4 — no reputation delta on capture (Step 3 default)', () => {
  it('the credit hook (the ONLY reputation path) is never invoked on capture', async () => {
    let creditCalls = 0;
    let creditedUser: string | null = null;
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'mem1', ruleText: a.ruleText, ruleType: a.ruleType }),
      credit: async (_org, user) => { creditCalls++; creditedUser = user; },
    };
    const { emit } = collect();
    // Snapshot "before" and "after" the capture — assert the DELTA, not row existence.
    const before = creditCalls;
    await executeReflectTool('capture_learning', { type: 'other', statement: 'a durable fact' }, 'c1', emit, CTX, deps);
    const after = creditCalls;

    expect(after - before).toBe(0);   // zero delta
    expect(creditedUser).toBeNull();  // and to nobody
    expect(CAPTURE_CREDITS_REPUTATION).toBe(false);
  });
});

// ── Check 5 — verify_claim is read-only and fails soft ────────────────────────────

describe('Check 5 — read-only verification cannot mutate; ungoverned is a typed state', () => {
  it('an ungoverned model surfaces as not_verifiable — never an uncaught throw', async () => {
    const deps: Partial<ReflectToolDeps> = {
      verify: async () => { throw new SemanticModelNotGovernedError('m1', 'candidate'); },
    };
    const { emit, events } = collect();
    // Must resolve, not reject.
    const out = JSON.parse(
      await executeReflectTool('verify_claim', { modelId: 'm1', entityId: 'e1', dimensions: [], measures: [], filters: [], sorts: [] } as unknown as Record<string, unknown>, 'c1', emit, CTX, deps),
    );
    expect(out.ok).toBe(false);
    expect(out.result.state).toBe('not_verifiable');
    const ev = events.find((e) => e.type === 'verification_result') as { result: { state: string } };
    expect(ev.result.state).toBe('not_verifiable');
  });

  it('a governed result maps rowCount → confirmed/unconfirmed and delegates to the governed executor', async () => {
    // The default verify dep is executeSemanticQuery → executeDatabricksSQL (the
    // single read-only chokepoint; no DDL/multi-statement). Here we assert the
    // wrapper delegates to that executor with the resolved connection and maps the
    // result deterministically.
    const seen: Array<[unknown, string]> = [];
    const depsConfirmed: Partial<ReflectToolDeps> = {
      verify: async (q, cid) => { seen.push([q, cid]); return { rowCount: 41, sql: 'SELECT count(*) ...' }; },
    };
    const { emit } = collect();
    const out = JSON.parse(
      await executeReflectTool('verify_claim', { modelId: 'm1' } as unknown as Record<string, unknown>, 'c1', emit, CTX, depsConfirmed),
    );
    expect(out.ok).toBe(true);
    expect(out.result.state).toBe('confirmed');
    expect(out.result.rowCount).toBe(41);
    expect(seen[0][1]).toBe('conn1'); // connectionId threaded through

    const out2 = JSON.parse(
      await executeReflectTool('verify_claim', { modelId: 'm1' } as unknown as Record<string, unknown>, 'c2', emit, CTX, { verify: async () => ({ rowCount: 0, sql: 'x' }) }),
    );
    expect(out2.result.state).toBe('unconfirmed');
  });

  it('no active connection → not_verifiable without ever calling the executor', async () => {
    let called = 0;
    const deps: Partial<ReflectToolDeps> = { verify: async () => { called++; return { rowCount: 1, sql: 'x' }; } };
    const { emit } = collect();
    const out = JSON.parse(
      await executeReflectTool('verify_claim', {} as Record<string, unknown>, 'c1', emit, { orgId: 'o', userId: 'u', connectionId: null }, deps),
    );
    expect(out.result.state).toBe('not_verifiable');
    expect(called).toBe(0);
  });
});
