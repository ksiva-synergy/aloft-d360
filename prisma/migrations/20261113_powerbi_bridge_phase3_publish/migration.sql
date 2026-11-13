-- Phase 3: verified queries from Power BI translations (minimal v1 for Inspector retrieval).

CREATE TABLE IF NOT EXISTS kb_verified_queries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             TEXT NOT NULL,
  question           TEXT NOT NULL,
  alt_phrasings      TEXT[] NOT NULL DEFAULT '{}',
  sql                TEXT NOT NULL,
  params             JSONB,
  tables_used        TEXT[] NOT NULL DEFAULT '{}',
  schema_hash        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'candidate',
  origin             TEXT NOT NULL,
  pbi_translation_id UUID,
  pbi_measure_id     UUID,
  props              JSONB NOT NULL DEFAULT '{}',
  verified_by        TEXT,
  verified_at        TIMESTAMPTZ(6),
  last_validated_at  TIMESTAMPTZ(6),
  embedding          vector(1024),
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_vq_org_measure
  ON kb_verified_queries (org_id, pbi_measure_id)
  WHERE pbi_measure_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_vq_translation
  ON kb_verified_queries (pbi_translation_id)
  WHERE pbi_translation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kb_vq_org_status ON kb_verified_queries (org_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_vq_org_origin ON kb_verified_queries (org_id, origin);
