-- Phase 3: measure translation attempts (rule tier first).

CREATE TABLE IF NOT EXISTS pbi_translations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT NOT NULL,
  model_id       UUID NOT NULL,
  measure_id     UUID,
  measure_name   TEXT NOT NULL,
  dax_hash       TEXT,
  sql_text       TEXT,
  tier           TEXT NOT NULL DEFAULT 'rule',
  status         TEXT NOT NULL DEFAULT 'draft',
  parity_verdict TEXT,
  run_id         TEXT,
  props          JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_pbi_translation_model FOREIGN KEY (model_id) REFERENCES pbi_models (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pbi_translation_org_measure
  ON pbi_translations (org_id, measure_id);

CREATE INDEX IF NOT EXISTS idx_pbi_translations_org ON pbi_translations (org_id);
CREATE INDEX IF NOT EXISTS idx_pbi_translations_model ON pbi_translations (model_id);
