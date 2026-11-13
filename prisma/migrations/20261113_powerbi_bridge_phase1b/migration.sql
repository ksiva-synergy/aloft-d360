-- Power BI semantic bridge — Phase 1b (parsed model structure).
-- Apply after Phase 1a (see scripts/powerbi/apply-phase1b-migration.mjs).

CREATE TABLE IF NOT EXISTS pbi_tables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  model_id        UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  lineage_tag     TEXT,
  partition_kind  TEXT,
  storage_mode    TEXT,
  hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  source_m        TEXT,
  is_auto_date    BOOLEAN NOT NULL DEFAULT FALSE,
  content_hash    TEXT,
  lifecycle       TEXT NOT NULL DEFAULT 'active',
  first_seen_run  TEXT,
  last_seen_run   TEXT,
  props           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_table_org_model_name UNIQUE (org_id, model_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pbi_tables_org ON pbi_tables (org_id);
CREATE INDEX IF NOT EXISTS idx_pbi_tables_model ON pbi_tables (model_id);

CREATE TABLE IF NOT EXISTS pbi_columns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  model_id         UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  table_id         UUID NOT NULL REFERENCES pbi_tables(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  data_type        TEXT,
  source_column    TEXT,
  lineage_tag      TEXT,
  display_folder   TEXT,
  format_string    TEXT,
  summarize_by     TEXT,
  calculated_dax   TEXT,
  content_hash     TEXT,
  lifecycle        TEXT NOT NULL DEFAULT 'active',
  props            JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_column_table_name UNIQUE (table_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pbi_columns_model ON pbi_columns (model_id);
CREATE INDEX IF NOT EXISTS idx_pbi_columns_table ON pbi_columns (table_id);

CREATE TABLE IF NOT EXISTS pbi_measures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  model_id         UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  table_id         UUID NOT NULL REFERENCES pbi_tables(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  dax              TEXT NOT NULL,
  dax_hash         TEXT,
  lineage_tag      TEXT,
  format_string    TEXT,
  display_folder   TEXT,
  content_hash     TEXT,
  lifecycle        TEXT NOT NULL DEFAULT 'active',
  props            JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_measure_table_name UNIQUE (table_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pbi_measures_model ON pbi_measures (model_id);
CREATE INDEX IF NOT EXISTS idx_pbi_measures_table ON pbi_measures (table_id);

CREATE TABLE IF NOT EXISTS pbi_relationships (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                TEXT NOT NULL,
  model_id              UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  pbi_relationship_id   TEXT NOT NULL,
  from_column           TEXT,
  to_column             TEXT,
  cardinality           TEXT,
  cross_filtering       TEXT,
  is_active             BOOLEAN,
  content_hash          TEXT,
  lifecycle             TEXT NOT NULL DEFAULT 'active',
  props                 JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_rel_org_model UNIQUE (org_id, model_id, pbi_relationship_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_rel_model ON pbi_relationships (model_id);

CREATE TABLE IF NOT EXISTS pbi_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  model_id        UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  filter_dax      TEXT,
  content_hash    TEXT,
  lifecycle       TEXT NOT NULL DEFAULT 'active',
  props           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_role_model_name UNIQUE (org_id, model_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pbi_roles_model ON pbi_roles (model_id);

CREATE TABLE IF NOT EXISTS pbi_source_bindings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL,
  model_id          UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  table_id          UUID NOT NULL REFERENCES pbi_tables(id) ON DELETE CASCADE,
  partition_kind    TEXT NOT NULL,
  connector         TEXT,
  connection_host   TEXT,
  native_sql        TEXT,
  uc_full_path      TEXT,
  bind_status       TEXT NOT NULL DEFAULT 'pending',
  source_m_hash     TEXT,
  props             JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_binding_table UNIQUE (table_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_bindings_model ON pbi_source_bindings (model_id);

CREATE TABLE IF NOT EXISTS pbi_embedded_tables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  model_id        UUID NOT NULL REFERENCES pbi_models(id) ON DELETE CASCADE,
  table_id        UUID NOT NULL REFERENCES pbi_tables(id) ON DELETE CASCADE,
  row_count       INTEGER,
  content_sha256  TEXT,
  pii_checked     BOOLEAN NOT NULL DEFAULT FALSE,
  props           JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_embedded_table UNIQUE (table_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_embedded_model ON pbi_embedded_tables (model_id);
