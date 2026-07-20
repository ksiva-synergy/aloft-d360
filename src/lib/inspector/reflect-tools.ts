/**
 * src/lib/inspector/reflect-tools.ts
 *
 * Teach / "Marcus Reflect" — the tool layer (Phase 1).
 *
 * This module is LAYER TWO of the two-layer "no tasks" control (layer one is the
 * system prompt in reflect-prompt.ts). The Reflect loop is granted EXACTLY three
 * tools, all read or candidate-only:
 *
 *   recall_memory    — read existing memory  (wraps selectMemoryAll / retrieve.ts)
 *   capture_learning — write a PERSONAL candidate learning (wraps teachRule)
 *   verify_claim     — read-only governed query (wraps executeSemanticQuery →
 *                      executeDatabricksSQL chokepoint). Advisory; never mutates.
 *
 * Every mutation/production tool the Inspector loop has (emit_semantic_chart,
 * emit_chart, execute_tool raw SQL, describe_schema, dashboard/chart writes) is
 * WITHHELD. Because the agent can only call tools present in the ToolConfiguration,
 * withholding a tool makes the action structurally impossible — the prompt persuades,
 * this allowlist enforces.
 *
 * The engine calls (recall/capture/verify/credit) are dependency-injected so the
 * guardrails, the learning_item event shape, and the reputation-timing decision are
 * unit-testable without a live database — matching this repo's test discipline.
 */

import type { Tool, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import type { ToolEmit } from './tools';
import { SEMANTIC_QUERY_SCHEMA } from './prompts';
// Error classes come from the node-safe errors module (no server-only), so this
// file loads cleanly under vitest. The ENGINE calls (teach.ts, retrieve.ts,
// execute.ts) each transitively import `server-only` via context/embed and
// platform/agents, so they are LAZY-imported inside DEFAULT_DEPS — never at
// module load. Tests inject deps and never trigger the lazy imports.
import {
  SemanticModelNotGovernedError,
  SemanticValidationFailureError,
  SemanticDraftAccessError,
} from '@/lib/semantic/errors';
import type { SemanticQuery } from '@/lib/semantic/types';

/** Inspector agent-memory class. Mirrors teach.ts's INSPECTOR_MEMORY_CLASS
 *  without statically importing that server-only module. */
export const INSPECTOR_MEMORY_CLASS = 'inspector';

// ── Learning taxonomy (lockstep with reflect-prompt.ts + Phase-4 card model) ────

export const LEARNING_TYPES = [
  'metric_definition',
  'enterprise_convention',
  'estate_navigation',
  'vocabulary_entity',
  'other',
] as const;
export type LearningType = (typeof LEARNING_TYPES)[number];

/**
 * Learning-card state machine (drives the Phase-4 rail):
 *   proposed → verifying → verified / conflict / rejected
 * Phase 1 only ever emits `proposed`. `verifying`/`verified`/`conflict` are
 * populated in Phase 2; the fields exist now so the front end binds without change.
 */
export const LEARNING_STATES = [
  'proposed',
  'verifying',
  'verified',
  'conflict',
  'rejected',
] as const;
export type LearningState = (typeof LEARNING_STATES)[number];

export interface RelatedMemoryHit {
  id: string;
  ruleText: string;
  ruleType: string;
  phase: 'INIT' | 'SCHEMA_GLOBAL' | 'TASK_SCOPED';
}

/**
 * Phase-2 seam — populated when verify_claim runs against a checkable claim.
 * Left null in Phase 1 (capture is never gated on verification — the C2 decision).
 */
export interface VerificationResult {
  ok: boolean;
  state: 'confirmed' | 'unconfirmed' | 'not_verifiable';
  rowCount?: number;
  sql?: string;
  reason?: string;
}

/** Phase-2 seam — populated when a learning contradicts retrieved memory. */
export interface ConflictInfo {
  existingMemoryId: string;
  existingStatement: string;
  note?: string;
}

/**
 * The typed learning-card model. Field shape matches the Phase-4 prototype
 * (type · statement · state · verify · conflict · recall) so the rail binds
 * directly off `learning_item` events, never by scraping chat text.
 */
export interface Learning {
  id: string;
  type: LearningType;
  statement: string;
  state: LearningState;
  verification_result: VerificationResult | null;
  related_memory_hits: RelatedMemoryHit[];
  conflict: ConflictInfo | null;
  /** platform_agent_memory id once captured; null before persistence. */
  memoryId: string | null;
  createdAt: string;
}

/** The SSE envelope for a learning. `type` is the event discriminator; the
 *  learning's OWN type lives at `learning.type` to avoid colliding with it. */
export interface LearningItemEvent {
  type: 'learning_item';
  learning: Learning;
}

// ── Tool names: the allowlist and the explicitly-withheld set ───────────────────

export const REFLECT_TOOL_NAMES = ['recall_memory', 'capture_learning', 'verify_claim'] as const;
export type ReflectToolName = (typeof REFLECT_TOOL_NAMES)[number];

/**
 * Tools the ordinary Inspector loop exposes that Reflect mode DELIBERATELY
 * withholds. Kept as a named constant so the acceptance test can assert none of
 * them ever leaks into the Reflect ToolConfiguration.
 */
export const WITHHELD_MUTATION_TOOLS = [
  'emit_semantic_chart',
  'emit_chart',
  'execute_tool',
  'describe_schema',
] as const;

export function isReflectToolAllowed(name: string): name is ReflectToolName {
  return (REFLECT_TOOL_NAMES as readonly string[]).includes(name);
}

// ── Tool specs ──────────────────────────────────────────────────────────────────

const RECALL_MEMORY_TOOL: Tool = {
  toolSpec: {
    name: 'recall_memory',
    description:
      'Read what you already know about a topic before capturing a new learning. Returns existing personal + org memory bullets relevant to your query. READ-ONLY — never writes.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language description of the topic to recall, e.g. "fiscal year definition" or "vessel ownership".',
          },
        },
        required: ['query'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  },
};

const CAPTURE_LEARNING_TOOL: Tool = {
  toolSpec: {
    name: 'capture_learning',
    description:
      'Capture ONE atomic learning the user is teaching you, as a PERSONAL candidate (visible only to this user until a later review step). Split compound statements into separate calls. Does NOT execute or build anything — it only records knowledge.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [...LEARNING_TYPES],
            description:
              'metric_definition | enterprise_convention | estate_navigation | vocabulary_entity | other',
          },
          statement: {
            type: 'string',
            description: 'A clear, self-contained statement of the learning that still makes sense out of context.',
          },
        },
        required: ['type', 'statement'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  },
};

/**
 * verify_claim's input schema. A NEW object that SPREADS the shared
 * SEMANTIC_QUERY_SCHEMA's properties and adds an optional `learningId` — so the
 * verification can be attached to the candidate it verifies WITHOUT mutating the
 * shared SEMANTIC_QUERY_SCHEMA (also used by Inspector's emit_semantic_chart).
 * `required` is inherited unchanged (learningId is optional). When present it is
 * the `memoryId` returned by the capture_learning that produced the learning.
 */
export const VERIFY_CLAIM_SCHEMA = {
  ...SEMANTIC_QUERY_SCHEMA,
  properties: {
    ...SEMANTIC_QUERY_SCHEMA.properties,
    learningId: {
      type: 'string',
      description:
        'Optional. The memoryId returned by the capture_learning call whose claim this query verifies — pass it to attach this verification to that learning.',
    },
  },
} as const;

const VERIFY_CLAIM_TOOL: Tool = {
  toolSpec: {
    name: 'verify_claim',
    description:
      'Advisory, READ-ONLY verification of a checkable factual claim against the GOVERNED data estate. Runs a governed semantic query (governed models only) through the read-only Databricks chokepoint. Never blocks capturing a learning; if the model is not governed it returns a "not_verifiable" state, not an error. Pass learningId (the memoryId of the learning you just captured) to attach the result to that learning.',
    inputSchema: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: VERIFY_CLAIM_SCHEMA as any,
    },
  },
};

/**
 * Build the Reflect ToolConfiguration — the hard guardrail. Exactly the three
 * read/candidate tools; no mutation tool is present, so the agent cannot perform
 * a task even if the prompt is ignored.
 */
export function buildReflectToolConfig(): ToolConfiguration {
  return { tools: [RECALL_MEMORY_TOOL, CAPTURE_LEARNING_TOOL, VERIFY_CLAIM_TOOL] };
}

// ── Pure helpers (unit-testable without a DB) ───────────────────────────────────

function coerceLearningType(v: unknown): LearningType {
  return typeof v === 'string' && (LEARNING_TYPES as readonly string[]).includes(v)
    ? (v as LearningType)
    : 'other';
}

/**
 * Construct a fully-typed Learning with Phase-1 defaults. Every field the
 * Phase-4 card binds to is present; the Phase-2 seams (verification_result,
 * related_memory_hits, conflict) default to their empty forms.
 */
export function buildLearning(input: {
  id: string;
  type: unknown;
  statement: string;
  memoryId?: string | null;
  state?: LearningState;
  createdAt?: string;
  related_memory_hits?: RelatedMemoryHit[];
  verification_result?: VerificationResult | null;
  conflict?: ConflictInfo | null;
}): Learning {
  return {
    id: input.id,
    type: coerceLearningType(input.type),
    statement: input.statement,
    state: input.state ?? 'proposed',
    verification_result: input.verification_result ?? null,
    related_memory_hits: input.related_memory_hits ?? [],
    conflict: input.conflict ?? null,
    memoryId: input.memoryId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Map a capture_learning tool call to teachRule() arguments. Personal-first,
 * created_by = the session user, and rule_type = SCHEMA_MAP (teach.ts's default)
 * — the ONLY rule type that reliably injects for a freshly-taught bullet (a
 * HARD_RULE silently never injects until harmful_count >= 1). The learning type
 * is metadata for the card; it does NOT change the injecting rule_type.
 */
export function mapCaptureToTeachArgs(
  orgId: string,
  userId: string,
  statement: string,
  agentClass: string = INSPECTOR_MEMORY_CLASS,
) {
  return {
    orgId,
    userId,
    ruleText: statement,
    ruleType: 'SCHEMA_MAP' as const,
    agentClass,
  };
}

/**
 * Mirror of retrieve.ts's SQL visibility clause, as a pure predicate:
 *   a bullet is visible iff it is org-wide OR the caller is its author.
 * Personal rules are FAIL-CLOSED: an unresolved caller (null) sees org rules only,
 * never anyone's personal rule.
 */
export function isVisibleToCaller(
  rule: { visibility: string; createdBy: string | null },
  callerUserId: string | null,
): boolean {
  if (rule.visibility === 'org') return true;
  if (!callerUserId) return false; // fail-closed
  return rule.createdBy === callerUserId;
}

/**
 * Phase-1 reputation-timing decision (Step 3): capture is NOT promotion, so a
 * Teach capture does NOT credit reputation. Reputation attaches later, when Build
 * promotes a learning (reusing creditAuthoringPromotion at that moment). This
 * constant makes the decision explicit and gives the test something to assert.
 */
export const CAPTURE_CREDITS_REPUTATION = false;

// ── Phase 2, Step 3 — verify → learning-state mapping ───────────────────────────

/**
 * Map a verification outcome onto the learning-card state machine.
 *
 * Only a CONFIRMED read-only result advances a learning to 'verified'. An
 * unconfirmed (0-row) or not_verifiable (ungoverned / model-not-found / no
 * connection) result is an honest NON-confirming state — it stays 'proposed'
 * (advisory; the shared verification-tiering rule keeps it promotable-later, it
 * does NOT reject or block the learning). Verification never gates capture.
 */
export function learningStateForVerification(result: VerificationResult): LearningState {
  return result.ok && result.state === 'confirmed' ? 'verified' : 'proposed';
}

// ── Phase 2, Step 2 — conflict detection (pure, deterministic default) ──────────

const CONFLICT_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
];
// A negation/exclusion flip on a shared subject is a contradiction signal.
const CONFLICT_NEGATIONS = ['not', 'never', 'no', "n't", 'exclude', 'excluding', 'without', 'omit', 'ignore'];
const CONFLICT_STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'we', 'our', 'us', 'you', 'when', 'means', 'mean', 'that', 'this', 'it',
  'as', 'by', 'with', 'always', 'should', 'must', 'from', 'at', 'they', 'them',
]);

function conflictTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9'=]+/g, ' ').split(' ').filter(Boolean);
}
function conflictContentWords(tokens: string[]): Set<string> {
  // Strip an `=value` suffix so `status='a'` and `status='active'` both
  // contribute the SUBJECT token `status` to the overlap — the differing value
  // is then judged separately by conflictAssignmentValues.
  return new Set(
    tokens
      .map((t) => { const eq = t.indexOf('='); return eq >= 0 ? t.slice(0, eq) : t; })
      .filter((t) => !CONFLICT_STOP.has(t) && t.length > 1),
  );
}
function conflictJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}
function conflictMonth(tokens: string[]): string | null {
  return tokens.find((t) => CONFLICT_MONTHS.includes(t)) ?? null;
}
/** Values on the RHS of an assignment token like `status='a'` or `type=t`. */
function conflictAssignmentValues(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq >= 0 && eq < t.length - 1) out.push(t.slice(eq + 1).replace(/'/g, ''));
  }
  return out;
}
function conflictNumbers(tokens: string[]): string[] {
  return tokens.filter((t) => /^\d+$/.test(t));
}
function conflictHasNegation(tokens: string[]): boolean {
  return tokens.some((t) => CONFLICT_NEGATIONS.includes(t));
}

/**
 * Deterministic, PRECISION-oriented contradiction check between two standing
 * statements about the same subject. Returns a human note when they contradict.
 *
 * Fires only when the two statements clearly concern the SAME subject (content-
 * word overlap) AND disagree on a DECISIVE token: a differing month, a differing
 * assignment value (status='A' vs status='ACTIVE'), a differing standalone
 * number, or a negation/exclusion flip. Precision over recall by design — a
 * missed contradiction is caught later at Build review, whereas a false conflict
 * wrongly stalls a capture-advance. Injectable (ReflectToolDeps.detectConflict)
 * so a future LLM-backed detector can raise recall without touching callers.
 */
export function detectStatementConflict(
  newStatement: string,
  existingStatement: string,
): { conflict: boolean; note?: string } {
  const nt = conflictTokens(newStatement);
  const et = conflictTokens(existingStatement);
  const overlap = conflictJaccard(conflictContentWords(nt), conflictContentWords(et));
  if (overlap < 0.4) return { conflict: false };

  const nMonth = conflictMonth(nt), eMonth = conflictMonth(et);
  if (nMonth && eMonth && nMonth !== eMonth) {
    return { conflict: true, note: `same subject, differing month (${eMonth} → ${nMonth})` };
  }

  const nVals = conflictAssignmentValues(nt), eVals = conflictAssignmentValues(et);
  if (nVals.length > 0 && eVals.length > 0) {
    const differ = nVals.some((v) => !eVals.includes(v)) || eVals.some((v) => !nVals.includes(v));
    if (differ) return { conflict: true, note: `same subject, differing value (${eVals.join(',')} → ${nVals.join(',')})` };
  }

  const nNums = conflictNumbers(nt), eNums = conflictNumbers(et);
  if (nNums.length > 0 && eNums.length > 0) {
    const differ = nNums.join(',') !== eNums.join(',');
    if (differ) return { conflict: true, note: `same subject, differing number (${eNums.join(',')} → ${nNums.join(',')})` };
  }

  if (overlap >= 0.5 && conflictHasNegation(nt) !== conflictHasNegation(et)) {
    return { conflict: true, note: 'same subject, negation/exclusion flipped' };
  }

  return { conflict: false };
}

/**
 * Default conflict detector: diff a new statement against recalled memory and
 * return the FIRST contradicting hit as a ConflictInfo. Null when nothing
 * contradicts. (The just-written rule must be excluded from `hits` by the caller
 * so a learning never conflicts with itself.)
 */
export function defaultDetectConflict(
  newStatement: string,
  hits: RelatedMemoryHit[],
): ConflictInfo | null {
  for (const h of hits) {
    const { conflict, note } = detectStatementConflict(newStatement, h.ruleText);
    if (conflict) {
      return { existingMemoryId: h.id, existingStatement: h.ruleText, note };
    }
  }
  return null;
}

// ── Phase 2, Step 2 — conflict resolution capture (no governed write) ───────────

export const CONFLICT_RESOLUTION_CHOICES = ['keep_new', 'keep_existing', 'scope_by_context'] as const;
export type ConflictChoice = (typeof CONFLICT_RESOLUTION_CHOICES)[number];

/**
 * The learning-card state a resolution choice advances to — single source of
 * truth shared by resolveConflict (client/card transition) and the persistence
 * store (teach-candidate-store.resolveCandidateByMemoryId). keep_existing means
 * the user kept the prior rule, so the NEW learning is 'rejected'; keep_new /
 * scope_by_context advance it out of 'conflict' back to 'proposed'.
 */
export function nextStateForResolution(choice: ConflictChoice): LearningState {
  return choice === 'keep_existing' ? 'rejected' : 'proposed';
}

/** The captured user decision on a conflict. Recorded as a learning outcome —
 *  NOT a governed-memory write (Build commits later). */
export interface ConflictResolution {
  choice: ConflictChoice;
  /** For scope_by_context: the disambiguating context the user supplied. */
  scopeNote?: string;
  resolvedAt: string;
}

/**
 * Capture the user's resolution of a conflicted learning and advance the card —
 * WITHOUT promoting or writing governed memory (that is Build's job; there is no
 * auto-supersede here). Pure state transition + a recorded outcome:
 *   keep_new / scope_by_context → learning advances out of 'conflict' to 'proposed'
 *   keep_existing               → the new learning is 'rejected' (user kept prior)
 * The conflict field is retained on the learning so the resolution stays auditable.
 */
export function resolveConflict(
  learning: Learning,
  choice: ConflictChoice,
  opts: { scopeNote?: string; resolvedAt?: string } = {},
): { learning: Learning; resolution: ConflictResolution } {
  const resolution: ConflictResolution = {
    choice,
    scopeNote: opts.scopeNote,
    resolvedAt: opts.resolvedAt ?? new Date().toISOString(),
  };
  const nextState: LearningState = nextStateForResolution(choice);
  return {
    learning: { ...learning, state: nextState },
    resolution,
  };
}

// ── Dependency-injected engine seams ────────────────────────────────────────────

export interface ReflectToolContext {
  orgId: string;
  userId: string | null;
  connectionId: string | null;
  agentClass?: string;
  /** The Teach session that captured these learnings (workbench_sessions.id).
   *  Persisted on the candidate row so the feed can scope by author + session;
   *  null when unresolved (feed then scopes by author only). */
  sessionId?: string | null;
}

/** Envelope persisted at capture — the transient learning_item made durable. */
export interface PersistCandidateArgs {
  orgId: string;
  authorUserId: string;
  sessionId: string | null;
  memoryId: string;
  learningType: LearningType;
  state: LearningState;
  conflict: ConflictInfo | null;
}

/** Attach a verification outcome to an already-captured candidate. */
export interface AttachVerificationArgs {
  orgId: string;
  authorUserId: string;
  memoryId: string;
  verification: VerificationResult;
  state: LearningState;
}

export interface ReflectToolDeps {
  recall: (
    orgId: string,
    agentClass: string,
    taskContext: string,
    callerUserId: string | null,
  ) => Promise<RelatedMemoryHit[]>;
  capture: (
    args: ReturnType<typeof mapCaptureToTeachArgs>,
  ) => Promise<{ id: string; ruleText: string; ruleType: string }>;
  verify: (query: SemanticQuery, connectionId: string) => Promise<{ rowCount: number; sql: string }>;
  /**
   * Phase 2, Step 2 — conflict detector. Diffs a new statement against recalled
   * memory and returns the contradicting hit (or null). Injectable so the default
   * deterministic heuristic can be swapped for an LLM-backed detector without
   * touching the dispatcher. The default is defaultDetectConflict.
   */
  detectConflict: (newStatement: string, hits: RelatedMemoryHit[]) => Promise<ConflictInfo | null>;
  /**
   * Reputation-credit hook. Present so the timing decision is EXPLICIT and
   * testable — Phase 1 never invokes it on capture (see CAPTURE_CREDITS_REPUTATION).
   * Build (Phase 3+) wires it at the promotion moment.
   */
  credit?: (orgId: string, userId: string) => Promise<void>;
  /**
   * Teach Phase 3 (capture-shape) — persist the typed envelope the learning_item
   * event carries, so a read-only feed can project it. Best-effort by contract:
   * a persistence failure NEVER sinks a capture (C2 — capture never blocks).
   * Injected; the default lazy-imports the server-only store.
   */
  persistCandidate?: (args: PersistCandidateArgs) => Promise<void>;
  /**
   * Teach Phase 3 (capture-shape) — attach a verification outcome + resulting
   * card state to a previously-captured candidate (keyed by memoryId). Best-effort.
   */
  attachVerification?: (args: AttachVerificationArgs) => Promise<void>;
}

async function defaultRecall(
  orgId: string,
  agentClass: string,
  taskContext: string,
  callerUserId: string | null,
): Promise<RelatedMemoryHit[]> {
  const { selectMemoryAll } = await import('@/lib/memory/retrieve');
  const { phase0, phase1a, phase1b } = await selectMemoryAll(
    orgId,
    agentClass,
    taskContext,
    null,
    callerUserId,
  );
  const map = (
    bullets: { id: string; ruleText: string; ruleType: string }[],
    phase: RelatedMemoryHit['phase'],
  ) => bullets.map((b) => ({ id: b.id, ruleText: b.ruleText, ruleType: b.ruleType, phase }));
  return [
    ...map(phase0, 'INIT'),
    ...map(phase1a, 'SCHEMA_GLOBAL'),
    ...map(phase1b, 'TASK_SCOPED'),
  ];
}

const DEFAULT_DEPS: ReflectToolDeps = {
  recall: defaultRecall,
  capture: async (args) => {
    const { teachRule } = await import('@/lib/memory/teach');
    return teachRule(args);
  },
  verify: async (query, connectionId) => {
    // Default (no opts) path = governed-only gate + executeDatabricksSQL chokepoint.
    const { executeSemanticQuery } = await import('@/lib/semantic/execute');
    const res = await executeSemanticQuery(query, connectionId);
    return { rowCount: res.rowCount, sql: res.sql };
  },
  detectConflict: async (newStatement, hits) => defaultDetectConflict(newStatement, hits),
  // credit intentionally undefined — capture does not credit in Phase 1.
  persistCandidate: async (args) => {
    const { persistCapturedCandidate } = await import('./teach-candidate-store');
    await persistCapturedCandidate(args);
  },
  attachVerification: async (args) => {
    const { attachVerificationToCandidate } = await import('./teach-candidate-store');
    await attachVerificationToCandidate(args);
  },
};

// ── Dispatcher ──────────────────────────────────────────────────────────────────

/**
 * Execute a Reflect tool. Unknown / withheld tools are rejected (defence in depth
 * behind the allowlist). Returns a JSON string for the model; side-effect events
 * (learning_item, memory_recall, verification) go through `emit`.
 */
export async function executeReflectTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  callId: string,
  emit: ToolEmit = () => {},
  ctx: ReflectToolContext = { orgId: '', userId: null, connectionId: null },
  deps: Partial<ReflectToolDeps> = {},
): Promise<string> {
  const d: ReflectToolDeps = { ...DEFAULT_DEPS, ...deps };
  const agentClass = ctx.agentClass ?? INSPECTOR_MEMORY_CLASS;

  if (!isReflectToolAllowed(toolName)) {
    // Structural guardrail: anything not in the allowlist is refused here too.
    const error = `Tool '${toolName}' is not available in Reflect mode.`;
    emit({ type: 'tool_call_error', callId, error, retryable: false });
    return JSON.stringify({ error });
  }

  // ── recall_memory (read) ──────────────────────────────────────────────────────
  if (toolName === 'recall_memory') {
    const query = typeof toolInput.query === 'string' ? toolInput.query.trim() : '';
    try {
      const hits = await d.recall(ctx.orgId, agentClass, query, ctx.userId);
      emit({ type: 'memory_recall', callId, query, count: hits.length, hits });
      return JSON.stringify({ ok: true, count: hits.length, hits });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'recall failed';
      emit({ type: 'memory_recall', callId, query, count: 0, hits: [] });
      return JSON.stringify({ ok: true, count: 0, hits: [], note: reason });
    }
  }

  // ── capture_learning (write CANDIDATE, personal) ────────────────────────────────
  if (toolName === 'capture_learning') {
    const statement = typeof toolInput.statement === 'string' ? toolInput.statement.trim() : '';
    const learningType = coerceLearningType(toolInput.type);
    if (!statement) {
      const error = 'capture_learning requires a non-empty statement.';
      emit({ type: 'tool_call_error', callId, error, retryable: true });
      return JSON.stringify({ error });
    }
    if (!ctx.userId) {
      // No resolved author → cannot write a personal learning (fail-closed).
      const error = 'Cannot capture a personal learning without a signed-in author.';
      emit({ type: 'tool_call_error', callId, error, retryable: false });
      return JSON.stringify({ error });
    }
    try {
      const args = mapCaptureToTeachArgs(ctx.orgId, ctx.userId, statement, agentClass);
      const rule = await d.capture(args);

      // Reputation-timing decision (Step 3): capture is NOT promotion. Do NOT
      // credit here, even though a credit hook may be injected. Build promotes.
      // (CAPTURE_CREDITS_REPUTATION === false — the hook stays uncalled.)

      // ── Phase 2, Step 2 — recall + conflict detection (ADVISORY) ─────────────
      // Capture has ALREADY succeeded (the row is written). Recall the caller's
      // own memory (Step-1 personal lane makes their fresh rules visible) and diff
      // the new statement against it. On contradiction the learning is emitted in
      // 'conflict' state for user resolution — but the memory row STANDS: conflict
      // never un-writes a capture (C2). Recall/detect failures are swallowed so a
      // transient recall error can never sink a successful capture.
      let hits: RelatedMemoryHit[] = [];
      let conflict: ConflictInfo | null = null;
      try {
        const recalled = await d.recall(ctx.orgId, agentClass, statement, ctx.userId);
        // Exclude the just-written rule so a learning never conflicts with itself.
        hits = recalled.filter((h) => h.id !== rule.id);
        conflict = await d.detectConflict(statement, hits);
      } catch (recallErr) {
        console.warn('[reflect-tools] recall/conflict-detect failed (non-fatal, capture stands):',
          recallErr instanceof Error ? recallErr.message : String(recallErr));
      }

      const learning = buildLearning({
        id: callId,
        type: learningType,
        statement,
        memoryId: rule.id,
        state: conflict ? 'conflict' : 'proposed',
        related_memory_hits: hits,
        conflict,
      });

      // ── Teach Phase 3 (capture-shape) — persist the typed envelope ───────────
      // Make the transient learning_item durable so a read-only feed can project
      // it. BEST-EFFORT: a persistence failure is logged, never thrown — capture
      // never blocks (C2). ctx.userId is non-null here (guarded above).
      try {
        await d.persistCandidate?.({
          orgId: ctx.orgId,
          authorUserId: ctx.userId,
          sessionId: ctx.sessionId ?? null,
          memoryId: rule.id,
          learningType,
          state: learning.state,
          conflict,
        });
      } catch (persistErr) {
        console.warn('[reflect-tools] candidate persistence failed (non-fatal, capture stands):',
          persistErr instanceof Error ? persistErr.message : String(persistErr));
      }

      const event: LearningItemEvent = { type: 'learning_item', learning };
      emit(event as unknown as Record<string, unknown>);
      return JSON.stringify({ ok: true, memoryId: rule.id, learning });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'capture failed';
      emit({ type: 'tool_call_error', callId, error, retryable: true });
      return JSON.stringify({ error });
    }
  }

  // ── verify_claim (read-only, advisory) ──────────────────────────────────────────
  if (toolName === 'verify_claim') {
    // Strip the Teach-only `learningId` (see VERIFY_CLAIM_SCHEMA) before the rest
    // is handed to the semantic executor as a SemanticQuery. When present, it is
    // the memoryId of the captured learning this verification attaches to.
    const { learningId: rawLearningId, ...queryInput } = toolInput;
    const learningId = typeof rawLearningId === 'string' ? rawLearningId : null;
    const query = queryInput as unknown as SemanticQuery;

    // Teach Phase 3 (capture-shape) — attach the verification outcome to the
    // captured candidate (keyed by memoryId). Best-effort: a persistence failure
    // never turns an advisory verification into an error. Only fires when a
    // learningId AND a resolved author are present (fail-closed).
    const maybeAttach = async (result: VerificationResult, state: LearningState) => {
      if (!learningId || !ctx.userId) return;
      try {
        await d.attachVerification?.({
          orgId: ctx.orgId,
          authorUserId: ctx.userId,
          memoryId: learningId,
          verification: result,
          state,
        });
      } catch (attachErr) {
        console.warn('[reflect-tools] verification attach failed (non-fatal):',
          attachErr instanceof Error ? attachErr.message : String(attachErr));
      }
    };

    if (!ctx.connectionId) {
      const result: VerificationResult = {
        ok: false,
        state: 'not_verifiable',
        reason: 'No active governed connection to verify against.',
      };
      const learningState = learningStateForVerification(result);
      await maybeAttach(result, learningState);
      emit({ type: 'verification_result', callId, learningId, result, learningState });
      return JSON.stringify({ ok: false, result, learningState });
    }
    try {
      const res = await d.verify(query, ctx.connectionId);
      const result: VerificationResult = {
        ok: true,
        state: res.rowCount > 0 ? 'confirmed' : 'unconfirmed',
        rowCount: res.rowCount,
        sql: res.sql,
      };
      // Phase 2, Step 3 — attach the card-state transition the Phase-4 rail binds:
      // a CONFIRMED result advances the learning proposed → verified; a 0-row
      // (unconfirmed) result stays 'proposed' (honest, advisory, promotable-later).
      const learningState = learningStateForVerification(result);
      await maybeAttach(result, learningState);
      emit({ type: 'verification_result', callId, learningId, result, learningState });
      return JSON.stringify({ ok: true, result, learningState });
    } catch (err) {
      // Governed-only gate (and validation/draft-access) surface as a TYPED state,
      // never a 500. A candidate/draft model → SemanticModelNotGovernedError →
      // 'not_verifiable'; capture is never gated on this (C2). model-not-found
      // (Prisma NotFound) falls through the same typed path.
      let reason = err instanceof Error ? err.message : 'verification failed';
      if (
        err instanceof SemanticModelNotGovernedError ||
        err instanceof SemanticValidationFailureError ||
        err instanceof SemanticDraftAccessError
      ) {
        reason = err.message;
      }
      const result: VerificationResult = { ok: false, state: 'not_verifiable', reason };
      const learningState = learningStateForVerification(result);
      await maybeAttach(result, learningState);
      emit({ type: 'verification_result', callId, learningId, result, learningState });
      return JSON.stringify({ ok: false, result, learningState });
    }
  }

  // Unreachable (guarded above), but keep the exhaustive fallback.
  return JSON.stringify({ error: `Unhandled Reflect tool: ${toolName}` });
}
