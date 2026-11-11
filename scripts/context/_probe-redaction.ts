import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { QUERY_HISTORY_TABLE } from '@/lib/context/databricks-system-tables';

type Exec = { scopeExec: (s: string, o?: { rowLimit?: number }) => Promise<{ rows: Record<string, unknown>[] }> };

async function main() {
  const sourceId = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const source = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
  });
  const a = new DatabricksAdapter(conn) as unknown as Exec;

  const r = await a.scopeExec(
    `SELECT COUNT(*) AS n, ` +
      `COUNT(*) FILTER (WHERE statement_text = '<REDACTED>') AS redacted, ` +
      `COUNT(*) FILTER (WHERE statement_text IS NOT NULL AND statement_text <> '<REDACTED>' AND length(statement_text) > 20) AS readable ` +
      `FROM ${QUERY_HISTORY_TABLE} ` +
      `WHERE start_time >= current_timestamp() - INTERVAL 7 DAYS AND statement_type = 'SELECT'`,
    { rowLimit: 1 },
  );
  console.log('Last 7d SELECT statement_text breakdown:', r.rows[0]);

  const sample = await a.scopeExec(
    `SELECT LEFT(statement_text, 80) AS st, length(statement_text) AS len, start_time ` +
      `FROM ${QUERY_HISTORY_TABLE} ` +
      `WHERE start_time >= current_timestamp() - INTERVAL 7 DAYS AND statement_type = 'SELECT' ` +
      `AND statement_text IS NOT NULL AND statement_text <> '<REDACTED>' AND length(statement_text) > 20 ` +
      `ORDER BY start_time DESC LIMIT 5`,
    { rowLimit: 5 },
  );
  console.log('\nReadable samples (if any):', sample.rows.length);
  for (const row of sample.rows) console.log(row);

  // Check if table references exist in other columns
  const cols = await a.scopeExec(`DESCRIBE ${QUERY_HISTORY_TABLE}`, { rowLimit: 200 });
  const names = cols.rows.map(r => r.col_name).filter(Boolean);
  console.log('\nquery.history columns (subset):', names.slice(0, 40).join(', '));
  const interesting = names.filter(
    (n: string) =>
      /table|text|statement|relation|entity|object/i.test(String(n)) && !String(n).startsWith('#'),
  );
  console.log('Interesting columns:', interesting);
}

main().finally(() => prisma.$disconnect());
