-- Power BI model families (near-duplicate / year-variant models).

CREATE TABLE IF NOT EXISTS pbi_families (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL,
  family_key        TEXT NOT NULL,
  name              TEXT NOT NULL,
  varying_parameter TEXT,
  member_constants  JSONB NOT NULL DEFAULT '{}',
  props             JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_family_org_key UNIQUE (org_id, family_key)
);

CREATE INDEX IF NOT EXISTS idx_pbi_families_org ON pbi_families (org_id);

ALTER TABLE pbi_models
  ADD COLUMN IF NOT EXISTS family_id UUID;

DO $$
BEGIN
  ALTER TABLE pbi_models
    ADD CONSTRAINT fk_pbi_models_family
    FOREIGN KEY (family_id) REFERENCES pbi_families (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
