# Phase A — staging verification bundle

Turnkey setup to run Phase A step 3 off-prod. Everything here targets a local
throwaway Postgres+pgvector container — no contact with the prod writer.

## Files

- `docker-compose.staging.yml` — Postgres 16 + pgvector on host port **5434**.
- `init/00-extensions.sql` — enables `vector` / `pgcrypto` on first boot.
- `env.staging.example` — copy to `.env.staging`; points Prisma at the container.
- `.env.staging` — throwaway local env (already provided), sourced by the setup script.
- `staging-setup.sh` — one-shot: confirm daemon → boot → schema → migration → verify → smoke test.
- `../scripts/reputation-smoke.ts` — the seeded integration test.

## Run it

```bash
# from repo root (Docker Desktop must be running)
bash staging/staging-setup.sh
```

Expected tail:

```
[PASS] bound session resolves to its user
[PASS] null-user session resolves to null
[PASS] 'anonymous' session resolves to null
[PASS] helpful domain rises above prior — A=0.775 prior=0.55
[PASS] harmful domain falls below prior — B=0.367
[PASS] per-domain divergence (A > B)
[PASS] bound session created a reputation row
[PASS] anonymous run created NO contribution rows
[PASS] contribution row recorded
[PASS] contributor_rep moved off default 1.0
[PASS] anonymous contribution is a no-op
[PASS] anonymous bullet contributor_rep stayed 1.0

SMOKE TEST PASSED
```

## What each assertion protects

- **run_id → user_id** — the join the whole signal depends on. If this fails, the
  fix is upstream: confirm the inspector chat route passes `sessionId` as `run_id`
  and that sessions are created with a real `user_id`.
- **anonymous no-op** — unbound runs must never fabricate attribution or throw.
- **per-domain divergence** — proves reputation is genuinely vector (per `agent_class`),
  not a single scalar: the same user is above prior in `billing`, below in `auth`.
- **contributor_rep off 1.0** — proves the Stage-3 multiplier is being maintained on
  write (still unused by retrieval until you enable weighting in Phase C).

## Notes

- Requires Docker, plus `npx tsx` (present in this repo's deps).
- **Port:** the container binds host **5434**, not 5433 — this machine already runs a
  native Postgres on 5433 which is unrelated and left untouched. Change the bind in
  `docker-compose.staging.yml` and the URLs in `.env.staging` in lockstep if 5434 is busy.
- The smoke test does **not** seed a `User` row: your `model User` has no `@@map` (table
  is `"User"`, not `users`) and `workbench_sessions.user_id` has no FK to it, so the
  `user_id` string on the session resolves on its own. The bullet insert sets its
  columns explicitly (incl. `updated_at`, which is `@updatedAt` / client-side only and
  therefore has no DB default under `prisma db push`).
- `prisma db push` builds the full schema fast for dev. It is NOT how you apply to
  prod — for prod use `prisma db execute --file <migration.sql>` as in step 5.
- The smoke test tags rows with a dedicated org id and cleans up, so it is
  re-runnable. It refuses to run unless `MEMORY_REPUTATION_ENABLED=true`.
- To reset the DB entirely: `docker compose -f staging/docker-compose.staging.yml down -v`.
