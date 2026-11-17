# Power BI → Databricks measure recreation: design, history and learnings

**Updated:** 2026-11-14 · **Branch:** `feature/powerbi-bridge` · **Commits:** `ef1fb144`, `d8a1a9c0` (plus uncommitted runner script, see §10)
**Pilot:** Vessel Internal Audit (`pbi_model_id` `b7d7e779-15df-4c75-9c8a-27764fd889d2`) and the five CII models
**Related:** [powerbi-harvest-build-plan.md](./powerbi-harvest-build-plan.md) · [jobs/powerbi-vessel-pilot-issues-and-wiring.md](./jobs/powerbi-vessel-pilot-issues-and-wiring.md) (2026-11-13 state, now partly superseded) · [jobs/powerbi-implementation-tracker.md](./jobs/powerbi-implementation-tracker.md) · [inspector/semantic-layer-and-powerbi.md](./inspector/semantic-layer-and-powerbi.md)

This document explains how Aloft turns a Power BI measure into Databricks SQL that returns the same number. It covers:
- what was wrong with the earlier approach, and every defect found on 2026-11-13/14 and how it was fixed;
- the DAX and Power Query semantics the compiler implements, and why each matters;
- what we learned;
- the architecture approved on 2026-11-14, with the same-day revision that brings in an LLM rule registry with differential testing;
- the build roadmap, how to run the pipeline, and open risks.

It is written for engineers working on the bridge and for reviewers who need to know why the design looks the way it does.

> **Architecture v2 (2026-11-14):** the target architecture is now in [powerbi-recreation-architecture.md](./powerbi-recreation-architecture.md). It covers the 7 layers, the per-measure lifecycle, the Investigator "brain" and the phased build plan. §7–§8 below are kept for history. §3.20–§3.27 record the findings that motivated v2.

---

## 1. Outcome in numbers

| Metric | Before (2026-11-13) | Now (2026-11-14) |
|---|---|---|
| Vessel measures matching Power BI and published | **7 / 73 (9.6%)** | **63 / 73 (86.3%)** |
| SIRE_Fin | not recreated (hand-built SQL gave 60, Power BI 62) | **62 = 62**, generated, no special-casing |
| Vessel "No UC binding" / "No SQL" | 23 / 37 | 0 / 5 |
| Measures harvested across the 6 parsed models | 254 | 440 (parser recovered 186 dropped measures) |
| Estate compile coverage (compile-only sweep) | 35.4% | **66.1%** |
| Measure ids stable across re-parse | no (all new ids every parse) | yes (73/73, 36/36 tables) |

Vessel progression, for orientation:

| Step | Published | What changed |
|---|---|---|
| Start | 7 | Rule/LLM tiers, hardcoded audit-bridge expander |
| Rename lineage in rule/LLM tiers, compiler for gated measures | 17 | §3.3, §3.6 |
| Compiler first for every measure, failures recorded | 35 | §3.9 |
| Typed parity, DAX date arithmetic, multi-hop relationships | 61 | §3.13, §4 |
| Relationship keys compared as text | 62 | §4 |
| DAX BLANK comparisons + relationship blank row | 63 | §4 (Managed_Vsl_Status_Count) |

---

## 2. How the pipeline works now

### 2.1 Stages
```
pbi_definitions → pbi_parse → pbi_catalog_link → pbi_translate → pbi_oracle → pbi_parity → pbi_publish
                     │                                │               │             │            │
            reconcile by lineageTag        compile-first + test   refresh time   typed compare  republish
            (ids stable)                   + repair, fallback     captured                       in place
                                           rule/LLM, reasons saved
                                   └──────────────► recreation summary: stage + root cause + fix per measure
```

### 2.2 Translate, per measure
1. **Compile** the measure DAX against the harvested model with `dax-sql-compile.ts`. That covers calc columns, calculated tables, Power Query lineage, relationships and other measures.
2. **Test** the compiled SQL on Databricks (`expand-validate.ts`, mode `PBI_EXPAND_TEST=execute|explain|off`, default `execute`).
3. **Repair**, only from grounded warehouse errors:
   - `UNRESOLVED_COLUMN` whose suggestion is the same identifier modulo case and punctuation → column override;
   - text-vs-number cast errors → numeric comparison mode.

   At most 4 attempts.
4. If it passes, save as `tier: expand`, `pattern: dax_compile`, with `expand_spec` holding tables, calc columns, inlined measures, notes, warnings, `result_kind` and source aliases, plus `expand_test`.
5. If not, **fall back** to the rule tier, then the LLM tier.
6. Every failure is saved (`tier: unresolved | logic_gate | llm_failed`, with `expand_failure` and `llm_failure` props) so the reason is never lost. `parity_verdict` is reset on every rewrite.

### 2.3 Verification and publish
- **Oracle:** Power BI evaluates each measure with no filters. The dataset's last completed refresh time is stored on `pbi_models.last_refresh_at` and copied onto each oracle result.
- **Parity** compares by type: numbers within 1% relative or 0.05 absolute; decorated numbers (`"~ 477.02"`) on their numeric part; dates to the second; text exactly; BLANK on both sides counts as a match. The refresh time and check time are stored for freshness classification.
- **Publish** writes `kb_verified_queries` for parity passes:
  - Changed SQL that parity re-verified is replaced in place (`superseded_schema_hash` kept).
  - Queries for measures that no longer exist are retired (`status: candidate`, `demoted_reason: measure_removed`).

### 2.4 Module map
| File | Responsibility |
|---|---|
| `src/lib/powerbi/m-lineage.ts` | Power Query step chain → base relation (native SQL or UC table). Reversed renames, transforms, type casts, `if/then/else`, `Number.*`, row filters with M null semantics, `Table.Distinct`. Unmodeled steps are reported. |
| `src/lib/powerbi/dax-parse.ts` | DAX → AST: VAR/RETURN, operators, functions, `'T'[c]`, `T[c]`, `[c]`, `'T'[Date].[Year]` levels, lists |
| `src/lib/powerbi/dax-sql-compile.ts` | AST → Spark SQL: evaluation model (§4), calculated tables, relationships, function library, root warnings |
| `src/lib/powerbi/measure-sql-expand.ts` | Entry point; `anyStrategy` for compile-first |
| `src/lib/powerbi/expand-validate.ts` / `expand-validate-plan.ts` | Warehouse test + grounded repair loop / pure repair planner |
| `src/lib/powerbi/measure-logic-analyze.ts` | Analyzer + logic catalog loader: columns with data types, warehouse columns, measures, relationships, TMDL sanitizing |
| `src/lib/powerbi/catalog-column-resolve.ts` | Rule/LLM column mapping through Power Query lineage (`via: pq_lineage`) |
| `src/lib/powerbi/tmdl-parse.ts`, `parse.ts`, `partition-kind.ts` | TMDL reader, reconcile-by-lineageTag parse, partition classification |
| `src/lib/powerbi/parity-compare.ts`, `parity.ts` | Typed parity |
| `src/lib/powerbi/oracle.ts`, `client.ts` | Oracle + dataset refresh time |
| `src/lib/powerbi/publish.ts` | Republish in place, retire stale verified queries |
| `src/lib/powerbi/recreation-root-cause.ts`, `recreation-summary.ts` | Root-cause classifier, per-measure stage + cause + fix |
| `src/views/agent-lab/estate/powerbi.tsx`, `src/app/api/agent-lab/powerbi/models/[id]/route.ts` | Estate UI: "Not recreated: …" breakdown, cause + fix per measure |

---

## 3. What was wrong, and how it was fixed

Each entry: **symptom → root cause → fix**. They are grouped by layer, because the layer decides where a fix belongs (§5).

### Earlier approach (before 2026-11-13 evening)

#### 3.1 Hardcoded "dynamic" expander
- **Symptom:** SIRE_Fin, PSC_Det and PSC_Fin were expanded; nothing else was. PSC_Det and PSC_Fin SQL failed on Databricks.
- **Root cause:** `expand-audit-bridge.ts` was a template around one report:
  - variable names `audfrom` / `final`;
  - columns `imono`, `AuditToDate`, `AuditFromDate`;
  - a literal SQL string for `KeyConcatenate`;
  - regexes for `REFERENCE_CODE_1` and `deficiency_count`.
- **Fix:** replaced by the model-driven compiler (§2.4). The old files (`expand-audit-bridge.ts`, `expand-calc-aggregate.ts`, `pq-predicate-sql.ts` and their tests) were deleted.

#### 3.2 Invalid SQL saved as `tier: expand`
- **Symptom:** `s.CAST(deficiency_count AS BIGINT) > 7` was persisted.
- **Root cause:** the alias qualifier didn't handle unquoted `CAST(`, and `validateLlmSql` only checks that the SQL starts with SELECT/WITH.
- **Fix:** every compiled query is executed (or EXPLAINed) on the warehouse before it's saved (§2.2).

#### 3.3 Power Query renames never reversed
- **Symptom:** `UNRESOLVED_COLUMN s.REFERENCE_CODE_1` and `` s.`Key Column` ``.
- **Root cause:** PBI `source_column` is the Power Query *output* name. PSC renames `reference_code → REFERENCE_CODE_1`, `keycolumn → Key Column` and `DOC → MANAGER_GROUP`. Both the expander and the rule/LLM column resolver used the post-rename name.
- **Fix:** `m-lineage.ts` walks the step chain and maps output names back to warehouse expressions. The compiler and `catalog-column-resolve.ts` (`via: pq_lineage`) both use it.

#### 3.4 Power Query filters truncated and polluted
- **Root cause:** a compound predicate (`status <> "Rejected" and manager_group <> "SMIC" and ReferenceNo <> null`) kept only its first clause, and a `//` commented-out `auditsubtype` clause leaked into the captured text.
- **Fix:** a real M expression compiler with comment stripping and balanced parsing.

#### 3.5 Orphan translation rows
- **Symptom:** diagnostics by measure name showed SIRE_Fin as `logic_gate` although the live row was `expand`.
- **Root cause:** re-parse created new measure ids, and the database has no FK cascade (the Prisma schema says cascade, the database doesn't). 14 stale rows survived.
- **Fix:** translate deletes rows whose measure no longer exists. Since §3.10 this is rarely needed.

### Harvest fidelity

#### 3.6 TMDL property lines leaked into DAX
- **Symptom:** `Unknown identifier changedProperty`. `IMO_Master_List[IMO_NO]`, a physical column, was treated as a calc column.
- **Root cause:** the TMDL reader ended an open expression only at `key: value` lines or known child keywords. `changedProperty = DataType` and bare flags such as `isHidden` didn't match.
- **Fix:** more child keywords plus a bare-flag rule in the reader, and `stripTrailingTmdlProperties` on load for rows harvested before the fix.

#### 3.7 Calculated-table and Power Query sources lost
- **Symptom:** some calculated tables were stored as `calculated source = Calendar(...)`. Fenced (code-block) bodies were lost entirely, for example Status_Table and CII_Enerva (`m\nsource = ```).
- **Root cause:** `source = …` under a partition was flattened into the partition body, and fenced bodies weren't captured, for any partition type.
- **Fix:** `source` under any partition is parsed as an expression block, and calculated partitions are classified from the partition header (`partitionType`).

#### 3.8 Table TMDL stored as "source" for measure-only tables
- **Symptom:** `Cannot parse calculated table 'CII_Enerva'/'CII_Measures': Unexpected character ':'`.
- **Root cause:** with no partition, the parser fell back to the table's whole TMDL text.
- **Fix:** no partition means an empty source.

#### 3.9 Quoted measure names
- **Symptom:** `[AER 2024] is neither a column … nor a known measure`.
- **Root cause:** 87 of 254 measure names were stored with TMDL quotes (`'Avg CO2'`). Column and table names were already being stripped.
- **Fix:** `stripTmdlQuotedName` for measures. Now 0 of 440.

#### 3.10 Wipe-and-rebuild parse
- **Symptom:** every forced re-parse orphaned every translation (56–73 rows per run), demoted every verified query, and reset every source binding to `pending` (any hand-made steward binding was lost).
- **Root cause:** `parse.ts` deleted all tables, measures, columns and bindings and recreated them.
- **Fix:** reconcile instead:
  - tables and measures are matched by TMDL `lineageTag`, then by name, and keep their ids;
  - bindings keep their match status when the source hash is unchanged;
  - only definitions that really disappeared are deleted.

  Verified: ids kept 73/73 and 36/36, bindings 6/6.

### Translate orchestration

#### 3.11 Compiler only for gated measures; silent LLM failures
- **Symptom:** "No SQL — run PBI Translate" even though translate had run.
- **Root cause:** the analyzer routed measures it considered simple (those reading CALENDAR, or calling other measures) to the LLM, which can't see calculated tables. LLM failures were not saved.
- **Fix:** the compiler runs first for every measure; rule/LLM is the fallback; every failure is saved with its reason.

#### 3.12 "No UC binding" wasn't a binding problem
- **Root cause:** `resolveUcForMeasure` only looked at direct `'T'[c]` references. Roughly 17 Vessel measures reference only other measures, and the rest read DAX calculated tables, which never have a warehouse binding.
- **Fix:** the compiler resolves tables through measure references and calculated tables. Vessel "No UC" went to 0.

#### 3.13 Parity compared numbers only
- **Symptom:** 14 Vessel skips: dates (Last_Audit_End), text ("VIA Done"), BLANK (VesselCount) and decorated numbers.
- **Fix:** typed parity (§2.3).

#### 3.14 Publish dead end
- **Symptom:** 50 verified queries demoted and never republished once ids became stable.
- **Root cause:** a schema-hash change demoted the query and skipped publishing, permanently. Earlier runs hid this because every run made new ids. Translate also didn't clear `parity_verdict`, so a stale pass could publish unverified SQL.
- **Fix:** translate resets the verdict on every rewrite; publish replaces the verified query in place when parity has re-verified the new SQL.

### Ground truth

#### 3.15 Dataset refresh time never captured
- **Root cause:** `pbi_models.last_refresh_at` existed but nothing populated it.
- **Fix:** the oracle reads `/datasets/{id}/refreshes`. Last completed Vessel refresh: 2026-11-13 02:40 UTC. Stale-dataset mismatches are classified `data_freshness`.

#### 3.16 Non-deterministic Power BI values
- **Root cause:** PSC's Power Query does `Table.Distinct(…, {"Key Column"})`, which keeps the first row in source order. 1,170 of 9,986 keys have rows with different `reference_code` values, and 30 differ on `deficiency_count`. The measures filter on those columns, so the result changes with row order: compiled SQL gave PSC_Det 17 and then 20 across runs.
- **Fix:** the compiler emits a warning, classified `nondeterministic_source`. The real fix belongs in Power Query (add a sort) or needs a steward-agreed rule.

### Engine

#### 3.17 Spark cannot plan deep correlation
- **Symptom:** `INTERNAL_ERROR … outerScope(IMO_NO)` / CANCELED for `SUMX(VALUES(IMO_NO), IF([Status measure] = SELECTEDVALUE(...), 1, 0))`.
- **Root cause:** one level of per-value correlation works (a probe returned 5,518). A measure that has its own CALCULATE/FILTER nests correlation 2–3 levels deep, which the Databricks optimizer can't handle.
- **Status:** classified `engine_limit`. Planned fix: a decorrelated GROUP BY / join plan (§8, step 5).

#### 3.18 Misleading root-cause label
- **Root cause:** any `SELECTEDVALUE` over a DATATABLE was labelled "slicer helper". Counts like ReportStatus_Count are real KPIs.
- **Fix:** "slicer helper" only applies to measures that don't aggregate, and engine errors are checked first. Flagged by the user from the Estate screen.

### Source systems

#### 3.19 Snowflake sources bound to Databricks
- **Root cause:** `parse.ts` writes `connector: 'databricks'` for every warehouse query. Catalog link matched Snowflake `REPORTING_LAYER.ENERVA_DBO.*` to same-named Databricks tables.
- **Status:** possibly a legitimate replica, since another model reads that table from Databricks, but it must be confirmed. Planned for the fidelity gate (§8, step 3).
- **Confirmed drift (2026-11-14):**
  - CII SDK's Power Query renames `BOILER_CONS_DURING_CARGO_HEATING_OR_DISCHARGING_MT_LFO` (present in Snowflake).
  - The Databricks replica has `…_HEATING_MT_LFO` and `…_DISCHARGING_MT_LFO` instead.
  - Numerator_CO2(gm) and CII SDK Attained_CII fail with `UNRESOLVED_COLUMN`.
  - No compiler change can fix this. It needs the v2 replica schema check (architecture L0) and a steward decision.

### Findings 2026-11-14 (afternoon): performance, verification, runs

#### 3.20 SQL blow-up from pasted measure references
- **Symptom:** CII measures produced 150–390 KB statements (`Attained_CII` 388 KB). Spark couldn't plan them within the wait limit.
- **Root cause:** every `[Measure]` reference and every row-free VAR pasted its full SQL at each use, and CII measure chains reuse the same measures many times.
- **Fix:** row-free measures (no row context) are compiled once per filter context as a shared scalar CTE `mN AS (SELECT … AS v)` and referenced as `(SELECT v FROM mN)`. Row-free VARs get the same treatment.

#### 3.21 Exponential `+` chains
- **Symptom:** the explainer showed `CII_Enerva[LNG]`, a 5-term sum, compiling to 2.9 KB.
- **Root cause:** the pairwise DAX BLANK rule (`CASE WHEN a IS NULL AND b IS NULL … coalesce(a,0)+coalesce(b,0)`) repeats the left operand twice per `+`, so the SQL doubles with every term.
- **Fix:** a whole `+`/`−` chain is one expression: BLANK only when every term is BLANK (`coalesce(a,b,…) IS NULL`), otherwise the sum with BLANK as 0. Same semantics, linear size.

  With §3.20, sizes dropped 4–15×: Attained_CII 388 KB → 26 KB, Numerator_CO2(gm) 157 KB → 15 KB.

#### 3.22 "CANCELED" was our client timeout, not Spark
- **Symptom:** many measures were labelled `engine_limit`.
- **Root cause:** `runWarehouseQuery` waits about 50 s without async polling, then the statement is cancelled. The same FCjVoyage query executed successfully in 128 s with async polling, and Attained_CII in 264 s.
- **Fix:** Architecture v2 Phase 1: one execution client with async polling, explicit budgets and classified outcomes.

#### 3.23 Translate "hangs" were silent cancellations
- **Symptom:** runs wrote no rows for 39 minutes, then failed.
- **Root cause:** about 40 consecutive large measures each spent about 55 s being cancelled. Measures that fall back to the LLM are only written at the end. Measures load **without an ORDER BY**, so each run hit a different stretch (one run reached 166, another 7).
- **Fix:** Phase 1 adds a stable order, a write per measure outcome, telemetry, checkpoints and resume.

#### 3.24 Fragile runs
- **Root cause:** the dev RDS (`aloft-dev-writer`) was unreachable three times on 2026-11-14. A retried step restarted translate from measure 1. Job rows whose process died stayed "running" forever (no heartbeat).
- **Fix:** Phase 1 adds database-retry around writes, per-measure checkpoints, a heartbeat and a stale-job reaper.

#### 3.25 Hand-written functions that differed from Power BI
- **Found by:** the differential harness, on its first run over the 25 built-in DAX functions.
- **Bugs:**
  - `MOD` with a negative divisor (DAX takes the divisor's sign: `MOD(1,-3) = -2`);
  - `CONTAINSSTRING` on empty text (always FALSE);
  - `LEN(BLANK)` is BLANK, not 0.
- **Fix:** all three corrected; 25 / 25 now match Power BI.

#### 3.26 Column resolver scoping
- **Root cause:**
  - the embedding fallback searched only the measure's primary table;
  - references to unbound tables (calculated tables) fell back to the primary table's catalog.

  Either could map a same- or similar-named column from the wrong table.
- **Fix:** every reference resolves only against its own table's warehouse object, and the embedding fallback runs per table.
- **Enabled** with `PBI_COLUMN_RESOLVE_EMBED=1` in `.env.local`, threshold 0.72.
- **Evaluated:** 0 / 28 unmapped references were mapped, correctly. All were calculated columns or measures, and the best wrong matches scored 0.19–0.44.

#### 3.27 Rule registry built
- `pbi_translation_rules` (migration `20261114_pbi_translation_rules`, applied to dev).
- The compiler and Power Query lineage use verified rules for functions that aren't built in, and record structured gaps `{kind, name, arity}`.
- `rule-difftest` is the Power BI-vs-Databricks harness (built-ins and rules); `rule-synthesize` is LLM synthesis with failing cases fed back (at most 3 attempts).
- CLI: `scripts/powerbi/rules-difftest.ts`.
- Explainer: `scripts/powerbi/explain-calc-column.ts`, which prints DAX, the dependency tree, warehouse lineage and compiled SQL.

#### 3.28 Replica drift was found mid-run, by hand (v2 Phase 2)
- **Symptom:**
  - CII SDK measures failed late with `UNRESOLVED_COLUMN` after repair attempts;
  - the CII run spent about 20 s per failing measure;
  - the cause (BOILER drift, §3.19) was found by manual probing.
- **Root cause:** nothing compared the Power Query input columns with the bound warehouse object before compiling.

  The first version of the gate also skipped every native query. CII_Enerva's native query is a plain `SELECT * FROM …SYNERGYDKREPORTEDDATA` passthrough, so its columns are the bound object's columns.
- **Fix:**
  - `model-graph.ts` (L1) gives every measure a dependency closure;
  - `fidelity-gate.ts` (L0) checks every lineage leaf, and every row-filter column, against the warehouse schema;
  - passthrough native queries are checked too;
  - issues attach to the measures whose closure reaches them;
  - translate skips compiling blocked measures (tier `fidelity_gate`).
- **Result on CII SDK:**
  - 70 drifted columns, 5 of them used by measures; 22 measures blocked before compile;
  - none of them had SQL before, so nothing regressed;
  - for the four BOILER columns the gate says "likely split into `…_HEATING_MT_x` + `…_DISCHARGING_MT_x`".
- **Vessel:** no drift (6 Databricks tables checked); only the empty measure is blocked.
- **Incremental runs:** the per-measure fingerprint now uses the graph's dependency hash. Editing one measure reprocesses only it and the measures that use it; a warehouse schema change reprocesses only measures reading that table. Covered by `fidelity-gate.test.ts`.

#### 3.29 Timeouts discarded valid SQL; mismatches had no named cause (v2 Phase 3)
- **Symptom:**
  - the CII run spent 2–3 minutes per large measure in the explain check, and 11 measures were discarded as `warehouse_timeout`;
  - parity mismatches only said "Mismatch oracle=X sql=Y".
- **Root cause:**
  - Databricks planning time on large generated SQL counted as a failure, although nothing showed the SQL was wrong;
  - nothing examined the values or the parts of a failing measure.
- **Fix:**
  - **Deferred validation:** an explain timeout keeps the SQL, and parity execution decides;
  - **detectors** name patterns from recorded values and telemetry;
  - **differential decomposition** evaluates the measure's parts on both sides and reports the first differing one;
  - every root cause carries evidence and a `precise` flag, giving the Phase 3 exit metric.
- **Learning (RLS):** CII returned "no oracle rows" because 4 of 5 CII models enforce RLS, and the oracle skipped them by design.
  - The JSON executeQueries API returns 401 for a service principal on RLS models.
  - **executeDaxQueries** works for a workspace-Admin service principal and returns unfiltered values. It was verified on CII SDK: 103,404 rows, 82 vessels.
  - Comparing with the warehouse found the CII SDK dataset 16 months stale. For the same period, the replica is missing about 1.3% of rows (Power BI 103,404 vs Databricks 102,020 before 2025-07-03).
- **Learning (Power Query):** the CII model failed entirely on unmodeled steps.
  - The fix generalizes: nested table calls, delimiter splits, merges between model tables, and embedded "Enter data" rows.
  - The model compiles 36/48 (was 0), and sampled values match Power BI exactly.
  - The LLM fallback had written SQL for these measures that read Power Query-only column names (`Date.1`, `Co2 (Mt)`). 9 of 12 failed and 2 were 8–12% off, because the LLM cannot see Power Query. That is why the gap belongs in the compiler.
- **Learning:** counts must compare exactly. The first decomposition marked 5,537 vs 5,538 rows as a match under the 1% value tolerance, and that single row was the whole finding.

---

## 4. Semantics the compiler implements (the "core")

These are the rules where an approximate translation runs fine and returns a wrong number. Every row was found by a parity mismatch or a warehouse error in this pilot.

| Semantic | Power BI behaviour | SQL translation | Found by |
|---|---|---|---|
| Power Query null comparisons | `null <> "x"` is **true** (row kept) | `NOT (a <=> b)` | SIRE_Fin 60 → 62 |
| Rename lineage | Model column ≠ warehouse column | Reverse `Table.RenameColumns`, apply transforms | PSC errors |
| BLANK in comparisons | BLANK = 0 = "" = BLANK; `BLANK <= 90` is TRUE | `coalesce` to the type's zero (0, "", 1899-12-30, FALSE) by operand kind | Managed_Vsl_Status_Count |
| `x = BLANK()` | TRUE for 0 / "" too (ISBLANK is strict) | `coalesce(x,0)=0` / `coalesce(x,'')=''` / `IS NULL` | — |
| BLANK in + / − | Treated as 0 unless both BLANK | `CASE WHEN both NULL THEN NULL ELSE coalesce… END` | `AVERAGE(...) + 0` |
| Date arithmetic | date ± n adds days; BLANK date = 1899-12-30 | `timestampadd(SECOND, n*86400, coalesce(ts, zero))` | 11 Vessel errors |
| Relationship blank row | `VALUES(col)` / `ALL(col)` include a blank row when many-side keys are unmatched; `DISTINCT` doesn't | `UNION SELECT NULL … WHERE EXISTS(orphan)` | 19 orphan audit rows |
| Context transition | CALCULATE turns row context into filters; table filter args override | Row scopes → transitions; `FILTER(T)` / `ALL(T)` remove them; `VALUES` iteration → column filter | SIRE_Check, `SUMX(VALUES)` |
| Filter propagation | One→many always; many→one if bidirectional; follows chains | Shortest path, nested `IN` subqueries | VesselStatus_Count, Audit_YTD |
| Relationship keys | Same type in Power BI | Non-date keys compared as text (warehouse types differ: IMO BIGINT vs text) | `CAST_INVALID_INPUT 'IM8912546'` |
| Text comparisons | Case-insensitive | `lower()` both sides | — |
| DISTINCTCOUNT | Counts BLANK as a value, case-insensitive | `COUNT(DISTINCT lower(x)) + has-null` | — |
| COUNT / COUNTROWS of nothing | BLANK, not 0 | `NULLIF(…, 0)` | — |
| VAR in calc columns | Evaluated once per row | Materialized as staged CTE columns, so correlation stays one level deep | SIRE_Check |
| Calculated tables | CALENDAR, ADDCOLUMNS, DATATABLE, SUMMARIZE | `explode(sequence())`, projections, `VALUES`, grouped subqueries | CALENDAR used across most reports |
| DATEDIFF | Counts boundaries crossed | `floor(unix_ts/unit)` differences, `datediff` on dates | — |
| TRIM | Also collapses internal spaces | `regexp_replace(trim(x), ' {2,}', ' ')` | — |
| FORMAT | Date/number format strings, `Q` quarter | `date_format` / `format_number` token mapping | — |
| Presentation | `FORMAT(x,"0.00") & " days"` at top level | `ROUND(x, 2)` for parity | Avg durations |

Function library (scalar): IF, SWITCH, DIVIDE, COALESCE, ISBLANK, date/text/math functions, WEEKNUM (proven against Power BI, §7.3), IFERROR, ERROR, COMBINEVALUES, ISINSCOPE, HASONEFILTER, SELECTEDVALUE, RELATED, LOOKUPVALUE, EARLIER, TOPN(1), TOTALYTD / DATESYTD / DATESBETWEEN.

**Not implemented yet:**
- **DAX:**
  - functions: RANKX, TOPN with N > 1, `SUMMARIZE` as a table expression inside measures;
  - filter modifiers: USERELATIONSHIP, ALLEXCEPT, ALLSELECTED;
  - time intelligence beyond YTD;
  - model features: calculation groups, field parameters;
  - CALCULATE on a calc column's own row without a FILTER/ALL override.
- **Power Query:** `Table.NestedJoin` (merges), `SplitColumn`, unpivot, group-by, custom functions, parameters.

---

## 5. What we learned

1. **It generalizes because it's a compiler, not a set of patterns.** The audit-bridge template covered 3 measures; implementing the language's rules covered 63 of 73. No fix today named a report, table or measure.
2. **Failures sit in distinct layers, and the layer decides the fix:**
   - harvest fidelity (parser);
   - model semantics (lineage, relationships, calculated tables);
   - DAX semantics (core compiler);
   - engine limits (SQL plan shape);
   - ground truth (oracle freshness, non-determinism, value types);
   - source systems (Snowflake, files).

   Treating a harvest bug as a compiler gap, or a stale dataset as a SQL bug, wastes effort.
3. **Silent failure was worse than failure.** "No UC binding" and "run translate" hid three unrelated bugs. Once every failure carried a stored reason, each fix took minutes.
4. **The hardest errors return plausible numbers.** BLANK comparisons, the blank row and Power Query null semantics all produce SQL that runs. Only parity against Power BI exposed them, and each was 1–2 rows off: SIRE 60 vs 62, Managed_Vsl_Status_Count 0 vs 1.
5. **Global semantics belong in deterministic code; local translation suits an LLM.** The LLM tier produced 9 of 73 Vessel measures, and its wrong answers looked right. Translating a single function or step is exactly what an LLM does well, as long as each answer is verified (§7).
6. **Power BI can be the oracle for function semantics, not just measures.** `EVALUATE` over a literal `DATATABLE` runs a DAX function on chosen inputs without touching model data. That makes correctness provable (§7.3).
7. **Never tune SQL to the oracle value.** Repairs are accepted only when the warehouse error names the fix, and plan choice is by what executes. Parity stays an independent check. Otherwise non-deterministic sources (PSC) would be "fixed" by luck.
8. **Stable identity is a prerequisite for a learning pipeline.** Until ids survived re-parse, every run rebuilt everything and masked the publish dead end (§3.14).
9. **The estate is bigger than the pilot.** Only 6 of 451 models were harvested (54 need RLS). The parser fixes alone recovered 186 measures, and compile coverage outside Vessel started at 35%. Harvest coverage and fidelity come before compiler breadth.
10. **The ground truth has failure modes too:** stale datasets (refresh 2026-11-13 02:40 UTC vs a newer warehouse), non-deterministic Power Query, text and visual-context measures with no meaningful grand total, and Power BI's own query failing (DueDate_2.0).
11. **Operational resilience matters.** A dev RDS connectivity drop killed a 15-minute run. Steps are idempotent, so runners now retry on transient database errors.

---

## 6. Root-cause taxonomy (as implemented)

`recreation-root-cause.ts` assigns one cause to every measure that isn't recreated. It's shown in Estate and in `summary.root_causes`.

| Category | Meaning | Suggested fix |
|---|---|---|
| `empty_dax` | Body empty or fully commented out | Retire the measure or restore its DAX |
| `ui_slicer_helper` | Returns 1/0 for a slicer match and doesn't aggregate | Exclude from recreation |
| `text_result` | Text-valued measure that can't be compared (parity skip) | Recreate the numeric base, or extend text parity |
| `nondeterministic_source` | Power BI's value depends on source row order | Add a sort in Power Query, or a steward rule |
| `data_freshness` | Warehouse value is newer than the dataset refresh | Refresh the dataset, re-run oracle and parity |
| `engine_limit` | Logically complete SQL that Spark can't plan | Decorrelated plan (roadmap) |
| `unsupported_dax` | DAX construct not modeled | Extend the compiler / rule registry |
| `pq_unsupported` | Power Query step not modeled | Extend lineage / rule registry |
| `harvest_gap` | Harvested model incomplete or broken | Fix the parser, re-parse |
| `replica_drift` | Replica schema differs from the Power BI source (caught by the fidelity gate before compile) | Steward confirms the suggested mapping (e.g. split columns), or fix the replica |
| `warehouse_timeout` | Valid SQL exceeded its time budget | Check telemetry; raise the budget or reduce the plan |
| `warehouse_unavailable` | 503 / network after retries | None: the next run retries |
| `unbound_table` | Referenced table has no warehouse binding | Steward binding |
| `warehouse_error` | SQL failed with no grounded repair | Inspect `expand_failure.attempts` |
| `llm_failed` | Compiler and LLM both failed | Inspect failure props |
| `parity_mismatch` | Runs but differs, cause unknown | Investigate (sliced oracle, roadmap) |
| `parity_no_oracle` | No Power BI value | Re-run oracle; check the measure returns a value |
| `not_translated` | No translation row | Run translate |

---

## 7. Architecture

> Superseded by [Architecture v2](./powerbi-recreation-architecture.md). The sections below are the first sketch, kept for history.

### 7.1 Approved 2026-11-14: self-diagnosing loop
```
 Harvest ──► Fidelity gate ──► Compile ──► Plan & test ──► Verify ──► Publish
               │                 │            │              │
               ▼                 ▼            ▼              ▼
          harvest_gap      capability_gap  engine_limit   truth_issue
               └────────────────┴──────┬─────┴──────────────┘
                                       ▼
                          Triage router (by category)
               auto-fix │ LLM-assisted (verified) │ steward question
                                       ▼
                    Golden corpus + estate regression sweep
```

1. **Fidelity gate** (before compiling) checks that:
   - every measure and calculated table parses;
   - every `[ref]` resolves;
   - no TMDL property text appears in stored DAX;
   - every table's source system is classified (Databricks / Snowflake / files / enter-data / DAX);
   - non-Databricks sources bound to Databricks are flagged as "replica: confirm".
2. **Structured capability gaps:** `{kind: dax_fn | m_step | table_expr | semantic, name}` instead of free text, so the estate sweep ranks the backlog by impact.
3. **Plan alternatives for engine limits:** correlated subqueries, then materialized stages, then a decorrelated GROUP BY / join. The first plan that executes wins; the choice is never made by the oracle value.
4. **Ground-truth hygiene:**
   - a sliced oracle (grand total plus grouped by one dimension), which catches compensating errors and lets label and visual-context measures be compared at their intended grain;
   - freshness via refresh time;
   - non-determinism detection.
5. **Triage router:** harvest/capability gaps → auto-fix work; long tail → LLM-assisted with verification; business decisions → one steward question per model or family.
6. **Golden corpus + regression sweep:**
   - every parity pass is a regression case;
   - every compiler change runs the compile-only estate sweep plus live verification on a sample.

### 7.2 Revision 2026-11-14: core plus verified LLM rule registry
**Why:** hand-implementing ~250 DAX functions and several hundred Power Query functions doesn't scale, and hand-written code isn't proven correct either. An LLM writing whole measures is worse (§5.5).

**Design:**

| Layer | Owner | Contents |
|---|---|---|
| **Core (code)** | Engineers | The evaluation model in §4: filter context, CALCULATE, transitions, relationships, blank row, BLANK semantics, VAR staging, the Power Query step walker. Finite, rarely changes, and an LLM fails silently here. |
| **Rule registry (data)** | LLM-synthesized, machine-verified, human-promoted | Scalar DAX functions and Power Query functions/steps as SQL templates with typed parameters, e.g. `WEEKNUM(d: date, t: int) → (floor((dayofyear({0}) - 1 + …) / 7) + 1)`. Today's hand-written functions are seeded here and go through the same tests. |
| **LLM diagnostician** | LLM proposes, parity decides | For parity mismatches: hypotheses from DAX + SQL + lineage notes + total and sliced differences → candidate compiler option or rule → accepted only if parity passes on the total **and** every slice |

**Compiler lookup order:** core built-ins → `verified`/`promoted` registry rule → otherwise request synthesis. The measure becomes `capability_gap` until the rule verifies. Translate requests that synthesis itself when a compile failure is a scalar `dax_fn` gap (`rule-gap-fill.ts`): one LLM call per function per run, kept only after differential tests match Power BI, then the measure is compiled again. Iterators, table expressions and Power Query steps are not sent to this path. Whole-measure LLM SQL stays the last resort and still does not see Power Query.

**Rule lifecycle:** `candidate` (synthesized) → `verified` (differential tests pass) → `promoted` (human glance; usable estate-wide). If tests fail, the LLM retries with the failing cases as feedback (bounded N); after that the gap is recorded with its evidence.

**Proposed table:** `pbi_translation_rules`, with columns:
- `id`, `kind` (`dax_fn | m_fn | m_step`), `name`, `signature` (argument kinds), `sql_template`;
- `status`, `evidence` (inputs, Power BI results, SQL results), `model_used`, `prompt_version`;
- `created_at`, `verified_at`, `promoted_by`.

### 7.3 Differential testing: making rules provable
**DAX functions.**
1. Generate edge-case inputs per argument kind:
   - BLANK, 0, negatives;
   - empty and mixed-case text;
   - month and year boundaries, leap days, ISO-week edges.
2. Evaluate in **Power BI**: `EVALUATE ADDCOLUMNS(DATATABLE(...), "r", FN(...))`. No model data is involved; it works against any dataset the service principal can query.
3. Evaluate the template in **Databricks**: `SELECT template FROM VALUES (...)`.
4. Compare typed values row by row.

**Proof of concept (2026-11-14):** WEEKNUM, types 1 / 2 / 21, on 7 edge dates gave 21 comparisons and **0 mismatches**. That includes 2024-12-31 → ISO week 1 and 2027-01-01 → ISO week 53. The harness also proves the hand-written functions.

**Power Query steps** can't be evaluated in isolation through the API, so test them at table level. Compare the compiled base table with Power BI's copy of the same table:
- row count;
- per column: count, distinct count, min, max, sum;
- a sample of rows by key.

A wrong rename, filter, type cast or merge shows up as a fingerprint difference. The CII merge/split gaps are the first users.

### 7.4 Why this is more reliable than "the LLM writes the SQL"
| | LLM writes whole measures | Core + verified LLM rules |
|---|---|---|
| Filter context, relationships | Re-derived per measure, silently wrong | Fixed in the core, tested once |
| New DAX function / Power Query step | Hoped for | Synthesized, proven against Power BI on edge cases |
| Errors | Found at parity, if ever | Caught per rule before any measure uses it |
| Cost | An LLM call per measure per run | One call per new rule, ever |
| Audit | "The model said so" | Stored evidence: inputs, Power BI vs SQL results |
| Reuse | None | Verified once, applies to all 451 models |

---

## 8. Roadmap (updated 2026-11-14)

| # | Step | Status |
|---|---|---|
| 1 | Harvest fixes: quoted measure names, measure-only table source, fenced sources for all partitions, TMDL leaks | **Done** (`d8a1a9c0`) |
| 2 | Cheap capabilities: compiler crash, IFERROR / WEEKNUM / COMBINEVALUES / ISINSCOPE, `Number.Round*`, M `if`, date levels | **Done** (`d8a1a9c0`) |
| 2b | **Rule registry + differential test harness + LLM synthesis** (§7.2–7.3) | **Built** (§3.27). Translate requests synthesis on a scalar `dax_fn` gap (2026-11-16). No estate synthesis round has been run yet |
| v2 | Architecture v2 phases 1–5 ([powerbi-recreation-architecture.md](./powerbi-recreation-architecture.md) §7) | **Phase 1 done; Phase 2 built** (§3.28) |
| 3 | Fidelity gate (source-system check, replica confirmation, dead measures) | **Built** in v2 Phase 2 (§3.28). Still to do: nightly compile-only estate sweep job |
| 4 | Definitions + parse for all 451 models (pilot scope off); RLS strategy for 54 models | Planned |
| 5 | Decorrelated plan alternative for per-value iterators (the 4 Vessel `engine_limit` measures) | Planned |
| 6 | Sliced oracle; Power Query merges/splits via table fingerprints; time intelligence; calc-column own-row transitions | Planned |
| 7 | LLM parity diagnostician | Planned |

Estate compile-only sweep after steps 1–2 (6 models, 440 measures, 291 compiled). Remaining buckets:

| Measures | Gap | Layer / step |
|---|---|---|
| 54 | `CII_Correction_factor` unbound in one model | Source system / step 3 |
| 48 | Power Query `SplitColumn` + `NestedJoin` | Capability / steps 2b, 6 |
| 30 | CALCULATE on a calc column's own row, no FILTER/ALL override | Core semantics / step 6 |
| 9 | `SUMMARIZE` as a table expression in measures | Capability |
| 7 | Dead measures | Steward |

Vessel's remaining 10, by cause:
- `engine_limit` (4): Audit>90_Count, Nex_Audit_Status_Count, ReportStatus_Count, VIA_Check_Count.
- `data_freshness` (2): Last_Audit_Start, Last_Record_Updated.
- `nondeterministic_source` (2): PSC_Det, PSC_Fin.
- `parity_no_oracle` (1): DueDate_2.0.
- `empty_dax` (1): Average_Sailing_AuditDays.

---

## 9. Running it

All runners execute pipeline code directly from the CLI. **The Next.js app does not need to be running.**
- `scripts/context/noserver.cjs` loads `.env.local` / `.env`, stubs `server-only` and maps `@/` to `src/`.
- Runners call `enqueue` + `runQueuedJobById` from `scripts/context/orchestrator.ts`, the same job code the app uses.
- They connect directly to the **shared dev Postgres** (`aloft-dev-writer` RDS), the Databricks SQL warehouse, the Power BI REST API and the LLM provider.
- **Runs write to the shared dev database.** Results appear in Estate → Power BI when the app runs.

| Command | What it does |
|---|---|
| `npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-vessel-fresh.ts` | Vessel end to end: definitions → parse (forced) → catalog link → translate → oracle → parity → publish, plus summary |
| `… scripts/powerbi/run-harvested-pipeline.ts [--models "A,B"]` | Translate → publish for harvested models, per-model summary; retries transient database errors |
| `… scripts/powerbi/run-reparse-harvested.ts` | Force re-parse + catalog link for every harvested model (applies parser fixes; ids preserved) |

Settings:
- `PBI_EXPAND_TEST=execute|explain|off`: warehouse test mode for compiled SQL (default `execute`).
- `PBI_TRANSLATE_LLM_MAX_MEASURES`: LLM fallback cap.

Diagnostics used during the pilot, worth turning into scripts:
- **Estate compile-only sweep:** compile every measure, bucket the failures. Minutes, no warehouse.
- **verify-all:** compile, execute and typed-parity every measure against its stored oracle, with "was/now" verdict changes. It caught regressions while the BLANK and blank-row semantics were changing.
- **Ad-hoc DAX probes:** compile a probe DAX expression against a model and run it. This found the blank row behind Managed_Vsl_Status_Count.

---

## 10. Open issues and risks

- **Uncommitted:** `scripts/powerbi/run-harvested-pipeline.ts` (CII runner with transient retry). The CII pipeline run was in progress when this doc was written; record its results in the tracker when it finishes.
- **Shared dev database:** pilot runs mutate shared dev data (translations, verified queries, re-parsed tables). Consider a flag or a separate schema for experiments.
- **Snowflake → Databricks bindings** are unconfirmed (§3.19). Verified queries for those tables assume the Databricks replica matches.
- **Access types:** `runWarehouseQuery` is called with `level: 'read'`, `surface: 'harvest'` (same as `parity.ts`). These aren't in the `Level` / `AccessSurface` unions; they're cast in `expand-validate.ts`. Align the access types.
- **Pre-existing TypeScript errors:** 17, unrelated to this work.
- **Vitest under Git Bash** fails at setup for every file; run tests from PowerShell.
- **Known approximations:**
  - Power Query filters after `Table.Distinct` are applied before de-dup (noted per table);
  - IFERROR returns the expression (SQL operators are error-free);
  - blank-row filters don't yet reach many-side orphan rows;
  - DAX case-insensitive keys in relationships aren't modeled.

---

## 11. Commit and file index

- `ef1fb144` feat(powerbi): DAX→SQL compiler, PQ lineage, test-repair loop, root causes
- `d8a1a9c0` fix(powerbi): harvest fidelity + compiler capabilities from estate sweep
- Tests:
  - `src/lib/powerbi/__tests__/dax-sql-compile.test.ts`
  - `src/lib/powerbi/__tests__/dax-compile-extended.test.ts` (calculated tables, iterators, blank row, freshness, harvest fidelity, step-2 capabilities)
  - `src/lib/powerbi/__tests__/parity-compare.test.ts` (typed parity)
  - 79 tests in total.
