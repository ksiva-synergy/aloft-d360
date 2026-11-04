-- Unified spend ledger + harvest job launcher attribution
-- Applied via: prisma db execute --file <this> --schema ./prisma/schema.prisma
-- Then: prisma migrate resolve --applied 20261103_platform_spend_events

ALTER TABLE "platform_context_jobs"
  ADD COLUMN IF NOT EXISTS "triggered_by_user_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_pcj_triggered_by_user"
  ON "platform_context_jobs" ("triggered_by_user_id");

CREATE TABLE IF NOT EXISTS "platform_spend_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bucket" TEXT NOT NULL,
  "user_id" TEXT,
  "surface" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "usd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "input_tokens" INTEGER DEFAULT 0,
  "output_tokens" INTEGER DEFAULT 0,
  "cache_read_tokens" INTEGER DEFAULT 0,
  "cache_write_tokens" INTEGER DEFAULT 0,
  "model" TEXT,
  "status" TEXT DEFAULT 'success',
  "session_id" TEXT,
  "turn_id" TEXT,
  "job_id" UUID,
  "agent_slug" TEXT,
  "job_kind" TEXT,
  "source_id" UUID,
  "reference_type" TEXT,
  "reference_id" TEXT,
  "meta" JSONB,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_spend_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_spend_event_ref"
  ON "platform_spend_events" ("reference_type", "reference_id", "action");

CREATE INDEX IF NOT EXISTS "idx_platform_spend_org_time"
  ON "platform_spend_events" ("org_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_platform_spend_user_time"
  ON "platform_spend_events" ("user_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_platform_spend_bucket_time"
  ON "platform_spend_events" ("bucket", "occurred_at" DESC);
