#!/usr/bin/env npx tsx
/**
 * Verify table usage in the last N days:
 * 1) Postgres: any T3 snapshots / last_t3_at on context objects
 * 2) Databricks: SELECT count in system_tables.query.query_history (same filters T3 uses)
 *
 * Usage:
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/verify-query-history-30d.ts --source-id ... --days 30 --sample 2000
 */

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import {
  buildQueryHistoryStatementSqlFilter,
  prefilterHistoryRowsForObjects,
} from '@/lib/context/job-scope';
import { QUERY_HISTORY_TABLE } from '@/lib/context/databricks-system-tables';

const DEFAULT_PATTERNS = [
  'curated_db.db_smac_prod_navitasai_crewing_public.*',
  'curated_db.db_smac_prod_navitasai_crewing_shore.*',
  'curated_db.db_smac_prod_navitasai_idp_public.*',
  'curated_db.db_smac_prod_navitasai_masters_crewing.*',
  'curated_db.db_smac_prod_navitasai_masters_document.*',
  'curated_db.db_smac_prod_navitasai_masters_public.*',
  'curated_db.db_smac_prod_navitasai_masters_vessel.*',
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sourceId = arg('--source-id') ?? 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const days = Math.max(1, Number(arg('--days') ?? '30') || 30);
  const orgId = arg('--org-id');

  const source = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: sourceId },
  });
  const resolvedOrgId = orgId ?? source.org_id;

  const pathClauses = DEFAULT_PATTERNS.reduce((acc, pat, i) => {
    const clause = Prisma.sql`o.full_path LIKE ${pat.replace('.*', '.%')}`;
    return i === 0 ? clause : Prisma.sql`${acc} OR ${clause}`;
  }, Prisma.empty as Prisma.Sql);

  const local = await prisma.$queryRaw<
    Array<{
      tables: number;
      with_t3_at: number;
      usage_snapshot_rows: number;
      max_usage_version: number | null;
    }>
  >`
    SELECT
      COUNT(DISTINCT o.id)::int AS tables,
      COUNT(DISTINCT o.id) FILTER (WHERE o.last_t3_at IS NOT NULL)::int AS with_t3_at,
      COUNT(u.id)::int AS usage_snapshot_rows,
      MAX(u.version)::int AS max_usage_version
    FROM platform_context_objects o
    LEFT JOIN platform_context_usage u
      ON u.context_object_id = o.id::text AND u.org_id = o.org_id
    WHERE o.lifecycle = 'active'
      AND o.org_id = ${resolvedOrgId}
      AND o.source_id = ${sourceId}::uuid
      AND (${pathClauses})
  `;

  console.log('\n=== ALOFT Postgres (platform_context_*) ===');
  console.log(`Source: ${source.display_name ?? sourceId}`);
  console.log(`Scope: ${DEFAULT_PATTERNS.length} Navitas schema patterns`);
  console.log(local[0]);
  console.log(
    '\nInterpretation: with_t3_at=0 and usage_snapshot_rows=0 means we have never stored T3 usage for these tables in our DB.',
  );
  console.log('That is NOT proof Databricks had zero queries — only that harvest never persisted usage.\n');

  const objectsRaw = await prisma.platformContextObject.findMany({
    where: { org_id: resolvedOrgId, source_id: sourceId, lifecycle: 'active' },
    select: {
      id: true,
      full_path: true,
      catalog_name: true,
      schema_name: true,
      object_name: true,
      last_t3_at: true,
    },
  });
  const objects = objectsRaw.filter(o =>
    DEFAULT_PATTERNS.some(p => {
      const prefix = p.replace(/\.\*$/, '.');
      return o.full_path.startsWith(prefix) || o.full_path === p.replace(/\.\*$/, '');
    }),
  );

  console.log(`In-scope context objects for patterns: ${objects.length}`);

  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
    select: { id: true, workspace_host: true, default_warehouse_id: true },
  });
  const adapter = new DatabricksAdapter(conn);

  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const statementTextSqlFilter = buildQueryHistoryStatementSqlFilter(objects);

  console.log(`\n=== Databricks ${QUERY_HISTORY_TABLE} ===`);
  console.log(`Window: last ${days} days (${since.toISOString()} → ${until.toISOString()})`);
  console.log(
    `SQL filter: ${statementTextSqlFilter ? 'scoped pushdown (contains on statement_text)' : 'none (too many / empty objects)'}`,
  );

  const sourceCtx = {
    id: source.id,
    org_id: source.org_id,
    connection_kind: source.connection_kind,
    connection_ref: source.connection_ref,
    display_name: source.display_name,
    scope_include: Array.isArray(source.scope_include) ? (source.scope_include as string[]) : null,
    scope_exclude: Array.isArray(source.scope_exclude) ? (source.scope_exclude as string[]) : null,
    harvest_config: null,
    status: source.status,
    last_sweep_at: source.last_sweep_at,
  };

  const sampleCap = Math.min(5000, Number(arg('--sample') ?? '2000') || 2000);

  try {
    const warehouseMatches = await adapter.countQueryHistoryWindow(since, until, {
      statementTextSqlFilter,
    });
    console.log(`Warehouse COUNT (scoped filter, same as T3): ${warehouseMatches.toLocaleString()} SELECT rows`);

    if (warehouseMatches === 0) {
      console.log('\nNo query history in this window matched the scope filter in SQL.');
      console.log('T3 would skip tables unless lineage-only signals exist.');
    } else {
      const { rows: raw, nextCursor } = await adapter.pullQueryHistoryWindow(
        sourceCtx,
        since,
        until,
        sampleCap,
        { statementTextSqlFilter },
      );
      console.log(
        `Sample pull (cap ${sampleCap.toLocaleString()}): ${raw.length.toLocaleString()} rows${nextCursor ? ' — truncated' : ''}`,
      );
      reportHistoryStats(raw, filteredFromRaw(raw, objects), objects, nextCursor);
      if (warehouseMatches > raw.length) {
        console.log(
          `\nNote: COUNT=${warehouseMatches.toLocaleString()} but sample has ${raw.length.toLocaleString()} — pass --sample for a larger per-table match sample.`,
        );
      }
    }
  } catch (err) {
    console.error('\nDatabricks check failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }

  console.log('\nDone.');
}

function filteredFromRaw(
  raw: Array<{ statement_text?: string | null }>,
  objects: Array<{
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
  }>,
) {
  return prefilterHistoryRowsForObjects(raw, objects);
}

function reportHistoryStats(
  raw: Array<{ statement_text?: string | null }>,
  filtered: Array<{ statement_text?: string | null }>,
  objects: Array<{
    full_path: string;
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
  }>,
  nextCursor: Date | null,
) {
  const tablesHit = new Set<string>();
  for (const obj of objects) {
    const any = filtered.some(r => {
      const sql = (r.statement_text ?? '').toLowerCase().replace(/`/g, '');
      const cat = (obj.catalog_name ?? '').toLowerCase();
      const sch = (obj.schema_name ?? '').toLowerCase();
      const tbl = (obj.object_name ?? '').toLowerCase();
      if (!tbl) return false;
      if (cat && sch && sql.includes(`${cat}.${sch}.${tbl}`)) return true;
      if (sch && sql.includes(`${sch}.${tbl}`)) return true;
      return false;
    });
    if (any) tablesHit.add(obj.full_path);
  }

  console.log(`History rows (warehouse pull): ${raw.length}${nextCursor ? ' (TRUNCATED at 50k — may miss older queries in window)' : ''}`);
  console.log(`History rows (qualified table match — what T3 counts): ${filtered.length}`);
  console.log(`Distinct in-scope tables with ≥1 matching query: ${tablesHit.size} / ${objects.length}`);

  if (raw.length > 0 && filtered.length === 0) {
    console.log(
      '\nDatabricks had SELECTs mentioning these schemas, but none used catalog.schema.table or schema.table — T3 treats that as "no usage".',
    );
  }
  if (raw.length === 0) {
    console.log('\nNo SELECT query history returned for this time window (warehouse-wide pull in fallback, or scoped pull returned 0).');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
