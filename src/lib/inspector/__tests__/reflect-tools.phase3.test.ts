/**
 * Teach Phase 3 (capture-shape) — persistence WIRING acceptance units.
 *
 * These assert the DISPATCHER threads the typed envelope into the injected
 * persistence deps correctly (persistCandidate on capture; attachVerification on
 * verify_claim when a learningId is present). Pure/injected — no DB. The store's
 * actual writes + lane-invariance + reject→SUPERSEDED are proven LIVE (Postgres).
 */

import {
  executeReflectTool,
  nextStateForResolution,
  VERIFY_CLAIM_SCHEMA,
  type ReflectToolContext,
  type ReflectToolDeps,
  type PersistCandidateArgs,
  type AttachVerificationArgs,
  type RelatedMemoryHit,
} from '../reflect-tools';

type Ev = Record<string, unknown> & { type: string };
function collect() {
  const events: Ev[] = [];
  const emit = (e: Record<string, unknown>) => { events.push(e as Ev); };
  return { emit, events };
}
const CTX: ReflectToolContext = {
  orgId: 'org1', userId: 'userA', connectionId: 'conn1', sessionId: 'sess-1',
};
function hit(id: string, ruleText: string): RelatedMemoryHit {
  return { id, ruleText, ruleType: 'SCHEMA_MAP', phase: 'SCHEMA_GLOBAL' };
}

// ── capture_learning persists the typed envelope ──────────────────────────────────

describe('Phase 3 capture-shape — capture persists the envelope', () => {
  it('persists {sessionId, type, state=proposed, conflict=null, memoryId} on a clean capture', async () => {
    const persisted: PersistCandidateArgs[] = [];
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      recall: async () => [hit('memX', 'Vessels are identified by IMO number')],
      persistCandidate: async (a) => { persisted.push(a); },
    };
    const { emit } = collect();
    await executeReflectTool(
      'capture_learning',
      { type: 'metric_definition', statement: 'Revenue excludes intercompany sales' },
      'c1', emit, CTX, deps,
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      orgId: 'org1',
      authorUserId: 'userA',
      sessionId: 'sess-1',
      memoryId: 'memNEW',
      learningType: 'metric_definition',
      state: 'proposed',
      conflict: null,
    });
  });

  it('persists state=conflict + the conflict envelope when a contradiction is detected', async () => {
    const persisted: PersistCandidateArgs[] = [];
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      recall: async () => [
        hit('memNEW', 'Our fiscal year starts in April'),   // self — excluded
        hit('memOLD', 'The fiscal year starts in January'),
      ],
      persistCandidate: async (a) => { persisted.push(a); },
    };
    const { emit } = collect();
    await executeReflectTool(
      'capture_learning',
      { type: 'enterprise_convention', statement: 'Our fiscal year starts in April' },
      'c1', emit, CTX, deps,
    );
    expect(persisted[0].state).toBe('conflict');
    expect(persisted[0].conflict?.existingMemoryId).toBe('memOLD');
  });

  it('a persistence failure NEVER sinks the capture (best-effort; row + event stand)', async () => {
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      recall: async () => [],
      persistCandidate: async () => { throw new Error('db down'); },
    };
    const { emit, events } = collect();
    const out = JSON.parse(await executeReflectTool(
      'capture_learning', { type: 'other', statement: 'A durable fact' }, 'c1', emit, CTX, deps,
    ));
    expect(out.ok).toBe(true);
    expect(events.find((e) => e.type === 'learning_item')).toBeTruthy();
  });

  it('falls back to sessionId=null when the context carries none', async () => {
    const persisted: PersistCandidateArgs[] = [];
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      recall: async () => [],
      persistCandidate: async (a) => { persisted.push(a); },
    };
    const { emit } = collect();
    await executeReflectTool(
      'capture_learning', { type: 'other', statement: 'X' }, 'c1', emit,
      { orgId: 'org1', userId: 'userA', connectionId: null }, deps,
    );
    expect(persisted[0].sessionId).toBeNull();
  });
});

// ── verify_claim attaches to the candidate only when a learningId is present ───────

describe('Phase 3 capture-shape — verify attaches to a candidate', () => {
  it('attaches {memoryId, verification, state=verified} on a confirmed verify with learningId', async () => {
    const attached: AttachVerificationArgs[] = [];
    const deps: Partial<ReflectToolDeps> = {
      verify: async () => ({ rowCount: 41, sql: 'SELECT ...' }),
      attachVerification: async (a) => { attached.push(a); },
    };
    const { emit } = collect();
    await executeReflectTool(
      'verify_claim', { modelId: 'm1', learningId: 'memNEW' } as any, 'v1', emit, CTX, deps,
    );
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({
      orgId: 'org1', authorUserId: 'userA', memoryId: 'memNEW', state: 'verified',
    });
    expect(attached[0].verification.state).toBe('confirmed');
  });

  it('does NOT attach when no learningId is supplied (advisory-only, no misattribution)', async () => {
    const attached: AttachVerificationArgs[] = [];
    const deps: Partial<ReflectToolDeps> = {
      verify: async () => ({ rowCount: 41, sql: 'x' }),
      attachVerification: async (a) => { attached.push(a); },
    };
    const { emit } = collect();
    await executeReflectTool('verify_claim', { modelId: 'm1' } as any, 'v1', emit, CTX, deps);
    expect(attached).toHaveLength(0);
  });

  it('strips learningId before handing the query to the semantic executor', async () => {
    let received: any = null;
    const deps: Partial<ReflectToolDeps> = {
      verify: async (q) => { received = q; return { rowCount: 1, sql: 'x' }; },
      attachVerification: async () => {},
    };
    const { emit } = collect();
    await executeReflectTool(
      'verify_claim', { modelId: 'm1', entityId: 'e1', learningId: 'memNEW' } as any, 'v1', emit, CTX, deps,
    );
    expect(received).not.toBeNull();
    expect('learningId' in received).toBe(false);
    expect(received.modelId).toBe('m1');
  });

  it('attaches an honest not_verifiable state (no connection) — never a fabricated result', async () => {
    const attached: AttachVerificationArgs[] = [];
    const deps: Partial<ReflectToolDeps> = { attachVerification: async (a) => { attached.push(a); } };
    const { emit } = collect();
    await executeReflectTool(
      'verify_claim', { modelId: 'm1', learningId: 'memNEW' } as any, 'v1', emit,
      { ...CTX, connectionId: null }, deps,
    );
    expect(attached[0].verification.state).toBe('not_verifiable');
    expect(attached[0].state).toBe('proposed'); // not_verifiable never advances to verified
  });

  it('does NOT attach when the author is unresolved, even with a learningId (fail-closed)', async () => {
    const attached: AttachVerificationArgs[] = [];
    const deps: Partial<ReflectToolDeps> = {
      verify: async () => ({ rowCount: 1, sql: 'x' }),
      attachVerification: async (a) => { attached.push(a); },
    };
    const { emit } = collect();
    await executeReflectTool(
      'verify_claim', { modelId: 'm1', learningId: 'memNEW' } as any, 'v1', emit,
      { orgId: 'org1', userId: null, connectionId: 'conn1' }, deps,
    );
    expect(attached).toHaveLength(0);
  });
});

// ── shared resolution transition + schema hygiene ─────────────────────────────────

describe('Phase 3 capture-shape — resolution transition + schema', () => {
  it('nextStateForResolution: keep_existing→rejected, others→proposed', () => {
    expect(nextStateForResolution('keep_existing')).toBe('rejected');
    expect(nextStateForResolution('keep_new')).toBe('proposed');
    expect(nextStateForResolution('scope_by_context')).toBe('proposed');
  });

  it('VERIFY_CLAIM_SCHEMA adds learningId WITHOUT changing the shared required set', () => {
    expect(VERIFY_CLAIM_SCHEMA.properties.learningId).toBeTruthy();
    // required is inherited unchanged from SEMANTIC_QUERY_SCHEMA (learningId optional)
    expect(VERIFY_CLAIM_SCHEMA.required).toEqual(['modelId', 'entityId', 'dimensions', 'measures', 'filters', 'sorts']);
    expect((VERIFY_CLAIM_SCHEMA.required as readonly string[]).includes('learningId')).toBe(false);
  });
});
