/** Print raw sample rows from system_tables.query.query_history (statement_text as stored). */
import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';

type Exec = { scopeExec: (s: string, o?: { rowLimit?: number }) => Promise<{ rows: Record<string, unknown>[] }> };

async function main() {
  const sourceId = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const source = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
    select: { workspace_host: true, id: true, default_warehouse_id: true },
  });
  const a = new DatabricksAdapter(conn) as unknown as Exec;

  console.log('Workspace:', conn.workspace_host);
  console.log('\n=== Raw sample: last 8 SELECT rows (2 hours) ===\n');

  const sample = await a.scopeExec(
    `SELECT
       start_time,
       executed_as,
       statement_type,
       statement_text,
       length(statement_text) AS text_len,
       client_application,
       query_source
     FROM system_tables.query.query_history
     WHERE statement_type = 'SELECT'
       AND start_time >= current_timestamp() - INTERVAL 2 HOUR
     ORDER BY start_time DESC
     LIMIT 8`,
    { rowLimit: 8 },
  );

  for (let i = 0; i < sample.rows.length; i++) {
    const row = sample.rows[i];
    console.log(`--- row ${i + 1} ---`);
    console.log(JSON.stringify(row, null, 2));
    console.log('');
  }
}

main().finally(() => prisma.$disconnect());
