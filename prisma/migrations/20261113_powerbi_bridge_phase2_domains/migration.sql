-- Power BI domain registry + measure name conflicts (Phase 2).

CREATE TABLE IF NOT EXISTS pbi_domains (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT NOT NULL,
  domain_key     TEXT NOT NULL,
  name           TEXT NOT NULL,
  steward_group  TEXT,
  sensitivity    TEXT,
  rollout_wave   INTEGER NOT NULL DEFAULT 99,
  lexicon        JSONB NOT NULL DEFAULT '[]',
  props          JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_domain_org_key UNIQUE (org_id, domain_key)
);

CREATE INDEX IF NOT EXISTS idx_pbi_domains_org ON pbi_domains (org_id);

CREATE TABLE IF NOT EXISTS pbi_conflicts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT NOT NULL,
  metric_name    TEXT NOT NULL,
  metric_key     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'proposed',
  model_ids      JSONB NOT NULL DEFAULT '[]',
  domain_keys    JSONB NOT NULL DEFAULT '[]',
  dax_hashes     JSONB NOT NULL DEFAULT '[]',
  summary        TEXT,
  first_seen_run TEXT,
  last_seen_run  TEXT,
  props          JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pbi_conflict_org_metric UNIQUE (org_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_pbi_conflicts_org ON pbi_conflicts (org_id);

-- pbi_models.domain_id was TEXT in Phase 1; domain rows use UUID (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pbi_models'
      AND column_name = 'domain_id'
      AND udt_name <> 'uuid'
  ) THEN
    ALTER TABLE pbi_models
      ALTER COLUMN domain_id TYPE UUID USING (
        CASE
          WHEN domain_id IS NULL OR btrim(domain_id::text) = '' THEN NULL
          ELSE domain_id::text::uuid
        END
      );
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE pbi_models
    ADD CONSTRAINT fk_pbi_models_domain
    FOREIGN KEY (domain_id) REFERENCES pbi_domains (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
