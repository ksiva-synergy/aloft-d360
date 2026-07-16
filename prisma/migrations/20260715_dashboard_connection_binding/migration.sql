-- DEC-1 Phase 0: per-dashboard connection binding
-- Applied manually via `prisma db execute` on 2026-07-15.
-- Marked as applied with `prisma migrate resolve --applied` to prevent drift detection.

ALTER TABLE "platform_dashboards" ADD COLUMN IF NOT EXISTS "connection_id" TEXT;

-- Backfill: all live dashboards get the global default connection (synergy_dwh).
-- Verified by scripts/inspector/verify-dashboard-connection-backfill.ts before running.
UPDATE "platform_dashboards"
SET "connection_id" = 'cmq52i0160005a2hjkdyd2d88'
WHERE "connection_id" IS NULL
  AND "deleted_at" IS NULL;

ALTER TABLE "platform_dashboards" ALTER COLUMN "connection_id" SET NOT NULL;
