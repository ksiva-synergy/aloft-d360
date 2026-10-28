# Efficient, non-redundant pipeline — playbook & brainstorm

**Audience:** Operators (today), product + eng (target state)  
**Last updated:** 2026-10-28  
**Companion:** [redundancy-and-skip-behavior.md](./redundancy-and-skip-behavior.md) (mechanics) · [schema-harvest-guide.md](./schema-harvest-guide.md) (one schema) · [remediation-master-plan.md](./remediation-master-plan.md) (execution)

---

## 1. North star

An **efficient harvest** means:

| Dimension | Good | Bad |
|-----------|------|-----|
| **Tiers** | Only kinds with real gaps for the chosen scope | Full T0→embed chain when only T1 is stale |
| **Scope** | `catalog.schema.*` (or explicit table list) matching the business unit | Full source when 40 tables in one schema need work |
| **Warehouse** | Stale-only T1/T2, delta T0, embed_text skip | `forceReprofile` / full pipeline by habit |
| **Orchestration** | One sequential chain with shared `pipeline_run_id` | Three manual launches while guessing order |
| **Outcome** | Job stats match preview (`staleObjectCount`, intent `staleEstimate`) | Green job with zero work and no explanation |
| **Ops** | Active Runs shows one parent chain; no overlap 409 surprises | Kind archaeology + duplicate overlapping jobs |

**Efficiency formula (mental model):**

```text
useful_work ≈ stale_objects_touched × tier_cost
waste       ≈ fargate_starts × (scope_width − stale_objects) + wrong_tiers_enqueued
```

Workers already minimize **warehouse waste**. The biggest lever operators have **today** is **scope + entry point**. The biggest lever eng has **next** is **preflight + one launch surface**.

---

## 2. Golden paths (use these first)

### 2.1 New schema in discovery (nothing scanned yet)

| Step | Action | Why |
|------|--------|-----|
| 1 | Confirm rows in **Scanned** tab or discovery facet — run **`estate_inventory`** only if schema missing from tree | Avoid blind T0 |
| 2 | **Guided launch** or Jobs modal: **T0 only**, Limit `catalog.schema.*` | Focus forces resolve for subset; avoids full-source T0 |
| 3 | **Scanned** → select schema → **Continue pipeline** through **embed** (or through T2 if search not needed) | Intent enqueues **only** T1/T2/embed with gaps — **not** another T0 |
| 4 | Watch **Active Runs** for sequential chain | One `pipeline_run_id`, ordered tiers |

**Do not:** Catalog **Run full pipeline (from T0)** unless you explicitly want a fixed T0→embed chain regardless of gaps.

### 2.2 Schema already scanned; Databricks tables changed (structural delta)

| Step | Action | Why |
|------|--------|-----|
| 1 | T0 with same `catalog.schema.*` Limit (no `forceFullScan` unless catalog team says full re-list) | Delta may suffice org-wide; Focus still resolves subset |
| 2 | **Continue pipeline** from Scanned | T0 bumps `last_t0_at` on touched tables → T1 stale only where structure changed |
| 3 | Skip embed until T2 done if you do not need vectors yet | Fewer Fargate embed passes |

### 2.3 Catch-up: scanned, need semantic cards for Agent Lab (no structural work)

| Step | Action | Why |
|------|--------|-----|
| 1 | Scanned tier pills / facet **needs profile / enrich** counts | Same predicates as workers |
| 2 | **Continue** with through = **T2** or **embed** as needed | Skips T0 and fresh T1 |
| 3 | If only embed gap: single **embed** job with schema Limit | Orchestrator scopes embed; worker skips unchanged `embed_text` |

### 2.4 Org-wide “what should we run next?” (cockpit)

| Step | Action | Why |
|------|--------|-----|
| 1 | Read **Recommended next step** title + **estimatedTables** | Priority: inventory → unscanned T0 → T1 → T2 → embed |
| 2 | If recommendation is T1/T2/embed and count ≪ source size | **Do not** click **Run on Fargate** blindly — open **Guided launch** or Scanned and **Limit** to top gap schemas from health |
| 3 | T0 gap recommendation often includes sample **`catalog.schema.*`** patterns — good | Scoped T0 |

### 2.5 Deliberate overwrite (compliance, model change, bad cards)

| Step | Action | Why |
|------|--------|-----|
| 1 | Jobs modal (Advanced) with **same Limit** | Explicit flags |
| 2 | Enable only what you need: `forceFullScan` → `forceReprofile` → `forceReEnrich` | Versioned new rows on T1/T2 |
| 3 | Run **embed** after T2 if vectors must match new semantics | Embed skip uses text hash, not “force” flag |

---

## 3. Which UI surface when?

| You want… | Best surface | Avoid |
|-----------|--------------|--------|
| Minimum tiers for selected schema(s) | Scanned **Continue pipeline** + confirm sheet | L1 kind card without Limit |
| First-time onboarding one schema | **Guided launch** (intent + scope steps) | Cockpit full-source T1 |
| Fixed curriculum T0→embed for one schema | Catalog **Run full pipeline (from T0)** | Continue (won’t enqueue T0 if already scanned) |
| See / kick / cancel what’s running | **Active Runs** | Refreshing L1 history only |
| Org priority nudge | Cockpit recommendation → **then narrow scope** | Run on Fargate with empty Limit for T1+ |
| Power user / overwrite | Jobs modal Advanced + checkboxes | Wizard alone (no force flags yet) |

---

## 4. Anti-patterns (efficiency killers)

| Anti-pattern | What happens | Fix |
|--------------|--------------|-----|
| Full pipeline on green schema | T0 job + chain even when only 3 tables stale | Continue from Scanned |
| Cockpit **Run on Fargate** for T1 with 50 stale / 50k scanned | Job succeeds with huge `skipped_stale` | Add Limit globs from facet gaps |
| Launch T1+T2+embed manually without **sequential** | T2 starts before T1 finishes on some tables | Continue or sequential launch |
| Same schema, overlapping kinds | 409 or duplicate work | Wait for Active Runs; cancel or finish |
| Embed for “schema harvest task” | Extra Titan cost | Omit embed until search/RAG needed |
| T3 for schema-only task | Source-wide query history (partial scope) | Defer T3 unless usage product needs it |
| Re-run T1 without structural change expecting skip | Still profiles if `forceReprofile` or misunderstanding | Trust stale pills; no force flag |

---

## 5. Scope craft (rules of thumb)

1. **One schema:** always `catalog.schema.*` in Limit — see [schema-harvest-guide.md](./schema-harvest-guide.md).  
2. **Multi-schema (≤12):** Scanned schema checkboxes → Continue (Phase 3).  
3. **Many tables, one schema:** default schema Limit; table checkboxes only when you truly need subset.  
4. **Exclude tree:** use to drop bad schemas from a wide source — **not** as a positive selector.  
5. **Match scope across tiers** in a chain: same patterns on T0→T1→T2→embed (Continue does this automatically).  
6. **Read plan preview:** `staleObjectCount` for T1/T2 — if **0**, do not launch that kind unless forcing overwrite.

---

## 6. Brainstorm — crafting the *best* system (product + eng)

Below is a prioritized backlog of ideas to maximize **non-redundant efficiency**. Items marked **Done (partial)** exist in repo; others align with [remediation-master-plan.md](./remediation-master-plan.md) Phase 4–5.

### 6.1 Control plane — “don’t enqueue empty work”

| Idea | Benefit | Notes |
|------|---------|--------|
| **Preflight refuse launch** when `staleObjectCount === 0` and no force flags | Saves Fargate for no-op T1/T2 | Cockpit Run + modal confirm; exception: operator override |
| **Single `POST launch` with intent id** | Continue, wizard, cockpit all send same payload | Phase 5 entry unification |
| **Align `needs_embed` with embed worker** | Intent count ≈ embed job `embedded + skipped` split | Today: presence vs embed_text |
| **Block full pipeline when intent says IDLE through embed** | Catalog button respects gaps | Or rename to “Force full refresh chain” |
| **409 + UI disable on Continue** | Already partial | Extend to all launch surfaces |

### 6.2 UX — one obvious “efficient” button

| Idea | Benefit | Notes |
|------|---------|--------|
| **Primary CTA: “Run gaps only (scoped)”** on cockpit | Replaces ambiguous Run on Fargate | Opens wizard step 2 with health-derived Limit |
| **Scanned row action: “Fix gaps”** | Same as Continue, clearer label | |
| **Job result badge: EMPTY / INCREMENTAL / FULL** from stats | Honest success | Charter principle 5 |
| **Show $/query estimate on plan** | Ops efficiency | Optional; tablesample already in T1 budget |
| **Wizard default through-tier** | Embed only if `needs_embed > 0` | Step 1 intent from `computePipelineIntent` |

### 6.3 Workers — tighter skips (without wrong skips)

| Idea | Benefit | Risk |
|------|---------|------|
| T0 **schema-only delta** when Limit set and not Focus-first | Less resolve on re-run | Must not miss new tables in schema |
| **Batch profile** for stale set only (already) | — | Keep |
| **Embed**: pre-filter object IDs with `needs_embed` SQL in orchestrator | Less JS skip loop | Must match embed_text edge cases |
| **T3 scoped to objects** | Schema-efficient usage | P2-5 pushdown |
| **Inventory diff** — skip full crawl when connector etag unchanged | Big win for huge estates | Needs platform support |

### 6.4 Scheduling & automation

| Idea | Benefit | Notes |
|------|---------|--------|
| **Scheduled “gap drain”** per source: intent → launch once nightly | No human | `--process-scheduled` + intent (Phase 0.3) |
| **Post-T0 webhook chain** | Structural change triggers Continue | Event-driven vs polling |
| **Per-schema SLA dashboard** | `% stale` drives priority | Product analytics |

### 6.5 Ops & cost

| Idea | Benefit |
|------|---------|
| Active Runs: **orchestration waste** column (`skipped_stale / scope_size`) | Spot bad launches |
| **`ui_surface` analytics** | Which entry points cause wide no-op jobs |
| Right-size Fargate / share workers for embed-only | Cost |
| Phase 0 **in-process chain** reliable | Fewer orphan queued children |

### 6.6 Governance

| Rule | Why |
|------|-----|
| Default **no force flags** in wizard | Overwrite is exceptional |
| Require **typed confirm** for full-source T1+ | Prevents mis-clicks |
| Document **one schema per PR / tenant onboarding** | Blast radius |

---

## 7. Recommended “best craft” summary (one paragraph)

**Today:** Pick **Scanned Continue** or **Guided launch** with **`catalog.schema.*`**, let **`computePipelineIntent`** choose tiers, verify **`staleObjectCount`** before launch, use **Active Runs** for chains, reserve **full pipeline** and **force*** flags for intentional refresh. **Tomorrow:** refuse zero-stale launches, unify entry points on intent, label EMPTY jobs, align embed gap math, and schedule **gap drains** so humans rarely click full-source Run.

---

## 8. Verification checklist (you ran efficiently)

- [ ] Scope Limit matches facet / schema selection  
- [ ] Plan or intent **staleEstimate** > 0 for each enqueued tier (or force flag documented)  
- [ ] No unnecessary **T0** in chain when Scanned already populated  
- [ ] **Sequential** chain if multiple tiers  
- [ ] Job stats: `objects_profiled` / `objects_enriched` ≈ preview, or **`skipped_stale`** explained  
- [ ] Active Runs: no overlapping same-kind scope  
- [ ] Embed omitted if search not required  

See also verification matrix in [remediation-master-plan.md](./remediation-master-plan.md) §11.

---

## 9. Related

| Doc | Role |
|-----|------|
| [redundancy-and-skip-behavior.md](./redundancy-and-skip-behavior.md) | Timestamp rules, launch path matrix |
| [versioning-and-incremental.md](./versioning-and-incremental.md) | When overwrite creates new versions |
| [phase-0-chain-deploy.md](./phase-0-chain-deploy.md) | Chain reliability for multi-tier efficiency |
