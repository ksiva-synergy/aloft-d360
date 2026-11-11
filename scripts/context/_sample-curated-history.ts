import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { QUERY_HISTORY_TABLE } from '@/lib/context/databricks-system-tables';

async function main() {
  const sourceId = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const source = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
  });
  const a = new DatabricksAdapter(conn);
  const since = new Date(Date.now() - 3 * 86400000);
  const si = since.toISOString().replace('T', ' ').replace('Z', '');
  const ui = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const norm = "replace(lower(statement_text), '`', '')";

  for (const needle of ['curated_db', 'employee_master', 'darwin_box']) {
    const sql =
      `SELECT COUNT(*) AS n FROM ${QUERY_HISTORY_TABLE} ` +
      `WHERE start_time >= TIMESTAMP '${si}' AND start_time < TIMESTAMP '${ui}' ` +
      `AND statement_type = 'SELECT' AND contains(${norm}, '${needle}')`;
    const r = await (a as unknown as { scopeExec: (s: string, o?: object) => Promise<{ rows: unknown[] }> }).scopeExec(
      sql,
      { rowLimit: 1 },
    );
    console.log(needle, (r.rows[0] as { n: number }).n);
  }

  const sampleSql =
    `SELECT LEFT(statement_text, 200) AS st, executed_as, start_time ` +
    `FROM ${QUERY_HISTORY_TABLE} ` +
    `WHERE start_time >= TIMESTAMP '${si}' AND start_time < TIMESTAMP '${ui}' ` +
    `AND statement_type = 'SELECT' AND contains(${norm}, 'curated_db') ` +
    `ORDER BY start_time DESC LIMIT 8`;
  const sample = await (a as unknown as { scopeExec: (s: string, o?: object) => Promise<{ rows: unknown[] }> }).scopeExec(
    sampleSql,
    { rowLimit: 8 },
  );
  console.log('\nSample curated_db queries:');
  for (const row of sample.rows) console.log(row);

  // Describe table in UC — what catalog/schema does Databricks think?
  try {
    const desc = await (a as unknown as { scopeExec: (s: string) => Promise<{ rows: unknown[] }> }).scopeExec(
      'DESCRIBE TABLE EXTENDED darwin_box.curated_db.employee_master',
    );
    console.log('\nDESCRIBE darwin_box.curated_db.employee_master rows:', desc.rows.length);
    if (desc.rows.length === 0) console.log('(path invalid — try alternate UC names)');
  } catch (e) {
    console.log('\nDESCRIBE darwin_box.curated_db.employee_master failed:', e instanceof Error ? e.message : e);
  }

  for (const path of [
    'curated_db.darwin_box.employee_master',
    'darwin_box.curated_db.employee_master',
  ]) {
    try {
      const desc = await (a as unknown as { scopeExec: (s: string) => Promise<{ rows: unknown[] }> }).scopeExec(
        `DESCRIBE TABLE EXTENDED ${path}`,
      );
      console.log(`DESCRIBE ${path}: OK (${desc.rows.length} rows)`);
    } catch (e) {
      console.log(`DESCRIBE ${path}:`, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
}

main().finally(() => prisma.$disconnect());
