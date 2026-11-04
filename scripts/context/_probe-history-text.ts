import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';

type Exec = { scopeExec: (s: string, o?: { rowLimit?: number }) => Promise<{ rows: Record<string, unknown>[] }> };

async function main() {
  const sourceId = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
  const source = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
  });
  const a = new DatabricksAdapter(conn) as unknown as Exec;
  const si = new Date(Date.now() - 1 * 86400000).toISOString().replace('T', ' ').replace('Z', '');
  const ui = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const base =
    `FROM system.query.history WHERE start_time >= TIMESTAMP '${si}' AND start_time < TIMESTAMP '${ui}' AND statement_type = 'SELECT'`;

  const norm = "replace(lower(coalesce(statement_text,'')), '`', '')";

  for (const label of ['total', 'nonempty', 'has select', 'has from'] as const) {
    let extra = '';
    if (label === 'nonempty') extra = ' AND statement_text IS NOT NULL AND length(statement_text) > 10';
    if (label === 'has select') extra = ` AND contains(${norm}, 'select')`;
    if (label === 'has from') extra = ` AND contains(${norm}, 'from')`;
    const r = await a.scopeExec(`SELECT COUNT(*) AS n ${base}${extra}`, { rowLimit: 1 });
    console.log(label, '->', r.rows[0]?.n);
  }

  const sample = await a.scopeExec(
    `SELECT LEFT(statement_text, 250) AS st, length(statement_text) AS len, executed_as, start_time ` +
      `${base} ORDER BY start_time DESC LIMIT 10`,
    { rowLimit: 10 },
  );
  console.log('\nLast 10 SELECT statement_text samples (24h):');
  for (const row of sample.rows) {
    console.log('--- len=', row.len, 'user=', row.executed_as, 'time=', row.start_time);
    console.log(String(row.st ?? '(null)').slice(0, 250));
  }
}

main().finally(() => prisma.$disconnect());
