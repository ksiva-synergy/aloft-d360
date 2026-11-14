# Power BI → Databricks recreation: Architecture v2

**Status:** approved 2026-11-14 · **Supersedes:** §7–§8 sketch in [powerbi-measure-recreation.md](./powerbi-measure-recreation.md)
**Baseline it must not regress:** Vessel Internal Audit 63 / 73 measures match Power BI and are published.

This document defines the target architecture for recreating Power BI measures as Databricks SQL across the whole estate, not one report. It combines:
- what works today (the model-driven compiler, typed parity, the rule registry, root causes);
- the self-diagnosing loop approved earlier;
- the lessons of 2026-11-14: run failures, SQL blow-up, false timeouts, replica drift and the "brain" gap.

The per-measure history of what was wrong and how it was fixed stays in the main recreation doc.

---

## 1. Why a v2

Two days of work took Vessel from 7 to 63 matching measures. Nearly every breakthrough, though, came from a person investigating by hand:
- probing per-status counts to find the relationship blank row;
- timing each measure to find 388 KB statements;
- re-running a "cancelled" query to find it actually succeeds in 128 s;
- reading the explainer output to see the SQL doubling with every `+`;
- comparing Power Query input columns with the Databricks replica to find a split column.

The pipeline *produced SQL and labelled outcomes*. It didn't *find out why*. Runs were also fragile: CII translate restarted from zero three times after database drops and one slow measure.

v2 makes those investigation moves part of the workflow and makes runs survive failures.

## 2. Design principles
Each principle is backed by a defect found in the pilot.

| # | Principle | Evidence |
|---|---|---|
| 1 | **Power BI is the judge.** SQL, rules and fixes are accepted only when they match Power BI; never pick SQL by matching the oracle value | PSC non-determinism would have been "fixed" by luck |
| 2 | **Deterministic core, LLM at the edges, always verified** | The LLM tier produced 9 / 73 Vessel measures; the compiler 63 |
| 3 | **Measure, don't guess**: telemetry on every step | 388 KB SQL, false timeouts and "hangs" were invisible until timed |
| 4 | **Every failure gets a precise reason** | "parity_mismatch 1 vs 0" was really "blank row from 19 orphan rows" |
| 5 | **One measure can't stall a run, and a crash can't lose a run** | CII runs: three restarts, one 39-minute "hang" |
| 6 | **Learn once, apply estate-wide** | WEEKNUM / LEN / MOD rules are proven once and used by all 451 models |

## 3. Layers
```
 L0 Harvest + fidelity gate ─► L1 Model graph ─► L2 Compiler ─► L3 Execution ─► L4 Verification ─► Publish
          ▲                                        ▲   │              │               │
          │                                        │   └──── telemetry + events ──────┤
          │                                        │                                  ▼
 L6 Learning + governance ◄────────────── L5 Investigator ("brain") ◄────── failures / slow / mismatches
```
✅ exists · 🆕 to build

### L0 · Harvest and fidelity gate: is the input trustworthy?
- ✅ `pbi_definitions` / `pbi_parse`. Reconciliation by lineageTag keeps measure and table ids stable across re-parses.
- ✅ TMDL fidelity fixes: property leaks, quoted measure names, fenced partition sources, measure-only tables.
- ✅ **Fidelity gate** (Phase 2, `fidelity-gate.ts`), run before compiling:
  - every measure and calculated-table DAX parses;
  - every `[ref]` resolves to a column or measure;
  - no TMDL property text appears in stored DAX;
  - every table's source system is classified (Databricks / Snowflake / SQL Server / files / enter-data / DAX).
- ✅ **Replica schema check.** For each table, compare the Power Query *input* columns (the leaves of the M lineage) with the bound warehouse table's columns.

  Example found 2026-11-14: CII SDK's `CII_Enerva` reads Snowflake, where `BOILER_CONS_DURING_CARGO_HEATING_OR_DISCHARGING_MT_LFO` exists. The bound Databricks replica splits it into `…_HEATING_MT_LFO` and `…_DISCHARGING_MT_LFO`.

  Output: `replica_drift` with the exact column difference, sent to a steward.

  **Built (Phase 2):**
  - Issues sit on graph nodes and attach to exactly the measures whose dependency closure reaches them.
  - Blocking kinds: `replica_drift`, `dax_parse_error`, `tmdl_leak`, `empty_measure`. Warnings: `unresolved_reference` (could be an ADDCOLUMNS/VAR name), `pq_unsupported`.
  - A drifted column inside a Power Query row filter blocks every measure on that table.
  - A plain passthrough native query (`SELECT * FROM t`) is checked against the bound object. Other native queries define their own columns and are skipped.
  - Suggestions: a generic split detector (`X_OR_Y` → `X` + `Y` both present), else the closest columns by token overlap.
  - Resolver-approved column overrides clear an issue.
  - Blocked measures get tier `fidelity_gate` with `props.fidelity_block` and root cause `replica_drift` / `harvest_gap` / `empty_dax`. The full report is stored on `pbi_models.props.fidelity`.
  - CLI: `scripts/powerbi/fidelity-report.ts --models "…"` (read-only).

### L1 · Model graph: one typed, versioned picture per model ✅ (Phase 2, `model-graph.ts`)
- One graph per model run:
  - tables (source system, M lineage, warehouse schema, refresh time);
  - columns (kind, type, lineage expression);
  - calculated tables, relationships, measures, verified rules.
- It replaces the three partial loaders used today (`loadMeasureLogicCatalog`, `loadModelColumnCatalog`, the analyzer).
- Every node carries a **content hash**. A measure's dependency hash covers its DAX, every column, calculated column and measure it reaches, and the lineage of their tables. That drives incremental runs: unchanged measures are skipped.
- **Built (Phase 2):**
  - Node kinds: table, calc_table, column, calc_column, measure, missing.
  - References are resolved the way DAX resolves them: `T[x]` is a column, else a measure; `[x]` is the home column, else a measure. Columns produced by a calculated table resolve to that table.
  - Table hashes cover source M, binding and warehouse schema, so schema changes reach exactly the measures that read the table.
  - The dependency hash includes a relationships signature.
  - Translate fingerprint = compiler version + verified rules + dependency hash + fidelity blocks.
  - The three loaders are not merged yet. The graph is built from `loadMeasureLogicCatalog`.
  - **Estate views:**
    - per-measure dependency graph (warehouse column → Power Query column → calculated column → measure);
    - whole-model overview grouped by table, with in-place expand and impact / sources highlighting. The browser receives the compact full graph (about 130 KB for 450 nodes) and computes impact locally.

### L2 · Compiler: semantics as code, functions as data
- ✅ Core evaluation rules:
  - filter context, CALCULATE, context transition;
  - relationships (multi-hop) and the blank row;
  - DAX BLANK comparisons and arithmetic;
  - Power Query null semantics;
  - calculated columns and calculated tables.
- ✅ Rule registry (`pbi_translation_rules`) for scalar functions and M functions, each proven by differential testing against Power BI.
- ✅ Size controls: shared scalar CTEs for row-free measures and VARs; linear `+`/`−` chains. Attained_CII went 388 KB → 26 KB.
- 🆕 **Plan strategies:** inline → shared CTE → staged → **decorrelated GROUP BY / join** (for per-value iterators that Spark can't plan). Chosen by what executes, never by the oracle value.
- 🆕 **Static cost check** before any warehouse call:
  - SQL size ÷ DAX size;
  - nesting depth;
  - correlated-subquery depth.

  Super-linear growth is flagged as `compiler_blowup` (a compiler bug) instead of being executed.

### L3 · Execution: one hardened path to Databricks 🆕 (Phase 1)
- A single warehouse client (`warehouse-exec.ts`) for the test step, parity and probes:
  - **async polling** with an explicit per-measure **time budget** (e.g. EXPLAIN 2 min, execute 10 min);
  - classified outcomes: `ok`, `sql_error` (planning/analysis), `timeout` (budget exhausted), `transient` (503 / network after retries);
  - bounded retries with backoff on transient errors;
  - an in-run **result cache** keyed by SQL hash.
- **Runs that survive:**
  - stable processing order;
  - **per-measure checkpoints:** a measure whose fingerprint (DAX hash + model fingerprint + compiler version) is unchanged and already has a final outcome is skipped, so a retried or resumed run continues where it stopped;
  - **heartbeat** on the job row and a **stale-job reaper** (jobs that heartbeat and go silent are marked failed with a reason);
  - **database-retry** around every write (`P1001` / connection drops).
- **Telemetry** stored with each translation: compile ms, DAX and SQL sizes, growth ratio, CTE count, plan/execute ms, attempts, outcome.

### L4 · Verification: did we match Power BI?
- ✅ Typed parity: numbers, decorated numbers, dates, text, BLANK.
- ✅ Dataset refresh time; `data_freshness` and `nondeterministic_source` classification.
- ✅ Nightly built-in function audit (25 / 25 built-ins match Power BI after three fixes).
- 🆕 **Batched oracle:** many measures per `EVALUATE`.
- ✅ CII oracle results that came back empty: these models use RLS. The oracle now reads RLS models through **executeDaxQueries** (Arrow) with the workspace-Admin service principal (unfiltered); see `execute-dax.ts`.
- ✅ Parity skips execution when there is no Power BI value (`rls_required` / missing oracle).
- ✅ Estate ownership & refresh card (`pbi-ownership.ts`). A stale or failing dataset shows before any mismatch is read as a SQL defect.
- 🆕 **Sliced oracle:** grand total plus one grouping (per vessel or per year). It catches errors that cancel out in the total, and lets label and visual-context measures be compared at their intended grain.

### L5 · Investigator: the brain 🆕
1. **Detectors** over telemetry and outcomes:
   - `compiler_blowup`;
   - timeout-vs-error (automatic retry with a larger budget before labelling `engine_limit`);
   - missing warehouse column (lineage leaf not in the warehouse catalog, caught before execution);
   - `replica_drift`, `data_freshness`, `nondeterministic_source`, type mismatch.
2. **Differential decomposition** for parity failures:
   - break the measure into its VARs, called measures, calculated columns, the row counts of the tables it iterates, and one-dimension slices;
   - compile each part as a probe and evaluate it in Power BI and in SQL;
   - report the **first part that differs**.

   Example output: "`VALUES(IMO_Master_List[IMO_NO])` → Power BI 1,265 rows, SQL 1,264 → relationship blank row (19 orphan audit rows)."
   **Built (Phase 3, in progress):**
   - `recreation-detectors.ts`: compiler_blowup, slow_plan, validation_deferred, pq/dax capability gaps, and parity value patterns (scale ×100/×1000, sign flip, exact k× row fan-out, ≤3% boundary rows, empty SQL, Power BI BLANK, text vs number).
   - Every root cause now carries its evidence and a `precise` flag. The summary reports `cause_precision_pct` (the exit metric), shown in Estate.
   - **Deferred validation:** when the explain check times out on large SQL, the SQL is kept and validated by parity execution (10-minute budget) instead of being discarded (`PBI_DEFER_ON_EXPLAIN_TIMEOUT=0` disables).
   - Decomposition (`decompose-plan.ts`, `decompose-run.ts`, `dax-print.ts`):
     - probes are plain DAX (`COUNTROWS('T')`, `COUNTROWS(VALUES('T'[c]))`, `[Called measure]` deepest first, each VAR with its predecessors);
     - Power BI evaluates them in one batched `ROW()` query, the compiler plus Databricks on the other side;
     - counts compare exactly;
     - the first differing part is stored as `props.investigation` and used by the root cause.
   - The pipeline investigates unexplained mismatches automatically (max 15 per model). CLI: `scripts/powerbi/investigate.ts`.
   - First live result: Vessel `Last_Record_Updated`, rows in 'Vessel Internal Audit': Power BI 5,537, SQL 5,538. One row was added after the dataset refresh, which confirms `data_freshness`.

3. **LLM investigator**, only when decomposition can't name the cause:
   - input: the first differing part, telemetry and explainer lineage;
   - it proposes a hypothesis and the next probe, using tools (compile, explain, run DAX, run SQL), bounded to N steps;
   - output: a diagnosis plus a candidate fix (compiler change or registry rule) that must pass L4.

### L6 · Learning and governance: never find the same thing twice
- Each confirmed diagnosis produces:
  - a **regression test** (the measure or the probe that showed the difference);
  - a **detector or root-cause category** if the pattern is new;
  - an entry in [powerbi-measure-recreation.md](./powerbi-measure-recreation.md).
- Human gates: promote registry rules, approve LLM-proposed compiler changes, answer steward questions. **One question per model or family**, not per measure.
- Estate dashboard: recreation %, % of failures with a precise cause, time to diagnosis, run reliability, cost.

## 4. Per-measure lifecycle
Every transition is an event stored with the translation, so runs are resumable and fully auditable.
```
harvested → fidelity_ok → compiled → planned → executed → verified(pass) → published
                │             │          │          │           │
                └─ gap ───────┴─ blow-up ┴─ timeout ┴─ mismatch ┴──► investigating → diagnosed
                                                                            → fixed (re-enters at compiled)
                                                                            → steward_question / accepted_limit
```

## 5. Where the LLM sits
| The LLM does | The LLM never does |
|---|---|
| Synthesize function / Power Query step templates (verified by differential tests) | Define evaluation rules: filter context, BLANK, relationships |
| Propose the next probe in an investigation | Decide that SQL is correct |
| Draft a compiler fix from a diagnosis (human approves, parity verifies) | Choose SQL by matching the oracle |
| Write steward questions in plain language | Map columns by name similarity |

The embedding column resolver (`PBI_COLUMN_RESOLVE_EMBED=1`) is enabled and scoped per table, with a 0.72 threshold. It's a last-resort lookup on the rule/LLM path only.

Evaluated 2026-11-14: 0 of 28 unmapped references were mapped, correctly. Every one was a calculated column or a measure. The best wrong candidates scored 0.19–0.44, so lowering the threshold would produce SQL that runs and returns wrong numbers.

## 6. Today vs target
| | Today | Target |
|---|---|---|
| Failure explanation | A label ("parity_mismatch") | First differing sub-result + cause |
| Slow / huge measures | Found by hand | Static cost check + telemetry detectors |
| A run crashes | Restarts from zero | Resumes from the last checkpoint |
| Timeouts | Mislabelled `engine_limit` (50 s client limit) | Explicit budgets, async polling, retry, correct label |
| Replica drift | A query fails mid-run | Caught at L0 with the column difference ✅ |
| New edge cases | Manual research | Decomposition finds, the LLM explains, Power BI verifies, a test remembers |

## 7. Build plan
| Phase | Delivers | Exit criteria |
|---|---|---|
| **1. Reliable runs** ✅ | L3: execution client (async, budgets, classified outcomes, retries, cache), checkpoints/resume, telemetry, heartbeat + reaper, stable order, database-retry | A CII run completes in one go; no false `engine_limit`; Vessel stays ≥ 63 / 73 |
| **2. Trustworthy input** ✅ | L0 fidelity gate + replica schema check; L1 model graph with dependency hashes; Estate dependency graph + Model health tab | BOILER-type drift flagged before compile ✅ (CII SDK, 22 measures); incremental runs skip unchanged measures ✅ (73 / 73 in 2 s); Vessel 67 / 73 ✅ |
| **3. Brain v1** ▶ built, validating on CII | L5 detectors + differential decomposition | ≥ 90% of non-recreated measures carry a precise named cause |
| **4. Brain v2** | L5 LLM investigator + L6 learning loop | New edge cases diagnosed without manual probes and kept as tests |
| **5. Breadth** (Power Query merges/splits/embedded tables ✅ pulled forward) | Sliced oracle, decorrelated plans, Power Query merges, all 451 models | Estate dashboard trending up |

## 8. Component map
| Layer | Built | Files |
|---|---|---|
| L0 | parse reconcile, TMDL fixes, fidelity gate (Phase 2) | `parse.ts`, `tmdl-parse.ts`, `partition-kind.ts`, `fidelity-gate.ts`, `scripts/powerbi/fidelity-report.ts` |
| L1 | model graph (Phase 2) on top of the catalog loader | `model-graph.ts`, `measure-logic-analyze.ts` (`loadMeasureLogicCatalog`), `catalog-column-resolve.ts` |
| L2 | compiler, lineage, registry | `dax-parse.ts`, `dax-sql-compile.ts`, `m-lineage.ts`, `rule-registry.ts`, `rule-store.ts`, `rule-synthesize.ts` |
| L3 | (Phase 1) | `warehouse-exec.ts`, `translate.ts`, `queue.ts` / orchestrator |
| L4 | parity, oracle, harness | `parity.ts`, `parity-compare.ts`, `oracle.ts`, `rule-difftest*.ts`, `rule-builtin-specs.ts` |
| L5 | classifier, explainer | `recreation-root-cause.ts`, `calc-column-explain.ts` |
| L6 | publish, docs | `publish.ts`, `docs/` |
