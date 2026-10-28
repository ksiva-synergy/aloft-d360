# Embeddings, “inactive”, and T0 drops

**Audience:** Operators, support, engineers  
**Last updated:** 2026-10-28  
**Related:** [tier-timestamps-and-staleness.md](./tier-timestamps-and-staleness.md) · [incident-2026-10-18-catalog-mass-drop.md](../incident-2026-10-18-catalog-mass-drop.md) · [current-status.md](./current-status.md)

---

## 0. Terminology (what “inactive” usually means)

People say **“embeddings went inactive”** or **“moved to inactive, not deleted.”** In this codebase that is **accurate**:

| Word you hear | What the database actually did |
|---------------|--------------------------------|
| **Inactive** (everyday) | Table **no longer in the active harvested catalog** — not shown in Scanned/search/agents the same way |
| **`lifecycle = 'dropped'`** (Scanned object) | T0 drop pass (or similar) **marked the context object inactive for product use** |
| **Not deleted** | **`platform_context_embeddings` rows usually remain**; **`platform_context_objects` rows remain** with `lifecycle = 'dropped'` (soft hide, not `DELETE`) |
| **Inactive for search** | Search **joins only `lifecycle = 'active'`** — existing vectors are **ignored**, which feels like embeddings were “turned off” |

There is **no** column named `inactive` on embedding rows. **Inactive = out of the active catalog path**, not erased from Postgres.

---

## 1. What people usually see

Reports like “**all embeddings went inactive**” or “**search lost the catalog**” often mean one of these — not that Postgres deleted every vector row:

| What you see | What actually happened |
|--------------|-------------------------|
| Tables disappear from Scanned / search | **`platform_context_objects.lifecycle`** set to **`dropped`** (T0 drop pass or bug) |
| Object detail / agents can’t find a table | **`describe` / `searchObjects`** only use **`lifecycle = 'active'`** objects |
| UI shows lower lifecycle (not Embedded / Published) | **`hasEmbedding`** false, or object dropped, or **`last_knowledge_sync_at`** / freshness rules |
| Semantic search returns nothing useful | Wrong **`model_id`** on stored vectors vs query embedder (fixed Oct 2026 — Titan v2 aligned) |

**Important:** `platform_context_embeddings` has **no `lifecycle` column**. Vectors usually **stay in the table** even when the object is dropped. They are simply **not used** in retrieval until the object is active again and search joins match.

---

## 2. How embeddings relate to objects

```text
platform_context_objects          platform_context_embeddings
  id  (UUID)          ───────────►  subject_id  (same UUID)
  lifecycle: active|dropped         subject_kind: object | column
  last_t0_at, last_t1_at, …         embedding, embed_text, model_id
```

| Check | Meaning |
|-------|---------|
| **`has_embedding` / `hasEmbedding` in UI** | EXISTS row with `subject_kind = 'object'`, `embedding IS NOT NULL` |
| **Jobs “needs embed”** | Scanned active object without object-level embedding (coarse) |
| **Embed job** | Upserts vectors; skips if **`embed_text`** unchanged |

Dropping an object does **not** automatically DELETE embedding rows in application code today. Orphan vectors can remain until re-embed or manual cleanup.

---

## 3. Why T0 can make the catalog (and embeddings) “vanish”

On a **full sweep** (first run, `forceFullScan`, Focus **`includePatterns`**, or exclude-only scope treated as first run — see `runT0Harvest` in `harvest.ts`), T0 runs a **lifecycle drop pass**:

- Compare **active** context objects to the **resolved listing** from Databricks.
- Paths that are in scope but **missing from the listing** → **`lifecycle: 'dropped'`**.

```245:271:src/lib/context/harvest.ts
    // ── 7. Full-sweep lifecycle pass ──────────────────────────────────────────
    // Only on first run: objects absent from the current sweep are marked dropped.
    ...
        const dropped = await prisma.platformContextObject.updateMany({
          where: { id: { in: dropIds.slice(i, i + 500) }, lifecycle: 'active' },
          data: { lifecycle: 'dropped' },
        });
```

**Delta T0** (normal re-run without first-run triggers) **does not** run this drop pass — it only updates changed tables.

### When drop pass is dangerous (historical bugs — mostly fixed)

| Risk | Effect |
|------|--------|
| Full-source T0 when operator meant **one table** | Drop pass evaluated against huge listing / wrong scope → mass **`dropped`** |
| Listing **truncated at 1000 rows** | Tables not in listing treated as deleted → **dropped** (fixed: paged `resolveScope`) |
| Drop compared to **harvested** set not **resolved** listing | False drops (fixed: `selectDroppedPaths`) |
| Objects **outside source scope** treated as “not seen” | Entire catalogs **dropped** (fixed: scope-aware `selectDroppedPaths`) |

Full write-up: **[incident-2026-10-18-catalog-mass-drop.md](../incident-2026-10-18-catalog-mass-drop.md)** — 1,387+ objects marked `dropped`; Estate inventory still `active`; embeddings still in DB but **inactive for search** until objects restored and re-embedded.

---

## 4. Why search and agents ignore “inactive” embeddings

`searchObjects` joins embeddings only to **active** objects and only **current model** vectors:

```669:701:src/lib/context/describe.ts
  // dropped objects cannot be described, so both are excluded from retrieval.
  ...
      JOIN platform_context_objects o
        ON o.id = e.subject_id AND o.org_id = e.org_id AND o.lifecycle = 'active'
      ...
        AND e.model_id = ${CURRENT_EMBEDDING_MODEL}
```

So if **`lifecycle = 'dropped'`**:

- Table is excluded even if **`platform_context_embeddings`** still has a row.
- Workbench / Inspector answers “not in catalog” while Databricks still has the table.

After the Oct 2026 incident restore: objects set back to **`active`**, then **embed job** re-ran for restored rows (742 embedded; others skipped unchanged).

---

## 5. UI lifecycle vs database lifecycle

Two different ideas both called “lifecycle”:

### 5.1 Database: `platform_context_objects.lifecycle`

| Value | Meaning |
|-------|---------|
| **`active`** | Normal Scanned object |
| **`dropped`** | T0 (or sync) decided table vanished from listing — hidden from most UI and search |

### 5.2 UI badges (Estate object hero / table)

Derived from timestamps + **`hasEmbedding`** + optional **`last_knowledge_sync_at`** — not the same as `dropped`.

Examples (`LifecycleBadge.tsx` / `HeroLifecycleBadge.tsx`):

- **Embedded** — has embedding row; may not be “Published” until knowledge sync timestamp rules pass.
- **Published** — sync timestamp set (legacy **`knowledge_sync`** job path; stub in orchestrator — see audit docs).
- **Knowledge stale** — Published but **`!hasEmbedding`** or structural freshness stale.

So “embedding inactive” in UI can mean **`hasEmbedding === false`** (never embedded or row missing), not necessarily **`lifecycle: dropped`**.

---

## 6. Other ways embeddings seem to “stop working”

| Cause | Symptom | Mitigation |
|-------|---------|------------|
| **Model mismatch** | Vectors exist but search scores noise | Re-embed with current Titan model (`CURRENT_EMBEDDING_MODEL` in `embed.ts`) |
| **Object dropped** | No search/describe | Restore **`lifecycle='active'`** if table still in Estate; re-run T0 if needed |
| **Never ran embed** | `needs_embed` in Scanned | Run **embed** tier (scoped Limit) |
| **Semantic text unchanged** | Embed job **`skipped`** high | Expected — not a failure |
| **T2 / T1 stale** | Old semantic text in vectors | Run T2 then embed |

---

## 7. Operator checklist after “everything went inactive”

1. **Scanned tab** — filter or count: are objects **`dropped`** vs missing embed?  
2. **SQL (support)** — objects dropped while Estate still active:

```sql
SELECT c.catalog_name, count(*)
FROM platform_context_objects c
JOIN platform_estate_objects e
  ON e.org_id = c.org_id AND e.full_path = c.full_path
WHERE c.lifecycle = 'dropped' AND e.lifecycle = 'active'
GROUP BY 1 ORDER BY 2 DESC;
```

3. **Recent T0 jobs** — `stats->>'dropped_objects'` > 0 on `platform_context_jobs`.  
4. **Fix path** — restore active lifecycle (if table truly exists), **T0** on correct scope if structural, **Continue** T1→T2→**embed** for gaps — not full-source blind T0.  
5. **Active Runs** — avoid overlapping full sweeps; use **`catalog.schema.*`** Limit.

---

## 8. Prevention (efficient + safe)

- Prefer **Scanned Continue** / **Guided launch** with schema Limit — see [efficient-pipeline-playbook.md](./efficient-pipeline-playbook.md).  
- Avoid unintended **first-run T0** on whole source (`last_sweep_at` null, missing `includePatterns` on one-table harvest — orchestrator **`scope.path`** issues documented in incident).  
- After structural work, run **embed** only when search/RAG needs vectors.  
- Monitor T0 job stats: large **`dropped_objects`** is a red flag.

---

## 9. Code map

| Topic | Location |
|-------|----------|
| T0 drop pass | `src/lib/context/harvest.ts` |
| Drop scope logic | `src/lib/context/scope-match.ts` — `selectDroppedPaths` |
| Embedding upsert / skip | `src/lib/context/embed.ts` |
| Search join active + model | `src/lib/context/describe.ts` — `searchObjects` |
| Has embedding SQL | `src/lib/context/embedding-presence.ts` |
| UI lifecycle | `src/components/estate/LifecycleBadge.tsx`, `HeroLifecycleBadge.tsx` |
