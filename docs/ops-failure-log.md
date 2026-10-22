# Ops Failure Log (ALOFT D360)

**Purpose:** Living record of broken / failing dependencies and how to fix them.  
**Audience:** Humans and any Cursor/agent chat working in this repo.  
**Canonical detail for endpoints:** [external-apis-and-providers.md](./external-apis-and-providers.md)  
**Agent rule:** `.cursor/rules/ops-failure-log.mdc` (always apply)

> Never put real secrets in this file. Name env vars only.

---

## How to maintain

| Event | Action |
|-------|--------|
| New failure seen in terminal/logs/UI | Add or update an **Open** row; append a **Changelog** line |
| Root cause confirmed | Fill **Cause** + **Fix** |
| Verified working again | Move entry to **Resolved**; set status ✅; note what changed |
| Status unknown | Use ❓ — do not invent a pass |

When fixing auth: update `.env.local` (local) / secrets store (prod), restart the Next.js process, re-run the failing path, then update this log.

---

## Open / broken

| ID | Area | Symptom | First seen | Last seen | Cause | Fix |
|----|------|---------|------------|-----------|-------|-----|
| F-001 | Amazon Bedrock (Converse) | `UnrecognizedClientException` / "The security token included in the request is invalid" (403). Semantic + groundedness scorers log `[semantic scorer]` / `[groundedness scorer] LLM call failed` | 2026-09-21 | 2026-09-29 | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` invalid, expired, or deactivated | Rotate IAM access keys; ensure Bedrock access in `BEDROCK_REGION` (`us-east-1`); restart `next dev` / server; confirm a Converse call or Boost scorer succeeds |
| F-002 | Bedrock Mantle | 401 "The security token included in the request is invalid" | 2026-09-21 | 2026-09-21 | `BEDROCK_MANTLE_API_KEY` rejected | Issue/rotate Mantle API key; set `BEDROCK_MANTLE_API_KEY` + `BEDROCK_MANTLE_REGION`; retest Mantle chat path |
| F-003 | Azure AI Foundry | `ENOTFOUND` for Foundry host | 2026-09-21 | 2026-09-21 | DNS / VPN / endpoint moved | Confirm VPN or correct `FOUNDRY_ENDPOINT`; update env; retest Foundry chat |
| F-004 | Azure OpenAI (classic) | Connection / resolution failure | 2026-09-21 | 2026-09-21 | Same network class as Foundry | Confirm endpoint reachability + `AZURE_OPENAI_API_KEY`; retest |
| F-005 | Context harvester (ECS) | 2 `t0_structural` jobs stuck `running` and ~49 `queued` (including Estate per-table requests such as `landing_zone_dev.sire_2_0.sire_report`); nothing processed. Per-table `{path}` jobs harvest the whole source instead of the table. | 2026-10-18 | 2026-10-20 | The queue consumer (EventBridge/ECS) appears down. `scripts/context/orchestrator.ts` ignores `scope.path`. See [incident-2026-10-18-catalog-mass-drop.md](./incident-2026-10-18-catalog-mass-drop.md) | Map `scope.path` → `includePatterns`; check the EventBridge rule, ECS tasks on `aloft-agents-dev` and the `/ecs/aloft-context-harvester` logs; reap stale `running` jobs |

### Impact notes (Open)

- **F-001:** Breaks Bedrock-backed Inspector default and memory reflect/enrich paths that use Bedrock. **Boost scorers mitigated (2026-09-29):** semantic + groundedness now call Foundry / Azure OpenAI (`src/lib/boost/scorers/llm-client.ts`), same credential path as embeddings — no longer blocked by invalid AWS keys.
- **F-001 chart mitigation (2026-09-25):** `emit_chart` now validates/compiles the agent-supplied Chart DSL in `toolInput` first (`src/lib/inspector/tools.ts`). `runChartPipeline` falls back to deterministic `recommendCharts` when Bedrock `emitChartSpec` fails (`src/lib/inspector/chart-pipeline.ts`). Chart UI should work without a second Bedrock call; Boost scorers and Bedrock chat still need rotated AWS keys.
- **F-002–F-004:** Alternate LLM routes unavailable until fixed.

---

## Unverified (❓)

| Area | Notes | How to verify |
|------|-------|---------------|
| Databricks SQL / OAuth SP | Creds present; not retested with F-001 session | Run a guarded SQL via Inspector or connection test API |
| PostgreSQL (RDS) | Creds present | App boot + simple Prisma query |
| Azure Entra ID (NextAuth) | Config present | Sign-in flow |

---

## Resolved

| ID | Area | Resolved | What fixed it |
|----|------|----------|---------------|
| — | — | — | (none yet) |

---

## Changelog

| Date | Who / chat | Change |
|------|------------|--------|
| 2026-09-21 | Health check | Initial broken matrix in `external-apis-and-providers.md` §9 |
| 2026-09-25 | Cursor chat | Confirmed **F-001** still failing via Boost semantic + groundedness scorers; created this log + always-apply Cursor rule |
| 2026-09-25 | Cursor chat | Chart `emit_chart` returned F-001 because handler discarded agent DSL and re-called Bedrock. Mitigated: prefer inline DSL + recommender fallback. AWS keys still broken for scorers/Bedrock chat. |
| 2026-09-29 | Cursor chat | Reconfirmed **F-001** via Boost semantic + groundedness scorers. Also fixed Foundry session-summary path sending `temperature: 0` (rejected by `gpt-6-luna`; omit like `foundry-chat`). |
| 2026-09-29 | Cursor chat | **Scorer mitigation:** moved semantic + groundedness off Bedrock Converse to Foundry/Azure OpenAI (`llm-client.ts`, default `gpt-6-luna`). F-001 still open for Bedrock chat/memory paths. |
| 2026-10-20 | Copilot chat | Added **F-005** (harvest queue stalled; orchestrator ignores `scope.path`). On 2026-10-18 a per-table Estate request triggered a full sweep that wrongly dropped 1,387 catalog objects; those objects (and 167 dropped earlier) were restored and the drop logic fixed. Write-up: [incident-2026-10-18-catalog-mass-drop.md](./incident-2026-10-18-catalog-mass-drop.md). F-001 (AWS keys): new IAM key verified for Bedrock Titan + Converse and Secrets Manager. |

---

## Quick diagnosis cheatsheet

| Log / error fragment | Likely ID | First place to check |
|----------------------|-----------|----------------------|
| `security token included in the request is invalid` + Bedrock SDK / scorers | F-001 | `.env.local` `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_REGION` |
| `temperature' does not support 0` + `[session-knowledge-llm]` | (code) | Omit `temperature` for Foundry summary (`session-knowledge-llm.ts`); restart if still on old code |
| Same message + `emit_chart` / `{ "error", "attempts": 1 }` | F-001 (mitigated) | Prefer agent tool-input DSL path in `tools.ts`; fallback recommender in `chart-pipeline.ts`. Rotate AWS keys only if Bedrock emit itself is required. |
| Same message + Mantle / 401 | F-002 | `BEDROCK_MANTLE_API_KEY` |
| `ENOTFOUND` + `cognitiveservices.azure.com` | F-003 / F-004 | Network + Foundry/Azure endpoint env vars |
| Databricks token / warehouse errors | (new or Databricks docs) | `DATABRICKS_CLIENT_*` + [databricks-auth-and-usage.md](./databricks-auth-and-usage.md) |
