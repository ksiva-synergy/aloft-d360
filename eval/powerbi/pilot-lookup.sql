SELECT id, display_name, connection_kind, status
FROM platform_context_sources
WHERE connection_kind = 'powerbi'
ORDER BY created_at DESC
LIMIT 3;

SELECT pbi_report_id, name, pbi_model_id
FROM pbi_reports
WHERE lifecycle = 'active'
  AND (name ILIKE '%CII%' OR name ILIKE '%SDK%')
ORDER BY name ASC
LIMIT 10;
