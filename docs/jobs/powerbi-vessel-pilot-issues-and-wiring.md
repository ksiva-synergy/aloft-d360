# Power BI Vessel pilot — issues, fixes, and what we wired

**Updated:** 2026-11-13 · **Branch:** `feature/powerbi-bridge`  
**Pilot report:** Vessel Internal Audit (`pbi_report_id` `093a04a2-aff1-4acb-8e80-2906cd4605a3`, `pbi_model_id` `b7d7e779-15df-4c75-9c8a-27764fd889d2`)  
**Related:** [powerbi-integration-validation.md](../powerbi-integration-validation.md) · [semantic-layer-and-powerbi.md](../inspector/semantic-layer-and-powerbi.md) · [powerbi-implementation-tracker.md](./powerbi-implementation-tracker.md)

This document records **what broke**, **how we fixed it**, and **how Aloft pieces connect** for the CII Vessel translate → oracle → parity → publish path—not a full phase gate checklist.

---

## 1. What we wired (end-to-end)

| Layer | Aloft capability | Power BI bridge use |
|-------|------------------|---------------------|
| **Harvest catalog** | `platform_context_objects`, `platform_context_columns`, T2 `semantic`, job `embed` → `platform_context_embeddings` | `pbi_catalog_link` binds PBI `native_sql` to UC + `context_object_id`; **catalog column resolve** reads harvested columns |
| **PBI semantic store** | `pbi_models`, `pbi_tables`, `pbi_columns` (`source_column`), `pbi_measures`, `pbi_source_binding` | Parse/inventory; UC path; DAX refs |
| **Translate** | Rule tier + LLM (`translate.ts`, xAI Grok → Sonnet fallback) | DAX → SQL with **`allowed_columns`** / **`column_map`** in props |
| **Oracle** | Power BI DAX query API | Scalar oracle per measure (v1: no report slicers) |
| **Parity** | Databricks read-only SQL | Compare oracle vs translated SQL; `databricks_source_id` from binding |
| **Publish** | `kb_verified_queries` + embed | Inspector `run_verified_query` path |
| **Operator UX** | Estate → Power BI, Jobs orchestrator | **Databricks recreation** funnel, per-measure stage tags, column map line on measures |
| **Inspector (parallel)** | Governed semantic + `describe_schema` + catalog embeddings | Not auto-routed in batch translate; same warehouse truth as column resolve |

**Job order (pilot):** `pbi_translate` → `pbi_oracle` (`oracle_only_translated: true`) → `pbi_parity` → `pbi_publish`.

**Local run:**

```bash
npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-pilot-local.ts \
  --report-ids 093a04a2-aff1-4acb-8e80-2906cd4605a3 --skip-inventory --no-llm-cap --from-kind pbi_translate
```

**Diagnostics:**

```bash
npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/diag-vessel-recreation.ts
```

---

## 2. Issues we hit and how we resolved them

### 2.1 Table binding (UC path)

| Issue | Symptom | Fix |
|-------|---------|-----|
| Measures on `Measure` / `Measure2` with no home-table UC | `no_bind` / skipped translate | **Track B:** `resolveUcForMeasure` + `extractDaxTableNames` in `translate-dax-refs.ts` |
| Quoted table names in TMDL vs UC map keys | UC lookup miss | `normalizePbiTableName()` |
| `modelTables` not passed into resolver | False `no_uc` | Wire `modelTableUc` map in `translate.ts` |
| `native_sql` → catalog object | `unscanned` bindings | `pbi_catalog_link` + `resolveCatalogBind` |
| Parity skipped wrong warehouse | `databricks_source_id` from measure home table, not SQL table | `parity.ts`: use `uc_source_table` from translation props; `pickDatabricksSourceId` host normalization + single-source fallback |

### 2.2 Translate / LLM

| Issue | Symptom | Fix |
|-------|---------|-----|
| Grok via Bedrock/Lite temperature errors | 0 LLM translations | Prefer **direct xAI** when `XAI_API_KEY`; omit temperature where required |
| Truncated JSON / strict zod | `llm_failed` | Higher token default; relaxed schema; Sonnet fallback on empty SQL |
| Rule tier invalid SQL | Parity `UNRESOLVED_COLUMN` / syntax | `COUNT(DISTINCT col)` not `COUNT DISTINCT(col)`; **`column_map`** on rule tier |
| LLM invents warehouse columns | `Audit_Duration`, `PSC_Check_Det`, etc. | **`catalog-column-resolve.ts`**: PBI `source_column`, catalog names, native SQL, token match; LLM prompt **v2-catalog**; **SQL allowlist** post-check |
| Oracle only first N measures by name | Passes skipped for translated measures | Pipeline order + **`oracle_only_translated`** after translate |
| Prisma upsert on translations | `42P10` unique violation | Migration: non-partial unique on `(org_id, measure_id)` |

### 2.3 Steward visibility

| Issue | Symptom | Fix |
|-------|---------|-----|
| No single “recreated in Databricks” view | Operators grep logs | `recreation-summary.ts`, API `recreation`, Estate bar + stage tags |
| Unknown why a measure failed | Opaque job counters | `recreation_reason`, failure taxonomy (`no_uc`, `no_sql`, `parity_error`, …) |
| Column mapping invisible | Could not see catalog harness | `column_resolution` in translation `props` + measure detail UI line |

### 2.4 Tests / tooling

| Issue | Symptom | Fix |
|-------|---------|-----|
| Vitest importing `server-only` module | Suite fail | Pure helpers in `catalog-column-parse.ts` |
| Allowlist flagged UC path parts | False reject on `FROM \`c\`.\`s\`.\`t\`` | Validate backticks only in SELECT/WHERE regions |

---

## 3. Catalog column resolve (what it uses from the app)

**Deterministic (default):**

1. `pbi_columns.source_column` from model harvest  
2. `platform_context_columns` for binding `context_object_id` (exact + normalized name)  
3. Column names parsed from `pbi_source_binding.native_sql`  
4. Token overlap on column names (light fuzzy)  

**Optional:** `PBI_COLUMN_RESOLVE_EMBED=1` — `embedQuery` + pgvector on **that object’s** `platform_context_embeddings` (`subject_kind = column'`), same Titan model as Inspector catalog search.

**Not used in batch translate today:** full-estate `describe_schema` search, `platform_nl_intent_embeddings`, cross-table `mapping.ts` proposals (available for future teach-back).

---

## 4. Vessel outcomes (latest local pilot, 2026-11-13)

After translate → oracle → parity → publish with catalog column resolve:

| Metric | Value |
|--------|------:|
| Measures | 30 |
| UC resolved (translate scan) | 22 |
| Rows with SQL (`sql_drafted` in recreation) | 12 (mix of this run + prior drafts) |
| **Parity pass** | **5** (16.7%) |
| Parity fail | 1 (`Updt_Audit_Count` numeric mismatch) |
| Parity error | 6 (mostly legacy SQL with invented column names) |
| **Published** (`kb_verified_queries`) | **4** (13.3%) |

**Published / pass examples:** `Audit_Count_Port_TB`, `Updt_Audit_Count_Sail_TB`, `Updt_Audit_Subtype`, `Vessel_Count_TB`; `Audit_Count_TB` pass not published.

**Still open on Vessel:**

| Class | Count | Notes |
|-------|------:|-------|
| `no_uc` | 8 | Empty DAX, date/calendar-only, unbound tables (`Vessel Audit FL`, card placeholders) |
| `no_sql` | 10 | Grok/Sonnet empty or allowlist reject; no new row this run |
| `parity_error` | 6 | Often **old** LLM SQL not overwritten when this translate wrote only 5 new SQL rows |
| Stale SQL | — | Re-translate all UC-bound measures or clear drafts before parity |

---

## 5. Code map (touch points)

| Concern | Primary files |
|---------|----------------|
| DAX table UC | `src/lib/powerbi/translate-dax-refs.ts` |
| Column resolve | `src/lib/powerbi/catalog-column-resolve.ts`, `catalog-column-parse.ts` |
| Translate / LLM | `src/lib/powerbi/translate.ts`, `translate-llm.ts`, `translate-rule.ts` |
| SQL validation | `src/lib/powerbi/translate-llm-validate.ts` |
| Catalog bind | `src/lib/powerbi/catalog-link.ts`, `native-sql.ts` |
| Parity / oracle / publish | `parity.ts`, `oracle.ts`, `publish.ts` |
| Recreation UI/API | `recreation-summary.ts`, `src/app/api/agent-lab/powerbi/models/[id]/route.ts`, `src/views/agent-lab/estate/powerbi.tsx` |
| Pilot runner | `scripts/powerbi/run-pilot-local.ts` |
| Catalog embed (harvest) | `src/lib/context/embed.ts` |
| Inspector catalog search | `src/lib/context/describe.ts` |

---

## 6. Recommended next steps (Vessel)

1. **Full re-translate** for all UC-resolved measures (or delete stale `pbi_translations` for failed parity_error rows) so column resolve + allowlist apply everywhere.  
2. Enable **`PBI_COLUMN_RESOLVE_EMBED=1`** where T2 + embed exist on the bound table.  
3. Map PBI calc names → warehouse (`Audit_Duration` → e.g. `AuditToDate` / steward-confirmed) via UI teach → `platform_context_mappings`.  
4. Keep **catalog-link** + **T0/T2/embed** fresh on the UC tables PBI imports.

---

## 7. Where this is logged elsewhere

| Doc | Content |
|-----|---------|
| `docs/CHANGELOG.md` | Dated entries for recreation UI, catalog resolve, pipeline order, LLM routing |
| `docs/jobs/session-log.md` | Session notes (Cursor) per workstream |
| `docs/jobs/powerbi-implementation-tracker.md` | Phase checklist (update when gates move) |
| `docs/inspector/semantic-layer-and-powerbi.md` | Product positioning vs governed semantic layer |
