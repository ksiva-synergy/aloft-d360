-- Single report lineage stitched from Postgres (same shape as notebooks/powerbi/single_report_lineage_from_postgres.py).
-- Set :org_id and :report_id (pbi_reports.id UUID).

-- Stitched: measure names from parse JSON → model measure → home table → UC
WITH measure_names AS (
  SELECT DISTINCT trim(elem) AS measure_name
  FROM pbi_reports r
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(r.props->'parse'->'measure_refs', '[]'::jsonb)
  ) AS elem
  WHERE r.org_id = :'org_id'
    AND r.id = :'report_id'::uuid
    AND trim(elem) <> ''
)
SELECT
  r.name AS report_name,
  mn.measure_name,
  (meas.id IS NOT NULL) AS found_on_model,
  mt.name AS measure_home_table,
  b.uc_full_path,
  o.full_path AS catalog_object_full_path
FROM measure_names mn
CROSS JOIN pbi_reports r
LEFT JOIN pbi_measures meas
  ON meas.org_id = r.org_id
 AND meas.model_id = r.model_id
 AND meas.lifecycle = 'active'
 AND lower(meas.name) = lower(mn.measure_name)
LEFT JOIN pbi_tables mt ON mt.id = meas.table_id
LEFT JOIN pbi_source_bindings b ON b.table_id = mt.id
LEFT JOIN platform_context_objects o ON o.id = b.context_object_id
WHERE r.id = :'report_id'::uuid;