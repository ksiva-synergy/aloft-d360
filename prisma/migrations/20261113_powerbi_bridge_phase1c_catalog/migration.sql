-- Power BI catalog link: bind warehouse partitions to platform_context_objects.

ALTER TABLE pbi_source_bindings
  ADD COLUMN IF NOT EXISTS context_object_id UUID REFERENCES platform_context_objects(id) ON DELETE SET NULL;

ALTER TABLE pbi_source_bindings
  ADD COLUMN IF NOT EXISTS databricks_source_id UUID REFERENCES platform_context_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pbi_bindings_context_object ON pbi_source_bindings (context_object_id);
