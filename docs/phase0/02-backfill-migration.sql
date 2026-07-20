-- ============================================================================
-- 02-backfill-migration.sql  (CORRECTED against the real aloft-d360 schema)
--
-- Run AFTER 01 adds `connection_id String?` to platform_dashboards and BEFORE
-- the follow-up migration that makes it NOT NULL.
--
-- Goal: give every existing dashboard the same Databricks connection that
-- resolveToolCatalogEntry('') resolves to today, so nothing that currently
-- works (via the global default warehouse) breaks once dashboards start
-- reading connection_id.
--
-- CORRECTION vs the original reference: connections are NOT in a
-- `platform_db_connections` table. The value stored in
-- platform_dashboards.connection_id is a platform_databricks_connections.id.
-- The global default is resolved through the `tool_catalog` table:
-- resolveToolCatalogEntry('') (src/lib/inspector/tools.ts) looks up slug
-- 'synergy_dwh', then reads config->>'connection_id' from that catalog row.
-- ============================================================================

-- Step 0 (REQUIRED) — run the pre-flight FIRST. It calls the real
-- resolveToolCatalogEntry('') and prints the exact connection id to backfill
-- with, plus divergence warnings:
--
--   npx tsx scripts/inspector/verify-dashboard-connection-backfill.ts
--
-- Why this exists: the runtime's primary lookup is
-- `SELECT ... FROM tool_catalog WHERE slug = 'synergy_dwh' LIMIT 1` — with NO
-- type filter, NO status filter, and NO ORDER BY. `tool_catalog` has no org_id
-- (it is global), so the default is org-agnostic and every dashboard uses the
-- same one today. Reconstructing that in SQL is only safe if there is EXACTLY
-- ONE 'synergy_dwh' row; otherwise the runtime's LIMIT 1 is non-deterministic
-- and a re-derived query can pick a different connection than the app actually
-- uses. So the primary path below backfills from the literal id the pre-flight
-- prints (faithful by construction), NOT from a re-derived subquery.

-- Step 1 — inspect the 'synergy_dwh' rows. This MUST show exactly one row (or
-- multiple rows that all share the same connection_id) for the pure-SQL variant
-- in Step 2b to be safe. If rows differ, use Step 2a only.
SELECT id::text AS tool_catalog_id,
       slug,
       type,
       status,
       config->>'connection_id' AS connection_id
FROM tool_catalog
WHERE slug = 'synergy_dwh';

-- Sanity-check the resolved id exists and is active:
-- SELECT id, name, status, org_id FROM platform_databricks_connections
-- WHERE id = '<connection_id from the pre-flight>';

-- Step 2a (PRIMARY, recommended) — backfill from the literal the pre-flight
-- printed. Paste it in. This cannot diverge from what the app resolves today.
UPDATE platform_dashboards
SET connection_id = :canonical_connection_id   -- e.g. from the pre-flight script
WHERE connection_id IS NULL
  AND deleted_at IS NULL;

-- Step 2b (ALTERNATIVE, pure SQL) — ONLY if Step 1 confirmed a single
-- 'synergy_dwh' row (or all rows share one connection_id). Mirrors the runtime's
-- slug-only LIMIT 1 exactly (no `type` filter — the runtime doesn't have one).
--
-- UPDATE platform_dashboards d
-- SET connection_id = (
--   SELECT tc.config->>'connection_id'
--   FROM tool_catalog tc
--   WHERE tc.slug = 'synergy_dwh'
--   LIMIT 1
-- )
-- WHERE d.connection_id IS NULL
--   AND d.deleted_at IS NULL;

-- Step 3 — verify zero rows remain unbackfilled before the NOT NULL migration.
-- This MUST return 0.
SELECT count(*) AS unbackfilled_dashboards
FROM platform_dashboards
WHERE connection_id IS NULL
  AND deleted_at IS NULL;

-- Guard: also confirm the backfill didn't write NULLs (i.e. the subquery found
-- a connection). If the count below is > 0, the 'synergy_dwh' lookup returned
-- NULL — fix the tool_catalog config or use the fallback query before NOT NULL.
SELECT count(*) AS live_dashboards_still_null
FROM platform_dashboards
WHERE connection_id IS NULL
  AND deleted_at IS NULL;

-- ============================================================================
-- Follow-up Prisma migration (separate file, run only after Step 3 = 0):
--
--   model platform_dashboards {
--     connection_id String   // dropped the `?`
--   }
--
--   npx prisma migrate dev --name dashboard_connection_id_not_null
-- ============================================================================

-- Soft-deleted dashboards are intentionally left NULL above (excluded by the
-- WHERE clause) — they never execute again. Decide before the NOT NULL step:
--   (a) backfill them too with the same default (simplest), OR
--   (b) exclude deleted_at IS NOT NULL rows via a partial constraint.
-- If you keep a plain NOT NULL column constraint, option (a) is required or the
-- migration will fail on the soft-deleted rows. To do (a), drop the
-- `AND d.deleted_at IS NULL` filter from the Step 2 UPDATE.
