---
name: pbi-recreation
description: Diagnose and fix Power BI measure recreation on Databricks (DAX→SQL compiler, Power Query lineage, parity, RLS oracle). Use when a measure is not recreated, a parity check fails, a pipeline run is slow or stuck, or when changing dax-sql-compile.ts, m-lineage.ts, parity, oracle or translate.
---

# Power BI measure recreation: find the cause, fix it, prove it

Recreation = compile a Power BI measure's DAX (plus Power Query lineage) to Databricks SQL and
prove it returns Power BI's value. Architecture: `docs/powerbi-recreation-architecture.md`.
History of every defect and fix: `docs/powerbi-measure-recreation.md` §3. Read those before
changing the compiler.

## Rules
- **Never hardcode** report, table, column or measure names. Fix the general mechanism
  (compiler, lineage, detector, rule) so every report benefits.
- **Power BI is the judge.** A change is done only when the measure matches Power BI (parity),
  and previously passing measures still pass.
- **Bump `COMPILER_VERSION`** in `dax-sql-compile.ts` whenever generated SQL can change, or
  translate checkpoints will skip measures that should be recompiled. Enforced by
  `__tests__/compiler-version.test.ts`. After bumping, refresh the lock with
  `UPDATE_COMPILER_LOCK=1 npx vitest run src/lib/powerbi/__tests__/compiler-version.test.ts`.

## Workflow for a measure that is not recreated
1. **Read its root cause** (Estate → Power BI → model → measure, or
   `buildModelRecreationSummary`). Every cause carries detector evidence and a `precise` flag.
2. **Pick the matching playbook below.** If the cause is not precise, investigate:
   - `scripts/powerbi/investigate.ts --model "<m>" --measure "<x>"`: differential
     decomposition. It evaluates row counts, distinct keys, called measures and VARs in Power BI
     and in SQL, and reports the first part that differs.
   - `scripts/powerbi/fidelity-report.ts --models "<m>"`: input defects (replica drift, empty
     or unparseable DAX, TMDL leaks) and the measures they block.
   - `scripts/powerbi/explain-calc-column.ts`: dependency tree and SQL of a calculated column.
3. **Reproduce on one measure first**, never on a whole model. Compile with
   `compileMeasureToSql`, run with `runPbiSql`, compare with Power BI with `executeDatasetQueries`,
   or `executeDaxQueries` for RLS models.
4. **Fix generally**, add a unit test with a synthetic catalog (see `__tests__/pq-merge.test.ts`,
   `compiler-phase5.test.ts`), and run `npx vitest run src/lib/powerbi/__tests__/`. Vitest needs
   PowerShell, not Git Bash.
5. **Regression gate:**
   - compile-only: every stored passing SQL is either byte-identical or re-verified;
   - then a full Vessel run (`run-harvested-pipeline.ts --models "Vessel Internal Audit"`) must
     keep ≥ its previous match count;
   - only then commit.

## Playbooks (symptom → cause → fix)
| Symptom / detector | Cause | Fix |
|---|---|---|
| `replica_drift` (fidelity gate) | Replica column missing, renamed or split (e.g. `X_OR_Y` → `X`, `Y`) | Steward confirms the mapping; never guess in SQL |
| `rls_required`, oracle `skipped_rls` | Model enforces RLS; JSON executeQueries returns 401 for a service principal | Oracle uses `executeDaxQueries` (Arrow, `execute-dax.ts`) with a workspace-Admin service principal (unfiltered). Do not publish RLS models without RLS-aware publishing. |
| `data_freshness`; decomposition "rows differ" with SQL > Power BI | Dataset older than the warehouse | Check the ownership card (refresh status / failure); refresh the dataset |
| `pq_capability_gap` (`Table.X` not modeled) | Power Query step not in `m-lineage.ts` | Model it generically (see split / merge / embedded tables). Do not let the LLM write around it: it cannot see Power Query. |
| `dax_capability_gap` `calculate_row_transition` | CALCULATE in a row context | Key filter on a unique key, else row hash (`ROW_HASH`) |
| `compiler_blowup`, `slow_plan`, `warehouse_timeout` | Repeated operands / correlated nests | Share uncorrelated scalars (`isUncorrelatedSql`), linear BLANK sum (`blankSum`), grouped evaluation (`groupedAggregate`) |
| `engine_limit` / Spark `INTERNAL_ERROR`, `MUST_AGGREGATE_CORRELATED_SCALAR_SUBQUERY` | Correlated subqueries under per-value iterators | Grouped CTE joined into the iterator (`takeIteratorJoins`); correlated scalar subqueries must be aggregated (`MAX(v)`) |
| `cast_error` | Text value in a numeric column | Clean the source or add a TRY_CAST rule |
| `scale_mismatch` / `sign_flip` / `row_fanout` / `boundary_rows` | ×100, sign, k× duplication, a few rows | Units / subtraction order / non-unique join key / date cut-off or blank row |
| LLM SQL fails with UNRESOLVED_COLUMN | LLM used Power Query-only names | LLM output passes the same Databricks check as compiler SQL; fix the compiler gap instead |

## Pitfalls learned (do not repeat)
- **Counts compare exactly.** 5,537 vs 5,538 rows was the whole finding, but value tolerance hid it.
- **Aliases defined inside SQL are not correlation.** A blanket alias check blocked all sharing
  and produced 150 KB+ statements.
- **Name collisions:** generated CTE names must not share a pattern with row aliases (`g1` vs
  `grp1`).
- **Run the warehouse one job at a time** on shared models. Two pipelines writing the same
  translations conflict, and probes slow every run.
- **Patching files with Python strings:** use raw strings for regex (`\b` became a backspace
  byte once). Scan with `grep -P '[\x00-\x08]'` after patching.
- **Stale scratch scripts:** use a new, unique file name for every helper script.
- **Before stopping a run**, check what it already rewrote: parity verdicts reset on rewrite
  until the next run.

## Key files
`dax-parse.ts`, `dax-sql-compile.ts` (compiler), `m-lineage.ts` (Power Query),
`model-graph.ts` + `fidelity-gate.ts` (L0/L1), `warehouse-exec.ts` (L3), `parity.ts`,
`oracle.ts` + `execute-dax.ts` (L4), `recreation-detectors.ts`, `recreation-root-cause.ts`,
`decompose-*.ts` (L5), `rule-*.ts` (rule registry), `translate.ts` (orchestration).
