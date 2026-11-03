-- Verify a Continue / pipeline run (T3 → T4) against Postgres.
-- Replace placeholders before running in psql, DBeaver, or `npx tsx scripts/context/verify-pipeline-run.ts`.

-- ── 1) All jobs in one pipeline run ───────────────────────────────────────────
-- :pipeline_run_id = '8942f51f-c06e-44d1-8311-c67ea1049d7e'

SELECT
  id,
  job_kind,
  status,
  created_at,
  finished_at,
  scope->>'ui_surface' AS ui_surface,
  scope->>'pipeline_run_id' AS pipeline_run_id,
  scope->'chain' AS chain,
  scope->'includePatterns' AS include_patterns,
  stats
FROM platform_context_jobs
WHERE scope->>'pipeline_run_id' = :'pipeline_run_id'
ORDER BY created_at;

-- Jobs that should have the run id but were chained before the fix may only match includePatterns + time:
SELECT id, job_kind, status, scope->>'pipeline_run_id' AS pipeline_run_id, created_at
FROM platform_context_jobs
WHERE job_kind IN ('t3_usage', 't4_scan', 't4_entity_propose', 't4_dim_propose')
  AND created_at > NOW() - INTERVAL '7 days'
  AND (
    scope->>'pipeline_run_id' = :'pipeline_run_id'
    OR scope->>'ui_surface' = 'scanned_continue'
  )
ORDER BY created_at DESC
LIMIT 50;

-- ── 2) T4 parent + children ───────────────────────────────────────────────────

SELECT
  p.id AS parent_id,
  p.job_kind AS parent_kind,
  p.status AS parent_status,
  p.stats AS parent_stats,
  c.id AS child_id,
  c.job_kind AS child_kind,
  c.status AS child_status
FROM platform_context_jobs p
LEFT JOIN platform_context_jobs c ON c.parent_job_id = p.id
WHERE p.id = :'t4_scan_job_id'::uuid
   OR p.scope->>'pipeline_run_id' = :'pipeline_run_id'
ORDER BY p.created_at, c.child_index NULLS FIRST;

-- ── 3) Scope health: tables needing T4 in Navitas schemas (matches intent SQL) ─

SELECT
  COUNT(*) FILTER (WHERE o.last_t0_at IS NOT NULL) AS scanned,
  COUNT(*) FILTER (
    WHERE o.last_t2_at IS NOT NULL
      AND (o.last_t4_at IS NULL OR o.last_t4_at < o.last_t2_at)
  ) AS not_in_model,
  COUNT(*) FILTER (WHERE o.last_t3_at IS NOT NULL) AS ever_t3
FROM platform_context_objects o
WHERE o.lifecycle = 'active'
  AND o.org_id = :'org_id'
  AND o.source_id = :'source_id'::uuid
  AND (
    o.full_path LIKE 'curated_db.db_smac_prod_navitasai_crewing_public.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_crewing_shore.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_idp_public.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_crewing.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_document.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_public.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_vessel.%'
  );

-- Sample rows still eligible for t4_scan (same rule as scanEstateForT4):

SELECT
  o.full_path,
  o.last_t2_at,
  o.last_t3_at,
  o.last_t4_at,
  (o.last_t4_at IS NULL OR o.last_t4_at < o.last_t2_at) AS t4_stale
FROM platform_context_objects o
WHERE o.lifecycle = 'active'
  AND o.org_id = :'org_id'
  AND o.source_id = :'source_id'::uuid
  AND o.last_t2_at IS NOT NULL
  AND (o.last_t4_at IS NULL OR o.last_t4_at < o.last_t2_at)
  AND (
    o.full_path LIKE 'curated_db.db_smac_prod_navitasai_crewing_public.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_crewing_shore.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_idp_public.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_crewing.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_document.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_public.%'
    OR o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_vessel.%'
  )
ORDER BY o.full_path
LIMIT 30;

-- ── 4) T3 usage snapshots (did a run actually write?) ───────────────────────────

SELECT
  u.context_object_id,
  u.full_path,
  u.version,
  u.window_start,
  u.window_end,
  (u.access_stats->>'n_queries')::int AS n_queries
FROM platform_context_usage u
JOIN platform_context_objects o ON o.id = u.context_object_id
WHERE o.org_id = :'org_id'
  AND o.source_id = :'source_id'::uuid
  AND o.full_path LIKE 'curated_db.db_smac_prod_navitasai_masters_public.%'
ORDER BY u.full_path, u.version DESC
LIMIT 20;

-- ── 5) Single job stats decode (paste job id) ───────────────────────────────

SELECT
  id,
  job_kind,
  status,
  stats->>'objectsInScope' AS objects_in_scope,
  stats->>'objectsProcessed' AS objects_processed,
  stats->>'snapshotsWritten' AS snapshots_written,
  stats->>'skipped' AS skipped,
  stats->>'windowStart' AS window_start,
  stats->>'windowEnd' AS window_end,
  stats->>'clusters_enqueued' AS clusters_enqueued,
  stats->>'tables_total' AS tables_total
FROM platform_context_jobs
WHERE id = :'job_id'::uuid;
