-- Column protections in the query path (E8-T5 / E11-T2): what the column check did or would do.
-- Additive only.
ALTER TABLE "access_decision_log" ADD COLUMN IF NOT EXISTS "column_mode" TEXT;
ALTER TABLE "access_decision_log" ADD COLUMN IF NOT EXISTS "masked_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "access_decision_log" ADD COLUMN IF NOT EXISTS "refused_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "access_decision_log" ADD COLUMN IF NOT EXISTS "parser_ok" BOOLEAN;
ALTER TABLE "access_decision_log" ADD COLUMN IF NOT EXISTS "timings" JSONB;
CREATE INDEX IF NOT EXISTS "idx_access_decision_log_column_mode" ON "access_decision_log" ("org_id", "column_mode", "ts" DESC);
