# Data access — feature map (simplified model)

Quick audit: everything built for the 2026-11-08 access workstream and **where it lives in the UI**.  
Branch: `feature/automate-runs` (includes `dff3f78` access + follow-ups).

## Five tabs (`/agent-staging/data-access`)

| Tab | Primary jobs | Key APIs |
|-----|----------------|----------|
| **Data** | Use rules on catalog → schema → table; optional whole-path protect; column list + ⓘ on tables | `data-tree`, `rules`, `path-protections`, `data-tree/columns`, `column-info` |
| **Department map** | Tag catalog → schema → table with **groups** (departments) and purpose (Query / Export / Block); **Data → departments** and **Department → data** | `data-tree`, `rules`, `groups` |
| **Protections** | Create protections (tags); tag columns; **Give access** on who sees values; search columns | `tags`, `column-tags`, `tag-grants`, `column-search`, `path-protections` |
| **People & groups** | Groups, members, person summary | `groups`, `person` |
| **Requests & log** | Approve/deny; history; column-check health | `requests`, `notifications`, `health` |

**My data access** (`/my-access`, user menu): read-only summary + ask for access + table search by meaning.

## Embedding search (harvest pgvector)

Uses `src/lib/access/semantic-search.ts` → `embedQuery` → `platform_context_embeddings` (column + table summaries).  
**Harvest unchanged:** `src/lib/context/embed.ts` still includes sample values in embed text for indexing (not returned in search JSON).

| Where | Query | API |
|-------|--------|-----|
| Data → Find a table | Hybrid name+embeddings; Luna re-rank (`ACCESS_TABLE_SEARCH_RERANK`) | `GET data-tree?q=` |
| Protections → column list + Add columns | **ⓘ** on every row; hybrid name+embedding search; Luna re-rank on noisy tails (`ACCESS_COLUMN_SEARCH_RERANK`) | `column-search`, `column-info` |
| My data access → Find a table | Same | `GET my-access?q=&by=meaning` |

Search responses: names, types, descriptions, scores — **never** embed text or sample values (e2e step 12).

## ⓘ Column info (admin only)

`GET /api/access/column-info?table=&column=` — description, profile top values, harvest dates, protections.

| Where | ⓘ button |
|-------|-----------|
| Protections → Add columns (name + meaning lists) | Yes |
| Data → table → Columns list | Yes |

## Protect — two layers

1. **Use** (Data tab): who can open tables / read **unprotected** fields.  
2. **Protection grants** (Protections tab): who sees **protected column values** (Exact values / Totals only).

Whole-path protection (Data → Protect catalog/schema/table) is optional and separate from column tags.

## Runtime / enforcement (not in this UI)

- `ACCESS_MODE` — table-level Use (`off` | `observe` | `enforce`; any other value enforces and is reported on the badge)  
- `COLUMN_ACCESS_MODE` — masking (`column-guard.ts`, `sql-columns.ts`; `off` | `shadow` | `enforce`; any other value enforces)  
- `ACCESS_BOOTSTRAP_OPEN=true` — first setup only: unprotected data is open while no access rules exist. Unset, no rules means nothing is open, and missing access tables refuse everything.  
- The Data access badge shows both modes, and goes amber when columns aren't masked, bootstrap is on, or a setting can't be read.  
- Inspector describe stripping, AI access notes — see `docs/access/manual-test-guide.md`

## Automated checks

- Unit/route: `npx vitest run src/lib/access src/app/api/access`  
- E2E dev: `vitest.e2e.config.ts` → 13 steps (meaning search, column-info, tree, requests, …)

## Retired from this page (code may remain)

Old **Labels**, standalone **Setup guide** tabs — folded into **Protections** / **Data**. Legacy **Data map** UX is back as **Department map** (new rules APIs). `?tab=map` opens Department map.
