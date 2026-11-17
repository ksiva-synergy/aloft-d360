# Evidence ledger: agent loop, working context, execution state, memory

Read on 2026-11-07 from the `main` working tree, including staged and uncommitted changes. Supports `reports/Agent context and memory architecture.md`.

**Confidence levels:**
- **High:** read directly in code.
- **Medium:** code plus an inference about runtime behaviour.
- **Low:** depends on provider, gateway or environment behaviour that was not observed.

"Prior" says whether the 2026-11-04 audit already had the finding: Confirmed, Corrected or New.

## A. Loop and execution

| ID | File : line | Symbol | Observed behaviour | Conf. | Prior |
|---|---|---|---|---|---|
| E-01 | `src/app/api/inspector/chat/route.ts:84-91, 173-174, 204-207` | `resolveModel` | Every model key resolves to an LLM Lite gateway config (`foundryDeployment` set, `bedrockId: ''`) | High | Confirmed |
| E-02 | `src/lib/inspector/tools.ts:447-467`; `src/lib/inspector/providers/foundry-chat.ts:650-658` | `execute_tool`, `runFoundryAgentLoop` | The model receives `JSON.stringify(sqlResult)`, i.e. all rows up to `MAX_ROWS` (default 1000, max 10k, `databricks/execute.ts:33-36`). It is appended as a `tool` message and re-sent on every later loop. Only the UI event is capped at 1000 | High | Confirmed |
| E-03 | `foundry-chat.ts:456-463` | Chat Completions request | Sends only `model`, `messages`, `tools`, 4096 cap and `stream`. No temperature, reasoning, `tool_choice` or cache control | High | Confirmed |
| E-04 | `foundry-chat.ts:469-506, 597-652` | stream loop, tool batch | No abort check inside the stream or before `Promise.all`. The `AbortController` is wired only to the 45 s stall timer | High | Confirmed |
| E-05 | `src/hooks/useInspectorChat.ts:285, 297-299, 306`; `route.ts:216-227` | `doSend` | `userMsg` is added to state, the state is read back (it includes `userMsg`), and `userMsg` is appended again. The server joins consecutive user messages with `\n` | Medium (React updater ordering; confirm with a captured body) | Confirmed |
| E-06 | `foundry-chat.ts:599-601`; `agent-loop.ts:263`; `foundry-chat.ts:330` | arg parse | Malformed JSON args silently become `{}` and the tool runs | High | Confirmed |
| E-07 | `foundry-chat.ts:459, 661-668`; `route.ts:676-687` | loop exhaustion | Tools are offered on the last loop. On exhaustion `finalText` is null, and the Inspector appends a canned "Tool-call limit reached" footer | High | Confirmed |
| E-08 | `route.ts:209-227` | history build | Client transcript filtered and merged. No count or char cap. Text only | High | Confirmed |
| E-09 | `route.ts:636, 701, 731-740, 788-793`; `log-agent-cost.ts:28-32, 59` | `persistInspectorSpend`, `pricingKey` | Spend recorded only for completed and truncated turns. `toolCalls = loops - 1`. Unknown model ids are priced as `claude-sonnet-4` | High | Confirmed |
| E-10 | `src/lib/inspector/prompts.ts:458-483` | `buildInsightsContext` | All `studio_insights` rows for the session are concatenated, with no limit | High | Confirmed |
| E-25 | `src/lib/agent-ops/record-turn-metrics.ts:41`; `route.ts:390` | `flush` | Returns early when `sessionId` is empty. The Inspector passes `''` for non-UUID sessions | High | Confirmed |
| E-26 | `src/lib/agent-ops/redact.ts:2, 23, 51-60`; `log-tool-invocation.ts:14, 58-68` | `redactToolOutput` | `tool_invocation_log` stores `rows` as `{_omitted, length}`, SQL truncated to 500 chars, payload ≤8 KB, optional success sampling. Keeps `statement_id` and columns | High | New |
| E-27 | `route.ts:744` | outcome mapping | `aborted` only when the loop result is not `completed`. A Bedrock abort returns `completed` (`agent-loop.ts:316-325`) | High | Confirmed |
| E-28 | `src/lib/access/warehouse.ts:27-46` | `runWarehouseQuery` | `authorizeSql(principal, statement, level)` → tier → tier-specific Databricks role → execute | High | **New** (changes result-reuse security) |
| E-29 | `src/lib/inspector/session-auth.ts:132` | `guardInspectorChat` | Enforce is the default (`!== 'false'`) | High | Corrects ADR-004 wording |
| E-40 | `src/lib/inspector/__tests__/`, `src/lib/agents/__tests__/run-catalog-agent.test.ts:39-40` | tests | No tests for `agent-loop.ts` or `foundry-chat.ts`. Callers mock the loop. `getFoundryClient` is built inside the loop (`foundry-chat.ts:418`), so there is no injection seam | High | Confirmed (plan F7) |
| E-41 | grep of `runAgentLoop` / `dispatchAgentLoop` / `runCatalogAgent` | call sites | Nine callers: inspector chat, agents chat, flows agent-try, workbench chat, workbench test-run, inspector teach, semantic blueprint, refine-item, flows-copilot propose, boost runner (plus factory and `runCatalogAgent` internals) | High | Confirmed (plan F6) |
| E-42 | `docs/business-ai-studio/02-target-architecture.md:119`; `07-memory-learning.md:3`; ADR-004 Decision 1 | Studio boundary | Studio must not import Inspector session code. Studio owns planning, budgets and checkpoints. Provider calls go through a gateway port over the shared provider stack | High (docs) | **New**: conflicts with plan §6.5 |

## B. Working context

| ID | File : line | Symbol | Observed behaviour | Conf. | Prior |
|---|---|---|---|---|---|
| E-11 | `src/lib/inspector/session-knowledge-core.ts:28-40` | `InspectorSessionKnowledge` | A structured working-context object already exists: schema paths ≤48, entities ≤24, heuristics ≤20, task `{goal, status, nextStep}`, summaries `{template, narrative}` | High | Partly (prior saw only the bounded block) |
| E-12 | `src/lib/inspector/session-knowledge-store.ts:16-47` | load / save | Stored in `workbench_sessions.progress.inspectorKnowledge` with an atomic jsonb merge | High | New |
| E-13 | `session-knowledge-store.ts:50-89`; `session-knowledge-llm.ts:17-31` | `persistSessionKnowledgeAfterTurn` | After each turn with tool calls: deterministic merge, then an LLM narrative summary (default `gpt-6-luna`). The summary is on whenever an LLM credential exists, unless `INSPECTOR_SESSION_SUMMARY_LLM=false`. The narrative is validated against facts (`session-knowledge-core.ts:420`) | High | **New**: an incremental summary already exists |
| E-14 | `session-knowledge-core.ts:45, 205-215, 245-258`; `session-knowledge-store.ts:126-131` | `extractEntitiesFromSqlResult`, `extractHeuristicsFromSql`, `loadRecentQueryFacts` | Hard-coded demo facts: `EPIC RADIANCE`→78, `EMPRESS ZONDA`→60 emitted when SQL contains `id in (60, 78)`. "Spare-to-component register links for vessels 60 and 78 were validated" emitted on a table-name substring match. A fixed SOMI schema claim. An IMO heuristic. The table-path regex is limited to five hard-coded catalogs | High | **New** |
| E-15 | `session-knowledge-core.ts:178-216`; `formatSessionKnowledgeForPrompt` `:452-506` | entity extraction | Entity labels come from SQL result rows (untrusted warehouse text) and are injected into the system prompt as "confirmed … do not re-discover" | High | New |
| E-16 | `src/lib/inspector/answer-rules.ts:22`; `route.ts:209-214` | `AGENT_ANSWER_VOICE` | Prose must omit SQL, tables, joins and paths, and history is text only. So earlier filters survive only via session knowledge (last SQL ≤1,200 chars, `session-knowledge-store.ts:151`) or the user's own words | High | New |
| E-17 | `src/lib/agents/agent-chats.ts:30-31, 66-83` | `historyForModel` | Saved agents: last 30 messages and ≤60k chars, starting on a user turn. Server-stored | High | Confirmed |
| E-18 | `src/app/api/agent-lab/agents/chat/route.ts:166-169, 199-203` | reply save | Saves the concatenated stream (`reply`) in preference to `finalText`. `runCatalogAgent` never wires `onTextReplace` | High | Confirmed |
| E-19 | `route.ts:247-251, 300-301, 323-328` | prompt assembly | One system string (base + semantic + voice + insights + session knowledge + P0 + P1a), plus P1b as a synthetic assistant message before the first user turn | High | Confirmed |

## C. Execution state and results

| ID | File : line | Symbol | Observed behaviour | Conf. | Prior |
|---|---|---|---|---|---|
| E-20 | `route.ts:357-377` | `sessionQueryResults` | An in-memory array per HTTP request (comment says "this session"). Lost when the request ends | High | **Corrected** (prior treated it as server-side storage) |
| E-21 | `useInspectorChat.ts:445-480`; `src/app/api/studio/results/route.ts:60-97` | `query_result` handler, POST | The browser POSTs each result's columns and rows (≤1000) to create `studio_query_results`. The server never writes this table from `execute_tool` | High | **New / Corrected** |
| E-22 | `prisma/schema.prisma:206-225` | `studio_query_results` | Columns: `id`, `session_id`, `seq`, `sql`, `columns`, `rows`, `row_count`, `truncated`, `profiles`, `specs`. No `turn_id`, principal, `statement_id` or SQL hash. Cascade on session delete; no TTL | High | New |
| E-23 | `tools.ts:200-206, 314-339` | `emit_chart`, `export_query_result` | Chart uses the last in-request result (race with same-batch `execute_tool`). Export falls back to the last `studio_query_results.sql` | High | Confirmed |
| E-24 | `src/app/api/inspector/export/route.ts:83-91` | export | Export prefers `resultId` from `studio_query_results` over browser SQL. An id-based access pattern already exists | High | New |

## D. Long-term memory

| ID | File : line | Symbol | Observed behaviour | Conf. | Prior |
|---|---|---|---|---|---|
| E-30 | `src/lib/memory/teach.ts:84-99, 119-120`; `src/lib/inspector/reflect-tools.ts:171` | `teachRule`, `capture_learning` | The tool description says the learning stays a "PERSONAL candidate … until a later review step". The row is written `status: 'ACTIVE'`, `visibility: 'personal'`, so it is retrievable immediately for its author | High | New |
| E-31 | `prisma/schema.prisma` (comment above `PlatformTeachCandidate`); `src/lib/memory/retrieve.ts:341-397` | personal lane | Candidate `state`, `verification` and `conflict` live in `platform_teach_candidate`, which retrieval does not read. Conflicted or unverified personal rules are injected | High | New |
| E-32 | `route.ts:253-255, 266, 283-294` | memory selection | `taskCtx` and `topicKey` are derived from the session's **first** user message on every turn | High | New |
| E-33 | `src/lib/memory/synthesis/curate.ts:180-230, 375-385, 430-440` | `curate` | Phantom check (identifiers present in trace), then caveat guard (quarantines only HEURISTIC and SOURCE_PREF on caveated tables), then insert or supersede as `ACTIVE`, org-visible. No human approval step | High | New |
| E-34 | `src/app/api/agent-lab/memory/synthesize/route.ts`; `DistillationStage.tsx:118`; `FoerOpsDashboard.tsx:265`; `run-sweep.ts:5` | synthesis trigger | Admin-only POST; up to 20 sessions per click. The referenced `scripts/memory/synthesize.ts` does not exist. No scheduler in `infra/`, `.github/workflows/` or `scripts/` | High (repo); Low (an external scheduler could exist) | New |
| E-35 | `src/lib/memory/synthesis/refine.ts:19-25, 261-301` | TTL expiry | SCHEMA_MAP 90 d, HEURISTIC 60 d, SOURCE_PREF 30 d, FAILURE_MODE 14 d (env-overridable). Runs only inside the sweep | High | New |
| E-36 | `retrieve.ts:623-635`; `route.ts:300-301, 323-328`; `docs/business-ai-studio/07-memory-learning.md:62` | `formatForInjection` | Memory is rendered as `=== OPERATING MEMORY ===` instruction lines in the system prompt, and P1b as a fake assistant turn. Studio docs list this as open risk S13 | High | New |
| E-37 | `src/lib/memory/attribution.ts:37-73, 96-150`; `route.ts:310, 674, 729, 738` | `recordInjection`, `attributeRunOutcome` | Injections keyed by **session id** with `ON CONFLICT DO NOTHING`; outcome claims rows `WHERE attributed_at IS NULL`. Success comes from the `scoreRun` heuristic. Aborted turns labelled completed are credited | High (code); Medium (that only first-turn outcomes count for re-injected bullets) | New |
| E-38 | `retrieve.ts:108-117, 135-145, 188-189` | flags, visibility | Injection needs `MEMORY_INJECT_ENABLED=true` and a class allowlist. Full pool needs an org canary list. Visibility is `org` or the caller's own `personal`; there is no team scope | High (code); Low (production env values not read) | New |
| E-39 | `docs/AI-AGENT-MEMORY.md` §2.3–2.5, §1 | docs | Says Bedrock is primary, `sonnet-4-6` is the default, 8 max loops, and memory synthesis runs overnight. None of these match the code | High | New |
