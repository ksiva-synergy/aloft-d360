-- Power BI semantic bridge — Phase 1 (inventory + model/report skeleton).
-- Apply after DB backup (see backups/README.md):
--   npx prisma db execute --file prisma/migrations/20261111_powerbi_bridge_phase1/migration.sql --schema ./prisma/schema.prisma
--   npx prisma migrate resolve --applied 20261111_powerbi_bridge_phase1
-- Rollback: drop tables in reverse FK order (operators only).

CREATE TABLE IF NOT EXISTS pbi_workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  pbi_workspace_id TEXT NOT NULL,
  name            TEXT,
  capacity_id     TEXT,
  domain_hint     TEXT,
  content_hash    TEXT,
  lifecycle       TEXT NOT NULL DEFAULT 'active',
  first_seen_run  TEXT,
  last_seen_run   TEXT,
  props           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_ws_org UNIQUE (org_id, pbi_workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_ws_org ON pbi_workspaces (org_id);

CREATE TABLE IF NOT EXISTS pbi_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES pbi_workspaces(id) ON DELETE CASCADE,
  pbi_model_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  configured_by   TEXT,
  is_refreshable  BOOLEAN,
  storage_mode    TEXT,
  rls_required    BOOLEAN NOT NULL DEFAULT FALSE,
  ols_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  endorsement     TEXT,
  last_refresh_at TIMESTAMPTZ(6),
  domain_id       TEXT,
  content_hash    TEXT,
  lifecycle       TEXT NOT NULL DEFAULT 'active',
  first_seen_run  TEXT,
  last_seen_run   TEXT,
  props           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_model_org UNIQUE (org_id, pbi_model_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_models_org ON pbi_models (org_id);
CREATE INDEX IF NOT EXISTS idx_pbi_models_ws ON pbi_models (workspace_id);

CREATE TABLE IF NOT EXISTS pbi_model_datasources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL,
  model_id          UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  datasource_id     TEXT,
  gateway_id        TEXT,
  datasource_type   TEXT,
  connection_server TEXT,
  connection_path   TEXT,
  is_personal_file  BOOLEAN NOT NULL DEFAULT FALSE,
  raw               JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbi_ds_model ON pbi_model_datasources (model_id);

CREATE TABLE IF NOT EXISTS pbi_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  workspace_id    UUID NOT NULL REFERENCES pbi_workspaces(id) ON DELETE CASCADE,
  model_id        UUID REFERENCES pbi_models(id) ON DELETE SET NULL,
  pbi_report_id   TEXT NOT NULL,
  pbi_model_id    TEXT,
  name            TEXT NOT NULL,
  report_type     TEXT,
  report_format   TEXT,
  web_url         TEXT,
  summary_text    TEXT,
  content_hash    TEXT,
  lifecycle       TEXT NOT NULL DEFAULT 'active',
  first_seen_run  TEXT,
  last_seen_run   TEXT,
  props           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_report_org UNIQUE (org_id, pbi_report_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_reports_org ON pbi_reports (org_id);
CREATE INDEX IF NOT EXISTS idx_pbi_reports_model ON pbi_reports (model_id);

CREATE TABLE IF NOT EXISTS pbi_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                TEXT NOT NULL,
  pbi_report_id         TEXT NOT NULL,
  report_name           TEXT,
  views                 INTEGER NOT NULL DEFAULT 0,
  distinct_users        INTEGER NOT NULL DEFAULT 0,
  window_start          DATE,
  window_end            DATE,
  usage_model_id        TEXT,
  usage_model_refresh   TIMESTAMPTZ(6),
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbi_usage_org_report ON pbi_usage (org_id, pbi_report_id);
