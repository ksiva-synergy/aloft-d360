# 07 — Memory and organisational learning

**Boundary rule:** ALOFT owns semantic mappings, user teaching, the vector and relational semantic stores, and lesson distillation. Studio owns run state, goal and progress records, and improvement proposals for its own skills and flows. Studio **reads** ALOFT knowledge through interfaces and **never writes** to it.

## 1. Memory classes

| Class | Owner | What | Where today | Studio's use |
|---|---|---|---|---|
| (a) Session context | Studio (per run or chat) | Messages, step outputs within one run | Run step outputs (`RunStore`); Inspector sessions are separate | Step outputs only. Never replay whole transcripts |
| (b) User / team operational memory | Studio | Preferences (default approver, preferred connection), recent drafts | None | Proposed `studio_preferences` (scoped, editable, deletable) |
| (c) Goal & Progress memory | Studio | Goals, plans, checkpoints, decisions, blockers, outcomes, evidence refs | None | Proposed (§2) |
| (d) Verified organisational process knowledge | Studio, approved by an org owner | "PO follow-ups go to the buyer's lead", approved templates | Templates in code | Template library with an approval workflow (M5) |
| (e) Semantic lessons and mappings | **ALOFT** | Governed models, taught rules, FOER bullets, reputation | `src/lib/semantic/*`, `src/lib/memory/*` (`teach.ts` personal → org promotion by the author or an admin) | Read via ports, as fenced data. No writes |

## 2. Goal & Progress memory (proposed, M4/M6)

```ts
type GoalRecord = {
  id: string; orgId: string; ownerId: string;
  scope: 'private' | 'team' | 'org';
  goal: string;                       // what the user asked for, verbatim
  plan: { stepId: string; summary: string }[];
  checkpoints: { at: string; runId?: string; stepId?: string; status: string; note?: string }[];
  decisions: { at: string; by: 'user' | 'agent' | 'policy'; decision: string; rationale: string; evidenceIds: string[] }[];
  blockers: { at: string; kind: 'missing_permission' | 'missing_connection' | 'approval_pending' | 'failure'; detail: string }[];
  outcome?: { status: 'achieved' | 'abandoned' | 'superseded'; at: string; evidenceIds: string[] };
  retention: { expiresAt?: string; legalHold?: boolean };
  verification: 'asserted' | 'evidenced';
};
```

Rules:

- **Structured decisions, not chain-of-thought.** Store the decision, its rationale summary and evidence ids. Never store raw reasoning tokens as audit truth.
- **Evidence vs assertion.** A record is `evidenced` only when it links to `Evidence` rows (step outputs, documents, query results with provenance).
- **Permission revalidation on read.** Every retrieval re-checks the reader against `scope` *and* against the evidence's access scope. A goal record never reveals data its reader can't open directly.
- **Inspect, edit, delete.** The owner can see and correct every record. Deletion cascades to derived summaries.
- **Expiry and consolidation.** Default TTL 180 days for private records (proposal). Consolidation produces a new summarized record that links its sources. Sources are never silently overwritten.

## 3. Learning loop (proposal-based)

```
observe run outcomes ─► evaluate (eval suites, approval rejections, failure clusters)
   ─► propose a change (skill version, flow version, template) ─► sandbox regression on pinned fixtures
   ─► human approval (owner; admin for org scope) ─► versioned release ─► monitor
```

- **Separation of duties:** skill improvement (Studio skill owners), process optimisation (flow owners), semantic learning (ALOFT teach and promotion). Studio may *suggest* that a user teach ALOFT a rule. It hands off through the existing teach UI and never writes the rule itself.
- **No global policy from one user's behaviour.** Org-wide changes need an org-scoped approval and an eval run across domains.
- **Rollback:** every learned change is a version and can be reverted by republishing the previous one.

## 4. ALOFT integration contract (reads only)

| Need | ALOFT function | Port (proposed) | Authorization | Fallback |
|---|---|---|---|---|
| Governed data for `query` steps | `executeSemanticQuery(query, connectionId, opts)` | `AloftSemanticPort.query` | Governed models only on the default path. Org from env. Run identity recorded | Step fails with a clear reason. No silent raw-SQL fallback |
| Semantic context for the planner | `buildSemanticContext` (`src/lib/semantic/context-builder.ts`) | `AloftSemanticPort.describe` | Same | Planner asks the user to pick a model |
| Taught rules / FOER memory for agent steps | `selectMemoryAll` + `formatForInjection` (`src/lib/memory/retrieve.ts`) | `AloftMemoryPort.select(scope)` | Personal lane only for the run owner. Org-visible otherwise. Off unless `MEMORY_INJECT_ENABLED` | Run without memory and record that it ran without memory |

**Measurable fallback:** every run records whether the semantic context and memory were available (`context.semantic: ok|unavailable`, `context.memory: injected|off|failed`). This allows comparing outcome quality with and without ALOFT context.

**Known risk (S13):** ALOFT memory is currently injected into system prompts as instruction text. Studio will pass it as fenced data in the user turn. It will not enable injection for flows until S1–S4 are fixed.
