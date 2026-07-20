# Build Plan — Teach (Memory Teaching UI)

> **Goal.** A learning-mode agent surface where "Marcus" (Reflect mode, on by default) *understands*
> rather than *does* — extracting verified, curated knowledge from a teaching conversation and
> displaying it live. Teach only **produces** learnings; the downstream commit/curation step ("Build")
> is a future thread seeded by what Teach captures, and is out of scope here.
>
> **Grounding key.** `[C]` = confirmed against `/mnt/project/` docs · `[I]` = inferred from a documented
> mechanic · `[U]` = named only in the screenshot / walkthrough spec / kickoff prompt, **not** in the
> two source docs — must be pinned against real code before trusting.

---

## Scope & non-goals

**In scope:** the Teach page — a single immersive session surface. The agent learns, asks follow-up
questions, retrieves and updates past memory, and verifies user statements with tools. The UI shows,
clearly and live, *what is being learnt* and its state.

**Explicitly out of scope (future):** the Build/curation/commit desk. Teach persists learnings as
reviewable candidates; a later thread will review, edit, resolve conflicts, and commit/promote them
into the memory store. Design and build Teach so its output is a clean, typed feed that Build can
consume later — but do not build Build now.

---

## Phase 0 — Pin the memory substrate `[hard prerequisite]`

Neither source doc describes FOER, synonyms/rules, or `platform_user_reputation`; those appear in the
dashboard screenshot and the walkthrough spec and are all `[U]`. Do **not** design writes against a
store you haven't confirmed. Before building, read the real code for:

- **Memory store schema** — what "active memory / core rule / topic" actually are (the screenshot shows
  317 active memories, 14 core rules, 6 topics). Confirm the tables and their org scoping. `[U]`
- **Synonym / rules subsystem** — personal-vs-org scoping, how a rule is stored and applied. `[U]`
- **`context-builder.ts`** — how memory is assembled into the LLM prompt. `[C]` that the file exists
  (memory §7); `[U]` how memory specifically is injected. This is the "dead synonym" risk from walkthrough
  seam 6: a memory that exists in the DB but never reaches the prompt is silently useless.
- **`applyOutcomeForUser` + reputation domains** — only if teaching should earn credit. `[U]` — pin the
  columns, the `(org_id, user_id, domain)` filter, and the expected delta before asserting anything.

This is the same class of gap the walkthrough spec's Section E flags. Front-load it.

---

## Phase 1 — The learning-mode agent loop

Fork the Inspector chat loop — `InspectorShell`, `useInspectorChat`, and the SSE `/api/inspector/chat`
route are the reference patterns (`[C]`, memory §7). What makes it "Teach":

- **System prompt = "Marcus Reflect."** Explicitly instructed to: *not* execute tasks; ask clarifying
  follow-up questions; extract discrete learnings; and verify checkable claims. This is the primary
  "no tasks" control.
- **Tool allowlist = the hard guardrail.** Grant only: (a) memory-read, (b) memory-write-*candidate*,
  and (c) read-only verification via `executeSemanticQuery` (governed-only gate + the `executeDatabricksSQL`
  chokepoint, both `[C]`, memory §4.1 / §8). Explicitly **withhold** dashboard-mutation, chart-save, and
  every write tool. The prompt says "don't do tasks"; the allowlist makes doing them impossible.
- **Structured emission.** Extend the SSE event schema to emit typed `learning_item` events
  (`type`, `statement`, `state`, `verification_result`, `related_memory_hits`, `conflict`) alongside the
  narrative — so the "What Marcus is learning" rail is driven by real events, never by scraping the chat
  text.

**Learning types** the extractor should tag: metric definition · enterprise convention · estate
navigation · vocabulary/entity · other.

---

## Phase 2 — Retrieve · Verify · Conflict

- **Retrieve.** On each user turn, query existing memory for related items and inject them into context.
  This is where the Phase-0 `context-builder` pin pays off — and it carries the seam-6 risk: confirm the
  retrieved memory actually reaches the assembled prompt, not just the DB. Surface a "recalled N related
  memories" affordance in the UI.
- **Verify.** When the user makes a checkable factual claim ("Spar owns 41 vessels," "tankers are type
  code T\*"), Marcus compiles and runs a **read-only** semantic query and attaches the result to the
  learning card ("confirmed: 41 Spar-owned vessels" / "couldn't confirm — 0 rows"). Handle the
  governed-only gate as an explicit "can't verify — model not governed" state, **not** a 500 (plan §9).
- **Conflict.** Diff each new learning against retrieved memory. On contradiction, emit a `conflict`
  state and require user resolution (existing vs. new, side by side) before that learning can advance.

**Learning-card state machine** (drives the UI): `proposed` → `verifying` → `verified ✓` /
`conflict` / `rejected`.

---

## Phase 3 — Persistence as a candidate feed (the Build seam)

Teach writes learnings as **candidates** only — never straight into governed memory. Model this on the
documented draft → candidate → governed lifecycle (`[C]`, memory §4.5 / §8):

- Persist each learning with its type, statement, state, verification result, conflict info, session id,
  and author. This typed feed is exactly what the future Build desk consumes.
- Do **not** implement commit/promote here. But shape the schema so a later `canEditDashboard`-style RBAC
  gate (predicates in `permissions.ts`, `[C]`, memory §1.5) can govern the eventual org-wide commit.
- If accepted teaching should earn reputation later, that's the `applyOutcomeForUser` path — pin it first
  (Phase 0) and assert **delta + correct user**, not row-existence (the seam-3/6 weak-assertion trap).

---

## Phase 4 — UI

The Teach page (single immersive surface, Reflect mode on by default):

- **Center thread** with Marcus; persistent "Reflect mode" indicator; visible clarifying follow-ups.
- **Session header** — topic being taught + live counters (proposed / verified / pending / conflicts).
- **"What Marcus is learning" rail** (docked right) — one card per learning, type-tagged, state-colored,
  updating live off `learning_item` events.
- **Verification chips** inline on cards ("checked against the data estate → confirmed: 41…").
- **Memory-recall** expander and **conflict-resolution** side-by-side interaction.
- **States to build:** mid-conversation (mixed card states incl. a verified-against-data and a conflict),
  empty ("What should Marcus understand today?"), verifying/loading, conflict resolution.
- **Both light and dark themes** from shared design tokens (dark primary; light = off-white base, shadows
  instead of glows, deepened accent).

---

## Open questions to resolve before starting

1. **Personal-first or straight-to-org?** Are learnings scoped to the teaching user first (then promoted),
   or proposed org-wide immediately? (Affects Phase 3 schema + the future Build gate.)
2. **Does verification ever block?** — **RESOLVED** (see *Shared rule: verification tiering* below).
   Advisory at capture, hard gate at promote.
3. **Reputation on teaching** — in or out for v1? If in, Phase 0 must pin `applyOutcomeForUser`.

---

## Shared rule: verification tiering `[decision — applies to Teach AND Metric Store]`

Verification is **advisory at capture/submit** and a **hard gate at promote-to-governed**:

- **Capture never blocks.** A learning (Teach) or metric definition (Store) can be persisted as a
  draft/candidate with *any* verification outcome — including `0 rows` and `model-not-governed`. The
  outcome is recorded on the card; it does not stop the thing from existing as a candidate.
- **Promotion requires `confirmed`.** Advancing draft/candidate → **governed** requires a `confirmed`
  read-only verification, alongside the other promote gates (grounded dependencies, no unresolved synonym
  conflicts, steward role). `0 rows` / `model-not-governed` are honest non-confirming states — they leave
  the item promotable-later, not promoted-now.

**Why this is a shared rule, not a screen property.** Teach and the Store write the *same* substrate
(the Phase-0 `[U]` memory/vocabulary tables). If the gate lived only in one surface's UI, a thing that is
unverifiable in one could be promoted through the other. Enforce the tiering at the **lifecycle /
promote path** both surfaces call — not in either screen — so they cannot drift. The `Define a Metric`
prototype's promotion-readiness checklist is one *rendering* of this rule; it is not the source of it.

*(Still `[U]`: the promote path, its gate set, and where `confirmed` is stored must be pinned against
the real 3.5A–D source before this rule is enforced in code.)*

---

## Dependency note

The Teach flow's writes and the Metric Store's intent resolution depend on the **same** unconfirmed
memory/vocabulary substrate (Phase 0's `[U]` items). If both are built in parallel threads, pin that
substrate once, first — the two features feed each other (teaching produces the synonyms and definitions
the Store later resolves against).
