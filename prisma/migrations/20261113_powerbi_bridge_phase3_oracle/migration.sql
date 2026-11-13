-- Phase 3: DAX oracle result snapshots (pilot / non-RLS models).

CREATE TABLE IF NOT EXISTS pbi_oracle_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL,
  model_id          UUID NOT NULL,
  measure_id        UUID,
  measure_name      TEXT NOT NULL,
  dax_query         TEXT NOT NULL,
  result_hash       TEXT,
  row_count         INTEGER NOT NULL DEFAULT 0,
  result_preview    JSONB NOT NULL DEFAULT '[]',
  identity_kind     TEXT NOT NULL DEFAULT 'service_principal',
  model_refresh_at  TIMESTAMPTZ(6),
  run_id            TEXT,
  props             JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_pbi_oracle_model FOREIGN KEY (model_id) REFERENCES pbi_models (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pbi_oracle_org ON pbi_oracle_results (org_id);
CREATE INDEX IF NOT EXISTS idx_pbi_oracle_model ON pbi_oracle_results (model_id);
CREATE INDEX IF NOT EXISTS idx_pbi_oracle_measure ON pbi_oracle_results (org_id, measure_name);
