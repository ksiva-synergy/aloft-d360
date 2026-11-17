-- Power BI bridge lineage in Postgres (read-only steward queries).
-- Replace :org_id and optional filters before running in psql / DBeaver.

-- Crosswalk: semantic table → UC path → catalog object
SELECT
  m.name AS model_name,
  t.name AS pbi_table,
  t.lineage_tag,
  b.bind_status,
  b.uc_full_path,
  b.connector,
  o.full_path AS context_object_full_path
FROM pbi_source_bindings b
JOIN pbi_tables t ON t.id = b.table_id AND t.lifecycle = 'active'
JOIN pbi_models m ON m.id = b.model_id
LEFT JOIN platform_context_objects o ON o.id = b.context_object_id
WHERE b.org_id = :'org_id'
ORDER BY m.name, t.name;

-- Power Query source (column-level lineage is NOT materialized — parse with m-lineage in app)
SELECT m.name, t.name AS pbi_table, LENGTH(t.source_m) AS source_m_bytes, t.partition_kind
FROM pbi_tables t
JOIN pbi_models m ON m.id = t.model_id
WHERE t.org_id = :'org_id'
  AND t.lifecycle = 'active'
  AND t.source_m IS NOT NULL
ORDER BY source_m_bytes DESC
LIMIT 50;

-- In-model join lineage
SELECT m.name, r.from_column, r.to_column, r.cardinality, r.is_active
FROM pbi_relationships r
JOIN pbi_models m ON m.id = r.model_id
WHERE r.org_id = :'org_id'
  AND r.lifecycle = 'active';