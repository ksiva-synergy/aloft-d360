# Versioning and incremental harvest

**Principle (product):** **Incremental runs are desirable when each meaningful re-run appends a new version** (or otherwise preserves history). Skipping work is good only when the **current** version is still valid; **overwrite** is for when you need a **new** version after a deliberate full pass.

**Last updated:** 2026-10-24

---

## 1. Policy

| Rule | Meaning |
|------|---------|
| **Incremental default** | Run the smallest scope and the fewest tiers that bring data forward (delta T0, stale-only T2). |
| **Version on change** | When a tier **does** run, persist **append-only** history where the product promises auditability (profiles, semantic cards). |
| **Skip ≠ delete** | Incremental skip leaves the **latest version** in place; operators can still open history in UI/API where exposed. |
| **Overwrite = new version** | “Re-profile” / “Re-enrich” should create **vN+1**, not silently mutate vN in place (except current-column JSON on T2 columns — see below). |

This aligns with operator expectation: *incremental is good if we are keeping a version.*

---

## 2. What the codebase does today

| Tier | Incremental behavior | Versioning / history |
|------|----------------------|----------------------|
| **T0 structural** | After first sweep: `detectChanges` delta; Focus forces full resolve for subset | **No per-run version table** — current columns/object row updated; `last_t0_at` stamped. Lifecycle/drop on full sweeps only. |
| **T1 profile** | **No skip** — every object in scope is profiled each run | **`platform_context_profiles`** — new row per run, `version` monotonic per object (`saveProfile` in `profile.ts`). Drift vs previous version. |
| **T2 semantic** | **Skip stale-safe** — enrich only if `last_t2_at` null or `< last_t1_at` | **`platform_context_semantics`** — new card row, `version` monotonic per object (`persistCard` in `enrich.ts`). UI guards (confirm-semantic, resolve-pii) check latest version. |
| **embed** | Skips if embed text unchanged vs semantic card | Embedding store updates; not the same as semantic **card** version chain |
| **T3 usage** | Continuation windows | Usage snapshots / cards — separate model; see `usage.ts` |

**Implication:**

- **T1 + T2** match the principle: re-run → **new version**; skip (T2 only) → keep latest version.
- **T0** is incremental for **work avoidance** (delta) but **not** a versioned structural archive — if we need “structural as-of date”, that’s a future enhancement (snapshots or versioned column defs).
- **T1** does not skip by `last_t1_at` today — so it always adds a profile version for every table in scope (can be more work than necessary; charter Phase 4 may add stale-only T1).

---

## 3. Operator guidance

| Goal | Action |
|------|--------|
| Refresh stats, keep history | T1 on `catalog.schema.*` → new profile versions + drift |
| Refresh LLM card only where profile changed | T2 (default) → new semantic versions only for stale objects |
| Force new semantic cards everywhere in schema | Re-T1 then T2, or future **Overwrite re-enrich** |
| Structural delta only | T0 without Focus (after first sweep) → no version chain; updates current metadata |
| Structural full re-list one schema | T0 with `catalog.schema.*` Focus → resolveScope for subset |

---

## 4. Target UX (charter)

Launch wizard **Overwrite** toggles should map to versioned tiers:

| Toggle | Effect |
|--------|--------|
| Full structural rescan (schema) | T0 resolveScope for schema → updates current structural state |
| Re-profile all in scope | T1 for all objects → **new profile versions** |
| Re-enrich all in scope | T2 ignoring stale check → **new semantic versions** |

Default path remains incremental **without** overwrite when latest version is still valid (especially T2).

---

## 5. Engineering notes (future)

- **T1 stale-only:** Skip when `source_altered_at` / profile age policy says current vN is fresh; still append vN+1 when run.
- **T0 structural snapshots:** Optional `platform_context_structure_versions` if compliance requires point-in-time schema.
- **Expose version in Jobs UI:** Job stats should show `profiles_written`, `max_profile_version`, `semantics_written` so EMPTY vs incremental success is obvious.

---

## 6. Related docs

- [current-status.md](./current-status.md) — tier table  
- [schema-harvest-guide.md](./schema-harvest-guide.md) — what to run  
- [harvest-job-pipeline-remediation-charter.md](../audits/harvest-job-pipeline-remediation-charter.md) — overwrite toggles  
