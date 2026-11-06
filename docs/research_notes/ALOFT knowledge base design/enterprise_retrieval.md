# Enterprise Retrieval (RAG) and Knowledge-Base Architecture for AI Agents (2024 – Oct 2026)

Scope: techniques, measured gains, and trade-offs for an analytics platform on Aurora PostgreSQL + pgvector, AWS Bedrock models, Databricks, with a TypeScript/Next.js backend. Research date: 24 Oct 2026. Vendor-authored benchmarks are flagged **[vendor]**.

## Chunking: fixed vs semantic vs structure-aware vs late chunking; Contextual Retrieval; parent-document retrieval

### Takeaway
Chunking strategy matters less than embedding quality and adding document context to each chunk. Semantic chunking rarely pays for its cost. Late chunking gives about 1.5–1.9 points of nDCG. Anthropic's Contextual Retrieval cut top-20 retrieval failures by 35% with embeddings only, 49% when contextual BM25 is added, and 67% when reranking is added too. It costs about $1 per million document tokens, using prompt caching.

### Cited Findings
- **Contextual Retrieval (Anthropic, 19 Sep 2024)** **[vendor]**: an LLM writes a 50–100 token context for each chunk, using the whole document as input, and that context is prepended to the chunk before both embedding and BM25 indexing — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- Measured on codebases, fiction, arXiv and science papers, with metric 1 − recall@20 and Gemini Text 004 embeddings: Contextual Embeddings reduced the failure rate by 35% (5.7% → 3.7%). Adding Contextual BM25 brought the reduction to 49% (→ 2.9%). Adding a Cohere reranker (top-150 reranked down to 20) brought it to 67% (→ 1.9%) — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- Cost: one-time cost of $1.02 per million document tokens, assuming 800-token chunks, 8k-token documents, Claude 3 Haiku and prompt caching — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- Anthropic tried adding generic document summaries to chunks and "saw very limited gains"; HyDE and summary-based indexing showed "low performance" in their evaluation. Passing 20 chunks to the model beat passing 10 or 5. Voyage and Gemini embeddings benefited most — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- If the knowledge base is under about 200k tokens (roughly 500 pages), Anthropic recommends putting all of it in the prompt with prompt caching instead of using RAG. Caching cuts latency by more than 2x and cost by up to 90% — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- **Semantic vs fixed-size chunking (Vectara, NAACL Findings 2025)**: the extra compute for semantic chunking "is not justified by consistent performance gains". Fixed-size chunking won on real (non-stitched) documents, for example HotpotQA document-retrieval F1@5 of 90.59 (fixed) vs 87.37 (breakpoint) vs 84.79 (clustering). Semantic chunking only won on artificially stitched, topic-diverse documents. Embedding quality mattered more than the chunker — [arXiv 2410.13070](https://arxiv.org/html/2410.13070); [ACL Anthology](https://aclanthology.org/2025.findings-naacl.114/)
- **Late chunking (Jina, Sep 2024)** **[vendor]**: the whole document is embedded with a long-context embedding model, and token embeddings are then mean-pooled per chunk. Averaged over 3 models and 4 BEIR datasets, nDCG@10 improved by 1.8 points absolute for fixed 256-token chunks (52.2 → 54.0), 1.9 points for sentence boundaries, and 1.5 points for semantic boundaries. Gains grow with document length. Chunk overlap "neither improves nor harms" results — [arXiv 2409.04701](https://arxiv.org/html/2409.04701v3); [jina-ai/late-chunking](https://github.com/jina-ai/late-chunking/)
- Late chunking needs access to token-level embeddings. Bedrock embedding APIs return only pooled vectors (see the request schemas below), so late chunking is not possible with Titan or Cohere through Bedrock — inferred from [Bedrock Cohere Embed v4 schema](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.html)
- **Parent-document / small-to-big**: Bedrock Knowledge Bases offers HIERARCHICAL chunking, where small child chunks are derived from larger parent chunks. It also offers FIXED_SIZE, SEMANTIC (breakpoint percentile, buffer size, max tokens) and NONE. The default is about 300 tokens, preserving sentence boundaries. The chunking strategy cannot be changed after the data source is connected — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-customize-ingestion.html)
- When Bedrock's GraphRAG is combined with hierarchical chunking, it returns only child chunks and does not swap in their parents — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-build-graphs.html)
- GraphRAG paper baseline: 600-token chunks with 100-token overlap — [arXiv 2404.16130](https://arxiv.org/abs/2404.16130)

### Inferences
- For catalog and analytics content (table and column descriptions, dashboards, metric definitions, runbooks), structure-aware units are the natural choice: one chunk per table, column group, or Markdown section. Each chunk should carry a contextual header (catalog.schema.table, owner, domain), which is Contextual Retrieval done deterministically from metadata without an LLM call.
- LLM-generated context is worth paying for on long free-text documents such as policies and wikis. With Claude Haiku on Bedrock plus prompt caching, the cost is close to Anthropic's figure, but current Bedrock pricing needs checking.
- A practical default: chunks of roughly 300–800 tokens, sent to the model as top-20 after reranking, with parent expansion (fetch the parent section by `parent_id`) done in SQL at answer time.

### Gaps
- I found no independent, peer-reviewed replication of the 49% and 67% Contextual Retrieval figures. Anthropic has not published its datasets beyond appendix examples.
- I found no rigorous public benchmark of structure-aware (Markdown, HTML, AST) chunking against fixed-size chunking on enterprise documents.

## Hybrid search: BM25 + dense with RRF; how to do it in Postgres; measured benefits

### Takeaway
Hybrid search (lexical + dense, fused with Reciprocal Rank Fusion at k=60) is the consensus baseline: in Anthropic's experiments, adding BM25 to contextual embeddings took the failure-rate reduction from 35% to 49%. True BM25 inside Postgres needs ParadeDB `pg_search`, which **Aurora does not support**. On Aurora, the options are native `tsvector`/`ts_rank_cd` fused with RRF in SQL, or Bedrock Knowledge Bases' managed hybrid search over Aurora.

### Cited Findings
- Anthropic's recipe: run BM25 and embeddings separately, then combine and deduplicate with rank fusion. "Embeddings+BM25 is better than embeddings on their own." BM25 catches exact identifiers such as "Error code TS-999" that embeddings miss — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- The pgvector README recommends pairing pgvector with Postgres full-text search (`tsvector`, `plainto_tsquery`, `ts_rank_cd`) and combining results with RRF or a cross-encoder — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- ParadeDB `pg_search` provides BM25 through `USING paradedb` indexes, the `|||` match operator, `pdb.score()`, field boosts, phrase and proximity search, and filter/facet pushdown. RRF is implemented in SQL as `weight/(60+rank)` summed across a text CTE and a vector CTE, and the examples weight vector results at 0.7 — [ParadeDB RRF](https://www.paradedb.com/docs/reference/hybrid/rrf); [ParadeDB blog](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)
- `pg_search` must be loaded through `shared_preload_libraries` and requires pgvector. Self-hosted installation is documented, and it supports PostgreSQL 15 and later — [ParadeDB self-hosted](https://www.paradedb.com/docs/operate/deploy/self-hosted/extension); [pg_search README](https://github.com/paradedb/paradedb/blob/main/pg_search/README.md)
- **`pg_search` is not on Aurora PostgreSQL's supported-extension list.** Aurora lists pgvector (0.8.2 on its latest PG17/18 minors), `pg_trgm` and `pg_bigm`. Aurora cannot install customer-built C extensions — [AWS Aurora extensions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html); [1bench summary](https://1bench.dev/extensions/postgresql/on-aws-aurora) (aggregator)
- Bedrock Knowledge Bases added hybrid search (semantic + full-text) for Aurora PostgreSQL vector stores on 10 Apr 2025. It was previously limited to OpenSearch — [AWS What's New](https://aws.amazon.com/about-aws/whats-new/2025/04/amazon-bedrock-knowledge-bases-hybrid-search-aurora-postgresql-mongo-db-atlas-vector-stores/)
- In a 2025 thesis comparing RAG variants, hybrid RAG improved response relevance and semantic adequacy on multi-hop sets but had slightly lower recall on single-hop sets — [DiVA thesis](https://www.diva-portal.org/smash/get/diva2:2002498/FULLTEXT01.pdf) (non-peer-reviewed)
- On multi-hop benchmarks, a hybrid single-step retriever beat BM25 and SBERT alone. On MuSiQue R@10, hybrid scored 46.3 vs BM25 38.5 and SBERT 37.9 — [GEAR, ACL Findings 2025](https://aclanthology.org/2025.findings-acl.624.pdf)

### Inferences
- On Aurora, store a generated `tsvector` column with a GIN index alongside a `halfvec` HNSW column, run both as CTEs with `RANK()`, and fuse them with RRF (k=60) in one SQL round trip. Postgres `ts_rank_cd` is not BM25: it has no corpus-level IDF and no length-normalization saturation. Expect it to work well for exact identifiers (table and column names, error codes) but to rank less well than real BM25. Weighting the lexical branch higher for identifier-like queries is a cheap heuristic.
- If true BM25 inside Postgres is required, the options are a separate self-managed or ParadeDB-hosted Postgres, or OpenSearch. Each adds an extra system to operate.
- `pg_trgm` (available on Aurora) helps fuzzy matching of identifiers, for example misspelled column names.

### Gaps
- I found no published benchmark comparing `ts_rank_cd` + RRF against true BM25 + RRF on the same corpus.
- I could not confirm which lexical scorer Bedrock Knowledge Bases' Aurora hybrid search uses internally.

## Reranking: cross-encoders (Cohere Rerank on Bedrock, Voyage, bge-reranker); cost, latency, gains

### Takeaway
Reranking the top 100–150 hybrid candidates down to about 20 is the highest-leverage step after hybrid search: it moved Anthropic's failure-rate reduction from 49% to 67%. On Bedrock, Cohere Rerank 3.5 costs $2 per 1,000 queries and Amazon Rerank 1.0 costs $1 per 1,000. Voyage rerank-2.5 and Cohere Rerank 4 rank higher in third-party leaderboards but are not documented as available on Bedrock.

### Cited Findings
- Anthropic's setup: rerank the top 150 candidates down to 20 with Cohere; this reduced the failure rate by 67% (from 49% without reranking). Reranking adds latency, and the number of candidates trades accuracy against cost — [Anthropic](https://www.anthropic.com/news/contextual-retrieval) **[vendor]**
- Bedrock Rerank models: `cohere.rerank-v3-5:0` (ap-northeast-1, ca-central-1, eu-central-1, us-east-1, us-west-2) and `amazon.rerank-v1:0` (ap-northeast-1, ca-central-1, eu-central-1, us-west-2; **not us-east-1**) — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-supported.html)
- Pricing: Cohere Rerank 3.5 costs $2.00 per 1,000 queries. One query covers up to 100 document chunks, so 350 documents bill as 4 queries. Documents longer than about 512 tokens (query plus document) are split and billed as more documents — [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/); [AWS rerank pricing](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-pricing.html)
- Amazon Rerank 1.0 costs $1.00 per 1,000 search units — [AI Model Watch](https://aimodelwatch.dev/models/amazon-rerank-v1) (aggregator citing the AWS Price List API)
- Voyage rerank-2.5 (11 Aug 2025) **[vendor]**: +7.94% over Cohere Rerank 3.5 averaged across 93 datasets, has a 32K-token context (8x Cohere 3.5), and follows instructions (+12.70% over Cohere 3.5 on the MAIR benchmark). Voyage also reports that Cohere 3.5 *hurt* quality when applied on top of the strongest first-stage retriever (voyage-3-large) — [Voyage blog](https://blog.voyageai.com/2025/08/11/rerank-2-5/)
- Third-party leaderboard (Agentset; 6 datasets; LLM-judge Elo): Zerank 2 1638, Cohere Rerank 4 Pro 1629, Voyage rerank-2.5 1544, Cohere Rerank 4 Fast 1510, Qwen3-Reranker-8B 1473, Cohere Rerank 3.5 1451, bge-reranker-v2-m3 1327 — [agentset-ai/reranker-eval](https://github.com/agentset-ai/reranker-eval)
- Latency in the same benchmark: Cohere 3.5 averaged 392 ms (p50 about 285–373 ms), Voyage 2.5 averaged 613 ms, and bge-reranker-v2-m3 averaged 2,383 ms (hosting-dependent) — [Agentset](https://agentset.ai/rerankers/compare/voyage-ai-rerank-25-vs-cohere-rerank-35); [Agentset bge](https://agentset.ai/rerankers/compare/voyage-ai-rerank-25-vs-baaibge-reranker-v2-m3)
- A small independent study (32 queries): reranking added a mean 31 ms (+65% retrieval latency) for a 6–8% accuracy gain over single-method search — [Zenodo](https://zenodo.org/records/20669912) (small sample)
- The pgvector README also suggests a cross-encoder as an alternative to RRF for fusing hybrid results — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)

### Inferences
- Default choice: Bedrock `Rerank` with Cohere 3.5, sending at most 100 candidates per call so each call bills as one query (about $0.002 per user query). Keep chunks under about 450 tokens to avoid billing splits. Budget roughly 300–400 ms.
- For agent tool calls that fire many retrievals per turn, rerank only the final candidate set, or skip reranking for high-precision lexical hits (exact table names).

### Gaps
- I found no AWS documentation listing Cohere Rerank 4 or Voyage rerankers as Bedrock models as of Oct 2026; Voyage is available through SageMaker or its own API. This needs confirming against the live Bedrock model catalog.
- I found no published latency figures for the Bedrock Rerank API specifically.

## Embedding models on Bedrock; dimensions; Matryoshka; pgvector HNSW tuning; iterative scans and filtered-search pitfalls

### Takeaway
On Bedrock, use Cohere Embed v4 (256/512/1024/1536 Matryoshka dimensions, multimodal, 128k context, int8/binary outputs) or Titan Text Embeddings V2 (256/512/1024; 8k tokens). 1024 dimensions stored as `halfvec` is a safe pgvector default, and Titan reports 512 dimensions keep about 99% of 1024-dim accuracy. Aurora ships pgvector 0.8.x: enable `hnsw.iterative_scan` for any filtered, tenant-scoped, or ACL-scoped query, or top-k results will silently come back short.

### Cited Findings
- **Cohere Embed v4 on Bedrock** (`cohere.embed-v4:0`): text, image and interleaved input; `output_dimension` of 256, 512, 1024 or 1536 (default 1536); `embedding_types` of float, int8, uint8, binary or ubinary; up to about 128k tokens per input; 96 inputs per call; `input_type` must be `search_document` or `search_query` — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.html); [Cohere changelog](https://docs.cohere.com/changelog/embed-multimodal-v4)
- **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`): 8,192 tokens or 50,000 characters; outputs 1024 (default), 512 or 256 dimensions; `normalize` defaults to true. Officially English, with "100+ languages in preview". Throttling is per request, not per token, so batch with care — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- AWS reports **[vendor]** that 512 dimensions keep about 99% and 256 about 97% of 1024-dim accuracy, so 256 dimensions save 75% of storage — [AWS News Blog](https://aws.amazon.com/blogs/aws/amazon-titan-text-v2-now-available-in-amazon-bedrock-optimized-for-improving-rag/)
- Other Bedrock embedding models: `cohere.embed-multilingual-v3` (1024 dimensions) and `amazon.nova-2-multimodal-embeddings-v1:0` (256/384/1024/3072 dimensions; text, image, video, audio; noted as us-east-1 only) — [Meilisearch docs](https://www.meilisearch.com/docs/capabilities/hybrid_search/providers/bedrock) (third party)
- In Anthropic's tests, Voyage and Gemini embeddings performed best; neither is on Bedrock — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- **pgvector dimension limits**: `vector` can be indexed up to 2,000 dimensions, `halfvec` up to 4,000, and `bit` up to 64,000. Larger vectors can be indexed with expression indexes on `subvector()` (useful for Matryoshka prefixes), then re-ranked by the full vector — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- **HNSW parameters**: `m` defaults to 16 and `ef_construction` to 64. Higher `ef_construction` gives better recall but slower builds. `hnsw.ef_search` defaults to 40 and can be set per query with `SET LOCAL`. Builds are much faster when the graph fits in `maintenance_work_mem`, and `max_parallel_maintenance_workers` speeds builds. "Use the defaults unless seeing low recall" — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- **Filtered-search pitfall**: filtering happens *after* the approximate index scan. With `ef_search=40`, a filter matching 10% of rows returns about 4 rows on average. The fix is iterative index scans (0.8.0+): `hnsw.iterative_scan = strict_order | relaxed_order`, bounded by `hnsw.max_scan_tuples` (default 20,000) and `hnsw.scan_mem_multiplier`. With relaxed ordering, wrap the query in a materialized CTE and re-sort (`ORDER BY distance + 0` on PG17+). Alternatives: a B-tree index on the filter column (exact search for selective filters), partial HNSW indexes for a few filter values, and partitioning for many values — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- **Multitenancy**: in a shared HNSW index, one tenant's vectors can affect other tenants' recall and speed. For isolation, use list partitioning or separate tables — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- **Aurora**: pgvector 0.8.0 became available on 9 Apr 2025 (PG 16.8, 15.12, 14.17, 13.20 and later). The current extension list shows 0.8.2 on recent PG17/18 minors — [AWS What's New](https://aws.amazon.com/about-aws/whats-new/2025/04/pgvector-0-8-0-aurora-postgresql/); [Aurora extensions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html)
- AWS benchmark **[vendor]** (10M × 384-dim vectors, r8g.4xlarge): pgvector 0.8.0 improved p99 latency over 0.7.4 by up to 9.4x (simple filtered query: 123 ms → 13 ms, ef_search=40 with relaxed ordering) and 5.7x on a complex query (913 ms → 160 ms). The best configuration for complex filters was ef_search=200 with relaxed ordering. AWS says relaxed ordering keeps "95–99% of result quality" — [AWS Database Blog](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/)
- AWS: "If you don't need a vector index, don't use it." For small datasets, a sequential scan gives 100% recall — [AWS Database Blog](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/)
- **Scale and quantization (AWS)** **[vendor]**: a full-precision HNSW index at 768 dimensions takes about 3.7 GB per million vectors. `halfvec` halves index size "with near-zero recall loss" and is the low-risk first step. Binary quantization (32x) plus rescoring against full vectors reached 0.951 recall at 18.9 ms p99 on OpenAI 1536-dim vectors. On clustered Cohere embed-english-v3 768-dim vectors, it needed 3,000 rerank candidates (16 QPS, 1.64 s p99). Validate on your own data. Embedding-model upgrades "require full reindexing" — [AWS Database Blog](https://aws.amazon.com/blogs/database/scale-pgvector-with-binary-quantization-on-amazon-aurora-postgresql/)

### Inferences
- For an analytics catalog, which is likely to hold well under 10M chunks, use `halfvec(1024)` with HNSW (m=16, ef_construction=64 to 128) and `SET LOCAL hnsw.ef_search = 100..200` plus `iterative_scan = relaxed_order` on every scoped query. At 1M chunks the index fits comfortably in memory on mid-size instances.
- Choose between Cohere v4 and Titan v2 on cost and multilingual needs. Cohere v4 is multilingual and multimodal (for dashboard screenshots), and its Matryoshka output lets you store 1024 dimensions now and index a 256-dim `subvector` prefix later if needed.
- Record `embedding_model` and `embedding_dim` on every chunk row so a model change can be done as a shadow column or table rebuild.

### Gaps
- I found no independent MTEB-style comparison of Titan V2 against Cohere Embed v4 on Bedrock.
- I could not confirm current Bedrock per-token pricing for Cohere Embed v4 or Titan V2 (the pricing page is long and dynamic).

## Agentic retrieval: tool vs always-on injection; query rewriting, HyDE, multi-hop; just-in-time context; long context vs RAG

### Takeaway
The 2025–26 direction is hybrid: inject a small, high-signal context up front and expose retrieval as tools the agent calls just-in-time with lightweight identifiers. Multi-step agentic retrieval clearly beats single-shot retrieval on multi-hop questions, at a cost in latency and tokens. Long-context models win on raw accuracy when fully resourced, but RAG is far cheaper, and routing between the two (Self-Route) keeps most of the accuracy.

### Cited Findings
- Anthropic, "Effective context engineering for AI agents" (29 Sep 2025): teams are augmenting embedding-based pre-inference retrieval with "just in time" strategies, where agents hold lightweight identifiers (file paths, stored queries, links) and load data through tools at runtime. Claude Code uses a hybrid: CLAUDE.md is injected up front, while glob and grep retrieve on demand, "bypassing the issues of stale indexing". The hybrid "might be better suited for contexts with less dynamic content, such as legal or finance work". The guiding principle is "find the smallest set of high-signal tokens". Context rot means recall degrades as context grows — [Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- The same article recommends compaction, structured note-taking and multi-agent architectures for long-horizon tasks, plus tool-result clearing — [Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- **Long context vs RAG (Google DeepMind, Jul 2024)**: when fully resourced, long context consistently beat RAG on average, but RAG and long context gave identical predictions on more than 60% of queries. Self-Route (try RAG; the model says whether the question is answerable; otherwise fall back to long context) matched long-context performance at 65% lower cost for Gemini-1.5-Pro and 39% lower for GPT-4o — [arXiv 2407.16833](https://arxiv.org/html/2407.16833v1)
- **LaRA (ICML 2025)**: 2,326 cases across 11 LLMs; "no silver bullet". The best choice depends on model size, long-text ability, context length, task type and chunk characteristics — [PMLR](https://proceedings.mlr.press/v267/li25dv.html); [arXiv 2502.09977](https://arxiv.org/abs/2502.09977)
- Elastic's practitioner test **[vendor]**: RAG was about 1,250x cheaper per query ($0.00008 vs $0.10) and about 45x faster (1 s vs 45 s) than sending about 1M tokens. The full-context answers were less accurate — [Elastic Search Labs](https://www.elastic.co/search-labs/de/blog/rag-vs-long-context-model-llm)
- **Multi-hop**: agentic multi-step retrieval beat single-step retrieval. On MuSiQue R@5, GEAR scored 58.4 vs IRCoT 46–48 vs single-step hybrid 39.9 (ACL Findings 2025). Knowledge-aware iterative multi-agent retrieval also consistently beat one-step retrieval — [GEAR](https://aclanthology.org/2025.findings-acl.624.pdf); [arXiv 2503.13275](https://arxiv.org/html/2503.13275v2)
- **HyDE / query rewriting**: in one thesis comparison, HyDE gave the largest gains in response relevance, and query expansion gave the highest faithfulness but sometimes added noisy passages — [DiVA thesis](https://www.diva-portal.org/smash/get/diva2:2002498/FULLTEXT01.pdf). HyDE applied to decomposed multi-hop sub-queries raised recall by about 19.5% and hit rate by 21.2% in one industry study — [Korea Science 2025](https://www.koreascience.kr/article/JAKO202527236050999.page). In contrast, Anthropic saw "low performance" from HyDE-style approaches compared with Contextual Retrieval — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)

### Inferences
- For an analytics agent, always inject a compact catalog "map" (domains, top entities, glossary). Expose `search_knowledge(query, filters)`, `get_table(id)`, `get_lineage(id, depth)` and `run_sql` as tools that return IDs plus snippets, and let the agent fetch full objects on demand.
- Use query rewriting and decomposition only when the first retrieval comes back weak or the question is multi-part. Avoid HyDE by default, because it adds an LLM call to every query and the evidence is mixed.
- For small, bounded corpora (one domain's docs under about 200k tokens), prompt-cached full context can beat RAG outright.

### Gaps
- I found no rigorous public A/B test of always-on injection vs retrieval-as-a-tool on enterprise data. The Anthropic guidance is qualitative.

## GraphRAG / knowledge graphs: when graphs beat vectors; build cost; relevance for catalogs with lineage and foreign keys

### Takeaway
LLM-extracted graphs (Microsoft GraphRAG) win on global "sensemaking" questions, with 72–83% comprehensiveness win rates over vector RAG, but they are expensive to build and to update. Cheaper variants (LazyGraphRAG, LightRAG) narrow the gap. For a data catalog, the graph already exists explicitly (lineage, foreign keys, ownership), so the high-value pattern is deterministic graph tables in Postgres traversed with recursive CTEs after vector seeding, not LLM entity extraction.

### Cited Findings
- **Microsoft GraphRAG (Apr 2024)**: an LLM extracts an entity graph, then summarizes communities hierarchically; answers are built map-reduce style. On about 1M-token corpora, its global approaches beat vector RAG on comprehensiveness (72–83% wins on podcasts, 72–80% on news; p<.001) and diversity (75–82% and 62–71%). Vector RAG gave the most *direct* answers. Root-level summaries use more than 97% fewer tokens than summarizing the source text — [arXiv 2404.16130](https://arxiv.org/abs/2404.16130)
- Graph extraction is about 75% of GraphRAG indexing cost. FastGraphRAG is much cheaper but produces a noisier graph — [GraphRAG docs](https://microsoft.github.io/graphrag/index/methods/)
- **LazyGraphRAG (Microsoft Research, Nov 2024)** **[vendor]**: no LLM at indexing time (noun-phrase co-occurrence graph). Indexing cost equals vector RAG and is 0.1% of full GraphRAG. Global-query quality is comparable to GraphRAG at 700x lower query cost. Evaluated on one dataset (5,590 AP articles, 100 queries) — [Microsoft Research](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/); [critique](https://graphrag.xinbetween.com/chapters/26-cost-scaling.html)
- **LightRAG (Oct 2024)**: dual-level retrieval over an extracted graph without community reports. It beat naive RAG, HyDE and RQ-RAG (about 60–85% win rates, largest on the Legal set) and roughly tied GraphRAG (52–55%). Retrieval uses fewer than 100 tokens and 1 API call, vs about 610k tokens for GraphRAG. Incremental updates merge new entities without rebuilding communities. Evaluated with LLM-as-judge win rates — [arXiv 2410.05779](https://arxiv.org/html/2410.05779v2)
- **Bedrock Knowledge Bases GraphRAG** (Neptune Analytics): vector search seeds the retrieval, then graph traversal expands to linked chunks and entities. Graph construction cannot be customized, sources are limited to S3, there is no autoscaling, and each data source holds 1,000 files (10,000 on request) — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-build-graphs.html)
- Graph expansion on top of any base retriever raised single-step MuSiQue R@15 (hybrid 49.1 → 61.2) — [GEAR](https://aclanthology.org/2025.findings-acl.624.pdf)

### Inferences
- Catalog questions such as "what feeds this dashboard?", "what breaks if I drop column X?" and "which tables join to orders?" are graph traversals over known edges. Store `kb_edges(src_id, dst_id, type, props)` in Postgres and use recursive CTEs; no Neo4j or Neptune is needed at catalog scale. Embed nodes (tables, columns, metrics, dashboards) for seeding, then expand 1–2 hops before reranking.
- Reserve LLM entity extraction (LightRAG-style) for unstructured documents where the relationships are not explicit.
- Bedrock's managed GraphRAG is poorly suited: sources are S3-only and the graph cannot be customized, so the existing lineage and foreign-key graph from Databricks Unity Catalog cannot be loaded into it.

### Gaps
- I found no quantified benchmark of graph-augmented retrieval on data-catalog or text-to-SQL schema retrieval tasks specifically.
- I did not find Neo4j primary benchmarks; Neo4j patterns are not covered here.

## Freshness and incremental indexing: change detection, versioned chunks, tombstones, re-embedding on model change

### Takeaway
Incremental sync keyed on content hashes is standard; Bedrock Knowledge Bases re-ingests only added, modified or deleted documents. Access-control metadata should sync separately and more often than content. Changing the embedding model forces a full re-embed and reindex, so plan for shadow builds.

### Cited Findings
- Bedrock Knowledge Bases sync is incremental. Unchanged documents are skipped. A change to content *or metadata* triggers a full re-parse, re-chunk, re-embed and re-index of that document. Deleted documents are removed from the vector store. A deletion policy (Delete or Retain) applies when a data source is removed — [AWS sync docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-sync-ingest.html); [AWS data source docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-ds-update.html)
- For Aurora vector stores, AWS recommends storing metadata in a single custom metadata column with an index on it — [AWS sync docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-sync-ingest.html)
- Chunking strategy is immutable per data source; changing it means creating a new data source — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-customize-ingestion.html)
- Embedding-model upgrades require full reindexing. Index build speed (for example, 1.1 h vs 31.5 h for 100M vectors with different index types) therefore matters operationally — [AWS Database Blog](https://aws.amazon.com/blogs/database/scale-pgvector-with-binary-quantization-on-amazon-aurora-postgresql/)
- Permission changes only take effect once synced to the index. Sync access-control lists (ACLs) as cheap metadata writes, separately from re-embedding — [Csorba blog](https://balazscsorba.com/blog/rag-access-control-permissions) (practitioner)
- Anthropic notes just-in-time tool retrieval sidesteps "stale indexing" — [Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Build HNSW indexes after the bulk load; dead tuples can reduce the number of results returned — [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)

### Inferences
- Suggested schema: `kb_documents(source_id, source_version, content_hash, acl_version, deleted_at)` and `kb_chunks(doc_id, chunk_ix, content_hash, embedding_model, embedding, …)`. On sync, diff hashes, upsert only changed chunks, and soft-delete with tombstones so retrieval can filter `deleted_at IS NULL`. Hard-delete in a batch job, then `VACUUM` and periodically `REINDEX CONCURRENTLY`.
- Drive change detection from Databricks (Unity Catalog audit or system tables, Delta change data feed) through EventBridge or SQS into an embedding worker, and batch Bedrock embedding calls, since quota is per request.
- On a model change, write to a new `embedding_v2` column or table, build its HNSW index concurrently, compare recall on an evaluation set, then switch the read path.

### Gaps
- I found no primary-source benchmark of chunk-level vs document-level re-embedding cost savings.
- Databricks-specific change-data-capture integration was outside the sources consulted.

## Access control in retrieval: document ACL filtering, multi-tenant isolation (Postgres RLS), permission-aware retrieval

### Takeaway
Enforce permissions inside the retrieval query itself, with RLS plus `FORCE ROW LEVEL SECURITY` and tenant and group context set per transaction, never in the prompt. The trap specific to pgvector is recall: permission filters are post-filters on HNSW, so users with few rights silently get "nothing found" unless iterative scans, partial indexes or partitions are used.

### Cited Findings
- Use a two-table schema (documents and chunks), each with `tenant_id`, linked by a composite foreign key. Apply `ENABLE` and `FORCE ROW LEVEL SECURITY` to both tables, with policies on `current_setting('app.tenant_id')`. Set context *transaction-locally* (`SET LOCAL`), because session-scoped settings leak across pooled connections. Keep RLS policies free of sub-SELECTs, which degrade query plans. Backups need a role with `BYPASSRLS` — [Render](https://render.com/articles/multi-tenant-rag-postgresql-pgvector)
- Each chunk inherits its document's ACL as group IDs. Policy pattern: `allowed_groups && string_to_array(current_setting('app.groups'), ',')`. Resolve group membership from the identity provider at query time. Re-check high-risk sources live. Caches, summaries and memories derived from documents need the same ACLs — [Csorba blog](https://balazscsorba.com/blog/rag-access-control-permissions) (practitioner)
- A permission filter is exactly the kind of post-filter that empties HNSW results (about 4 results when 10% of rows match at ef_search=40). Use `SET LOCAL hnsw.iterative_scan = relaxed_order` — [Csorba blog](https://balazscsorba.com/blog/rag-access-control-permissions); [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- Strategy by tenant shape: a B-tree on `tenant_id` for small tenants (exact search); partial HNSW indexes for a few stable tenants; list partitioning or separate tables for strong isolation, since a shared index lets tenants affect each other's recall — [Render](https://render.com/articles/multi-tenant-rag-postgresql-pgvector); [pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)
- AWS's pattern for pooled multi-tenant pgvector on Aurora uses RLS on the knowledge-base table and sets the tenant ID on each request — [AWS Database Blog](https://aws.amazon.com/blogs/database/self-managed-multi-tenant-vector-search-with-amazon-aurora-postgresql/)
- AWS also notes that iterative scans are "essential" for multi-tenant workloads with selective filters — [AWS Database Blog](https://aws.amazon.com/blogs/database/scale-pgvector-with-binary-quantization-on-amazon-aurora-postgresql/)

### Inferences
- For a Next.js backend using Prisma or `pg`, wrap every retrieval in a transaction that runs `SET LOCAL app.tenant_id`, `app.groups`, `hnsw.iterative_scan` and `hnsw.ef_search`, connecting as a non-owner role. Test that this works with RDS Proxy or PgBouncer in transaction mode.
- Mirror Unity Catalog grants into `allowed_groups` on catalog chunks, so the agent can only discover tables the user could query in Databricks.
- Put a GIN index on `allowed_groups`. For very selective ACLs, the planner may prefer exact search through the B-tree or GIN index, which is correct and fast.

### Gaps
- I found no benchmark quantifying RLS overhead on pgvector HNSW queries.

## Citations / grounding: returning source spans and attribution formats

### Takeaway
On Bedrock, Claude models natively support `search_result` content blocks (passed directly or returned from tools) with `citations: {enabled: true}`. Responses then carry structured `search_result_location` citations (source, title, `cited_text`, block indices). This is the cleanest way for an agent's retrieval tool to return citable chunks.

### Cited Findings
- `search_result` blocks contain `source`, `title`, a `content` array of text blocks, and `citations.enabled`. They can appear in user messages and inside tool results. Claude cites whole text blocks (the minimal unit), so split content into smaller blocks for finer citations. `cited_text` does not count toward output tokens — [Claude docs](https://platform.claude.com/docs/en/build-with-claude/search-results)
- Citation object fields: `type: "search_result_location"`, `source`, `title`, `cited_text`, `search_result_index`, `start_block_index`, `end_block_index` (exclusive) — [Claude docs](https://platform.claude.com/docs/en/build-with-claude/search-results)
- Other citation types: `char_location` for plain-text documents, `page_location` for PDFs, `content_block_location` for custom-content documents — [Claude API reference](https://platform.claude.com/docs/en/api/typescript/messages/batches/results)
- The Bedrock Converse API exposes `SearchResultBlock` and a `CitationLocation` union (documentChar, documentChunk, documentPage, searchResultLocation, web). The documentation lists support for Claude Opus 4.1/4, Sonnet 4.5/4/3.7 and 3.5 Haiku — [Bedrock SearchResultBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_SearchResultBlock.html); [Bedrock CitationLocation](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_CitationLocation.html)
- Anthropic suggests the answer model may do better when it can tell the generated context apart from the original chunk text — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)

### Inferences
- Have the retrieval tool return each chunk as a `search_result` with `source = kb://<object_type>/<id>#chunk-<n>` and the title set to the object's display name. Put the original chunk text in content blocks and keep the Contextual Retrieval prefix out of the cited blocks, so `cited_text` maps to a real span. The UI resolves `source` to a deep link (table page, dashboard, doc section).
- For non-Claude Bedrock models, use a numbered `[n]` citation convention and validate it after generation.

### Gaps
- The Bedrock model-support list for `SearchResultBlock` I found names models only up to Opus 4.1 and Sonnet 4.5. Support for newer Claude versions on Bedrock needs confirming in the current documentation.
- I found no quantitative study of how citation formats affect hallucination rates.
