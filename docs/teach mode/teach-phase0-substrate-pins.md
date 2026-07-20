# Teach — Phase 0 substrate pins (read-only verification pass)

**Date:** 2026-07-20
**Scope:** Verify the memory / vocabulary / reputation substrate against real code before Teach relies on it. No feature code, migrations, schema, or tests were written.
**Verdict up front:** Every substrate item is **CONFIRMED present**. Phase 1 is safe to start. Four watch-items (not blockers) are listed at the bottom.

---

## Step A — Existence check

| Substrate item | Present? | Path (authoritative) |
|---|---|---|
| Memory store ("active memory / core rule / topic") | ✅ present | `PlatformAgentMemory` → `platform_agent_memory` — [schema.prisma:2234](../../prisma/schema.prisma#L2234); logic in [src/lib/memory/](../../src/lib/memory/) |
| Synonym / rules subsystem (personal vs org) | ✅ present | governed synonyms: `platform_sem_*` `synonyms[]` — [governance.ts:45](../../src/lib/semantic/governance.ts#L45); standing rules: [src/lib/memory/teach.ts](../../src/lib/memory/teach.ts) |
| `src/lib/semantic/context-builder.ts` | ✅ present | [context-builder.ts:64](../../src/lib/semantic/context-builder.ts#L64) |
| `applyOutcomeForUser` | ✅ present | [reputation/store.ts:213](../../src/lib/memory/reputation/store.ts#L213) |
| `platform_user_reputation` | ✅ present | [migration.sql:49](../../prisma/migrations/20260713_reputation_system/migration.sql#L49); `PlatformUserReputation` [schema.prisma:2303](../../prisma/schema.prisma#L2303) |
| Inspector chat loop | ✅ present | [InspectorShell.tsx](../../src/components/inspector/InspectorShell.tsx), [useInspectorChat.ts](../../src/hooks/useInspectorChat.ts), [chat/route.ts](../../src/app/api/inspector/chat/route.ts) |

**No STOP condition triggered.** This remained a verification pass. Note: a user-facing teach path already exists — `src/lib/memory/teach.ts` (Phase 3.5D). "Reputation on teaching" is therefore *not* net-new (see Step C3).

---

## Step B — Substrate pins

| # | Item | Status | Real name | file:line | Notes |
|---|---|---|---|---|---|
| 1 | Memory store table | **[C]** | `platform_agent_memory` / `PlatformAgentMemory` | [schema.prisma:2234](../../prisma/schema.prisma#L2234) | columns below |
| 1 | "active memory" | **[C]** | `status = 'ACTIVE'` rows | [schema.prisma:2247](../../prisma/schema.prisma#L2247) | soft-retire = `SUPERSEDED` |
| 1 | "core rule" | **[C]** | `rule_type` enum-by-convention | [teach.ts:38](../../src/lib/memory/teach.ts#L38) | `SCHEMA_MAP\|HARD_RULE\|HEURISTIC\|SOURCE_PREF\|FAILURE_MODE` |
| 1 | "topic" | **[C]** | `task_signature` → `platform_memory_topics.topic_key` | [retrieve.ts:257](../../src/lib/memory/retrieve.ts#L257) | topic grouping is a join, not a column |
| 1 | org scoping mechanism | **[C] — via `getDefaultOrg()`** | `DEFAULT_ORG_ID` env | [org.ts:4](../../src/lib/org.ts#L4), [chat/route.ts:191](../../src/app/api/inspector/chat/route.ts#L191) | see §"org scoping" |
| 2 | governed synonyms | **[C]** | `synonyms text[]` on `platform_sem_entities/_dimensions/_measures` | [governance.ts:45](../../src/lib/semantic/governance.ts#L45) | editable field, allowlisted |
| 2 | standing rules (taught) | **[C]** | `platform_agent_memory` via `teachRule()` | [teach.ts:63](../../src/lib/memory/teach.ts#L63) | writes SAME table, bypasses `curate()` |
| 2 | personal-vs-org scope | **[C]** | `visibility` (`'personal'\|'org'`) + `created_by` | [schema.prisma:2262](../../prisma/schema.prisma#L2262) | retrieval clause [retrieve.ts:163](../../src/lib/memory/retrieve.ts#L163) |
| 3 | synonyms reach the prompt | **[C] — live** | `buildSemanticPromptSection` renders `also called:` | [prompts.ts:326](../../src/lib/inspector/prompts.ts#L326) | NOT flag-gated; caveats below |
| 3 | memory rules reach the prompt | **[C] — flag-gated** | `formatForInjection` → system prompt | [chat/route.ts:226](../../src/app/api/inspector/chat/route.ts#L226) | needs `MEMORY_INJECT_ENABLED` + class |
| 4 | reputation table | **[C]** | `platform_user_reputation` | [migration.sql:49](../../prisma/migrations/20260713_reputation_system/migration.sql#L49) | columns below |
| 4 | reputation filter | **[C]** | unique `(org_id, user_id, domain)` | [migration.sql:66](../../prisma/migrations/20260713_reputation_system/migration.sql#L66) | `loadOrInit` [store.ts:128](../../src/lib/memory/reputation/store.ts#L128) |
| 4 | authoring domain string | **[C]** | `'semantic_authoring'` | [promotion-gate.ts:39](../../src/lib/semantic/promotion-gate.ts#L39) | memory-bullet outcomes use `agent_class` instead |
| 4 | `applyOutcomeForUser` | **[C]** | delta = `+0.5` (CONTRIBUTED), capped | [engine.ts:89](../../src/lib/memory/reputation/engine.ts#L89) | credits the AUTHOR, not the admin |

### 1 — Memory store schema (columns)
`platform_agent_memory` ([schema.prisma:2234-2268](../../prisma/schema.prisma#L2234)):
`id, org_id, agent_class, task_signature (nullable), rule_text, rule_type, helpful_count, harmful_count, confidence (0.5), embed_text, source_session_ids[], version, status ('ACTIVE'), valid_from, valid_until, created_at, updated_at, embedding (pgvector), last_used_at, short_label, blurb, caveat_context (json), contributor_rep (1.0), created_by (nullable), visibility ('org')`.

**Org scoping (the answer to the memory §5.8 question):** every read/write is filtered by `org_id` at the **column level** — confirmed in [retrieve.ts:191](../../src/lib/memory/retrieve.ts#L191), [teach.ts:72](../../src/lib/memory/teach.ts#L72), [context-builder.ts:71](../../src/lib/semantic/context-builder.ts#L71). **But the `org_id` VALUE is resolved by `getDefaultOrg()`, which just reads the `DEFAULT_ORG_ID` env var** ([org.ts:4](../../src/lib/org.ts#L4)) — it is *not* derived from the caller's session/membership. The chat route ([chat/route.ts:171,191](../../src/app/api/inspector/chat/route.ts#L171)) and both governance routes use it. → **It leans on `getDefaultOrg()` — the documented single-org risk is real.** Column-level tenancy is present; identity-level tenancy is not enforced.

### 2 — Synonym / rules subsystem (answers Open Q1)
There are **two** vocabulary surfaces, both **personal-first**:
- **Governed synonyms** live as `synonyms text[]` on the semantic definition tables; editing them is an allowlisted field ([governance.ts:49](../../src/lib/semantic/governance.ts#L49)). Their scope follows the definition's ladder: `draft` (owner-only) → `candidate` (org-visible) → `governed`.
- **Standing rules** are written by `teachRule()` into `platform_agent_memory` with `visibility='personal', created_by=<you>` ([teach.ts:84](../../src/lib/memory/teach.ts#L84)); `promoteRuleToOrg()` flips `visibility='org'` ([teach.ts:151](../../src/lib/memory/teach.ts#L151)), reputation-gated.

**Open Q1 resolved by code: personal-first, not straight-to-org.** Retrieval visibility clause is `visibility='org' OR created_by=$caller` ([retrieve.ts:163](../../src/lib/memory/retrieve.ts#L163)); an unresolved caller falls back to a `__no_user__` sentinel so a personal rule is **fail-closed** — never leaks into another user's context ([retrieve.ts:153,460](../../src/lib/memory/retrieve.ts#L153)).

### 3 — Injection path (the dead-synonym risk)
**Synonyms → assembled prompt: CONFIRMED LIVE, not flag-gated.** Trace:
`buildSemanticContext` populates `GovernedEntitySummary.synonyms` ([context-builder.ts:174,181,188](../../src/lib/semantic/context-builder.ts#L174)) → `buildSemanticPromptSection` renders each synonym as `, also called: …` for entities/dimensions/measures ([prompts.ts:326-345](../../src/lib/inspector/prompts.ts#L326)) → `buildSystemPrompt` concatenates the section ([prompts.ts:363](../../src/lib/inspector/prompts.ts#L363)) → chat route calls it into the system prompt ([chat/route.ts:180](../../src/app/api/inspector/chat/route.ts#L180)). The prompt text even documents the intent: *"A synonym nobody reads is dead weight."* ([prompts.ts:324](../../src/lib/inspector/prompts.ts#L324)). So synonyms are **asserted in the assembled context, not merely in a table.**

⚠️ **Two real dead-synonym traps for Teach to respect:**
1. `buildSemanticContext` only loads **`status='governed'`** entities/dims/measures ([context-builder.ts:71-79](../../src/lib/semantic/context-builder.ts#L71)). A synonym on a **candidate or personal-draft** definition is stored but **NOT injected** until the definition is governed.
2. Only the **top-K (default 10)** pgvector-ranked entities are injected ([context-builder.ts:67,144](../../src/lib/semantic/context-builder.ts#L67)). Synonyms on entities beyond the cap never reach the prompt.

**Memory rules → assembled prompt: CONFIRMED but FLAG-GATED + RULE-TYPE-GATED.** They reach the prompt only when `MEMORY_INJECT_ENABLED='true'` AND `'inspector' ∈ MEMORY_INJECT_CLASSES` ([retrieve.ts:83](../../src/lib/memory/retrieve.ts#L83), [chat/route.ts:189](../../src/app/api/inspector/chat/route.ts#L189)). Phase 0 + 1a are appended to the system prompt ([chat/route.ts:226](../../src/app/api/inspector/chat/route.ts#L226)); Phase 1b is prepended as a synthetic assistant turn ([chat/route.ts:249](../../src/app/api/inspector/chat/route.ts#L249)). **`teach.ts` deliberately defaults `ruleType='SCHEMA_MAP'`** ([teach.ts:65](../../src/lib/memory/teach.ts#L65)) because Phase 1a injects null-signature SCHEMA_MAPs with no confidence/harmful gate — a freshly taught **`HARD_RULE` would silently never inject** until `harmful_count ≥ 1` ([retrieve.ts:PHASE0_MIN_HARMFUL usage:200](../../src/lib/memory/retrieve.ts#L200)). This is the live dead-rule trap and Teach must pick rule types with it in mind.

### 4 — Reputation
`platform_user_reputation` columns ([migration.sql:49-64](../../prisma/migrations/20260713_reputation_system/migration.sql#L49)):
`id, org_id, user_id, domain, role ('member'), pos, neg, last_decay_at, cap_day, cap_pos_today, season_id ('S1'), season_xp, last_rank, updated_at`. Unique on **`(org_id, user_id, domain)`** ([migration.sql:66](../../prisma/migrations/20260713_reputation_system/migration.sql#L66)).

- **Domain string:** authoring/promotion credit uses `'semantic_authoring'` ([promotion-gate.ts:39](../../src/lib/semantic/promotion-gate.ts#L39)). Memory-bullet runtime outcomes use `agent_class` (e.g. `'inspector'`) as the domain ([store.ts:245](../../src/lib/memory/reputation/store.ts#L245)). **These are different domains — a Teach assertion must name the right one.**
- **Delta on a promote/outcome:** `creditAuthoringPromotion` → `applyOutcomeForUser(org, user, 'semantic_authoring', 'CONTRIBUTED')` → `OUTCOME_WEIGHTS.CONTRIBUTED = +0.5` added to `pos`, **subject to `dailyPositiveCap = 20`** ([engine.ts:89,156-179](../../src/lib/memory/reputation/engine.ts#L89)). It is **not** a row-existence event — it is a `+0.5` evidence bump (may be 0 if the daily cap is exhausted).
- **Who is credited:** the **contributor / row author (`created_by`)**, explicitly not the acting admin — promote route credits each promoted row's author ([promote/route.ts:131-138](../../src/app/api/inspector/semantic/[modelId]/promote/route.ts#L131)); `promoteRuleToOrg` credits `rule.createdBy` ([teach.ts:156](../../src/lib/memory/teach.ts#L156)). Gated on `MEMORY_REPUTATION_ENABLED` ([promotion-gate.ts:222](../../src/lib/semantic/promotion-gate.ts#L222)); non-fatal.

> **Assertion rule for later phases:** when we assert reputation moved, assert **delta = +0.5 (capped) to the AUTHOR's `semantic_authoring.pos`** — never row existence, never the acting user.

---

## Step C — Doc tensions / open questions

### C1 — Aggregate-edit tension (walkthrough seam 4): **DEMOTES to candidate.**
Editing a governed measure's `aggregate` is a snapshot-relevant (computation) change: `SNAPSHOT_RELEVANT_FIELDS.measure = ['aggregate','expression','metric_type']` ([authoring-draft.ts:168](../../src/lib/semantic/authoring-draft.ts#L168)), so `touchesComputation` is true → `decideEditGate` returns `forceDemotion: true` ([authoring-draft.ts:248-254](../../src/lib/semantic/authoring-draft.ts#L248)) → the PATCH route sets `status='candidate'` and writes a `demote` audit row ([definitions/[definitionId]/route.ts:143-164](../../src/app/api/inspector/semantic/[modelId]/definitions/[definitionId]/route.ts#L143)).
- **Both docs are partly right:** the measure IS demoted, *and* dependent widgets are flagged — but they are the **same field set** by design (`SNAPSHOT_RELEVANT_FIELDS` is deliberately tied to `MeasureSnapshot` so the demotion rule and the dashboard drift detector cannot diverge — [authoring-draft.ts:157-166](../../src/lib/semantic/authoring-draft.ts#L157)). Authoritative answer to the tension: **aggregate edit → demote to candidate for re-governance.** A cosmetic edit (label/synonyms/unit/format) stays governed. Only an admin or self-approve-eligible user may edit a governed def at all ([definitions route:93-112](../../src/app/api/inspector/semantic/[modelId]/definitions/[definitionId]/route.ts#L93)).

### C2 — Does failed/absent verification block capturing a candidate? **Code does NOT decide it — product call.**
There is **no verification-execution gate on the capture path today.** Draft capture runs shape validation + `compileSafety` only (no query execution) — [authoring-draft.ts:76](../../src/lib/semantic/authoring-draft.ts#L76); `teachRule()` writes directly with no gate ([teach.ts:63](../../src/lib/memory/teach.ts#L63)). All reputation/admin gates fire at **promotion** (candidate→governed), never at capture. → Absent/failed verification currently **does not block** capturing a draft/candidate. Teach's notion of *"verified* candidate learnings" is **net-new**; the "verify-before-capture" decision is undecided by existing code and should be treated as a product call in Phase 1.

### C3 — Is reputation already wired on an authoring/promote path today? **YES — reuse it.**
`creditAuthoringPromotion` is already invoked on:
- the metric promote route ([promote/route.ts:137](../../src/app/api/inspector/semantic/[modelId]/promote/route.ts#L137)), and
- standing-rule promotion ([teach.ts:158](../../src/lib/memory/teach.ts#L158)).

Both gate on `MEMORY_REPUTATION_ENABLED` (project memory: flag is **ON**, weighting off). → **"Reputation on teaching" is not net-new** — the loop exists for both metrics and standing rules. Teach reuses `applyOutcomeForUser` / `creditAuthoringPromotion` / `evaluatePromotionEligibility` rather than building anything.

---

## Safe to start Phase 1?

**Yes — all substrate items are [C]. No hard blockers.** Carry these four watch-items into Phase 1:

1. **Single-org (`getDefaultOrg` → `DEFAULT_ORG_ID`).** Everything is org-scoped by column, but the org value is a single env-configured id, not per-user. Don't design Teach assuming per-session/per-membership org resolution.
2. **Synonyms only inject when `governed` AND within top-K (10).** Vocabulary Teach captures at draft/candidate tier will *not* affect the agent until promoted and ranked — mirror this in any "it's now applied" UX so we don't imply a dead synonym is live.
3. **Memory-rule injection is flag-gated + rule-type-gated.** A taught rule is silently dead if `MEMORY_INJECT_ENABLED`/class is off, or if the rule type doesn't clear its phase gate (e.g. a `HARD_RULE` with `harmful_count=0`). Default to `SCHEMA_MAP` as `teach.ts` already does.
4. **Verify-before-capture is undecided (C2).** Needs a product call before Phase 1 builds the capture surface.

**Assertion discipline for later phases:** reputation → assert `+0.5` (capped) delta to the **author's** `semantic_authoring.pos`, not row existence; vocabulary → assert presence in the **assembled prompt** (governed + top-K), not DB presence.
