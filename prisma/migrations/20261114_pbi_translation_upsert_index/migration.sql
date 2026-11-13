-- Prisma upsert ON CONFLICT (org_id, measure_id) requires a non-partial unique index.

DROP INDEX IF EXISTS uq_pbi_translation_org_measure;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pbi_translation_org_measure
  ON pbi_translations (org_id, measure_id);
