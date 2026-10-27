# ALOFT D360 — current knowledge assets (codebase inventory, 2026-10-24)

Scope: every subsystem in `c:\ALOFT\aloft-ui-redesign` that stores, derives, retrieves, or injects "knowledge" for AI agents. All sources are repo paths with line numbers (as read on 2026-10-24, working tree, uncommitted files included). "Unverified" means the code or DDL needed to confirm it is not in the repo.

## 1. Store-by-store inventory: schema, writers, readers, freshness, org scoping

### Takeaway
There are six live knowledge stores. Four are harvested-catalog tables (`platform_estate_objects`, `platform_context_objects/columns/profiles/semantics/usage`, `platform_context_embeddings`, `platform_nl_intent_embeddings`). The other two are agent memory (`platform_agent_memory`) and per-session working memory (a JSON key on `workbench_sessions.progress`). A seventh store, `knowledge_sources`/`knowledge_chunks`, is fully modelled and has a working writer library, but in production the writer never runs and nothing reads it. No vector index (HNSW or ivfflat) is defined anywhere in the repo.

### Cited Findings

**Catalog inventory: `platform_estate_objects`**
- Columns: `id, org_id, source_id, connection_ref, full_path, catalog_name, schema_name, object_name, object_type, comment, last_altered_src, lifecycle, harvest_state, context_object_id, first/last_inventoried_at`. Unique `(org_id, full_path)`, plus indexes on `(org_id, lifecycle)`, `(org_id, catalog_name, schema_name)` and `(org_id, harvest_state)` — [prisma/schema.prisma:2107-2130](prisma/schema.prisma)

**Harvested catalog: `platform_context_*`**
- `platform_context_objects` holds structural fields plus tier timestamps `last_t0_at … last_t4_at`, `last_knowledge_sync_at`, `entity_tags Json`, and `domain_keywords String[]`. The doc comment says domain_keywords is used for "sub-5ms array-overlap routing". Unique `(source_id, full_path)`, index `(org_id, full_path)`. There is **no index on `domain_keywords`** in the Prisma schema — [prisma/schema.prisma:1840-1877](prisma/schema.prisma)
- `platform_context_columns` has `profile Json` (T1 statistics) and `semantic Json` (T2 role/description/pii_flag). It has `org_id` but no org index; unique `(object_id, name)` — [prisma/schema.prisma:1879-1898](prisma/schema.prisma)
- `platform_context_profiles` stores versioned T1 `stats` and `drift` — [prisma/schema.prisma:1900-1913](prisma/schema.prisma)
- `platform_context_usage` stores versioned T3 snapshots: `access_stats, key_columns, filter_patterns, co_objects, source_breakdown, drift`, with index `(org_id, context_object_id, version desc)` — [prisma/schema.prisma:1915-1935](prisma/schema.prisma)
- `platform_context_semantics` is an append-only versioned `card Json` with `model_id, prompt_version, confidence, status` (default `'assumed'`). Unique `(subject_kind, subject_id, version)`. There is no org index — [prisma/schema.prisma:1937-1952](prisma/schema.prisma)
- The T2 card shape (zod) is `summary, entity, grain, key_columns, fk_candidates, time_columns, measures, json_blob_columns, usage_patterns (min 1), caveats, pii_columns, confidence`. The column semantic shape is `role` (enum), `entity, description, pii_flag, confidence`. `PROMPT_VERSION='enrich_object_v2'` — [src/lib/context/enrich.ts:23-59](src/lib/context/enrich.ts)
- The T2 LLM is chosen through `getHarvestLlmModelId()`: xAI or Groq env vars, else `HARVEST_BEDROCK_MODEL_ID` / `BEDROCK_SONNET_MODEL_ID`, else the default `us.anthropic.claude-sonnet-4-6` — [src/lib/context/harvest-llm.ts:22-41](src/lib/context/harvest-llm.ts)
- After each T2 run, T2 writes `domain_keywords` and `last_t2_at` — [src/lib/context/enrich.ts:642-673](src/lib/context/enrich.ts)
- T3 writes a **new version of the same object semantic card** with `status:'observed'`. That card contains only `{usage_patterns, key_columns}` — [src/lib/context/usage.ts:406-425](src/lib/context/usage.ts)
- T3 matches queries to tables by a case-insensitive substring test on `statement_text` — [src/lib/context/usage.ts:550-552](src/lib/context/usage.ts). The audit flags this as P0-7 — [docs/audits/harvest-job-pipeline-issues.md:93](docs/audits/harvest-job-pipeline-issues.md)

**Catalog vectors: `platform_context_embeddings`**
- Columns: `id, org_id, subject_kind ('object'|'column'), subject_id uuid, embed_text, embedding Unsupported("vector") (no dimension declared), model_id, created_at`. Unique `(subject_kind, subject_id)`. **No org index and no vector index** — [prisma/schema.prisma:1954-1966](prisma/schema.prisma)
- Writer: `embedSubjects`. It skips a row when the new embed_text equals the stored text, and upserts with `ON CONFLICT (subject_kind, subject_id)`, which also overwrites `org_id` — [src/lib/context/embed.ts:108-133](src/lib/context/embed.ts), [src/lib/context/embed.ts:149-263](src/lib/context/embed.ts)
- The embed job only picks objects with `last_t2_at NOT NULL` and columns whose `semantic` is not null — [src/lib/context/embed.ts:291-366](src/lib/context/embed.ts). The orchestrator has its own copy of this logic — [scripts/context/orchestrator.ts:250-294](scripts/context/orchestrator.ts)
- Readers:
  - `searchObjects` — [src/lib/context/describe.ts:656-839](src/lib/context/describe.ts)
  - `buildSemanticContext` — [src/lib/semantic/context-builder.ts:94-136](src/lib/semantic/context-builder.ts)
  - the estate-briefing API — [src/app/api/agent-lab/context/estate-briefing/route.ts:75-95](src/app/api/agent-lab/context/estate-briefing/route.ts)
  - also referenced in `src/lib/context/mapping.ts`, `silo.ts`, `reads.ts`, `embedding-presence.ts`, `src/lib/dashboard/summary.ts` (file-level grep only; these call sites were not read)

**Governed-intent vectors: `platform_nl_intent_embeddings`**
- A separate table. Its comment says this is because definition and chart ids are cuid2 strings, not uuids. Columns: `org_id, source_type ('measure'|'dimension'|'raw_chart'), source_id, intent_text, embedding vector, model_id`. Unique `(source_type, source_id)`, index `org_id`. The comment states "Same Titan-v2 embedding path (embedQuery), 1024-dim" — [prisma/schema.prisma:1968-1994](prisma/schema.prisma)
- Written by `upsertIntentEmbedding` — [src/lib/semantic/intent-embed.ts:30-90](src/lib/semantic/intent-embed.ts). The callers are:
  - semantic drafts — [src/app/api/inspector/semantic/[modelId]/drafts/route.ts:228,263](src/app/api/inspector/semantic/[modelId]/drafts/route.ts)
  - semantic definitions — [src/app/api/inspector/semantic/[modelId]/definitions/[definitionId]/route.ts:133](src/app/api/inspector/semantic/[modelId]/definitions/[definitionId]/route.ts)
  - charts — [src/app/api/inspector/charts/route.ts:142](src/app/api/inspector/charts/route.ts)
  - a backfill script — [scripts/backfill-nl-intent-embeddings.ts:106](scripts/backfill-nl-intent-embeddings.ts)
- Read by `matchIntents` and `listGovernedIntents` — [src/lib/semantic/intent-match.ts:150-215](src/lib/semantic/intent-match.ts). Their callers are the resolve-intent, disambiguation-rank and intents routes — [resolve-intent/route.ts:118](src/app/api/inspector/semantic/[modelId]/resolve-intent/route.ts), [disambiguation-rank/route.ts:79](src/app/api/inspector/semantic/[modelId]/disambiguation-rank/route.ts), [intents/route.ts:28](src/app/api/inspector/semantic/[modelId]/intents/route.ts)

**Agent memory: `platform_agent_memory` (`PlatformAgentMemory`)**
- Columns: `org_id, agent_class, task_signature, rule_text, rule_type, helpful/harmful_count, confidence, embed_text, source_session_ids[], version, status, valid_from/until, embedding vector, last_used_at, short_label, blurb, caveat_context, contributor_rep, created_by, visibility ('org'|'personal')`. Indexes `(orgId, agentClass, status)`, `(taskSignature)` and `(orgId, agentClass, visibility, createdBy)`. No vector index — [prisma/schema.prisma:2234-2269](prisma/schema.prisma)
- A code comment states the column is `vector(1024)` — [src/app/api/agent-lab/memory/[id]/curate/route.ts:98](src/app/api/agent-lab/memory/[id]/curate/route.ts). pgvector is enabled for the staging DB because of this table — [staging/init/00-extensions.sql:2-5](staging/init/00-extensions.sql)
- Writers:
  - synthesis curate (INSERT) — [src/lib/memory/synthesis/curate.ts:218,375,430](src/lib/memory/synthesis/curate.ts)
  - refine — [src/lib/memory/synthesis/refine.ts:220-325](src/lib/memory/synthesis/refine.ts)
  - teach (`teachRule`: `visibility:'personal'`, `confidence:0.9`, best-effort embedding) — [src/lib/memory/teach.ts:77-124](src/lib/memory/teach.ts)
  - attribution counters — [src/lib/memory/attribution.ts:119-141](src/lib/memory/attribution.ts)
  - reputation — [src/lib/memory/reputation/store.ts:288](src/lib/memory/reputation/store.ts)
  - curate API — [src/app/api/agent-lab/memory/[id]/curate/route.ts:60-101](src/app/api/agent-lab/memory/[id]/curate/route.ts)
  - purge-session — [src/app/api/agent-lab/memory/purge-session/route.ts:111](src/app/api/agent-lab/memory/purge-session/route.ts)
- `runSynthesisSweep` is the synthesis entry point — [src/lib/memory/run-sweep.ts:168](src/lib/memory/run-sweep.ts). It is triggered manually by POST `/api/agent-lab/memory/synthesize` (limit 20) — [src/app/api/agent-lab/memory/synthesize/route.ts:20](src/app/api/agent-lab/memory/synthesize/route.ts) — and by `runDag` — [src/lib/memory/orchestrate.ts:61,160](src/lib/memory/orchestrate.ts). The current-state audit says `runDag` is "Not wired" — [docs/audits/business-ai-studio-current-state.md:554](docs/audits/business-ai-studio-current-state.md)
- Readers: see question 4 (memory injection).

**Session working memory: `workbench_sessions.progress.inspectorKnowledge`**
- The JSON key is `PROGRESS_KEY='inspectorKnowledge'`. Shape: `{version, updatedAt, schemaPaths[], entities[], heuristics[], task?, summaries?{template, narrative}}`, capped at 48 paths, 24 entities and 20 heuristics — [src/lib/inspector/session-knowledge-core.ts:6-40](src/lib/inspector/session-knowledge-core.ts)
- Saved with an atomic `jsonb ||` merge — [src/lib/inspector/session-knowledge-store.ts:31-48](src/lib/inspector/session-knowledge-store.ts). It is rebuilt after every turn from the tool trajectory, followed by an optional LLM narrative of up to 1200 characters — [src/lib/inspector/session-knowledge-store.ts:50-86](src/lib/inspector/session-knowledge-store.ts), [src/lib/inspector/session-knowledge-llm.ts:155-178](src/lib/inspector/session-knowledge-llm.ts)
- At prompt time it is merged with the last 12 `studio_query_results` SQL rows — [src/lib/inspector/session-knowledge-store.ts:88-170](src/lib/inspector/session-knowledge-store.ts)

**Per-session insights: `studio_insights`**
- Read by `buildInsightsContext(sessionId)`, which returns every insight row for the session with no cap — [src/lib/inspector/prompts.ts:453-478](src/lib/inspector/prompts.ts)

**Marcus reflections: `platform_marcus_reflections`**
- Columns: `session_id, subject_kind, turn_index, trigger_type, technique, headline, body, suggested_action, severity, status (default 'withheld'), state_snapshot, prompt_version` — [prisma/schema.prisma:2082-2105](prisma/schema.prisma)
- The data-access layer is `createReflection`, `getPendingReflections`, `getSessionReflections`, `markDelivered` and `resolveReflection` — [src/lib/marcus/dal.ts:21-76](src/lib/marcus/dal.ts)
- A first-turn evaluation is fired from Inspector chat — [src/app/api/inspector/chat/route.ts:750-758](src/app/api/inspector/chat/route.ts)
- Reflections are shown in the workbench UI (`useReflections`) — [src/components/workbench/PromptCanvas.tsx:676](src/components/workbench/PromptCanvas.tsx). They are **not injected into any agent prompt**: grep finds readers only in the dal, the reflections and workbench-session routes, and `memory/synthesis/reflect.ts`.

**Dormant document knowledge base: `knowledge_sources` and related tables**
- `knowledge_sources` has `org_id, name, type (FILE|DATABASE|API|SAAS), status, auth_type, refresh_schedule, tags, record_count, last_indexed_at, search_mode (semantic|keyword|hybrid), embedding_model (default openai/text-embedding-3-small), chunk_size 512, chunk_overlap 64, top_k 5, hybrid_weight 50, metadata_filters, is_trusted / trusted_*, score_discoverable/accessible/trusted/actionable, slug, connector_config, doc_count, chunk_count`. It has org indexes — [prisma/schema.prisma:1401-1448](prisma/schema.prisma). The enums are at [prisma/schema.prisma:2773-2813](prisma/schema.prisma) and include `aloft_native` ("aloft/native").
- `knowledge_chunks` has `source_id, org_id, content, embedding vector (no dim), chunk_index, doc_ref, metadata`, with indexes on `source_id` and `org_id`. **There is no unique key, so `ON CONFLICT DO NOTHING` never fires** (inference from the schema) — [prisma/schema.prisma:1450-1465](prisma/schema.prisma)
- `knowledge_dimension_checks`, `knowledge_error_logs`, `knowledge_record_history` and `knowledge_source_agents` (unique `(source_id, agent_id)`) — [prisma/schema.prisma:1467-1519](prisma/schema.prisma)
- The only writer is `syncObjectToKnowledge` / `syncSourceToKnowledge`. It serialises a schema doc, a semantic doc and optional 5-row samples into chunks, and creates a `knowledge_sources` row with `slug='context:<platformSourceId>'` and `embedding_model:'aloft_native'` — [src/lib/context/knowledge-sync.ts:71-153](src/lib/context/knowledge-sync.ts), [src/lib/context/knowledge-sync.ts:194-239](src/lib/context/knowledge-sync.ts), [src/lib/context/knowledge-sync.ts:251-445](src/lib/context/knowledge-sync.ts)
- **No production code imports `knowledge-sync.ts`.** A grep for `syncSourceToKnowledge` / `syncObjectToKnowledge` finds only the definitions. The orchestrator finalizes `knowledge_sync` jobs as `succeeded` with the note "not yet implemented in harvester, skipped" — [scripts/context/orchestrator.ts:349-355](scripts/context/orchestrator.ts)
- The UI and API still enqueue that job: EstateCatalogTab calls POST `/api/agent-lab/context/estate/sync-knowledge` — [src/components/estate/EstateCatalogTab.tsx:65-75](src/components/estate/EstateCatalogTab.tsx), [src/app/api/agent-lab/context/estate/sync-knowledge/route.ts:15-58](src/app/api/agent-lab/context/estate/sync-knowledge/route.ts). It is also exposed as a "Knowledge Sync" job — [src/views/agent-lab/estate/jobs.tsx:245,349,413](src/views/agent-lab/estate/jobs.tsx)
- **Nothing reads `knowledge_chunks`.** Grep for `knowledge_chunks|knowledge_sources|knowledge_source_agents` in code returns only `knowledge-sync.ts`, `artifactDraftSchemas.ts` and `prisma/schema.prisma`.
- `knowledge_source_ids` exists only as a zod field with the comment "Real knowledge source bindings (UUIDs from knowledge_sources table)" — [src/lib/agent-lab/artifactDraftSchemas.ts:22-23,155](src/lib/agent-lab/artifactDraftSchemas.ts). No other file references it.

**Indexes and DDL**
- Only seven migration files exist, and none is for the context or knowledge tables — `prisma/migrations/*` (glob). The only `.sql` file that mentions vector is `staging/init/00-extensions.sql`. Grep for `hnsw|ivfflat|vector(N)` in `*.sql`, `scripts`, `infra` and `staging` finds nothing.

### Inferences
- All pgvector searches (`<=>`) are sequential scans unless an index was created out-of-band in Aurora. `ORDER BY embedding <=> … LIMIT k` with an `org_id` filter and no org index on `platform_context_embeddings` will degrade linearly as the store grows.
- The "sub-5ms GIN" claim for `domain_keywords` ([src/lib/context/describe.ts:549-553](src/lib/context/describe.ts)) depends on an index that is not in the Prisma schema.
- **Semantic-card shadowing bug.** T3 appends an `'observed'` card containing only `{usage_patterns, key_columns}` as the newest version ([src/lib/context/usage.ts:406-425](src/lib/context/usage.ts)). Every reader takes the newest card by version without filtering on status:
  - `describeObject` — [describe.ts:383-387](src/lib/context/describe.ts)
  - `listObjects` — [describe.ts:290-301](src/lib/context/describe.ts)
  - `searchObjects` summaries — [describe.ts:793-804](src/lib/context/describe.ts)
  - `embedSubjects` — [embed.ts:172-182](src/lib/context/embed.ts)
  - knowledge-sync, which orders by `created_at` — [knowledge-sync.ts:281-285](src/lib/context/knowledge-sync.ts)

  So after T3 runs, the object summary and grain read as `''`. A re-embed would then overwrite the good vector with `"<path> (table): . Grain: . Key columns: …"`, because the embed text changed. This needs runtime confirmation (a DB check of `status='observed'` being the latest version).
- `usageObject` expects `card.usage_patterns` to be a string ([describe.ts:1088-1092](src/lib/context/describe.ts)), but T3 writes an array. `usage_narrative` is therefore always null.

### Gaps
- Actual Aurora DDL: whether vector indexes, a GIN index on `domain_keywords`, or a dimension constraint exist in deployed databases. This is unverified because no migrations for these tables are in the repo.
- Whether any `knowledge_chunks` rows exist in deployed databases. This is unverified; at most an older harvester image could have written them.

## 2. Embedding models and dimensions per path

### Takeaway
Catalog, memory, governed-intent, estate-briefing and semantic-context paths all use Bedrock Titan v2 (`amazon.titan-embed-text-v2:0`, 1024 dimensions, normalized) through `embedQuery`. The dormant knowledge-chunk path uses Azure OpenAI / Foundry `text-embedding-3-large` at 1024 dimensions. Its vectors are not comparable with the rest, and three labels and comments about it contradict each other.

### Cited Findings
- `TITAN_EMBED_MODEL='amazon.titan-embed-text-v2:0'` and `DEFAULT_EMBED_DIMS=1024`. `embedWithTitan` sends `{inputText: text.slice(0,32000), dimensions, normalize:true}`. Bulk concurrency is `EMBED_BULK_CONCURRENCY` (default 8, max 16). Auth is a bearer API key or the AWS SDK — [src/lib/azure/embed-client.ts:11-103](src/lib/azure/embed-client.ts)
- `embedWithFallback` is **Azure/Foundry only**, despite its name: `text-embedding-3-large` by default, input truncated to 8000 characters, labelled `openai/<deployment>`. It has no Titan fallback — [src/lib/azure/embed-client.ts:6-9](src/lib/azure/embed-client.ts), [src/lib/azure/embed-client.ts:136-179](src/lib/azure/embed-client.ts)
- `src/lib/knowledge/embed.ts` has the doc comment "Bedrock Titan v2 first, then Azure OpenAI / Foundry fallback", but it calls `embedWithFallback`, which is Azure only — [src/lib/knowledge/embed.ts:11-18](src/lib/knowledge/embed.ts)
- The knowledge-sync header says "with Bedrock embeddings", while the `knowledge_sources` row is labelled `embedding_model:'aloft_native'`. Both disagree with the code above — [src/lib/context/knowledge-sync.ts:10](src/lib/context/knowledge-sync.ts), [src/lib/context/knowledge-sync.ts:224](src/lib/context/knowledge-sync.ts)
- Catalog embed and query use `embedWithTitan` and `embedBulkWithTitan` with `EMBED_DIMS=1024`. `CURRENT_EMBEDDING_MODEL = TITAN_EMBED_MODEL` — [src/lib/context/embed.ts:1-20](src/lib/context/embed.ts), [src/lib/context/embed.ts:74-100](src/lib/context/embed.ts), [src/lib/context/embed.ts:271-274](src/lib/context/embed.ts)
- `embedQuery` (Titan) is used by:
  - memory retrieval — [src/lib/memory/retrieve.ts:439](src/lib/memory/retrieve.ts)
  - memory curate — [src/lib/memory/synthesis/curate.ts:243](src/lib/memory/synthesis/curate.ts)
  - teach — [src/lib/memory/teach.ts:104](src/lib/memory/teach.ts)
  - the curate API — [src/app/api/agent-lab/memory/[id]/curate/route.ts:91](src/app/api/agent-lab/memory/[id]/curate/route.ts)
  - intent embed and match — [src/lib/semantic/intent-embed.ts:44](src/lib/semantic/intent-embed.ts), [src/lib/semantic/intent-match.ts:160](src/lib/semantic/intent-match.ts)
  - semantic context — [src/lib/semantic/context-builder.ts:95](src/lib/semantic/context-builder.ts)
  - estate briefing — [src/app/api/agent-lab/context/estate-briefing/route.ts:75](src/app/api/agent-lab/context/estate-briefing/route.ts)
  - catalog search — [src/lib/context/describe.ts:666](src/lib/context/describe.ts)
- Only `searchObjects` filters stored vectors by `model_id = CURRENT_EMBEDDING_MODEL` and reports index health (comparable vs other-model counts) — [src/lib/context/describe.ts:669-709](src/lib/context/describe.ts). Estate briefing and `buildSemanticContext` do not filter by `model_id` or `lifecycle` — [estate-briefing/route.ts:83-93](src/app/api/agent-lab/context/estate-briefing/route.ts), [context-builder.ts:101-111](src/lib/semantic/context-builder.ts)
- `platform_agent_memory` has no model_id column, so vector provenance is implicit — [prisma/schema.prisma:2234-2269](prisma/schema.prisma)
- A stale script comment still says "FOUNDRY embedding env for embed jobs" — [scripts/context/backfill-t2.ts:17](scripts/context/backfill-t2.ts)

### Inferences
- A unified knowledge base should standardise on Titan v2 at 1024 dimensions, with a `model_id` column on every vector table, and route `knowledge/embed.ts` through `embedWithTitan`. Otherwise chunk vectors cannot be blended with catalog or memory vectors.

### Gaps
- Whether Azure embedding env vars are set in deployed environments, which decides whether the knowledge-sync path would produce vectors or null-embedding rows. Unverified.

## 3. describe_schema: embed_text content, search ranking, actions

### Takeaway
Object embed text is `path (kind): summary. Grain: … Key columns: …`. Column embed text adds the description, role and up to 5 sample values (suppressed for PII). Search is hybrid: cosine similarity (with a 0.15 floor) blended 0.70 / 0.15 / 0.15 with keyword-array overlap and exact-name matches, plus a +0.05 entity-group boost. Only object vectors are searched; column vectors are written but never read. The dispatcher supports 7 actions, but the tool schema advertises only 5.

### Cited Findings
- `composeEmbedText`:
  - object: `${full_path} (${object_kind}): ${summary}. Grain: ${grain}. Key columns: ${keyCols}.`
  - column: `${path}.${name} (${dt}): ${description}. Role: ${role}. Sample values: ${top5}.`
  - top_k values are dropped when `pii_flag` is set.
  - [src/lib/context/embed.ts:40-70](src/lib/context/embed.ts), [src/lib/context/embed.ts:233-249](src/lib/context/embed.ts)
- Search pipeline in `searchObjects`:
  1. Keyword routing via `domain_keywords && tokens` (limit k×4, max 80) — [src/lib/context/describe.ts:565-602](src/lib/context/describe.ts)
  2. A Titan query vector and cosine top `k×3`, restricted to `subject_kind='object'`, active objects and the matching model id — [describe.ts:666-709](src/lib/context/describe.ts)
  3. ILIKE name matches on `full_path` / `object_name` — [describe.ts:713-734](src/lib/context/describe.ts)
  4. `rankCatalogCandidates` — [describe.ts:739-745](src/lib/context/describe.ts)
  5. A +0.05 boost for items outside the initial top-k that share an entity group with a top-k hit — [describe.ts:757-790](src/lib/context/describe.ts)
  6. A reason string from the card summary, up to 150 characters — [describe.ts:813-829](src/lib/context/describe.ts)
- Ranking formula: `MIN_SEMANTIC_SIMILARITY = 0.15`. With vectors: `0.7·sem + 0.15·kw + 0.15·exactName`. Without vectors: `0.65·kw + 0.35·exactName`. `k` defaults to 5, max 20 — [src/lib/context/search-ranking.ts:14-58](src/lib/context/search-ranking.ts), [describe.ts:657](src/lib/context/describe.ts)
- Dispatcher actions: `list, describe, profile, search, research, relations, usage`. `research` runs search with k≤5, then describe (first 20 columns) and relations (first 15) per candidate, plus a retrieval-health note — [src/lib/context/dispatch.ts:9-156](src/lib/context/dispatch.ts)
- The tool spec enum lists only `['list','describe','profile','search','relations']` (schema version "v1.3.0"). `research` and `usage` are not advertised to the model — [src/lib/inspector/prompts.ts:164-186](src/lib/inspector/prompts.ts)
- `describe` compact mode caps at 60 columns (a "~200–400 token budget"). It suppresses top_k for PII columns, adds a freshness block, and self-heals by enqueueing t0 or t2 jobs when stale — [src/lib/context/describe.ts:318-449](src/lib/context/describe.ts), [describe.ts:207-236](src/lib/context/describe.ts)
- `usage` reads `platform_context_usage` (top 10 of each list) and marks data stale after 8 days — [src/lib/context/describe.ts:1006-1095](src/lib/context/describe.ts)
- The Inspector system prompt tells the model to call `describe_schema action:'search'` first, with `connection:'synergy_dwh'`, and to steer users to "Run a knowledge harvest" when nothing is found — [src/lib/inspector/prompts.ts:29-63](src/lib/inspector/prompts.ts)

### Inferences
- Column vectors (`subject_kind='column'`) are paid for and never queried. A unified knowledge base could use them for column-level retrieval at no extra ingest cost.
- The connection parameter is mostly cosmetic for search. `searchObjects` ignores `connection` and searches the whole org ([dispatch.ts:65-75](src/lib/context/dispatch.ts)), while `describe`, `profile` and `list` scope by connection.

### Gaps
- Whether Bedrock or other providers enforce the input-schema enum, which decides whether the model can call `research` / `usage` at all. Unverified.

## 4. How the Inspector system prompt is assembled, and token budgets

### Takeaway
The system prompt is built per request from: base prompt (+ governed semantic block, capped at about 8000 characters) + all prior session insights (uncapped) + session knowledge (capped by counts and characters) + memory phases 0 and 1a. Memory phase 1b goes in as a synthetic assistant turn. Memory injection is off by default (`MEMORY_INJECT_ENABLED`). There is no global token budget.

### Cited Findings
- **Governed semantic context.** `buildSemanticContext(org.id, connectionId)` runs on every request; the code comment says "Resolve once at session init" — [src/app/api/inspector/chat/route.ts:215-226](src/app/api/inspector/chat/route.ts). It takes the first `governed` model, ranks governed entities by vector similarity to the **connection name** (not the user question), and keeps the top 10 — [src/lib/semantic/context-builder.ts:64-145](src/lib/semantic/context-builder.ts). It is formatted with `MAX_CHARS = 8000` and includes "REFUSE RATHER THAN GUESS" instructions and synonyms (max 6) — [src/lib/inspector/prompts.ts:373-451](src/lib/inspector/prompts.ts)
- **Assembly order.** `[basePrompt, insightsContext (harvested mode only), sessionKnowledgeContext].join('\n\n')` — [src/app/api/inspector/chat/route.ts:228-233](src/app/api/inspector/chat/route.ts)
- **Insights.** Every `studio_insights` row for the session is included, with no limit — [src/lib/inspector/prompts.ts:453-478](src/lib/inspector/prompts.ts)
- **Session knowledge block** (header "SESSION KNOWLEDGE … do not re-discover"): structured and narrative summaries (≤1200 characters each), task, up to 48 paths, up to 24 entities, up to 20 heuristics, and the last SQL (≤1200 characters) — [src/lib/inspector/session-knowledge-core.ts:452-500](src/lib/inspector/session-knowledge-core.ts), [src/lib/inspector/session-knowledge-store.ts:153-163](src/lib/inspector/session-knowledge-store.ts)
- **Memory injection** (`isMemoryInjectionEnabled('inspector')`):
  - The topic key comes from a substring match of the topic map against the first user message (≤500 characters).
  - The caller is resolved by email to get the personal lane.
  - Phases 0 and 1a are appended to the system prompt; phase 1b is unshifted as an assistant message.
  - Injections are recorded for attribution.
  - [src/app/api/inspector/chat/route.ts:239-310](src/app/api/inspector/chat/route.ts)
- **Flags:** `MEMORY_INJECT_ENABLED` must be `'true'` and `MEMORY_INJECT_CLASSES` is an allowlist — [src/lib/memory/retrieve.ts:17-25,108-111](src/lib/memory/retrieve.ts)
- **Memory budgets:** phase 0 HARD_RULE uses 200 tokens and at most 3 bullets (confidence ≥0.9, harmful ≥1). Phase 1a SCHEMA_MAP uses 600 tokens and at most 10. Phase 1b HEURISTIC / SOURCE_PREF / FAILURE_MODE uses 1200 tokens and at most 20. The personal lane adds 400 tokens and at most 5. Tokens are estimated as `chars/4` — [src/lib/memory/phases.ts:9-87](src/lib/memory/phases.ts), [src/lib/memory/retrieve.ts:64-69,98-100](src/lib/memory/retrieve.ts)
- **Phase 1b retrieval:** cosine over `platform_agent_memory`, filtered by org, class, ACTIVE status, rule type and visibility. Distance must be `< 0.35` in the legacy path, or `< 0.8` with a post-MMR relevance floor of 0.65 when `MEMORY_P1B_FULLPOOL` is on. Optional MMR (`MEMORY_MMR_ENABLED`, λ 0.7, 40 candidates). `lastUsedAt` is bumped — [src/lib/memory/retrieve.ts:419-576](src/lib/memory/retrieve.ts)
- **Format:** bullets are wrapped in `=== OPERATING MEMORY | phase:… ===` markers with no instruction firewall — [src/lib/memory/retrieve.ts:623-635](src/lib/memory/retrieve.ts). The audit flags this as S13 (prompt injection) — [docs/audits/business-ai-studio-current-state.md:607](docs/audits/business-ai-studio-current-state.md)
- **Other memory consumers:** the reflect tool `recall_memory` — [src/lib/inspector/reflect-tools.ts:576-577](src/lib/inspector/reflect-tools.ts) — and the boost eval runner's `selectMemory` — [src/lib/boost/runner.ts:112](src/lib/boost/runner.ts)
- **Commissioned agents** (`/api/agent-lab/agents/chat`):
  - The system prompt is `buildRuntimeSystemPrompt`, consisting of instructions, persona and declared datasources rendered as text lines, plus data rules — [src/lib/construction/prompts.ts:74-101](src/lib/construction/prompts.ts)
  - Only the `describe_schema` and `execute_tool` tools are allowed. Limits are 8 loops, 30 history messages and 8000 characters per message. There is no memory, session knowledge or semantic context — [src/app/api/agent-lab/agents/chat/route.ts:19-22,140-150](src/app/api/agent-lab/agents/chat/route.ts)
  - The construction state supports datasource `kind: 'kb'` and a placeholder `runtimeProvision.kbNamespace` (default null), but nothing resolves them — [src/lib/construction/constructionState.ts:26-31,51-53](src/lib/construction/constructionState.ts)

### Inferences
- Three kinds of knowledge reach the prompt by three mechanisms (system text, synthetic assistant turn, tool results), and nothing measures their combined size. The uncapped insights block and the per-request semantic block are the unbounded parts.
- Commissioned agents get no knowledge at all beyond whatever they look up with `describe_schema`. `kb` datasources are decorative.

### Gaps
- Real token sizes of the base prompt and typical session blocks. These were not measured; the code only records `contextChars` (see question 5).

## 5. Agent loop: tool result size, truncation, context measurement

### Takeaway
The Bedrock agent loop appends full tool-result strings to the conversation with no truncation, summarisation or pruning. `measureContext` only measures (system prompt length + JSON length of the messages) for metrics.

### Cited Findings
- `measureContext` returns `{contextMessages, contextChars}`, where `contextChars` is the system prompt length plus `JSON.stringify(messages).length` — [src/lib/inspector/agent-loop.ts:57-65](src/lib/inspector/agent-loop.ts). It is called each loop for `onLoopMetrics` — [agent-loop.ts:185,237-252](src/lib/inspector/agent-loop.ts)
- Tool results go into `toolResult.content[{text: toolResult}]` verbatim — [agent-loop.ts:307-312](src/lib/inspector/agent-loop.ts). Only the trajectory copy is truncated (output to 2000 characters, SQL to 120) — [agent-loop.ts:280-289](src/lib/inspector/agent-loop.ts)
- `maxTokens` is 4096 per call, and Anthropic thinking uses `budget_tokens` 1024. Optional prompt caching uses `cacheSystemPrompt` — [agent-loop.ts:83-91,143-181](src/lib/inspector/agent-loop.ts)
- SQL results are capped at 1000 rows inside `executeInspectorTool` — [src/lib/inspector/tools.ts:444](src/lib/inspector/tools.ts). `describe_schema` is routed to `handleDescribeSchema` — [tools.ts:482-484](src/lib/inspector/tools.ts)
- Foundry and xAI models use `dispatchAgentLoop` from `src/lib/inspector/providers/factory` (imported at [src/app/api/agent-lab/agents/chat/route.ts:7](src/app/api/agent-lab/agents/chat/route.ts)). Its truncation behaviour was not read (unverified).

### Inferences
- A `research` call with k=5 can return 5×(20 columns + 15 relations + card) of JSON inside one tool result, and it is carried forward every loop. A knowledge base that returns more text needs a result-budgeting layer at the `executeTool` seam.

### Gaps
- Behaviour of the provider-factory loop for non-Bedrock models. Not inspected.

## 6. UI and API surfaces for knowledge

### Takeaway
There is no knowledge-source management UI or CRUD API. "Knowledge" in the UI means the per-object Estate page (`ObjectKnowledgePage`), lifecycle badges based on `last_knowledge_sync_at` (which never advances in production), and the FOER memory panels.

### Cited Findings
- `ObjectKnowledgePage` renders the semantic card, columns, profile timeline, relationships, usage, freshness, embedding presence (`hasEmbedding` "Published lifecycle signal"), semantic model and data score — [src/components/estate/ObjectKnowledgePage.tsx:1-80](src/components/estate/ObjectKnowledgePage.tsx). It is mounted at [src/views/agent-lab/estate/object.tsx:5,205](src/views/agent-lab/estate/object.tsx)
- `HeroLifecycleBadge` shows "PUBLISHED" when `last_knowledge_sync_at` is set — [src/components/estate/HeroLifecycleBadge.tsx:8,63-66](src/components/estate/HeroLifecycleBadge.tsx). The estate table computes lifecycle from the same field — [src/components/estate/EstateTable.tsx:124,329](src/components/estate/EstateTable.tsx). Reads filter on it as well — [src/lib/context/reads.ts:1226-1228](src/lib/context/reads.ts)
- The memory UI includes MountPanel ("Schema map — Domain knowledge", "System prompt · domain knowledge") and ShelvesPanel topic lanes — [src/components/agent-lab/memory/MountPanel.tsx:466,603](src/components/agent-lab/memory/MountPanel.tsx), [src/components/agent-lab/memory/ShelvesPanel.tsx:13-18,174](src/components/agent-lab/memory/ShelvesPanel.tsx)
- Knowledge-adjacent API routes are under `src/app/api/agent-lab/context/**` (sources, objects, jobs, mappings, estate, sync-knowledge, estate-briefing), `src/app/api/agent-lab/memory/**`, `src/app/api/inspector/teach`, `src/app/api/inspector/memory/rules/**` and `src/app/api/inspector/semantic/**` (git status listing; glob). No route reads or writes `knowledge_sources` (grep in Section 1).

### Inferences
- Because `knowledge_sync` is a stub, the "Published" lifecycle state is unreachable through the Jobs path. The UI therefore suggests a knowledge-publishing step that does not exist.

### Gaps
- `web/src` was not separately searched beyond the e2e fixture that includes `last_knowledge_sync_at` ([web/e2e/fixtures.mjs:41](web/e2e/fixtures.mjs)).

## 7. Tenant / org scoping and RBAC on reads

### Takeaway
Everything is effectively single-tenant. The org comes from env (`DEFAULT_ORG_SLUG` or `DEFAULT_ORG_ID`), not from the caller. `describe_schema` has no user context at all. Most writes check only for a NextAuth session. Personal memory visibility is the only user-level read filter.

### Cited Findings
- `getDefaultOrg()` loads the org by `DEFAULT_ORG_SLUG` — [src/lib/platform/agents.ts:81-90](src/lib/platform/agents.ts). A second resolver uses `DEFAULT_ORG_ID` — [src/lib/org.ts:4-13](src/lib/org.ts). `getOrgId()` wraps the first — [src/lib/databricks/connections.ts:35-38](src/lib/databricks/connections.ts)
- The `describe_schema` dispatcher comment says "getDefaultOrg provides org scoping; no session context is consulted" — [src/lib/context/dispatch.ts:1-27](src/lib/context/dispatch.ts)
- `resolveConnectionName` and the connection lookups in `describe.ts` query `platformDatabricksConnection` with no `org_id` filter — [src/lib/context/describe.ts:129-150,184-187,247-251](src/lib/context/describe.ts). The same is true in `buildSemanticContext` — [src/lib/semantic/context-builder.ts:90-93](src/lib/semantic/context-builder.ts)
- The embedding upsert conflict key `(subject_kind, subject_id)` excludes org and rewrites `org_id` on conflict — [src/lib/context/embed.ts:119-132](src/lib/context/embed.ts)
- Personal memory: `selectMemoryAll` falls back to a no-user sentinel, so retrieval is org-visible only when the caller is unresolved — [src/lib/memory/retrieve.ts:547-576](src/lib/memory/retrieve.ts). The route resolves the caller by email — [src/app/api/inspector/chat/route.ts:251-260](src/app/api/inspector/chat/route.ts)
- Route auth style is `getServerSession` + `getDefaultOrg` with no permission check in:
  - confirm-semantic — [src/app/api/agent-lab/context/objects/[id]/confirm-semantic/route.ts:36,63](src/app/api/agent-lab/context/objects/[id]/confirm-semantic/route.ts)
  - memory curate — [src/app/api/agent-lab/memory/[id]/curate/route.ts:26,46](src/app/api/agent-lab/memory/[id]/curate/route.ts)
  - sources — [src/app/api/agent-lab/context/sources/route.ts:11,28](src/app/api/agent-lab/context/sources/route.ts)
  - teach — [src/app/api/inspector/teach/route.ts:84-87](src/app/api/inspector/teach/route.ts)
  - sync-knowledge — [src/app/api/agent-lab/context/estate/sync-knowledge/route.ts:16-27](src/app/api/agent-lab/context/estate/sync-knowledge/route.ts)

  Grep found no `resolveAuth`, `requirePermission` or `hasPermission` in these routes.
- Inspector chat ownership is log-only unless `INSPECTOR_AUTH_ENFORCE=true`. A single org is used for every user. Memory purge has no ownership check — [docs/audits/business-ai-studio-current-state.md:599-604](docs/audits/business-ai-studio-current-state.md)
- The only permission-gated knowledge governance is semantic promotion (admin / platform_admin) — [docs/audits/business-ai-studio-current-state.md:560](docs/audits/business-ai-studio-current-state.md)

### Inferences
- A unified knowledge base must add a caller-derived org and principal at the retrieval seam. Today, tool calls cannot pass one: `handleDescribeSchema` takes only the tool input. It also needs per-source ACLs (`knowledge_source_agents` is a ready-made binding table).

### Gaps
- Whether `rbac.ts` permission strings for knowledge or estate exist but are unused. Not searched.

## 8. Test coverage

### Takeaway
Ranking, keywords, the Titan bulk embedder, the memory personal lane and session knowledge have unit tests. The core retrieval and ingest modules (describe, dispatch, context embed, enrich, knowledge-sync, chunker, knowledge embed, memory phase 1b) have none. CI does not run the unit tests.

### Cited Findings
- Existing tests:
  - `src/lib/context/search-ranking.test.ts`
  - `src/lib/context/keywords.test.ts`
  - `src/lib/context/scope-match.test.ts`
  - `src/lib/azure/embed-client.test.ts` (tests `embedBulkWithTitan`, [lines 5-53](src/lib/azure/embed-client.test.ts))
  - `src/lib/memory/retrieve.personal-lane.test.ts` (mocks `embedQuery` → null, so phase 1b is untested, [line 35](src/lib/memory/retrieve.personal-lane.test.ts))
  - `src/lib/memory/reputation/engine.test.ts`
  - `src/lib/memory/synthesis/validate.negative-existence.test.ts`
  - `src/lib/inspector/__tests__/session-knowledge.test.ts`
  - `session-knowledge-llm.test.ts`
  - `reflect-tools*.test.ts`
  - `teach-*.test.ts`
  - `src/lib/semantic/__tests__/*`

  (glob of `src/lib/**/*.test.ts`)
- Grep of test files for imports of `context/(describe|dispatch|embed|knowledge-sync|enrich)`, `knowledge/(chunker|embed)` or `memory/retrieve` finds only the personal-lane test.
- "CI builds images and deploys. It does not run the ~82 unit test files" — [docs/audits/business-ai-studio-current-state.md:637](docs/audits/business-ai-studio-current-state.md)

### Inferences
- The T3 card-shadowing issue (Section 1) and the schema-enum mismatch (Section 3) are the kind of regressions an integration test around `describeObject` and `handleDescribeSchema` would catch.

### Gaps
- The e2e coverage in `web/e2e` was not assessed beyond the fixture.

## 9. Gaps, duplication, contradictions, dead code

### Takeaway
The repo already has a good harvested-catalog knowledge graph with hybrid retrieval, plus a feedback-scored memory store. The "Knowledge" tables are a dormant parallel design that uses a different embedding provider. Build the unified knowledge base by extending `platform_context_*` and the `platform_agent_memory` retrieval patterns, and by reviving `knowledge_sources` / `knowledge_chunks` only as the document and chunk layer on Titan.

### Cited Findings
- **Dead or stub code:**
  - The `knowledge_sync` orchestrator stub returns success — [scripts/context/orchestrator.ts:349-355](scripts/context/orchestrator.ts)
  - `knowledge-sync.ts` is never imported (grep)
  - `knowledge_source_ids` is never consumed — [src/lib/agent-lab/artifactDraftSchemas.ts:22-23](src/lib/agent-lab/artifactDraftSchemas.ts)
  - `kbNamespace` is always null — [src/lib/construction/constructionState.ts:51-53](src/lib/construction/constructionState.ts)
  - `PDF_EXTRACTION_AVAILABLE=false`, and `.pdf` returns a placeholder string — [src/lib/knowledge/chunker.ts:1-2,57-59](src/lib/knowledge/chunker.ts)
  - Column embeddings are never searched (Section 3)
  - `compressSchemaMaps`, `runDag` and workbench / commissioned-agent memory injection are not wired — [docs/audits/business-ai-studio-current-state.md:554](docs/audits/business-ai-studio-current-state.md)
- **Duplication:**
  - Embed-job logic exists in both `runEmbedJob` and the orchestrator — [src/lib/context/embed.ts:291-366](src/lib/context/embed.ts), [scripts/context/orchestrator.ts:250-294](scripts/context/orchestrator.ts)
  - Three separate pgvector query sites for `platform_context_embeddings` follow different rules on model and lifecycle (Section 2)
  - Two org resolvers (Section 7)
  - Two chunk-size conventions: the chunker uses fixed 2048 / 200 characters ([src/lib/knowledge/chunker.ts:11-13](src/lib/knowledge/chunker.ts)), while `knowledge_sources.chunk_size/chunk_overlap` defaults to 512 / 64 and is ignored ([prisma/schema.prisma:1414-1415](prisma/schema.prisma))
  - Session knowledge and memory SCHEMA_MAP both store "confirmed table paths"
- **Contradictions:**
  - `knowledge/embed.ts` comment vs code — [src/lib/knowledge/embed.ts:11-17](src/lib/knowledge/embed.ts)
  - knowledge-sync "Bedrock embeddings" vs Azure code vs the `aloft_native` label — [src/lib/context/knowledge-sync.ts:10,224](src/lib/context/knowledge-sync.ts)
  - "Resolve once at session init" vs per-request — [src/app/api/inspector/chat/route.ts:216](src/app/api/inspector/chat/route.ts)
  - The tool schema has 5 actions vs 7 in the dispatcher — [src/lib/inspector/prompts.ts:174](src/lib/inspector/prompts.ts), [src/lib/context/dispatch.ts:153-155](src/lib/context/dispatch.ts)
  - The usage-narrative type mismatch (Section 1)
  - The "GIN index" comment vs a schema with no index — [src/lib/context/describe.ts:551](src/lib/context/describe.ts), [prisma/schema.prisma:1864](prisma/schema.prisma)
- **Hard-coding:** session knowledge regex-matches only the catalogs `landing_zone|curated_db|reporting_layer|raw_db|synergy_dwh` and hard-codes the vessel names `EPIC RADIANCE` / `EMPRESS ZONDA` — [src/lib/inspector/session-knowledge-core.ts:42-45](src/lib/inspector/session-knowledge-core.ts), [src/lib/inspector/session-knowledge-store.ts:117-125](src/lib/inspector/session-knowledge-store.ts). The prompts hard-code `synergy_dwh` — [src/lib/inspector/prompts.ts:37](src/lib/inspector/prompts.ts)
- **Freshness mechanisms:**
  - Catalog: tier timestamps, self-healing enqueue on describe, and the embed-text change check
  - Usage: 8-day stale flag
  - Memory: `lastUsedAt`, helpful/harmful counters, `valid_until`
  - Session knowledge: per-turn rewrite
  - Knowledge chunks: `last_knowledge_sync_at < last_t2_at` comparison (unused)

  Sources: [describe.ts:207-236,426-433](src/lib/context/describe.ts), [describe.ts:1006-1065](src/lib/context/describe.ts), [prisma/schema.prisma:2241-2253](prisma/schema.prisma), [knowledge-sync.ts:264-267,401-409](src/lib/context/knowledge-sync.ts)
- **Pipeline issues relevant to knowledge freshness:** the chain stops on `partial` (P0-6); embed ignores Focus (P1-2); stub success (P1-4 / P1-19) — [docs/audits/harvest-job-pipeline-issues.md:92-121](docs/audits/harvest-job-pipeline-issues.md)
- The current-state audit says the same thing about where to build: "A future 'Business AI Studio' should call these modules, not reimplement a semantic layer or a memory store beside them" — [docs/audits/business-ai-studio-current-state.md:527](docs/audits/business-ai-studio-current-state.md)

### Inferences
- Recommended reuse seams:
  1. `embedQuery` / `embedWithTitan` as the single embedder.
  2. The `rankCatalogCandidates` hybrid pattern, generalised to chunks.
  3. `formatForInjection`-style phased, budgeted injection, with delimiter hardening.
  4. `knowledge_source_agents` for agent ↔ source binding, consumed by `buildRuntimeSystemPrompt` and a new tool action.
  5. The `executeTool` seam for result budgeting.
- Fix before building on it:
  - T3 card shadowing (filter readers to `status IN ('assumed','certified',…)` or store T3 separately)
  - the orchestrator `knowledge_sync` stub
  - the `knowledge/embed.ts` provider
  - a unique key on `knowledge_chunks (source_id, doc_ref, chunk_index)`
  - vector and org indexes

### Gaps
- Whether `semantic.status` takes values other than `assumed` / `observed`, such as `certified` via confirm-semantic. Not read in detail.
- Marcus reflections' relationship to memory synthesis (`src/lib/memory/synthesis/reflect.ts`). Its grep matches name the dal functions; not read.
- The platform_sem_* model columns ([prisma/schema.prisma:2424-2535](prisma/schema.prisma)) and the compiler internals were not inventoried beyond their use in the prompt.
