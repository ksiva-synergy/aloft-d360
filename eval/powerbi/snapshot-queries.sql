-- Read-only snapshots for Power BI bridge validation (run on dev Aurora).

-- Phase 0/1: any Power BI context source registered?
SELECT id, name, connection_kind, status, created_at
FROM platform_context_sources
WHERE connection_kind = 'powerbi';

-- Phase 1+: inventory tables (run after migration)
SELECT 'pbi_workspaces' AS tbl, COUNT(*)::bigint AS n FROM pbi_workspaces
UNION ALL SELECT 'pbi_models', COUNT(*) FROM pbi_models
UNION ALL SELECT 'pbi_reports', COUNT(*) FROM pbi_reports
UNION ALL SELECT 'pbi_usage', COUNT(*) FROM pbi_usage
UNION ALL SELECT 'pbi_model_datasources', COUNT(*) FROM pbi_model_datasources;

-- Phase 3+ (when shipped): verified queries from Power BI publish
-- SELECT COUNT(*) FROM kb_verified_queries WHERE origin = 'powerbi';

-- Recent inventory jobs
SELECT id, job_kind, status, finished_at, stats
FROM platform_context_jobs
WHERE job_kind = 'pbi_inventory'
ORDER BY finished_at DESC NULLS LAST
LIMIT 10;
