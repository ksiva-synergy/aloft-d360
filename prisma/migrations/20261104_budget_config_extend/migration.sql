-- Budget policy fields for Cost monitor (period, mode, org scope)

ALTER TABLE "budget_config"
  ADD COLUMN IF NOT EXISTS "org_id" TEXT,
  ADD COLUMN IF NOT EXISTS "period" TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS "mode" TEXT DEFAULT 'soft';

CREATE INDEX IF NOT EXISTS "idx_budget_config_org" ON "budget_config" ("org_id");
