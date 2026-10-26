# Build ALOFT one typed, governed knowledge harness

ALOFT D360 does not need a new document RAG system. It needs one **typed analytics knowledge base**: catalog structure, semantic cards, usage patterns, governed metrics, verified queries, column values, scoped instructions, documents and agent memory. Each type gets its own trust tier and retrieval policy. All of them sit behind a single retrieval service on the Aurora + pgvector + Titan v2 stack the platform already runs. Most of the raw material exists today: the T0–T3 harvested catalog, the governed semantic layer, FOER memory and per-session working memory. What is missing is the harness around them. There is no shared index or ranking rules, no principal-aware tool contract, no global token budget, no instruction firewall, no verified-query or value-grounding store, and no evaluation loop. The evidence for this priority order is consistent. Text-to-SQL accuracy depends most on getting the right schema subset, then value grounding, then business definitions, then execution feedback, then in-domain verified examples. Dumping everything into the context window measurably hurts. Before any new retrieval code is written, ALOFT has to fix a set of defects that quietly corrupt what agents already see. The worst are these: a T3 job that overwrites good semantic cards with near-empty ones; no vector or org indexes anywhere in the repo; a "Knowledge Sync" job that reports success without doing anything; a tool schema that hides two of seven actions; system-prompt blocks with no cap; and tool results that are never truncated. Most of the published accuracy gains cited here come from vendors and small benchmarks of 11–40 questions. Treat them as direction, not as predictions for ALOFT, and build the evaluation harness in the same phase as the fixes.

## ALOFT already owns a knowledge base, split across six stores with no shared rules

The codebase has more knowledge machinery than its UI suggests. Six stores are live. Four hold the harvested catalog: `platform_estate_objects` for inventory, the `platform_context_*` family (objects, columns, profiles, semantics, usage), `platform_context_embeddings` for catalog vectors, and `platform_nl_intent_embeddings` for governed-metric vectors. The other two hold agent memory (`platform_agent_memory`) and per-session working memory, stored as a JSON key on `workbench_sessions.progress` (`prisma/schema.prisma:1840-1994`, `prisma/schema.prisma:2234-2269`, `src/lib/inspector/session-knowledge-core.ts:6-40`). A seventh store, `knowledge_sources` / `knowledge_chunks`, is fully modelled and has a writer library. **No production code imports that writer, and nothing reads the tables** (`src/lib/context/knowledge-sync.ts`, `prisma/schema.prisma:1401-1465`).

| Store | What it holds | Writer | Reader that reaches an agent | State |
|---|---|---|---|---|
| `platform_context_objects/columns/profiles/usage` | T0 structure, T1 profiles, T3 usage | harvest orchestrator | `describe_schema` via `src/lib/context/dispatch.ts` | Live; no index on `domain_keywords` or column `org_id` |
| `platform_context_semantics` | Versioned T2 card (`summary, grain, key_columns, measures, pii_columns…`) | `src/lib/context/enrich.ts:23-59`, T3 `usage.ts:406-425` | `describeObject`, `listObjects`, `searchObjects`, `embedSubjects` | **Shadowed by T3 cards** (below) |
| `platform_context_embeddings` | Titan v2 1024-d vectors for objects and columns | `src/lib/context/embed.ts:108-263` | `searchObjects`, `buildSemanticContext`, estate briefing | No vector index, no org index; column vectors never read |
| `platform_nl_intent_embeddings` | Measure, dimension and chart intents | `src/lib/semantic/intent-embed.ts:30-90` | `matchIntents` (`intent-match.ts:150-215`) | Live |
| `platform_agent_memory` | FOER rules with helpful/harmful counts, validity, visibility | curate, refine, teach, attribution | `selectMemoryAll` + `formatForInjection` | Injection off by default; no `model_id`; no vector index |
| `workbench_sessions.progress.inspectorKnowledge` | Paths, entities, heuristics, summaries | rebuilt every turn (`session-knowledge-store.ts:50-86`) | Inspector system prompt | Live; hard-coded catalog and vessel regexes |
| `knowledge_sources/chunks` | Document chunks | `knowledge-sync.ts` (never called) | none | Dormant; Azure embedder; no unique key |

The retrieval logic that does exist is better than a first-generation RAG. `searchObjects` runs keyword-array routing, Titan cosine search filtered to the current embedding model and to active objects, and ILIKE name matching. It fuses them as `0.7·semantic + 0.15·keyword + 0.15·exactName` with a 0.15 similarity floor, then adds a +0.05 entity-group boost (`src/lib/context/search-ranking.ts:14-58`, `src/lib/context/describe.ts:565-829`). FOER memory has phased, budgeted injection with optional MMR (`src/lib/memory/phases.ts:9-87`, `src/lib/memory/retrieve.ts:419-576`). The current-state audit draws the right conclusion: future work "should call these modules, not reimplement a semantic layer or a memory store beside them" (`docs/audits/business-ai-studio-current-state.md:527`).

The problem is that the stores share no rules, and several defects corrupt what agents see. Take the **semantic-card shadowing bug**. T3 appends a new version of each object's semantic card with `status:'observed'` that contains only `{usage_patterns, key_columns}` (`src/lib/context/usage.ts:406-425`). Every reader takes the newest version without filtering on status (`describe.ts:290-301, 383-387, 793-804`, `embed.ts:172-182`). After T3 runs, summaries and grain therefore read as empty strings. Because the embed text has changed, the next embed run overwrites a good vector with `"<path> (table): . Grain: . Key columns: …"`. This needs a database check to confirm at runtime, but the code path is unambiguous. The other defects:

- **Indexes.** No HNSW or ivfflat index is defined anywhere in the repo, and only seven migrations exist, none for the context tables. Every `<=>` search is a sequential scan unless someone created an index out of band in Aurora.
- **Embedding upsert.** The upsert's conflict key `(subject_kind, subject_id)` leaves out the org, and it **rewrites `org_id` on conflict** (`embed.ts:119-132`).
- **Tool schema.** The `describe_schema` tool schema advertises five actions, but the dispatcher implements seven. `research` and `usage` are invisible to the model (`src/lib/inspector/prompts.ts:164-186` vs `dispatch.ts:9-156`).
- **Uncapped prompt content.** The Inspector system prompt includes **every** session insight with no cap (`prompts.ts:453-478`). It also ranks the governed semantic block by similarity to the connection *name* rather than the user's question, and rebuilds it on every request (`src/lib/semantic/context-builder.ts:64-145`, `src/app/api/inspector/chat/route.ts:215-226`).
- **Tool results.** The agent loop appends tool results verbatim, with no truncation (`src/lib/inspector/agent-loop.ts:307-312`). `measureContext` only measures character counts for metrics (`agent-loop.ts:57-65`).
- **Knowledge Sync.** The orchestrator marks `knowledge_sync` jobs as succeeded while doing nothing (`scripts/context/orchestrator.ts:349-355`). The UI's "Published" lifecycle badge depends on a timestamp that job never sets, so the state is unreachable (`src/components/estate/HeroLifecycleBadge.tsx:63-66`).
- **Org scoping.** It comes from environment variables, not the caller. The `describe_schema` dispatcher states that "no session context is consulted" (`dispatch.ts:1-27`).
- **CI.** CI builds and deploys but does not run the roughly 82 unit tests (`docs/audits/business-ai-studio-current-state.md:637`). No test covers describe, dispatch, embed, enrich or memory phase 1b.

Commissioned agents get even less. `buildRuntimeSystemPrompt` renders declared datasources as text lines, only `describe_schema` and `execute_tool` are allowed, and no memory, session knowledge or semantic context is injected (`src/lib/construction/prompts.ts:74-101`, `src/app/api/agent-lab/agents/chat/route.ts:19-22,140-150`). A `kb` datasource kind and a `kbNamespace` field exist but are always null (`src/lib/construction/constructionState.ts:26-31,51-53`).

## The right knowledge base is typed analytics context, not a document store

The most consistent finding across vendors and research is that analytics copilots work best on a **typed** knowledge model, where each artifact type has its own retrieval policy and quota. A single pile of chunked text performs worse. Databricks Genie's response context lists UC table metadata with PK/FK relationships, filtered column descriptions, an agent-scoped knowledge store (synonyms, joins, SQL expressions for measures and filters), entity-matched values, selectively retrieved example SQL, SQL functions and a small set of plain-text instructions ([Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/genie-agents/concepts); [Databricks](https://docs.databricks.com/aws/en/genie-agents/tune-quality)). Snowflake Cortex Analyst, Looker, Quick Sight and Fabric converged on the same set: descriptions and synonyms, a business-logic model, always-on instructions, and verified question→query pairs retrieved by similarity ([Snowflake](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository); [Microsoft Learn](https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices); [AWS](https://docs.aws.amazon.com/quick/latest/userguide/topics-natural-language.html)). Databricks' official guidance ranks **SQL expressions first, complete example SQL second, and text instructions "only as a last resort"**, warning that too many instructions reduce effectiveness ([Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/genie/best-practices)).

The academic ablations rank what matters in the same order. CHESS lost **6.12 points without table selection**, 4.76 without entity and context retrieval, and **6.80 without execution-based revision**. On a 4,337-column schema, its schema selector gave +2% accuracy at about **5× fewer tokens** ([CHESS](https://arxiv.org/html/2405.16755v3)). On enterprise-scale Spider 2.0, wrong schema linking was the largest error class at **27.6%**. Generic few-shot examples from unrelated databases barely helped (5.68% → 6.76% at 3-shot) ([Spider 2.0](https://arxiv.org/html/2411.07763v2)). The combined ranking is: correct schema subset, then value grounding, then business definitions, then execution feedback, then *in-domain* verified examples. Databricks' worked example points the same way. On 13 questions, accuracy went from 0% with only data objects, to 54% after metadata, joins and value matching, to **77% after example SQL** ("the largest single accuracy improvement"), to 100% after instructions ([Databricks Blog](https://www.databricks.com/blog/how-build-production-ready-genie-spaces-and-build-trust-along-way)). That is one vendor's demo, but the order matches CHESS.

ALOFT's governed semantic layer (`platform_sem_*`, `src/lib/semantic`) is its strongest asset for KPI-grade answers. dbt's 2026 open rerun on the ACME Insurance benchmark found modern LLMs reaching **84–90% with text-to-SQL vs 98–100% with a semantic layer** on modeled data. The more durable difference was how each fails: "With text-to-SQL, failure looks like a plausible but incorrect answer. With the Semantic Layer, failure looks like an error message" ([dbt](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026)). The existing "REFUSE RATHER THAN GUESS" governed block (`prompts.ts:373-451`) already follows this. The knowledge base should therefore route governed-metric questions to governed definitions first, and use retrieved catalog context only as the fallback.

### Eleven knowledge types, each with its own store, trust tier and retrieval mode

| # | Knowledge type | Authoritative store | Writer | Retrieval mode | Default trust |
|---|---|---|---|---|---|
| 1 | Catalog structure (tables, columns, types, PK/FK) | `platform_context_objects/columns` | T0 harvest | Tool (`kb_search` → `kb_get`) | system |
| 2 | Semantic cards (summary, grain, measures, PII) | `platform_context_semantics` (assumed → certified) | T2 LLM, human confirm | Tool; summary in search snippets | assumed until confirmed |
| 3 | Usage patterns (joins, filters, co-objects, popularity) | `platform_context_usage` **only** | T3 | Ranking prior + `kb_get` section | observed |
| 4 | Governed metrics and dimensions | `platform_sem_*` + `platform_nl_intent_embeddings` | semantic authors, promotion gate | Session-pinned block + `matchIntents` | governed |
| 5 | Verified queries (question + SQL) | **new** `kb_verified_queries` | thumbs-up capture, query-history mining, authors | Auto-retrieve top 3 per turn above a threshold | governed when verified |
| 6 | Column value index | **new** `kb_column_values` | T1 extension | Tool (`kb_values`) | system |
| 7 | Scoped instructions and glossary | **new** `kb_instructions` (scope = org, catalog, schema, table, metric) | authors | Injected only when an in-scope object is retrieved | governed |
| 8 | Documents (runbooks, policies, data dictionaries) | revived `knowledge_sources/chunks` on Titan | doc connector | Tool | external |
| 9 | Agent operating memory (FOER) | `platform_agent_memory` | synthesis sweep, teach | Existing phased injection | agent-inferred or user-asserted |
| 10 | Session working memory | `workbench_sessions.progress` | per-turn rebuild | Always-on, capped | session |
| 11 | Marcus reflections | `platform_marcus_reflections` | Marcus | **Never injected**; feeds error analysis | n/a |

Types 5, 6 and 7 are the gaps. Every vendor ships a verified-query store and value grounding, and both have measured effects. ALOFT has neither. Snowflake's verified-query schema (`question, sql, verified_by, verified_at, use_as_onboarding_question`) is ready to copy, and so is its rule that a verified query can either guide runtime or serve as evaluation ground truth, but never both ([Snowflake evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)). Genie's entity matching caps value lists at 120 columns × 1,024 distinct values of ≤127 characters each, and is blocked on tables with row filters or column masks ([Databricks](https://docs.databricks.com/aws/en/genie-agents/tune-quality)). Those limits are a sensible default for ALOFT's value index.

### Rejected alternatives, and why

**Bedrock Knowledge Bases** gained managed hybrid search over Aurora in April 2025 ([AWS](https://aws.amazon.com/about-aws/whats-new/2025/04/amazon-bedrock-knowledge-bases-hybrid-search-aurora-postgresql-mongo-db-atlas-vector-stores/)). It is still a poor fit for the catalog. The chunking strategy cannot be changed once a data source is connected, and its GraphRAG is S3-only with a graph you cannot customise ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-customize-ingestion.html); [AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-build-graphs.html)). It also cannot hold ALOFT's existing ranking signals, card trust states or FOER counters. It is a fallback option only for the document layer (type 8), and even there, keeping one embedder and one access-control path in-house is simpler.

**Neo4j, Neptune or LLM-extracted GraphRAG** win on global sensemaking over large unstructured corpora ([GraphRAG](https://arxiv.org/abs/2404.16130)). In a data catalog, though, the graph already exists explicitly: FK candidates, T3 `co_objects`, and lineage. A `kb_edges` table traversed with recursive CTEs after vector seeding covers this. Graph expansion on top of a hybrid retriever raised MuSiQue R@15 from 49.1 to 61.2 ([GEAR](https://aclanthology.org/2025.findings-acl.624.pdf)).

**ParadeDB BM25** is not on Aurora's supported-extension list ([AWS](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html)). ALOFT should use native `tsvector` plus `pg_trgm` and accept the weaker scorer.

**Full-context stuffing** is right for corpora under about 200k tokens with prompt caching ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)). It is wrong for a multi-catalog estate. Chroma found **~300-token focused prompts vastly outperform ~113k-token full prompts** on LongMemEval across all model families ([Chroma](https://research.trychroma.com/context-rot)). One exception is worth keeping: a single commissioned agent bound to one small, governed domain can carry its whole semantic model in a cached prefix.

### How strong the evidence is

| Claim the design relies on | Evidence | Strength |
|---|---|---|
| Schema selection and value grounding drive SQL accuracy | CHESS ablations; Spider 2.0 error analysis | Independent, peer-reviewed; benchmark, not enterprise traffic |
| Verified in-domain examples are the biggest single lever | Genie 13-question demo; Snowflake; Vanna | Vendor; small n |
| Semantic layers beat raw text-to-SQL, and fail safer | dbt 2026 (open, reproducible, 11 questions × 20 runs) | Vendor-run but reproducible; gap shrinking |
| Hybrid + rerank cuts retrieval failures 49–67% | Anthropic Contextual Retrieval | Vendor; not independently replicated |
| Shorter, focused context beats long context | Chroma, 18 models | Vendor research lab; broad and consistent |
| Memory can be poisoned with query-only access | MINJA (NeurIPS 2025), AgentPoison (NeurIPS 2024) | Peer-reviewed |
| Append-only memory can be worse than none | TEPA, StateFuse | 2026 preprints, abstract-level only |
| Public text-to-SQL gold labels are often wrong | PVLDB audit (52.8% BIRD Mini-Dev) | Peer-reviewed |

## One retrieval service, one embedder, one search projection on Aurora

The core decision is to put **one `KnowledgeRetriever` module** behind every agent's knowledge tools, backed by one search-projection table, `kb_index`. The authoritative stores stay where they are. Today, three separate query sites hit `platform_context_embeddings` under different rules: only `searchObjects` filters by `model_id`, and estate briefing and `buildSemanticContext` filter on neither model nor lifecycle (`describe.ts:669-709`, `context-builder.ts:101-111`, `src/app/api/agent-lab/context/estate-briefing/route.ts:83-93`). A projection table puts tenancy, model version, trust, lifecycle and access-control filtering in one place, at the cost of one more write path per source.

The alternative is to keep each store queryable on its own. That avoids duplication, but it repeats the current fragmentation for every new knowledge type. `platform_agent_memory` stays outside the projection because its feedback counters, phases and personal lane are a different lifecycle. It gets `model_id`, an HNSW index and the same trust labelling.

### The `kb_index` projection replaces three inconsistent vector query sites

Standardise on **Titan Text Embeddings v2 at 1024 dimensions**, which every live path already uses through `embedQuery` / `embedWithTitan` (`src/lib/azure/embed-client.ts:11-103`). Switching to Cohere Embed v4 would buy multilingual and multimodal support, but it would force a full re-embed, and the notes found no independent Titan-vs-Cohere comparison ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.html)). Defer that to a shadow-column experiment. Store vectors as `halfvec`, which halves index size "with near-zero recall loss" ([AWS](https://aws.amazon.com/blogs/database/scale-pgvector-with-binary-quantization-on-amazon-aurora-postgresql/)). Route `src/lib/knowledge/embed.ts` through Titan. Despite its comment, it currently calls an Azure-only `embedWithFallback` (`src/lib/knowledge/embed.ts:11-18`, `embed-client.ts:136-179`), which would produce vectors that cannot be compared with anything else in the platform.

```sql
CREATE TABLE kb_index (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  kind          text NOT NULL,      -- table|column|metric|dimension|verified_query|instruction|doc_chunk
  subject_id    text NOT NULL,      -- uuid or cuid2 of the authoritative row
  chunk_ix      int  NOT NULL DEFAULT 0,
  parent_id     uuid,               -- column -> table, chunk -> doc section
  title         text NOT NULL,      -- full_path, metric name, doc title
  body          text NOT NULL,      -- deterministic contextual header + content
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED,
  embedding     halfvec(1024),
  model_id      text NOT NULL,      -- 'amazon.titan-embed-text-v2:0'
  content_hash  text NOT NULL,
  source_version text,              -- card version, definition version, doc etag
  trust         text NOT NULL,      -- governed|system|observed|assumed|candidate|external
  status        text NOT NULL DEFAULT 'active',   -- active|deprecated|tombstoned
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_until   timestamptz,
  acl_groups    text[] NOT NULL DEFAULT '{org}',
  popularity    real NOT NULL DEFAULT 0,          -- from platform_context_usage
  fresh_at      timestamptz,                      -- last_t2_at / definition updated_at
  UNIQUE (org_id, kind, subject_id, chunk_ix)
);
CREATE INDEX ON kb_index USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 128);
CREATE INDEX ON kb_index USING gin (tsv);
CREATE INDEX ON kb_index USING gin (title gin_trgm_ops);
CREATE INDEX ON kb_index USING gin (acl_groups);
CREATE INDEX ON kb_index (org_id, kind, status);
ALTER TABLE kb_index ENABLE ROW LEVEL SECURITY; ALTER TABLE kb_index FORCE ROW LEVEL SECURITY;
CREATE POLICY kb_org ON kb_index USING (org_id = current_setting('app.org_id')::uuid);
```

The unique key includes `org_id`, which fixes the conflict-key flaw. Column rows (`kind='column'`) put the existing but never-queried column vectors to use at no extra ingest cost. `body` keeps `composeEmbedText`'s deterministic header (`embed.ts:40-70`). That header is Anthropic's Contextual Retrieval idea done from metadata, with no LLM call. Anthropic measured a **35% cut in top-20 failures from contextual embeddings alone and 49% with contextual BM25 added** ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)). LLM-written chunk context is worth paying for only on long free-text documents (type 8). Anthropic put that cost at about $1.02 per million document tokens with Haiku and prompt caching; Bedrock pricing has not been re-verified.

For documents, use **fixed-size, structure-aware chunks of about 300–450 tokens**. Vectara found semantic chunking's extra compute "is not justified by consistent performance gains" ([arXiv 2410.13070](https://arxiv.org/html/2410.13070)), and chunks under about 512 tokens avoid split billing on Bedrock rerank ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-pricing.html)). Expand to the parent section through `parent_id` at answer time. The current chunker's fixed 2048/200 characters, and the ignored 512/64 settings on `knowledge_sources`, should collapse into this single convention (`src/lib/knowledge/chunker.ts:11-13`, `prisma/schema.prisma:1414-1415`).

Two edge tables complete the store. `kb_edges(org_id, src_id, dst_id, type in ('fk','co_query','lineage','defines','derived_from'), weight, props)` is written from T2 `fk_candidates`, T3 `co_objects`, and semantic definitions that reference tables. `kb_verified_queries` and `kb_column_values` hold the two new artifact types:

```sql
CREATE TABLE kb_verified_queries (
  id uuid PRIMARY KEY, org_id uuid NOT NULL, question text NOT NULL,
  alt_phrasings text[] NOT NULL DEFAULT '{}',          -- 5–7 trigger phrasings (Power BI guidance)
  sql text NOT NULL, params jsonb, tables_used text[] NOT NULL,
  schema_hash text NOT NULL,                           -- hash of referenced columns at verification time
  status text NOT NULL,                                -- captured|candidate|verified|deprecated|benchmark
  origin text NOT NULL,                                -- thumbs_up|query_history|author|agent_proposal
  verified_by uuid, verified_at timestamptz, last_validated_at timestamptz,
  success_rate real, uses_30d int DEFAULT 0
);
CREATE TABLE kb_column_values (
  org_id uuid NOT NULL, column_id uuid NOT NULL, value text NOT NULL CHECK (length(value) <= 127),
  value_norm text NOT NULL, freq bigint, PRIMARY KEY (column_id, value)
);
CREATE INDEX ON kb_column_values USING gin (value_norm gin_trgm_ops);
```

The verified-query lifecycle follows the vendors, where every documented path to "trusted" includes a human step. Auto-capture puts a query in `captured`. Re-execution and a liveness check move it to `candidate`. Human approval moves it to `verified`. Holding it out of runtime makes it `benchmark`. WrenAI's auto-store of successful pairs skips the review gate ([WrenAI](https://github.com/Canner/WrenAI/blob/5fd88706/docs/core/get_started/quickstart.md)), and given MINJA ALOFT should not copy that. Seed candidates from Databricks query history, filtered to SELECTs over in-scope tables, the way Genie suggests "popular workspace queries" for author Accept/Reject ([Databricks](https://docs.databricks.com/aws/en/genie-agents/set-up)). Pinterest prioritises patterns with "98%+ success rate, high monthly usage" ([Pinterest](https://medium.com/pinterest-engineering/unified-context-intent-embeddings-for-scalable-text-to-sql-793635e60aac)), so `success_rate` and `uses_30d` belong in the ranking. A `schema_hash` mismatch against the current T0 columns automatically demotes a verified query to `candidate`. This is the "stale patterns from deprecated tables" failure Pinterest reports.

The value index must skip columns with `pii_flag`, reusing the PII suppression already in `embed.ts:233-249` and `describe.ts`. Like Genie, it must also skip any table with row filters or masks. Whether ALOFT's harvest sees UC row filters is **unverified**; until it does, restrict the index to string columns under the cardinality cap.

### Hybrid retrieval: RRF fusion, governance priors, selective reranking, one graph hop

Each `kb_search` call runs one SQL round trip inside a transaction:

```sql
BEGIN;
SET LOCAL app.org_id = $1;  SET LOCAL hnsw.iterative_scan = relaxed_order;  SET LOCAL hnsw.ef_search = 100;
WITH dense AS MATERIALIZED (
  SELECT id, embedding <=> $2 AS d FROM kb_index
  WHERE kind = ANY($3) AND status = 'active' AND model_id = $4 AND acl_groups && $5
  ORDER BY embedding <=> $2 LIMIT 60),
dense_r AS (SELECT id, row_number() OVER (ORDER BY d) r FROM dense WHERE 1 - d >= 0.15),
lex_r   AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) r
            FROM kb_index, websearch_to_tsquery('simple', $6) q
            WHERE tsv @@ q AND kind = ANY($3) AND status = 'active' AND acl_groups && $5 LIMIT 60),
name_r  AS (SELECT id, row_number() OVER (ORDER BY similarity(title, $6) DESC) r
            FROM kb_index WHERE title % $6 AND kind = ANY($3) AND status = 'active' LIMIT 20)
SELECT id, sum(w / (60.0 + r)) AS fused FROM (
  SELECT id, r, 1.0 AS w FROM dense_r UNION ALL
  SELECT id, r, $7  AS w FROM lex_r   UNION ALL      -- $7 = 1.5 for identifier-like queries, else 1.0
  SELECT id, r, 1.0 AS w FROM name_r) u
GROUP BY id ORDER BY fused DESC LIMIT 100;
```

`iterative_scan` is required here, not optional. pgvector filters *after* the approximate scan, so with the default `ef_search=40` a filter matching 10% of rows returns about **4 rows**. Tenant and ACL filters are exactly that kind of filter ([pgvector](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)). AWS measured pgvector 0.8.0's iterative scans cutting filtered p99 from 123 ms to 13 ms. That is a vendor benchmark ([AWS](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/)). AWS's other advice also applies: "If you don't need a vector index, don't use it." Measure row counts first, because at a few thousand objects a sequential scan is exact and fast.

`ts_rank_cd` is not BM25. It has no corpus IDF and no length saturation. It is good at exact identifiers such as table names and error codes, which is why the lexical weight rises for identifier-like queries. This replaces the current linear blend with RRF at k=60, because RRF is scale-free across scorers. Keep the existing 0.15 similarity floor and the entity-group boost.

After fusion, the harness applies governance priors, following Pinterest's "governance-aware ranking" that fuses similarity with tier, freshness, ownership and documentation completeness:

**final = fused_norm × trust_w × fresh_w × (1 + 0.1·log₁₀(1 + popularity))**

| Factor | Values |
|---|---|
| `trust_w` | governed 1.0, system 0.95, observed 0.9, assumed 0.8, external 0.7, candidate 0.6 |
| Excluded entirely | deprecated and tombstoned rows |
| `fresh_w` | 1.0 inside the source's freshness SLO, otherwise 0.85 |

These weights are engineering starting points, not published values. They exist to be tuned on the golden set described below.

Reranking is the highest-leverage step after hybrid retrieval: it took Anthropic's failure reduction from 49% to **67%** ([Anthropic](https://www.anthropic.com/news/contextual-retrieval)). Use Bedrock `cohere.rerank-v3-5:0`, which is available in us-east-1, unlike `amazon.rerank-v1:0`. It costs $2 per 1,000 queries, with up to 100 documents billed as one query ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-supported.html); [AWS pricing](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-pricing.html)). A third-party benchmark puts its average latency at about **392 ms** ([Agentset](https://agentset.ai/rerankers/compare/voyage-ai-rerank-25-vs-cohere-rerank-35)).

Rerank only when it pays. Skip it when the top lexical or name hit is an exact `full_path` match. Otherwise rerank at most 50 candidates down to 20, then multiply by the priors. Voyage reports Cohere 3.5 *hurting* quality on top of a very strong first stage ([Voyage](https://blog.voyageai.com/2025/08/11/rerank-2-5/)), so ship reranking behind a flag and gate it on the golden set.

Finally, the harness does a one-hop expansion over `kb_edges` (FK and co-query edges) for table results. It adds at most three neighbours at half their parent's score, then applies MMR with λ=0.7, reusing the memory path's setting (`retrieve.ts:419-576`). Catalog search keeps hierarchical narrowing. Uber's intent agent narrows by workspace before RAG, and that "drastically narrow[s] the search radius" ([Uber](https://www.uber.com/us/en/blog/query-gpt/)). ALOFT's equivalent is `domain_keywords` routing plus the agent's bound sources, applied as a filter before the vector branch. This needs the GIN index the code comment already assumes (`describe.ts:549-553`).

**Proposed acceptance criteria for the retriever:**

- recall@5 ≥ 0.90 on the synthetic question-per-table set;
- no regression against the current `searchObjects` baseline on real Inspector questions;
- p95 latency ≤ 300 ms without rerank and ≤ 800 ms with it;
- zero cross-org rows in an RLS probe test that includes get-by-id paths.

## A 12k-token knowledge envelope with a cache-stable prefix

Today nothing measures the combined size of the four mechanisms that put knowledge into the Inspector prompt. The system prompt carries the base prompt, the governed block (8,000 characters), all insights (uncapped), session knowledge (count-capped) and memory phases 0/1a. Memory phase 1b goes in as a synthetic assistant turn, and tool results come back verbatim (`route.ts:228-310`). The fix is a `ContextCompiler` at the route seam. It owns a fixed **knowledge envelope**, orders blocks for KV-cache stability, and reports real token usage from Bedrock rather than the current `chars/4` estimate.

Cache order is not a micro-optimisation. Manus calls KV-cache hit rate "the single most important metric for a production-stage AI agent", with cached input at $0.30/MTok vs $3/MTok uncached on Claude Sonnet and a ~100:1 input:output ratio ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)). ALOFT already has `cacheSystemPrompt` in the loop (`agent-loop.ts:83-91,143-181`). It only pays off if the prefix stops changing on every request.

| Layer | Content | Budget (tokens) | Cache | Change from today |
|---|---|---|---|---|
| L0 | Base prompt, tool definitions, knowledge map (catalog/domain index, skill names) | ≤ 4,000 | Stable across sessions | Remove hard-coded `synergy_dwh` and vessel names (`prompts.ts:37`) |
| L1 | Governed semantic block: top 10 entities ranked by the **first user question** | ≤ 2,000 | Pinned per session; recompute only on topic shift | Today it is ranked by connection name and rebuilt every request |
| *cache breakpoint* | | | | |
| L2 | FOER memory: hard rules 200, schema map 600, heuristics 1,200, personal 400 | ≤ 2,400 | Per turn | Keep the existing budgets (`phases.ts:9-87`); move phase 1b out of the assistant role into a delimited data block |
| L3 | Verified-query matches (top 3 above threshold) + in-scope instructions | ≤ 1,600 | Per turn | New |
| L4 | Session knowledge (summaries, paths, last SQL) | ≤ 1,500 | Per turn | Already capped by counts; add a token cap |
| L5 | Session insights: latest 5 + one rolling summary | ≤ 500 | Per turn | Today uncapped (`prompts.ts:453-478`) |
| **Envelope** | | **≤ 12,000** | | |

Tool results get their own budget at the `executeTool` seam, which the audit already identifies as the right place to intervene. Defaults: **2,000 tokens for `concise` responses and 6,000 for `detailed`**, with a steering truncation message ("12 more columns; call kb_get with sections=['columns'] and offset=20") rather than silent cuts. Anthropic found concise formats used about a third of the tokens (72 vs 206) and that steering messages beat opaque truncation. Claude Code caps tool responses at 25,000 tokens ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).

SQL results return the row count, column list, a 20-row preview and a result handle that points at the row already stored in `studio_query_results`. Today up to 1,000 rows go straight into context (`src/lib/inspector/tools.ts:444`). This is Manus's "restorable compression": drop the content, keep the pointer.

Long sessions get two levers, both logged as memory writes because OpenAI flags summary poisoning as a risk ([OpenAI Cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)):

- **Soft limit, about 50k input tokens per call.** Clear tool results older than the last two turns and replace them with stubs that carry their handles. This mirrors OpenAI's `ToolOutputTrimmer`, and Anthropic calls tool-result clearing "one of the safest lightest touch forms of compaction" ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Hard limit, about 80k.** Summarise older turns into session knowledge.

These thresholds are judgement calls. The notes contain no published data quantifying compaction gains.

**Proposed acceptance criteria for the envelope:**

- p95 envelope ≤ 12k tokens;
- prompt-cache read ratio ≥ 70% of input tokens on turns 2 and later;
- no single tool result over 6k tokens;
- all of these visible per turn in `onLoopMetrics`.

## Five namespaced tools, with the principal supplied by the harness

The current `describe_schema` overloads seven actions into one tool, two of which the model cannot see. Its connection parameter is mostly cosmetic for search (`dispatch.ts:65-75`). Anthropic's guidance is to build few, purpose-built, namespaced tools, to prefer search over list, to return human-meaningful names instead of UUIDs, and to support a `response_format` ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)). Manus adds that the tool set should stay fixed within a session so the cache survives, which means masking tools rather than adding and removing them ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)).

The recommended contract has five `kb_` tools plus the existing SQL executor. During migration `describe_schema` stays as an alias that maps onto them.

```ts
type KbKind = 'table' | 'column' | 'metric' | 'dimension' | 'verified_query' | 'instruction' | 'doc';
type Trust  = 'governed' | 'system' | 'observed' | 'assumed' | 'candidate' | 'external';
type Fmt    = 'concise' | 'detailed';

// Search, then fetch. Returns refs plus short snippets, never full objects.
kb_search(i: { query: string; kinds?: KbKind[]; scope?: { catalog?: string; schema?: string; domain?: string };
               k?: number /* default 8, max 20 */; format?: Fmt }):
  { results: { n: number /* 0-indexed handle */; ref: string /* kb://table/<id> */; kind: KbKind; title: string;
               snippet: string /* ≤300 chars */; trust: Trust; asOf: string; stale: boolean; score: number }[];
    health: { comparableVectors: number; otherModelVectors: number }; note?: string };

kb_get(i: { refs: string[] /* ≤5, or result handles n */;
            sections?: ('columns'|'semantics'|'usage'|'relations'|'profile'|'definition'|'sql')[];
            offset?: number; format?: Fmt }): { items: KbObject[]; truncated?: string };

kb_values(i: { column_ref: string; text: string; k?: number /* default 5 */ }):
  { matches: { value: string; similarity: number; freq: number }[] };        // pg_trgm over kb_column_values

kb_related(i: { ref: string; edge_types?: ('fk'|'co_query'|'lineage'|'defines')[]; depth?: 1 | 2 }):
  { edges: { from: string; to: string; type: string; join_on?: string; weight: number }[] };

kb_propose(i: { kind: 'verified_query' | 'memory_rule' | 'card_correction'; payload: unknown;
                evidence_refs: string[] }): { proposal_id: string; status: 'candidate' };  // never writes live knowledge
```

The harness, not the model, supplies the security context. Every tool handler receives `ctx: { orgId, principalId, groups, agentId, sessionId, boundSourceIds }` from the authenticated route. Today `handleDescribeSchema` receives only the tool input, and connection lookups query `platformDatabricksConnection` with no org filter (`describe.ts:129-150,184-187,247-251`, `context-builder.ts:90-93`). For commissioned agents, `boundSourceIds` comes from the existing `knowledge_source_agents` binding table (`prisma/schema.prisma:1467-1519`) and from the construction state's `kb` datasources. That turns the decorative `kbNamespace` into a real filter, and `buildRuntimeSystemPrompt` gains the same L0–L5 compiler as Inspector.

`kb_get` should return chunks as Bedrock Converse `SearchResultBlock`s with `source = kb://<kind>/<id>#<chunk>` and citations enabled. Responses then carry structured `search_result_location` citations whose `cited_text` maps to a real span ([Bedrock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_SearchResultBlock.html); [Claude docs](https://platform.claude.com/docs/en/build-with-claude/search-results)). Keep the contextual header out of the cited block. The documented model list stops at Sonnet 4.5, while ALOFT's harvest default is `us.anthropic.claude-sonnet-4-6` (`src/lib/context/harvest-llm.ts:22-41`). **Support for the Inspector models is unverified.** The xAI and Foundry providers in `dispatchAgentLoop` need a numbered `[n]` convention with post-generation validation instead.

**Proposed acceptance criteria for the tool contract:**

- every dispatcher action appears in the tool schema;
- a tool-call-correctness eval reaches ≥ 0.9 on the golden trajectory set;
- redundant-call rate (same tool, same arguments, within one turn) stays under 5%.

## Governance: trust tiers decide what may speak as instruction

ALOFT's Inspector has the full "lethal trifecta": access to private data (Databricks), exposure to untrusted content, and a channel to communicate externally ([Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)). The untrusted content includes more than future documents. It includes harvested UC comments, T2 cards written by an LLM, and rules any user can teach. The external channel is any rendered link, chart or export. OWASP states plainly that RAG does not mitigate indirect injection and that "it is unclear if there are fool-proof methods of prevention" ([OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)). Memory poisoning does not need write access: MINJA exceeded **95% injection success with query-only access** ([MINJA](https://proceedings.neurips.cc/paper_files/paper/2025/file/42a97bbd9844d2bf68596730af80bcdf-Paper-Conference.pdf)), and AgentPoison reached 82% retrieval success at under 0.1% poisoning ([AgentPoison](https://arxiv.org/html/2407.12784)).

Today FOER bullets go into the system prompt between plain markers, with no firewall (`retrieve.ts:623-635`; audit S13). Meanwhile the first Entra login creates an `admin` (audit S1), so "trusted teachers" currently means everyone.

The governing rule should be **trust tier decides voice**. Only `governed` knowledge may appear in instruction voice: promoted semantic definitions, verified queries, scoped instructions and human-certified cards. Everything else, including system-derived structure, is rendered as data inside delimited and datamarked blocks with a declared provenance attribute, for example `<kb_data trust="assumed" source="kb://table/…">`.

Spotlighting is a mitigation, not a defence. Delimiters roughly halved attack success but "could be easily subverted". Datamarking and encoding did better at negligible task cost ([Spotlighting](https://arxiv.org/abs/2403.14720)). The architectural controls therefore do the real work:

- The privileged agent that can run SQL never sees raw external document text. Documents go through a quarantined summariser that returns structured fields (the Dual-LLM / context-minimisation patterns, [Willison](https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/)).
- Model output may not render remote images or arbitrary URLs.
- `kb_propose` can only create candidates.

| Tier | Examples | Voice in prompt | Who can promote into it |
|---|---|---|---|
| governed | Promoted metrics, verified queries, scoped instructions, certified cards | Instruction | `admin`/`platform_admin` via the existing promotion gate, after RBAC fix S1 |
| system | T0 structure, T1 profiles, values | Data | Harvest only |
| observed | T3 usage patterns | Data, ranking prior | Harvest only |
| assumed | T2 cards, synthesized FOER rules | Data | Synthesis → review queue |
| candidate | Captured queries, agent proposals, taught rules pending review | Not injected; personal lane only | Any user |
| external | Documents, wiki pages | Quarantined summary only | Source owner |

Knowledge lifecycle should use **invalidation, not deletion**. Zep's bi-temporal edges (`t_valid / t_invalid` plus system created/expired) preserve history while preferring new facts ([Zep](https://arxiv.org/abs/2501.13956)). The 2026 TEPA preprint reports append-only and last-write-wins memory scoring 0.210 under full world change, *below* no memory at 0.309, while keyed revocation scored 0.950 ([TEPA](https://arxivsignals.io/papers/2608.07429)). That is preprint-strength evidence, but it matches Zep's design. FOER already has `valid_from/until`, `version` and `status`. Add `superseded_by`, tie every memory and verified query to the object versions it depends on (`schema_hash`, definition version) so that T0 schema changes invalidate them, and run contradiction detection **before** deduplication. The governed-memory study found a dedup gate rejecting contradictory writes before the contradiction detector saw them ([arXiv 2606.24535](https://arxiv.org/html/2606.24535)).

When a document and the data disagree, surface both claims with provenance and let the agent abstain or ask, rather than silently picking one. Authority runs governed > certified card > observed usage > assumed card > external document > agent memory.

Consolidation should stay a background job ("sleep-time" in Letta's terms, [Letta](https://www.letta.com/blog/sleep-time-compute/)). `runSynthesisSweep` is the right engine, but it is currently triggered manually and `runDag` is not wired (`src/lib/memory/run-sweep.ts:168`; audit line 554). Schedule it nightly. Route any output that would become org-visible through the review queue. Personal-lane writes can stay on the hot path.

Tenancy and access control belong in the storage layer, not in prompts:

- **Row-level security.** RLS with `FORCE`, context set through `SET LOCAL` per transaction (session-scoped settings leak across pooled connections), and a non-owner role ([Render](https://render.com/articles/multi-tenant-rag-postgresql-pgvector); [AWS](https://aws.amazon.com/blogs/database/self-managed-multi-tenant-vector-search-with-amazon-aurora-postgresql/)).
- **Every read path.** The 2026 governed-memory study found that sub-tenant scope was not enforced on direct GET-by-id even where tenant isolation held. `kb_get` needs the same probe tests as `kb_search`.
- **Mirrored grants.** `acl_groups` should mirror the UC grants the end user holds, as Genie does by evaluating access "with each end user's own UC permissions" ([Databricks](https://docs.databricks.com/aws/en/genie-agents/set-up)). ALOFT executes SQL as a connection service principal (audit S4) and harvests no grants that the notes found, so **per-user catalog ACLs are a Phase 3 item that depends on a design decision**: on-behalf-of user tokens, or mirrored grants.
- **PII.** No primary source in the research gives tested patterns for redacting PII inside retrieved context. The existing `pii_flag` suppression in embed text and describe output is the right base, and it must extend to `kb_column_values` and to chunk bodies.

## Evaluation: measure retrieval before generation, and gate CI by segment

The most common mistake in RAG work is tuning generation before measuring retrieval ([Jason Liu](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)). For ALOFT, the cheapest first golden set is **question-per-table and question-per-column**. Generate 2–3 natural-language questions from each certified or assumed T2 card, and measure recall@5 and MRR of `kb_search` against the known source object. This can be built in days from data already in `platform_context_semantics`, and it directly targets schema linking, the main error class on Spider 2.0. It is biased toward easy lexical matches, so it needs two companions:

- **A real-query set.** Mine Inspector traffic and cluster it by topic (catalog or domain) and capability (aggregate, compare, trend, lookup, multi-hop), as Liu recommends.
- **An SQL gold set.** 50–150 SME-authored questions with expected SQL. Databricks recommends 10–20 to start and >80% before UAT ([Databricks](https://www.databricks.com/blog/how-build-production-ready-genie-spaces-and-build-trust-along-way)). ARES calibrates with about 150 human labels ([ARES](https://arxiv.org/html/2311.09476v2)).

Budget expert audit time. Public gold sets had **52.8% (BIRD Mini-Dev) and 62.8% (Spider 2.0-Snow) annotation errors** ([PVLDB](https://www.vldb.org/pvldb/vol19/p931-jin.pdf)), and Spider 2.0's own first validation pass found 45% of items in error ([Spider 2.0](https://arxiv.org/html/2411.07763v2)). An internal first draft will not be cleaner.

SQL scoring should be layered:

1. A parse and dry-run check.
2. **Focused result-set comparison**: order-insensitive unless ORDER BY matters, tolerant of extra columns, with numeric tolerance, as in Spider 2.0.
3. A FLEX-style LLM judge given full context, run only on mismatches and suspicious matches. FLEX raised agreement with experts from κ 62.0 under plain execution accuracy to **87.04** ([FLEX](https://arxiv.org/pdf/2409.19014v4.pdf)).
4. Human adjudication of disagreements.

Run gold and predicted SQL against pinned Delta time-travel versions, so gold results do not drift with live data. Run each question k=3–5 times and report **pass^k** next to pass@1. If a model succeeds 80% of the time per trial, it gives pass^8 of only 16.8% ([τ-bench](https://arxiv.org/abs/2406.12045); [sandtable](https://sandtable.dev/concepts/pass-k)), and business users see every run. Hold verified queries used as benchmarks out of runtime retrieval, per Snowflake's leakage rule.

Judges should be binary and cover one dimension each: groundedness, answer correctness, refusal-when-unanswerable, citation precision. The "God evaluator" has "never" worked well for Eugene Yan ([Eugene Yan](https://eugeneyan.com/writing/product-evals/)). Validate each judge on **≥ 50 expert labels**, reporting precision, recall and κ rather than raw agreement ([AlignEval](https://eugeneyan.com/writing/aligneval/); [Hamel Husain](https://hamel.dev/blog/posts/evals/)). Use a judge from a different model family than the generator to limit self- and family-preference bias ([arXiv 2508.06709](https://arxiv.org/html/2508.06709)). The harness already supports xAI and Groq providers (`harvest-llm.ts:22-41`). The boost eval runner (`src/lib/boost/runner.ts`) and the `/api/inspector/boost/*` routes are the natural host for this. The notes confirm only that they select memory (`runner.ts:112`), so check that they can carry these suites before committing to them.

CI gating follows Husain's three levels:

- **Every PR: deterministic assertions.** These include an integration test that `describeObject` never returns an `observed`-only card as the latest card, an RLS cross-org probe, and a schema-vs-dispatcher action parity test.
- **Nightly, with repeated trials: retrieval and SQL suites.** Gates are per segment, not aggregate. The build blocks if any guardrail cluster drops more than a threshold, even when the mean improves.
- **On demand: shadow indexes for embedding-model, chunking or ranking changes.** Write to a new column or table, build HNSW concurrently, compare recall, then switch the read path. Model upgrades "require full reindexing" ([AWS](https://aws.amazon.com/blogs/database/scale-pgvector-with-binary-quantization-on-amazon-aurora-postgresql/)).

None of this runs until CI executes the existing unit tests at all.

Production observability needs these pieces:

- **A `kb_retrieval_log`.** Each row records org, principal, agent, query hash, kinds, returned refs with scores and trust, rerank on or off, and latency. It is joined to the existing `tool_invocation_log`, which also needs an `org_id` (audit S11).
- **OpenTelemetry spans.** `retrieval` and `execute_tool` spans following the GenAI semantic conventions, wrapped in a thin helper because the conventions are still "Development" status ([OTel GenAI](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)).
- **Per-source freshness SLOs**: time since the last successful T0, T2 and embed, and the lag from a source change to it being indexed. No published standard exists, so ALOFT must set its own. A starting point is T0 ≤ 24 h and T2 + embed ≤ 72 h for objects with `uses_30d > 0`.
- **A specific feedback question.** "Did we answer the question correctly? Yes/No" in place of a generic thumbs-down ([Jason Liu](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)).
- **A trace viewer.** One page showing retrieved refs, the SQL, results and source links for any turn, which Husain says can be built "in less than a day".

Freshness is currently undermined by the harvest pipeline itself. The chain stops when a job ends `partial` (P0-6), embed ignores Focus (P1-2), and stub jobs report success (P1-4) (`docs/audits/harvest-job-pipeline-issues.md:92-121`).

## Fix twelve defects first, then build in four phases

Each of these defects either corrupts knowledge agents already receive, or would make any new retrieval layer untrustworthy. Fix them before Phase 1.

| # | Fix | Where | Why it comes first | Done when |
|---|---|---|---|---|
| 1 | Stop T3 shadowing: T3 writes only `platform_context_usage`; readers select the newest card with `status IN ('assumed','certified')`; fix the `usage_patterns` array-vs-string read | `src/lib/context/usage.ts:406-425`; `describe.ts:290-301,383-387,793-804,1088-1092`; `embed.ts:172-182` | Empties summaries and degrades vectors after every T3 run | DB check shows no empty-summary latest cards; regression test passes; affected objects re-embedded |
| 2 | Org-safe embedding upsert: conflict key includes `org_id` | `src/lib/context/embed.ts:119-132` | Can silently move vectors between orgs | Unit test; unique index migrated |
| 3 | Check-in SQL migrations for HNSW (embeddings, memory, intents), org B-trees, GIN on `domain_keywords`, declared dimension | `prisma/schema.prisma:1864,1954-1994,2234-2269`; `prisma/migrations` | No indexes exist in the repo; Aurora state unverified | `EXPLAIN` shows an index scan on an org-filtered query, or a measured decision to stay on seq scan |
| 4 | Tool schema parity: advertise `research` and `usage`, or remove them | `src/lib/inspector/prompts.ts:164-186`; `dispatch.ts:9-156` | The model cannot reach implemented capabilities | Parity test in CI |
| 5 | Cap insights and tool results; return SQL previews plus handles | `prompts.ts:453-478`; `agent-loop.ts:307-312`; `tools.ts:444` | Unbounded context; context rot and cost | Per-turn token metrics within budgets |
| 6 | Rank the governed semantic block by the question and pin it per session | `context-builder.ts:64-145`; `route.ts:215-226` | Wrong ranking key; breaks the prompt cache | Cache-read ratio reported; relevance spot-check |
| 7 | Memory firewall: delimited and datamarked data blocks; phase 1b out of the assistant role. Ship together with RBAC fix S1 before turning on `MEMORY_INJECT_ENABLED` | `src/lib/memory/retrieve.ts:623-635`; `src/lib/rbac.ts:19,167-182` | Taught rules become instructions; everyone is admin | Injection red-team set passes; new users are not admin |
| 8 | Caller-derived org and principal in the tool context; org filter on connection lookups | `dispatch.ts:1-27`; `describe.ts:129-150,184-187,247-251`; `context-builder.ts:90-93` | Retrieval has no identity | Handler signature takes `ctx`; cross-org probe test |
| 9 | Retire the `knowledge_sync` stub: finalize as `failed`/hidden, and redefine "Published" as "embedded with current model + certified card" | `scripts/context/orchestrator.ts:349-355`; `HeroLifecycleBadge.tsx:63-66`; `EstateTable.tsx:124,329` | The UI promises a step that never happens | No green DONE for no-op jobs; the badge reflects real state |
| 10 | Single embedder: `knowledge/embed.ts` → Titan; add `model_id` to memory | `src/lib/knowledge/embed.ts:11-18`; `prisma/schema.prisma:2234-2269` | Prevents an incomparable vector space | All vector rows carry `model_id` |
| 11 | Remove hard-coded catalogs and vessel names from session knowledge and prompts | `session-knowledge-core.ts:42-45`; `session-knowledge-store.ts:117-125`; `prompts.ts:37` | Breaks for any other estate | Derived from the harvested catalog |
| 12 | Run unit tests in CI; add integration tests for describe, dispatch, embed and memory phase 1b | CI workflow; audit line 637 | Every fix above can regress silently | CI fails on test failure |

Item 9 is a deliberate call against reviving `knowledge-sync.ts` as written. It serialises catalog objects into `knowledge_chunks` with an Azure embedder (`knowledge-sync.ts:71-445`). That would double-index content already in `platform_context_embeddings`, in an incompatible vector space. The document layer should come back later, for actual documents only. The harvest audit's P0-6 (chain stops on `partial`), P0-7 (T3 substring matching) and P1-2 (embed ignores Focus) should land alongside these, because they decide whether the knowledge base stays fresh and correct.

Several facts must be checked against deployed systems before any of this is scheduled, because the repo cannot answer them:

- the actual Aurora DDL: which vector, GIN and dimension constraints exist;
- whether any `knowledge_chunks` rows exist;
- whether Azure embedding environment variables are set;
- whether Bedrock enforces tool-schema enums;
- how the provider-factory loop truncates tool results for xAI and Foundry models;
- whether unused knowledge permission strings exist in `rbac.ts`;
- real token sizes of the base prompt;
- whether the EventBridge T4 schedule is enabled.

### The four build phases

| Phase | Scope | Builds on | Exit criteria |
|---|---|---|---|
| **1. Retrieval core and evaluation harness** | `kb_index` + RLS; projection writers for tables, columns, metrics and dimensions; `KnowledgeRetriever` with RRF + priors + MMR; `kb_search`/`kb_get` behind a `describe_schema` alias; `ContextCompiler` L0–L5; question-per-table golden set; trace viewer; `kb_retrieval_log` | `searchObjects`, `rankCatalogCandidates`, `embedSubjects`, `formatForInjection` | recall@5 ≥ 0.90 synthetic; no real-query regression; p95 envelope ≤ 12k; zero cross-org rows |
| **2. Verified queries, values and graph** | `kb_verified_queries` with capture → candidate → verified workflow and review UI; query-history seeding; `kb_column_values` + `kb_values`; `kb_edges` + `kb_related`; Cohere rerank behind a flag; SQL gold set (≥ 50 items) with focused comparison, FLEX judge and pass^k | T3 usage, T2 FK candidates, semantic promotion gate | SQL pass@1 and pass^3 baselines recorded; verified-query retrieval hit-rate measured; rerank kept only if it lifts recall@5 on the golden set |
| **3. Commissioned agents, documents and ACLs** | `knowledge_source_agents` → `boundSourceIds`; compiler for `buildRuntimeSystemPrompt`; document connector on Titan with 300–450-token structure-aware chunks and an LLM contextual prefix; quarantined summariser for external docs; citations via `SearchResultBlock` (after confirming model support); per-user ACL design (on-behalf-of token vs mirrored grants) | `knowledge_sources/chunks` schema with unique `(source_id, doc_ref, chunk_index)` | Commissioned-agent evals match Inspector on the same scope; citation precision ≥ 0.9 on doc questions; injection red-team passes with docs in scope |
| **4. Consolidation and lifecycle** | Nightly synthesis sweep; review queue for org-scope promotions; `superseded_by` + schema-hash invalidation; contradiction-before-dedupe; freshness SLO alerts; shadow-index workflow for embedding changes (e.g. a Cohere v4 trial) | `runSynthesisSweep`, FOER counters, `valid_until` | Knowledge-update eval (LongMemEval-style) passes; stale-pattern incidents traceable to a source version; no org-wide rule without an approver |

## Conclusion

ALOFT's knowledge problem is mostly harness engineering, not data. The platform already holds richer catalog knowledge than most vendor copilots expose: profiles, usage patterns and governed metrics. Its agents see a degraded and ungoverned slice of it, because nothing enforces model versions, card status, tenancy, budgets or trust when that knowledge enters a prompt. Dashboard features or a new document KB will not move accuracy much. The highest-return work is making existing knowledge arrive correct, scoped and small, then adding the two artifact types the evidence most consistently rewards: human-verified in-domain queries and column-value grounding.

The second implication is that trust tiers are the load-bearing abstraction. The same tier field decides how a candidate ranks, whether it may speak as instruction, who can promote it, when it goes stale, and what the eval suite must prove before a change ships. A team that designs the tiers first gets retrieval ranking, injection safety and curation workflows that are consistent with each other. A team that adds them last will rebuild all three. ALOFT should treat its first golden set and its first RLS probe as part of the knowledge base itself. Without them, no claim this report borrows from vendors can be confirmed for ALOFT's own estate.
