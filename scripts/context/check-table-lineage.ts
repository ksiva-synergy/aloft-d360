/**
 * Sample system.access.table_lineage for Aloft context objects.
 * Usage:
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/check-table-lineage.ts --full-path darwin_box.curated_db.employee_master
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/check-table-lineage.ts --pattern "curated_db.db_smac_prod_navitasai_masters_public.%"
 */
import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { buildLineageTableSqlFilter } from '@/lib/context/job-scope';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Exec = { scopeExec: (s: string, o?: { rowLimit?: number }) => Promise<{ rows: Record<string, unknown>[] }> };

const NAVITAS_PREFIXES = [
  'curated_db.db_smac_prod_navitasai_crewing_public.',
  'curated_db.db_smac_prod_navitasai_crewing_shore.',
  'curated_db.db_smac_prod_navitasai_idp_public.',
  'curated_db.db_smac_prod_navitasai_masters_crewing.',
  'curated_db.db_smac_prod_navitasai_masters_document.',
  'curated_db.db_smac_prod_navitasai_masters_public.',
  'curated_db.db_smac_prod_navitasai_masters_vessel.',
];

async function main() {
  const sourceId = arg('--source-id') ?? 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const fullPath = arg('--full-path');
  const pattern = arg('--pattern');
  const days = Math.max(1, Number(arg('--days') ?? '30') || 30);

  const source = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
  });
  const adapter = new DatabricksAdapter(conn) as unknown as Exec;

  let objects: Array<{
    full_path: string;
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
  }> = [];

  if (fullPath) {
    const o = await prisma.platformContextObject.findFirst({
      where: { source_id: sourceId, lifecycle: 'active', full_path: fullPath },
      select: { full_path: true, catalog_name: true, schema_name: true, object_name: true },
    });
    if (!o) {
      console.error('No platform_context_object for full_path:', fullPath);
      process.exitCode = 1;
      return;
    }
    objects = [o];
  } else if (pattern) {
    const prefix = pattern.replace(/\.\*$/, '.');
    const all = await prisma.platformContextObject.findMany({
      where: { source_id: sourceId, lifecycle: 'active' },
      select: { full_path: true, catalog_name: true, schema_name: true, object_name: true },
    });
    objects = all.filter(o => o.full_path.startsWith(prefix));
  } else {
    const all = await prisma.platformContextObject.findMany({
      where: { source_id: sourceId, lifecycle: 'active' },
      select: { full_path: true, catalog_name: true, schema_name: true, object_name: true },
    });
    objects = all.filter(o => NAVITAS_PREFIXES.some(p => o.full_path.startsWith(p)));
  }

  console.log('Workspace connection:', conn.workspace_host);
  console.log(`Objects in scope: ${objects.length}`);
  console.log(`Lineage window: last ${days} days (same family as T3 pullTableLineage)\n`);

  const filter = buildLineageTableSqlFilter(objects);
  console.log('Warehouse filter (T3 buildLineageTableSqlFilter):', filter ? 'yes (scoped)' : 'none');

  const predicate = filter?.trim() ? ` ${filter.trim()} ` : '';
  const countSql =
    `SELECT COUNT(*) AS n FROM system.access.table_lineage ` +
    `WHERE event_time >= CURRENT_TIMESTAMP() - INTERVAL ${days} DAYS${predicate}`;
  const countRes = await adapter.scopeExec(countSql, { rowLimit: 1 });
  const scopedRows = Number(countRes.rows[0]?.n ?? 0);
  console.log(`Rows in table_lineage (scoped filter): ${scopedRows.toLocaleString()}`);

  const totalSql =
    `SELECT COUNT(*) AS n FROM system.access.table_lineage ` +
    `WHERE event_time >= CURRENT_TIMESTAMP() - INTERVAL ${days} DAYS`;
  const totalRes = await adapter.scopeExec(totalSql, { rowLimit: 1 });
  console.log(`Rows in table_lineage (workspace-wide, same window): ${Number(totalRes.rows[0]?.n ?? 0).toLocaleString()}\n`);

  if (fullPath) {
    const fp = fullPath.toLowerCase();
    const edgeSql =
      `SELECT source_table_full_name, target_table_full_name, event_time ` +
      `FROM system.access.table_lineage ` +
      `WHERE event_time >= CURRENT_TIMESTAMP() - INTERVAL ${days} DAYS ` +
      `AND (LOWER(source_table_full_name) = '${fp.replace(/'/g, "''")}' ` +
      `OR LOWER(target_table_full_name) = '${fp.replace(/'/g, "''")}') ` +
      `ORDER BY event_time DESC LIMIT 15`;
    const edges = await adapter.scopeExec(edgeSql, { rowLimit: 15 });
    console.log(`=== Edges touching ${fullPath} (up to 15) ===`);
    if (edges.rows.length === 0) {
      console.log('(none in this window)');
    } else {
      for (const r of edges.rows) {
        console.log(r.event_time, '←', r.source_table_full_name, '→', r.target_table_full_name);
      }
    }
  }

  if (objects.length > 0 && objects.length <= 500) {
    const paths = [...new Set(objects.map(o => o.full_path.toLowerCase()))];
    let withLineage = 0;
    for (const fp of paths.slice(0, 50)) {
      const q =
        `SELECT 1 AS x FROM system.access.table_lineage ` +
        `WHERE event_time >= CURRENT_TIMESTAMP() - INTERVAL ${days} DAYS ` +
        `AND (LOWER(source_table_full_name) = '${fp.replace(/'/g, "''")}' ` +
        `OR LOWER(target_table_full_name) = '${fp.replace(/'/g, "''")}') LIMIT 1`;
      const r = await adapter.scopeExec(q, { rowLimit: 1 });
      if (r.rows.length > 0) withLineage++;
    }
    const sampled = Math.min(paths.length, 50);
    console.log(`\nTables with ≥1 lineage edge (sampled first ${sampled} of ${paths.length}): ${withLineage}/${sampled}`);
    if (paths.length > 50) console.log('(Increase script to scan all paths if needed.)');
  }

  console.log(
    '\nNote: T3 reads this data but does NOT create usage snapshots from lineage alone — only enriches after query history matches.',
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
