# Power BI → ALOFT Semantic Intelligence Playbook

**Purpose:** Catalog *what valuable information lives in Power BI/Fabric semantic models* and how an AI-forward product can **mine it once, govern in ALOFT, execute on Databricks** — without making Power BI a second runtime.

**Audience:** Product, data stewards, AI/engineering  
**Status:** Vision + near-term backlog (2026-11-09)

---

## Executive thesis

Power BI is already an **unofficial enterprise glossary** for hundreds of reports: measure names, DAX formulas, synonyms for Q&A/Copilot, descriptions, relationships, lineage to Fabric warehouses, and governance badges (Promoted / Certified). That is **high-value training and stewardship input** for ALOFT — not a system to query at runtime.

**Turn it into power by treating PBI as a Semantic Intelligence Source (SIS):**

```text
Fabric / PBI artifacts  →  extract & score  →  steward workspace (drafts)
       →  map to UC full_path  →  govern in platform_sem_*  →  Inspector / agents / dashboards
```

Microsoft’s own Copilot contract proves the same metadata classes matter for NL analytics: **schema, relationships, DAX, descriptions (≤200 chars in grounding), synonyms, format strings, data categories** ([Power BI agentic semantic-model guidance](https://github.com/data-goblin/power-bi-agentic-development/blob/main/plugins/semantic-models/skills/semantic-model/references/ai-copilot-readiness.md)).

ALOFT already has the **receiving dock**: `synonyms`, `nl_intent`, `description`, `format_hint`, `platform_nl_intent_embeddings`, harvest lineage, promotion gates.

---

## Tier S — Highest value for ALOFT semantics

| PBI artifact | What it contains | Maps to ALOFT | Why it matters |
|--------------|------------------|---------------|----------------|
| **Measure definitions (DAX)** | Business logic, filters, denominators | `platform_sem_measures.expression` (reviewed), measure `description` | Turns “119 measures” into **15 canonical KPIs + documented ratios** (avoid duplicate Compliance % definitions) |
| **Linguistic metadata / synonyms (LSDL JSON)** | Alternate phrases per table/column/measure | `synonyms[]`, `nl_intent` on dims/measures | Same lever Copilot uses; powers `matchIntents` + Inspector |
| **Descriptions (TMDL / TOM)** | Steward-authored definitions per object | `description`, `ai_context` on entity/dim/measure | Grounding text; Microsoft recommends descriptions on **every** TOM object ([TMDL overview](https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview)) |
| **Relationships** | Keys, cardinality, active/inactive, cross-filter | `platform_sem_joins.join_on_sql` | PO Spend: `Purchase_History.DOC` → `doc_target.DOC` (you already extracted 2 relationships) |
| **Power Query M (SQL source)** | Joins + CASE rules at refresh | **Databricks view DDL** (not Aurora) | Physical truth; ALOFT entity points at **one** enriched UC object |

---

## Tier A — Strong value for discovery & trust

| PBI artifact | What it contains | Maps to ALOFT | Why it matters |
|--------------|------------------|---------------|----------------|
| **Fabric lineage API** | Upstream dataflows, lakehouse, warehouse, downstream reports | Estate graph + harvest scope prioritization | “What must we replicate in UC?” without guessing ([relations API preview](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/lineage-aware-ai-with-the-fabric-item-relations-api-preview/5366064)) |
| **Gateway / connection metadata** | SQL endpoints, cloud vs gateway | Mapping worksheet: Fabric host → UC `full_path` | You already used this for PO Spend warehouse vs doc DB |
| **Endorsement (Certified / Master data)** | Org-trusted datasets | **Steward queue priority** + `trust: governed` in KB design | Scan Certified models first, not all 500 workspace items ([endorsement overview](https://learn.microsoft.com/en-us/fabric/governance/endorsement-overview)) |
| **Admin Scanner API** | Inventory, refresh, sensitivity labels, incremental scan | Job: `pbi_semantic_scan` → link to `platform_context_objects` | Enterprise-scale mining ([metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run)) |
| **Column data categories & format strings** | Currency, URL, %, dates | `format_hint`, `unit` on measures/dims | Align dashboard widgets + refusal-safe formatting |

---

## Tier B — Useful for UX and metric families (not 1:1 import)

| PBI artifact | What it contains | Maps to ALOFT | Why it matters |
|--------------|------------------|---------------|----------------|
| **Display folders** | Measure grouping in model explorer | Metric **families** / Inspector browse taxonomy | Collapse 119 measures into “Compliance”, “Leakage”, “Time” buckets |
| **Calculation groups** | YTD, PY, YoY wrappers | **One temporal grain** + few **derived measure templates** | Don’t clone 8× per measure; use `SemanticQuery.timeGrain` + 3–5 derived metrics |
| **Field parameters** | Which measures users switch in UI | **nl_intent clusters** (“when user says margin, map to these 4 measures”) | User language for *families*, not separate governed measures |
| **Perspectives** | Hidden subsets for roles/audiences | Future: **access-scoped semantic views** or prompt blocks | Informs department-specific Inspector context |
| **RLS roles (DAX filters)** | Row filters per role | ALOFT **access rules** + UC row filters — **reference only** | Security must not live only in PBI |

---

## Tier C — Valuable for prioritization, not definitions

| PBI artifact | What it contains | Use |
|--------------|------------------|-----|
| Report / visual metadata (scanner) | Which measures appear on Certified reports | **Governance backlog rank** — govern what’s on exec dashboards first |
| Usage metrics (if enabled) | Views, refreshes | Deprecate dead DAX; don’t port junk |
| Sensitivity labels | Confidentiality | Align with column protections in Access console |

---

## Tier D — Usually **do not** import as semantics

| PBI artifact | Why skip or defer |
|--------------|-------------------|
| Auto date tables (`LocalDateTable_*`) | Use temporal dimensions on fact date columns |
| 100+ ranking / conditional-formatting measures | UI helpers, not business KPIs |
| Implicit measures | ALOFT requires explicit measures |
| Live connection AS models | No portable M/DAX in dataset |
| Real-time datasets | Scanner skips deep schema |

---

## Product concept: **Semantic Intelligence Pipeline (SIP)**

Five modules that make PBI input **powerful** inside ALOFT without dual masters.

### 1. Mine (extract)

Sources (pick per tenant policy):

- **PBIX / TMDL folder** (offline, what you did with pbixray + future TMDL)
- **XMLA read-only** → TMDL serialize ([Microsoft TMDL how-to](https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-how-to))
- **Fabric Scanner** → certified datasets only, incremental
- **Relations API** → lineage edges for PO Spend chain

Output: normalized **Semantic Intelligence Package (SIPkg)** JSON:

- entities (tables), columns, measures, relationships, synonyms, descriptions, connections, lineage ids

### 2. Score (AI + rules)

Per measure/dimension:

- **Copilot-readiness score** (description length, synonyms present, disambiguation keywords in first 200 chars)
- **Complexity score** (DAX depth, external dependencies)
- **Usage score** (on Certified reports?)
- **UC readiness** (can we map connection → harvested `full_path`?)

Stewards see a **ranked inbox**, not 3,134 candidates.

### 3. Align (map to Databricks)

- Lineage + connection metadata → candidate `full_path` (human confirms)
- Column name fuzzy match: PBI column ↔ UC column (embeddings you already have)
- Flag gaps: `compliance_flag` in DAX but missing on UC → “data engineering task”, not semantic draft

### 4. Draft (authoring accelerators)

Auto-create **candidates only**:

- Entity per mapped UC table/view
- Dimensions from columns + PBI synonyms
- Measures: **simple aggregates** automated; **ratios** as drafts with DAX pasted into `description` + proposed `expression` for review
- Bulk `synonyms` import from LSDL

**Never auto-promote.**

### 5. Govern & learn (closed loop)

- Promote → embed `nl_intent` (`intent-embed.ts`)
- Inspector thumbs-up → future `kb_verified_queries` (per knowledge-base design)
- When UC view changes → stale badge on entity (reuse pipeline freshness patterns)

---

## PO Spend example: what you’d pull from PBI

| Extract today (`pbix_semantic_metadata`) | ALOFT action |
|------------------------------------------|--------------|
| `dax_measures.csv` (119) | Cluster into ~12 families; govern **5–15**; rest = synonyms or deprecated |
| `power_query.csv` | UC gold view spec |
| `relationships.csv` (DOC joins) | `platform_sem_joins` |
| `schema.csv` | Dimension labels + types |
| `rls.csv` | Access design note, not copy-paste RLS |
| Fabric lineage (you captured) | Harvest scope + mapping worksheet |

---

## What makes this **powerful for the application**

| ALOFT capability | Powered by PBI intelligence |
|------------------|----------------------------|
| **Inspector NL → SQL** | Synonyms + nl_intent from LSDL; measure descriptions |
| **Intent match** (`platform_nl_intent_embeddings`) | Trigger phrases from verified answers / measure names |
| **Estate search** | Descriptions aligned with PBI steward text |
| **Dashboard widgets** | `format_hint`, `unit`, canonical measure ids |
| **Access console** | RLS role analysis → column/tag strategy |
| **Jobs / harvest** | Lineage tells *which* schemas to T4-bootstrap first |
| **Steward productivity** | Inbox ranked by Certified + usage + Copilot-readiness |

**Differentiator vs “connect Power BI”:** You ingest **meaning**, execute on **UC**, govern in **Aurora**. PBI becomes a **read-only semantic telescope**, not a second database.

---

## Guardrails (non-negotiable)

1. **Single runtime:** Databricks UC only for governed queries.
2. **Human promotion** for anything that changes numbers.
3. **Certified-first scope** — ignore long tail of 500 workspace reports until mapped.
4. **DAX is specification**, not executable in ALOFT v1 — compile to UC view + simple aggregates first.
5. **No bidirectional sync** to PBI datasets without explicit product decision.

---

## 90-day creative roadmap (pragmatic)

| Phase | Deliverable |
|-------|-------------|
| **0** | SIPkg schema + PO Spend sample from existing CSVs |
| **1** | Steward UI: “Import PBI package” → drafts + diff view |
| **2** | Synonyms bulk import → `synonyms[]` + re-embed intents |
| **3** | Fabric Scanner adapter (Certified models) → ranked inbox |
| **4** | Lineage + connections → suggest `full_path` on entity create |
| **5** | DAX complexity analyzer → “safe expression” proposals (human gate) |

---

## Further reading

- TMDL descriptions & round-trip: [Microsoft Learn — TMDL](https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview)
- LSDL / linguistic metadata: [INFO.LINGUISTICMETADATA](https://sumproduct.com/blog/the-a-to-z-of-dax-functions-info-linguisticmetadata/), [LSDL schema](https://json.schemastore.org/lsdlschema-3.0.json)
- Fabric lineage programmatic: [Item relations API (preview)](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/lineage-aware-ai-with-the-fabric-item-relations-api-preview/5366064)
- ALOFT semantic types: `src/lib/semantic/types.ts`, governance: `src/lib/semantic/governance.ts`
- Related repo doc: `reports/PO_Spend_Semantic_Migration_Analysis.md`
