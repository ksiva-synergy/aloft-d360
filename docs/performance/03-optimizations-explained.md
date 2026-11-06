# 03 — Optimizations Explained in Plain Language

Each item below gives:
- **what happens today**
- **an everyday analogy**
- **what we change**
- **what we gain**
- **who notices**

Item IDs (A1, B1, …) match the technical audit: [../audits/performance-and-cost-optimization-report.md](../audits/performance-and-cost-optimization-report.md).

---

## Part 1 — LLM token spend (biggest money saver)

### 1. Don't send the whole spreadsheet to the model (A1, A2)

- **Today:** when Inspector runs a SQL query, the screen shows up to 1,000 rows. The model receives **all** rows as text. Each later step resends that same text again.
- **Analogy:** you ask a colleague "which region sold most?" and fax them the whole 50-page sales ledger. Then you fax it again with every follow-up question.
- **Change:**
  - Give the model a **summary**: column names, row count, the first 20–50 rows, simple totals or min/max.
  - Keep the full data in the UI.
  - After the model has used a result, keep only a short note of it in the conversation.
- **Gain:** likely the **largest single token saving**, and faster answers.
- **Who notices:** finance (lower bill) and users (faster replies). Answer quality should not drop, because the model rarely needs every row. We test this with real questions before rollout.

### 2. Prompt caching (A3, A4, A5)

- **Today:** every step of a conversation resends the same long instructions and tool descriptions, at full price.
- **Analogy:** paying a printer full price to reprint the same cover page for every chapter, when they would keep it on file for a fraction of the price.
- **Change:**
  - Turn on the provider's prompt cache.
  - Order the prompt so the unchanging part comes first and the per-request part comes after the cache marker.
- **Gain:** a large part of every step's input is billed at the cheaper cached rate, and responses start faster.
- **Who notices:** finance and users.

### 3. Ask for shorter answers when a short answer is enough (A6)

- **Today:** every step allows up to 4,096 output tokens, even the steps where the model only picks a tool.
- **Analogy:** booking a 2-hour meeting room for a 5-minute check-in.
- **Change:** a small limit for tool-picking steps (~1,000) and the full limit for the final answer.
- **Gain:** fewer runaway outputs and lower output cost.

### 4. "Deep thinking" only when it is needed (A7)

- **Today:** extended thinking (with a 1,024-token budget) is on for every step whenever the model supports it.
- **Analogy:** calling a senior consultant to answer "what time is it?"
- **Change:** turn thinking on only for complex questions, such as investigations and multi-step analysis.
- **Gain:** fewer output tokens and faster simple answers.

### 5. Right-sized step budget (A8)

- **Today:** every question may take up to 15 steps (32 maximum).
- **Change:** a quick classifier picks a budget: simple lookup 3–5, investigation 8–10, complex 15.
- **Gain:** fewer steps on simple questions, so fewer tokens and faster answers.

### 6. Stop paying when the user leaves (A13, A14)

- **Today:** if the user closes the tab or presses stop, we set a flag, but the model keeps generating (and billing) until its current reply finishes.
- **Analogy:** cancelling a taxi, but the meter keeps running until the driver reaches the address.
- **Change:** send a real "cancel" to the model and to Databricks.
- **Gain:** no tokens or warehouse time billed for answers nobody will read.

### 7. Use cheap models for cheap jobs (A16, A17)

- **Today:** small jobs such as scoring, titles, short insights and classification may use the same strong model as the main chat.
- **Analogy:** sending the CEO to collect the mail.
- **Change:** in the existing **Models** admin page and model registry, assign a small, fast model to these features.
- **Gain:** these calls become much cheaper.

### 8. One chart call instead of two or three (A9, A10)

- **Today:** after answering, a second LLM call designs the chart, and sometimes a third repairs it. Each call sends every column's profile.
- **Change:** pick obvious charts with simple rules (a date column means a line chart; a category plus a number means a bar chart). Call the LLM only when the choice is unclear, and send only the relevant columns.

### 9. Do the "after-work" later, in one batch (A11)

- **Today:** after each answer, several extra LLM and database jobs run on the web server: knowledge notes, reflection, scoring and memory.
- **Change:** put them in a queue and process them together in the background.
- **Gain:** the web server is free sooner, and batching reduces calls.

### 10. Reuse connections to AI providers (A12)

- **Today:** about 14 places create a new AI client for every call. Each one sets up a new secure connection.
- **Analogy:** dialling a new phone call for every sentence instead of staying on the line.
- **Change:** create one client per provider and reuse it.
- **Gain:** faster calls and less CPU.

---

## Part 2 — Getting more from the same server

### 11. Use both CPU cores (B1, B2, B3)

- **Today:** the server has 2 cores, but our app runs as **one** Node process, and Node runs JavaScript on one core.
- **Analogy:** a two-lane road with one lane closed.
- **Change:**
  - Run **two** copies of the app on the same server, each with a memory limit (~1.5 GB).
  - Split the database connection pool between them (~8 each).
  - Upgrade Node 20 → 22.
- **Gain:** roughly **double** the light API capacity. One busy request no longer blocks everyone.
- **Care needed:** anything kept only in the app's memory (some caches, in-process locks or rate limits) is no longer shared between the two copies. The implementation plan lists these checks.

### 12. Let a CDN serve the website files (B4)

- **Today:** the same Node process that runs the AI also sends every JavaScript and CSS file to browsers.
- **Analogy:** the head chef also working the coat check.
- **Change:** put the SPA files on S3 behind CloudFront, AWS's global content cache. This needs the cloud team.
- **Gain:** less CPU and bandwidth on the server, and faster page loads for users.

### 13. Move heavy file processing off the web server (B5, B6, B7)

- **Today:** PDF rendering, Word/Excel/PowerPoint parsing and server-side chart images run on the web server.
- **Analogy:** the receptionist stops answering phones to photocopy a 300-page document.
- **Change:**
  - Short term: limit file size, page count and how many run at once.
  - Long term: send the work to a background worker on Fargate. **A Python worker is an option here.**
- **Gain:** one large upload no longer slows every user.

### 14. Check login once per request (B8)

- **Today:** the login token is checked at the entrance, then again inside many API routes, sometimes several times per request.
- **Change:** check it once and pass the result along.

### 15. Keep-alive for Databricks (B13)

- **Today:** Databricks calls may open new connections, and status checks repeat at a fixed rate.
- **Change:** keep connections open and reuse them. Wait a little longer between each status check.

---

## Part 3 — Database

### 16. Add the missing search index (C1, C2)

- **Today:** semantic search ("find tables about crew wages") compares the question against **every** stored embedding. It also runs a full count query first, on every request.
- **Analogy:** a library with no catalogue, where the librarian walks every shelf for each request.
- **Change:**
  - Add an HNSW vector index, the catalogue for embeddings (https://github.com/pgvector/pgvector#hnsw).
  - Cache the count for a minute or two.
- **Gain:** much faster semantic search and less database CPU.

### 17. Ask only for the columns you need (C5, C6, C7)

- **Today:** some list pages load whole rows, including large JSON blobs, then use only a name and a status.
- **Change:** select only the needed fields.

### 18. Cache answers that rarely change (C3, C4, C8, C9)

- **Examples:** dashboard summary counts, the default organization id, a user's roles, the active job list.
- **Change:** keep these for 10–120 seconds instead of re-querying on every request.

### 19. Batch the metrics writes (C10, C11, C12, C13)

- Write turn and loop metrics in batches.
- Use a small shared connection pool for locks.
- Tune pool sizes for two processes.
- Add the missing job-queue index.

---

## Part 4 — Background jobs (harvest)

### 20. Pre-build the harvester (D1)

- **Today:** every harvest task compiles TypeScript at startup (`npx tsx`), and we pay Fargate for that time.
- **Change:** compile once when building the image, then run plain JavaScript.

### 21. Reuse workers; use Spot; right-size (D2, D10, D11, D12)

- **Today:** each child job starts its own Fargate task, which pays its own startup cost. Everything runs on full-price capacity at a single size.
- **Change:**
  - One task processes several queued jobs before stopping.
  - Scheduled and backfill jobs run on **Fargate Spot** (spare capacity, much cheaper). Jobs are already resumable, so an interruption is safe.
  - Size each task to its tier.

### 22. Only re-scan what changed (D4–D7)

- **Today:** a weekly full T1 profile of every table, with several Databricks queries per table and column.
- **Change:**
  - Re-profile only tables whose schema or `last_altered` changed.
  - Do a full sweep monthly.
  - Combine per-column queries into one per table.
  - Use smaller adaptive samples.
- **Gain:** shorter Databricks warehouse time, which is billed per hour while awake.

### 23. Smarter T2 enrichment (D8, D9, A19, A20)

- Send compact profiles.
- Process several objects per LLM call.
- Cache results by profile fingerprint, so unchanged tables cost nothing.
- Run several objects in parallel within safe limits.
- Write embeddings in bulk.

---

## Part 5 — Browser behaviour

### 24. Poll less often, and only when someone is looking (E1–E4)

- **Today:** job pages ask "is it done yet?" every 3 seconds. Several components on the same page ask separately, and they keep asking even when the tab is hidden.
- **Analogy:** five people in one car each asking "are we there yet?" every 3 seconds.
- **Change:**
  - One shared question per job.
  - Slow down over time (3 s → 15 s).
  - Pause when the tab is hidden, and stop when the job finishes.
  - Later, the server can push updates (SSE) instead.
  - Set sensible app-wide caching defaults.

### 25. Smaller pages of data (E5, E6)

- Paginate long lists, such as sessions (200, or 1,000 for admins).
- Load chart libraries only on pages that use them.
