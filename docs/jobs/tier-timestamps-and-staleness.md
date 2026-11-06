# Tier timestamps — how the system knows what to run next

**Audience:** Operators, support, new engineers  
**Last updated:** 2026-10-28  
**Related:** [redundancy-and-skip-behavior.md](./redundancy-and-skip-behavior.md) · [efficient-pipeline-playbook.md](./efficient-pipeline-playbook.md) · [current-status.md](./current-status.md)

---

## 1. Big picture

Each **table** (context object) in **Scanned** has a row in Postgres: `platform_context_objects`.

The pipeline does **not** decide “run T1 again” from job history alone. It compares **timestamps on that row**:

- When did we last **scan structure** (T0)?
- When did we last **profile** (T1)?
- When did we last **enrich** (T2)?
- Do we have an **embedding**?

If an upper step is **missing** or **older than** the step below it on the ladder, that table **needs** that tier.

---

## 2. Where the values live

| Column | Type | Set when |
|--------|------|----------|
| `last_t0_at` | `timestamptz` (nullable) | T0 structural harvest succeeds for this table |
| `last_t1_at` | `timestamptz` (nullable) | T1 profile succeeds for this table |
| `last_t2_at` | `timestamptz` (nullable) | T2 semantic enrich succeeds for this table |
| Embedding | separate table `platform_context_embeddings` | Embed job writes vector for object/column |

Schema: `prisma/schema.prisma` on model `PlatformContextObject`.

**Discovery** (`platform_estate_objects`) is separate. A table can exist in discovery but have **no** `last_t0_at` until T0 runs.

---

## 3. The ladder (order of tiers)

```text
  [Discovery]  →  T0  →  T1  →  T2  →  embed
                  │      │      │
                  │      │      └── last_t2_at
                  │      └── last_t1_at
                  └── last_t0_at
```

Rule of thumb: **each step must be at least as new as the step before it**, or the next step is “due.”

---

## 4. What `last_t1_at < last_t0_at` means

Both fields are **dates/times**, not yes/no flags.

**English:** The **profile** was finished **before** the **latest structural scan**. Structure is newer than stats → **re-profile this table**.

**Logic:**

```text
needs T1  when  last_t0_at is set
          AND  ( last_t1_at is NULL  OR  last_t1_at < last_t0_at )
```

### Example A — profile is current (T1 **not** needed)

```text
last_t0_at = 2026-10-20 10:00:00 UTC
last_t1_at = 2026-10-20 11:30:00 UTC

Compare: 11:30 is AFTER 10:00
→ last_t1_at < last_t0_at is FALSE
→ table does NOT need T1
```

### Example B — T0 ran again; profile is old (T1 **needed**)

```text
last_t0_at = 2026-10-28 09:00:00 UTC   ← T0 just updated structure
last_t1_at = 2026-10-20 11:30:00 UTC   ← profile never re-run since

Compare: 11:30 is BEFORE 09:00 on Oct 28
→ last_t1_at < last_t0_at is TRUE
→ table NEEDS T1
```

### Example C — scanned but never profiled (T1 **needed**)

```text
last_t0_at = 2026-10-28 09:00:00 UTC
last_t1_at = NULL

→ NEEDS T1 (no profile yet)
```

### Example D — same calendar day, different times

Comparison is **full timestamp**, not “same day”:

```text
last_t0_at = 2026-10-28 14:00:00 UTC
last_t1_at = 2026-10-28 10:00:00 UTC

→ last_t1_at < last_t0_at is TRUE → NEEDS T1
```

---

## 5. T2: `last_t2_at` vs `last_t1_at`

Same idea one step up. T2 only applies to tables that **have** a profile.

```text
needs T2  when  last_t1_at is set
          AND  ( last_t2_at is NULL  OR  last_t2_at < last_t1_at )
```

**Example — profile re-run makes enrich stale:**

```text
Before T1 run:
  last_t0_at = Oct 28 09:00
  last_t1_at = Oct 20 11:30   (stale vs T0)
  last_t2_at = Oct 21 08:00   (was current vs OLD last_t1_at)

After T1 run on Oct 28 15:00:
  last_t1_at = Oct 28 15:00   (updated)
  last_t2_at = Oct 21 08:00   (unchanged)

→ last_t2_at < last_t1_at is TRUE → NEEDS T2
```

---

## 6. Embed

Intent UI (coarse): scanned table **without** an object-level embedding row → counts toward **needs embed**.

Embed worker (fine): builds `embed_text` from semantic data; **skips** if stored `embed_text` is identical (no new Bedrock call).

After T2 changes semantic text, embed may need to run even if an old embedding row exists (text mismatch → not skipped).

---

## 7. When do “all steps” run again?

**Per table**, not whole schema by default.

| Event | Effect on that table |
|--------|----------------------|
| New table appears; T0 lists it | Sets `last_t0_at` → then needs T1, then T2, embed as gaps |
| T0 touches table (delta or full) | Updates `last_t0_at` → may need T1; after T1, may need T2/embed |
| T0 does **not** touch table | `last_t0_at` unchanged → T1/T2 stay fresh if already current |
| T1 completes | Sets `last_t1_at` → clears T1 gap; may open T2 gap if `last_t2_at` old |
| T2 completes | Sets `last_t2_at` |
| `forceReprofile` / `forceReEnrich` | Worker ignores stale check for that tier in scope |

**Whole schema “run everything”** only happens if you **launch** every tier (e.g. catalog full pipeline) — workers still **skip** tables that are already fresh at T1/T2/embed unless force flags are set.

---

## 8. Where you see this in the product

| UI / API | Uses same rules |
|----------|-----------------|
| Scanned tier pills & facet filters | `last_t1_at < last_t0_at`, etc. (`reads.ts`) |
| Continue pipeline | `computePipelineIntent` → `needs_profile`, `needs_enrich`, `needs_embed` |
| Launch plan | `staleObjectCount` for T1/T2 |
| T1/T2 workers | Same filters in `harvest.ts` / `enrich.ts` |

---

## 9. What we do **not** use for T1 skip

| Field / idea | Role |
|--------------|------|
| Last job succeeded | Not used for per-table stale |
| `source_altered_at` | Shown in describe/freshness UX; **T1 worker stale filter uses `last_t0_at` vs `last_t1_at`**, not this alone |
| Profile **version** number | History in `platform_context_profiles`; staleness gate is timestamps on `platform_context_objects` |

---

## 10. Quick reference table

| Condition | Needs |
|-----------|--------|
| Not in Scanned / `last_t0_at` NULL | T0 first (if in discovery) |
| `last_t1_at` NULL or `< last_t0_at` | T1 |
| `last_t1_at` set and (`last_t2_at` NULL or `< last_t1_at`) | T2 |
| Scanned, semantic done, no embedding (intent) | embed |
| All comparisons current | Nothing (Continue idle) |

---

## 11. Code references

| Logic | Location |
|-------|----------|
| Health / intent counts | `aggregateHealthFromRows` — `src/lib/estate/pipeline-intent.ts` |
| Plan stale count | `countStaleObjectsForKind` — same file |
| T1 worker filter | `runT1Profile` — `src/lib/context/harvest.ts` |
| T2 worker filter | `runT2Enrich` — `src/lib/context/enrich.ts` |
| Scanned list filters | `src/lib/context/reads.ts` |
