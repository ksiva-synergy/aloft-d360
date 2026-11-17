CREATE TABLE IF NOT EXISTS pbi_report_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  report_id UUID NOT NULL REFERENCES pbi_reports(id) ON DELETE CASCADE,
  model_id UUID,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'partial',
  measure_count INTEGER NOT NULL DEFAULT 0,
  uc_paths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  lineage JSONB NOT NULL DEFAULT '{}',
  warnings JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pbi_report_lineage_report ON pbi_report_lineage(report_id);
CREATE INDEX IF NOT EXISTS idx_pbi_report_lineage_status ON pbi_report_lineage(org_id, status);
CREATE INDEX IF NOT EXISTS idx_pbi_report_lineage_model ON pbi_report_lineage(org_id, model_id);