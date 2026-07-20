# Merge readiness — Inspector reframe (Dashboards P0/P1 · Metric substrate 3.5A–D · Teach P1–P3 · Guided P1–P4)

> Gate verification for the single merge to `main`, run thread-by-thread. All
> tested surfaces are green; untested surfaces were verified by code-read and
> live-DB check. Two gaps are carried forward **documented, not silent** (below).

## Gate results

| Gate | Verdict | Automated tests | How the rest was verified |
|------|---------|-----------------|---------------------------|
| 1 — Dashboards P0/P1 | ✅ pass (gap: no route tests) | 10/10 lib | SEC-1/2/3 + viewer-403 code-read; connection binds on `platform_dashboards` (no stale model binding anywhere); `toAlias` guard mutation-confirmed real |
| 2 — Metric substrate 3.5A–D | ✅ pass | 73/73 semantic (incl. new credit guard) | submit-audit CHECK verified against live constraint (5 code actions ⊆ allowed set); 403 boundary leak-proof |
| 3 — Teach P1–P3 | ✅ pass | 52/52 | capture credits no reputation (defers to shared promote path); draft invisibility enforced 3 ways (LLM-context unit-tested fail-closed; feed SQL author+`personal`-scoped; `decideDefinitionAccess` exclude) |
| 4 — Guided P1–P4 | ✅ pass | 30/30 | mode round-trip lossless (tested); defensive `modelId` pin tested at construction + enforced at execution both routes; per-widget 403 leak-proof tested; batch route governed-only (never passes `AuthoringOpts`) |

Phase-1a taught-synonym injection starvation: **closed** on this branch
(personal-taught lane, wired + tested), not a gap.

Gate-2 reputation credit: was untested; **now guarded** by
`src/lib/semantic/__tests__/promotion-credit.test.ts` — asserts the credit lands
on the draft **author** (never the promoting admin), routes to
`semantic_authoring`/`CONTRIBUTED`, is flag-gated, and produces a real positive
posterior-mean delta (not row existence). Recipient selection was factored into
`selectAuthoringCreditRecipients` (promotion-gate.ts) as the test seam.

## Carried-forward gap 1 — NL-intent features ship DORMANT (needs the Metric Store rollout owner's eyes)

**Ticket (ready to file):**

> **Title:** NL-intent search/suggestions return empty until `nl_intent` capture runs upstream + backfill re-runs
>
> **Body:** `platform_nl_intent_embeddings` is empty across all orgs (verified
> live 2026-07-20). Root cause is upstream, not this branch: the source
> `nl_intent` column is null on all 3,134 measures and 7,814 dimensions in the
> live org (`spinor-demo`/Aloft-synergy), so `scripts/backfill-nl-intent-embeddings.ts`
> is currently a no-op. The read side degrades gracefully (`matchIntents` /
> `listGovernedIntents` return `[]`), so nothing crashes — but:
>
> - **Metric Store search** returns empty/generic results,
> - **Guided Stage 1/2 topic suggestions & disambiguation ranking** produce no
>   NL-driven suggestions,
>
> until (a) `nl_intent` capture is enabled on authored definitions upstream and
> (b) the backfill is re-run against the live org. **Risk:** to an end user a
> dormant search feature reads as a bug. Owner of the Metric Store rollout should
> decide whether to gate the search entry point behind a "no data yet" state or
> accept the empty result until capture lands.

## Carried-forward gap 3 — API routes verified by code-read, not route-level integration tests

There are **no route-level tests** under `src/app/api/inspector/dashboards/` or
`.../semantic/`. SEC-1/2/3, the viewer-403/owner-200 distinction, the batch
data route's governed-only behavior, and the promote route were verified by
code-read + live-DB check. Runtime 401/403/200-by-role verification is deferred
to live creds **per an existing team decision** (`phase0-contract-reconciliation.md`),
not a new gap introduced here. Flagged for merge-review visibility.
