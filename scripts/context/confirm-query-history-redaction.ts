/**
 * Prove whether system_tables.query.query_history.statement_text is literal "<REDACTED>".
 * Prints only aggregates + hex of first bytes (no full SQL).
 */
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

  const agg = await a.scopeExec(
    `SELECT
       COUNT(*) AS total_select_24h,
       COUNT(DISTINCT statement_text) AS distinct_statement_text_values,
       MIN(length(statement_text)) AS min_len,
       MAX(length(statement_text)) AS max_len,
       SUM(CASE WHEN statement_text = '<REDACTED>' THEN 1 ELSE 0 END) AS exact_redacted_literal,
       SUM(CASE WHEN statement_text IS NULL THEN 1 ELSE 0 END) AS null_text
     FROM system_tables.query.query_history
     WHERE statement_type = 'SELECT'
       AND start_time >= current_timestamp() - INTERVAL 1 DAY`,
    { rowLimit: 1 },
  );
  console.log('\nLast 24 hours (SELECT only):');
  console.log(agg.rows[0]);

  const topValues = await a.scopeExec(
    `SELECT statement_text, COUNT(*) AS n
     FROM system_tables.query.query_history
     WHERE statement_type = 'SELECT'
       AND start_time >= current_timestamp() - INTERVAL 1 DAY
     GROUP BY statement_text
     ORDER BY n DESC
     LIMIT 5`,
    { rowLimit: 5 },
  );
  console.log('\nTop distinct statement_text values (value + count):');
  for (const row of topValues.rows) {
    const st = String(row.statement_text ?? 'NULL');
    const hex = [...st].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    console.log({
      display: st,
      length: st.length,
      charCodesHex: hex,
      count: row.n,
    });
  }

  const recent = await a.scopeExec(
    `SELECT
       statement_text = '<REDACTED>' AS is_exact_redacted,
       length(statement_text) AS len,
       hex(substring(statement_text, 1, 20)) AS first_chars_hex,
       start_time,
       executed_as
     FROM system_tables.query.query_history
     WHERE statement_type = 'SELECT'
       AND start_time >= current_timestamp() - INTERVAL 2 HOUR
     ORDER BY start_time DESC
     LIMIT 3`,
    { rowLimit: 3 },
  );
  console.log('\nLatest 3 rows (metadata only):');
  console.log(recent.rows);
}

main().finally(() => prisma.$disconnect());
