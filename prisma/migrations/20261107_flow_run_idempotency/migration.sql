-- Automate runs: an idempotency key so the same "run now" request sent twice starts one run.
-- Additive only: one nullable column and one partial unique index. Nothing existing is changed or removed.
--
-- Apply manually via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20261107_flow_run_idempotency` (same convention as 20261025_flows).
-- Rollback is a manual step for a person: remove index "uq_platform_flow_run_idem" and column
-- "platform_flow_runs"."idempotency_key". Nothing in the app depends on them being absent.

ALTER TABLE "platform_flow_runs" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_flow_run_idem"
  ON "platform_flow_runs" ("flow_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
