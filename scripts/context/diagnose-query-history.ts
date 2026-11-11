#!/usr/bin/env npx tsx
/**
 * Compare workspace query history vs T3 scoped filters for a table substring.
 * Usage:
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/diagnose-query-history.ts --source-id ... --days 7 --needle sire_report
 */
import prisma from '@/lib/db';
import { executeDatabricksSQL, DATABRICKS_API_MAX_WAIT_SECS } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';
import { QUERY_HISTORY_TABLE } from '@/lib/context/databricks-system-tables';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Optional exact Aloft full_path e.g. darwin_box.curated_db.employee_master */
const FULL_PATH = arg('--full-path');

async function main() {
  const sourceId = arg('--source-id') ?? 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const days = Math.max(1, Number(arg('--days') ?? '7') || 7);
  const needle = (arg('--needle') ?? 'sire_report').toLowerCase();

  const source = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: sourceId },
  });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
    select: { id: true, workspace_host: true, default_warehouse_id: true },
  });

  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);
  const sinceIso = since.toISOString().replace('T', ' ').replace('Z', '');
  const untilIso = until.toISOString().replace('T', ' ').replace('Z', '');
  const base =
    `WHERE start_time >= TIMESTAMP '${sinceIso}' ` +
    `AND start_time < TIMESTAMP '${untilIso}' ` +
    `AND statement_type = 'SELECT'`;
  const norm = "replace(lower(statement_text), '`', '')";

  const token = await getAccessToken(conn.id, conn.workspace_host, 'metadata');

  async function count(extra: string): Promise<number> {
    const sql = `SELECT COUNT(*) AS n FROM ${QUERY_HISTORY_TABLE} ${base}${extra}`;
    const r = await executeDatabricksSQL(
      conn.id,
      conn.workspace_host,
      conn.default_warehouse_id,
      token,
      {
        statement: sql,
        rowLimit: 1,
        waitTimeoutSecs: DATABRICKS_API_MAX_WAIT_SECS,
        asyncPolling: true,
      },
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async function sample(extra: string, lim = 8) {
    const sql =
      `SELECT LEFT(statement_text, 300) AS st, executed_as, start_time, query_source ` +
      `FROM ${QUERY_HISTORY_TABLE} ${base}${extra} ORDER BY start_time DESC LIMIT ${lim}`;
    const r = await executeDatabricksSQL(
      conn.id,
      conn.workspace_host,
      conn.default_warehouse_id,
      token,
      { statement: sql, rowLimit: lim, waitTimeoutSecs: DATABRICKS_API_MAX_WAIT_SECS, asyncPolling: true },
    );
    return r.rows;
  }

  const obj = FULL_PATH
    ? await prisma.platformContextObject.findFirst({
        where: { source_id: sourceId, lifecycle: 'active', full_path: FULL_PATH },
        select: {
          full_path: true,
          catalog_name: true,
          schema_name: true,
          object_name: true,
          last_t3_at: true,
        },
      })
    : await prisma.platformContextObject.findFirst({
    where: {
      source_id: sourceId,
      lifecycle: 'active',
      OR: [
        { full_path: { contains: needle } },
        { object_name: { equals: needle, mode: 'insensitive' } },
      ],
    },
    select: {
      full_path: true,
      catalog_name: true,
      schema_name: true,
      object_name: true,
      last_t3_at: true,
    },
  });

  console.log('\n=== Connection ===');
  console.log('Source:', source.display_name ?? sourceId);
  console.log('Workspace:', conn.workspace_host);
  console.log(`Window: last ${days} days`);
  console.log('\n=== Aloft object (if any) ===');
  console.log(obj ?? '(no matching platform_context_object on this source)');

  const allSelect = await count('');
  const needleCount = await count(` AND contains(${norm}, '${needle.replace(/'/g, "''")}')`);

  console.log(`\n=== ${QUERY_HISTORY_TABLE} (this workspace + warehouse) ===`);
  console.log('All SELECT rows in window:', allSelect.toLocaleString());
  console.log(`SELECT rows whose SQL text contains "${needle}":`, needleCount.toLocaleString());

  if (obj?.catalog_name && obj.schema_name && obj.object_name) {
    const fq = `${obj.catalog_name}.${obj.schema_name}.${obj.object_name}`.toLowerCase();
    const sq = `${obj.schema_name}.${obj.object_name}`.toLowerCase();
    const fqCount = await count(` AND contains(${norm}, '${fq.replace(/'/g, "''")}')`);
    const sqCount = await count(` AND contains(${norm}, '${sq.replace(/'/g, "''")}')`);
    console.log(`T3 fully-qualified match (${fq}):`, fqCount.toLocaleString());
    console.log(`T3 schema-qualified match (${sq}):`, sqCount.toLocaleString());
    console.log(
      '\nIf needle count > 0 but fq/sq = 0, your SQL likely uses aliases, views, or bare table names — T3 will skip.',
    );
  }

  if (needleCount > 0) {
    console.log('\n=== Recent queries mentioning needle ===');
    for (const row of await sample(` AND contains(${norm}, '${needle.replace(/'/g, "''")}')`)) {
      console.log('---');
      console.log('start_time:', row.start_time);
      console.log('executed_as:', row.executed_as);
      console.log('query_source:', JSON.stringify(row.query_source));
      console.log('statement_text:', row.st);
    }
  } else if (allSelect === 0) {
    console.log(
      '\nNo SELECT history at all in this window on THIS connection workspace. ' +
        'Queries in a different workspace or before retention will not appear.',
    );
  } else {
    console.log(
      '\nWorkspace has SELECT history, but none mention this needle in stored statement_text. ' +
        'Check catalog/schema in your SQL editor default, or non-SELECT statements (loads use INSERT/MERGE).',
    );
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
