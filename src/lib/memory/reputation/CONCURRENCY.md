# Reputation writes — concurrency posture (Phase D4)

**Decision: keep last-write-wins for now. No advisory lock.**

## What the writes are

`applyOutcomeForUser()` in [`store.ts`](./store.ts) is a read-modify-write on one
`platform_user_reputation` row per `(org_id, user_id, domain)`:

1. `loadOrInit()` — `SELECT` the current row (or synthesize a fresh one).
2. `applyOutcome()` — pure math in `engine.ts` (decay + add evidence).
3. `persist()` — `INSERT … ON CONFLICT (org_id, user_id, domain) DO UPDATE`.

`refreshBulletMultiplier()` similarly recomputes and writes
`platform_agent_memory.contributor_rep` for one bullet.

The read and the write are **not** in one transaction, so two outcomes for the
same `(user, domain)` that interleave can lose one increment (classic lost
update): both read `pos = P`, both write `pos = P + delta`, and the row ends at
`P + delta` instead of `P + 2·delta`.

## Why last-write-wins is acceptable today

- **Contention is negligible.** Reputation moves only on run completion /
  curation. The near-term contributor base is ~12–30 people; the odds of two
  outcomes for the *same user in the same domain* landing in the same
  read-modify-write window are vanishingly small.
- **The signal is not yet load-bearing.** Retrieval weighting is OFF (Phase C) —
  reputation does not affect retrieval. A rare lost increment is invisible to
  users and self-heals: evidence is cumulative and time-decayed, so one dropped
  `+1.0` is washed out by the next outcome and by decay. It cannot corrupt state,
  only very slightly under-count.
- **Every write is already idempotent / non-fatal.** Contribution rows use
  `ON CONFLICT DO NOTHING`; attribution claims injection rows atomically
  (`UPDATE … WHERE attributed_at IS NULL RETURNING`); the whole reputation path
  is wrapped in try/catch by its callers. A lost update degrades a number, it
  never throws or blocks a run.

## When to revisit (the trigger)

Add a per-`(user, domain)` advisory lock **only if** the D3 anomaly scan
(`scripts/reputation-anomaly-scan.ts`) shows evidence of concurrent-update
contention — e.g. cred totals that don't reconcile against the contribution /
attribution event counts for a user, or a spike investigation that traces back
to interleaved writes rather than real activity. It is also a prerequisite before
enabling retrieval weighting (Phase C) if by then contention has grown.

## The fix, if/when we need it

Wrap the read-modify-write in a transaction guarded by a Postgres advisory lock
keyed on `(user, domain)`, matching the synthesis-DAG idiom
(`pg_try_advisory_lock`) already used elsewhere in the codebase:

```sql
-- hashtextextended gives a stable bigint key from the (user,domain) pair
SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0));
```

acquired at the top of a transaction that then does the `SELECT` and the
`INSERT … ON CONFLICT` together. `pg_advisory_xact_lock` auto-releases at
commit/rollback, so there is no leaked-lock failure mode. This serializes only
writers for the *same* `(user, domain)`; unrelated users never contend.

We are deliberately NOT paying that per-write round-trip until the contention is
real.
