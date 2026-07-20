/**
 * Teach Phase 2 — Step 2 (conflict) + Step 3 (verify state) acceptance units.
 *
 * Maps to acceptance checks 3 and 4 in the Phase-2 brief. Pure/injected — the
 * recall / verify / capture engines are dependency-injected, and the conflict
 * detector's DEFAULT (deterministic) implementation is exercised directly, so no
 * live DB / Bedrock is needed.
 */

import {
  executeReflectTool,
  buildLearning,
  detectStatementConflict,
  defaultDetectConflict,
  resolveConflict,
  learningStateForVerification,
  CONFLICT_RESOLUTION_CHOICES,
  type ReflectToolContext,
  type ReflectToolDeps,
  type RelatedMemoryHit,
  type VerificationResult,
} from '../reflect-tools';
import { SemanticModelNotGovernedError } from '@/lib/semantic/errors';

type Ev = Record<string, unknown> & { type: string };
function collect() {
  const events: Ev[] = [];
  const emit = (e: Record<string, unknown>) => { events.push(e as Ev); };
  return { emit, events };
}
const CTX: ReflectToolContext = { orgId: 'org1', userId: 'userA', connectionId: 'conn1' };

function hit(id: string, ruleText: string): RelatedMemoryHit {
  return { id, ruleText, ruleType: 'SCHEMA_MAP', phase: 'SCHEMA_GLOBAL' };
}

// ── Check 3a — the default detector: precision-oriented contradiction ─────────────

describe('Check 3a — deterministic conflict detector', () => {
  it('flags a differing month on the same subject', () => {
    const r = detectStatementConflict('Our fiscal year starts in April', 'The fiscal year starts in January');
    expect(r.conflict).toBe(true);
    expect(r.note).toMatch(/month/);
  });

  it('flags a differing assignment value on the same subject', () => {
    const r = detectStatementConflict("When we say active we mean status='A'", "active means status='ACTIVE'");
    expect(r.conflict).toBe(true);
  });

  it('flags a negation/exclusion flip on the same subject', () => {
    const r = detectStatementConflict('Include internal test accounts in revenue', 'Exclude internal test accounts in revenue');
    expect(r.conflict).toBe(true);
  });

  it('does NOT flag unrelated statements', () => {
    expect(detectStatementConflict('Fiscal year starts in April', 'Exclude internal test accounts').conflict).toBe(false);
  });

  it('does NOT flag agreement (same subject, same value)', () => {
    expect(detectStatementConflict('The fiscal year starts in April', 'Our fiscal year begins in April').conflict).toBe(false);
  });

  it('defaultDetectConflict returns the first contradicting hit as ConflictInfo, else null', () => {
    const info = defaultDetectConflict('Fiscal year starts in April', [
      hit('m1', 'Exclude internal test accounts'),
      hit('m2', 'The fiscal year starts in January'),
    ]);
    expect(info?.existingMemoryId).toBe('m2');
    expect(defaultDetectConflict('Fiscal year starts in April', [hit('m1', 'Vessels are identified by IMO')])).toBeNull();
  });
});

// ── Check 3b — capture wiring: conflict state + fields, self-exclusion ────────────

describe('Check 3b — capture_learning emits conflict state & populates fields', () => {
  it('a contradicting candidate → learning_item state=conflict + populated conflict + related hits', async () => {
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      // recall returns the just-written rule (must self-exclude) + a contradicting prior.
      recall: async () => [
        hit('memNEW', 'Our fiscal year starts in April'),
        hit('memOLD', 'The fiscal year starts in January'),
      ],
      // detectConflict left to DEFAULT (deterministic).
    };
    const { emit, events } = collect();
    const out = JSON.parse(await executeReflectTool(
      'capture_learning',
      { type: 'enterprise_convention', statement: 'Our fiscal year starts in April' },
      'c1', emit, CTX, deps,
    ));
    expect(out.ok).toBe(true); // capture is UNBLOCKED even under conflict (C2)
    const ev = events.find((e) => e.type === 'learning_item') as { learning: any };
    expect(ev.learning.state).toBe('conflict');
    expect(ev.learning.conflict.existingMemoryId).toBe('memOLD'); // self (memNEW) excluded
    expect(ev.learning.related_memory_hits.map((h: any) => h.id)).toEqual(['memOLD']);
  });

  it('a non-contradicting candidate → state=proposed, conflict null', async () => {
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      recall: async () => [hit('memX', 'Vessels are identified by IMO number')],
    };
    const { emit, events } = collect();
    await executeReflectTool(
      'capture_learning',
      { type: 'enterprise_convention', statement: 'Fiscal year starts in April' },
      'c1', emit, CTX, deps,
    );
    const ev = events.find((e) => e.type === 'learning_item') as { learning: any };
    expect(ev.learning.state).toBe('proposed');
    expect(ev.learning.conflict).toBeNull();
  });

  it('a recall failure never sinks the capture (advisory, swallowed)', async () => {
    const deps: Partial<ReflectToolDeps> = {
      capture: async (a) => ({ id: 'memNEW', ruleText: a.ruleText, ruleType: a.ruleType }),
      recall: async () => { throw new Error('recall exploded'); },
    };
    const { emit, events } = collect();
    const out = JSON.parse(await executeReflectTool(
      'capture_learning', { type: 'other', statement: 'A durable fact' }, 'c1', emit, CTX, deps,
    ));
    expect(out.ok).toBe(true);
    const ev = events.find((e) => e.type === 'learning_item') as { learning: any };
    expect(ev.learning.state).toBe('proposed');
    expect(ev.learning.conflict).toBeNull();
  });
});

// ── Check 3c — resolution records the choice; nothing promoted to governed ────────

describe('Check 3c — conflict resolution capture (no governed write)', () => {
  const conflicted = buildLearning({
    id: 'c1', type: 'enterprise_convention', statement: 'Fiscal year starts in April', memoryId: 'memNEW',
    state: 'conflict', conflict: { existingMemoryId: 'memOLD', existingStatement: 'starts in January' },
  });

  it('keep_new advances the learning out of conflict to proposed', () => {
    const { learning, resolution } = resolveConflict(conflicted, 'keep_new', { resolvedAt: '2026-07-20T00:00:00Z' });
    expect(learning.state).toBe('proposed');
    expect(resolution.choice).toBe('keep_new');
    expect(resolution.resolvedAt).toBe('2026-07-20T00:00:00Z');
  });

  it('keep_existing rejects the new learning (user kept the prior rule)', () => {
    expect(resolveConflict(conflicted, 'keep_existing').learning.state).toBe('rejected');
  });

  it('scope_by_context advances with the disambiguating note recorded', () => {
    const { learning, resolution } = resolveConflict(conflicted, 'scope_by_context', { scopeNote: 'only for FY reporting' });
    expect(learning.state).toBe('proposed');
    expect(resolution.scopeNote).toBe('only for FY reporting');
  });

  it('the choice set is exactly the three documented options', () => {
    expect([...CONFLICT_RESOLUTION_CHOICES]).toEqual(['keep_new', 'keep_existing', 'scope_by_context']);
  });
});

// ── Check 4 — verify maps to the learning state machine; typed, never throws ──────

describe('Check 4 — verify → learning state, typed non-confirming states', () => {
  it('learningStateForVerification: only confirmed → verified', () => {
    const conf: VerificationResult = { ok: true, state: 'confirmed', rowCount: 41 };
    const unconf: VerificationResult = { ok: true, state: 'unconfirmed', rowCount: 0 };
    const nv: VerificationResult = { ok: false, state: 'not_verifiable', reason: 'x' };
    expect(learningStateForVerification(conf)).toBe('verified');
    expect(learningStateForVerification(unconf)).toBe('proposed');
    expect(learningStateForVerification(nv)).toBe('proposed');
  });

  it('governed confirmed → verified in the emitted event', async () => {
    const deps: Partial<ReflectToolDeps> = { verify: async () => ({ rowCount: 41, sql: 'SELECT ...' }) };
    const { emit, events } = collect();
    const out = JSON.parse(await executeReflectTool('verify_claim', { modelId: 'm1' } as any, 'c1', emit, CTX, deps));
    expect(out.result.state).toBe('confirmed');
    expect(out.learningState).toBe('verified');
    const ev = events.find((e) => e.type === 'verification_result') as { learningState: string };
    expect(ev.learningState).toBe('verified');
  });

  it('governed 0-row → unconfirmed → learning stays proposed (advisory)', async () => {
    const deps: Partial<ReflectToolDeps> = { verify: async () => ({ rowCount: 0, sql: 'x' }) };
    const { emit } = collect();
    const out = JSON.parse(await executeReflectTool('verify_claim', { modelId: 'm1' } as any, 'c1', emit, CTX, deps));
    expect(out.result.state).toBe('unconfirmed');
    expect(out.learningState).toBe('proposed');
  });

  it('candidate/ungoverned model → not_verifiable, no throw, capture-style unblocked', async () => {
    const deps: Partial<ReflectToolDeps> = {
      verify: async () => { throw new SemanticModelNotGovernedError('m1', 'candidate'); },
    };
    const { emit } = collect();
    const out = JSON.parse(await executeReflectTool('verify_claim', { modelId: 'm1' } as any, 'c1', emit, CTX, deps));
    expect(out.result.state).toBe('not_verifiable');
    expect(out.learningState).toBe('proposed');
  });

  it('model-not-found (generic throw) → not_verifiable, no throw', async () => {
    const deps: Partial<ReflectToolDeps> = {
      verify: async () => { throw new Error('No platform_semantic_models found'); },
    };
    const { emit } = collect();
    const out = JSON.parse(await executeReflectTool('verify_claim', { modelId: 'zzz' } as any, 'c1', emit, CTX, deps));
    expect(out.result.state).toBe('not_verifiable');
    expect(out.learningState).toBe('proposed');
  });
});
