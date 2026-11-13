#!/usr/bin/env npx tsx
/**
 * Step 3–4 of SIRE_Fin parity: SQL that mirrors PBI SIRE_Check + DISTINCTCOUNT.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/validate-sire-fin.ts
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/validate-sire-fin.ts --source-id <uuid>
 */
import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/lib/db';
import { executeDatabricksSQL, DATABRICKS_API_MAX_WAIT_SECS } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';

const DEFAULT_SOURCE = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';
const PBI_ORACLE_TARGET = 62;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runSql(
  conn: { id: string; workspace_host: string; default_warehouse_id: string },
  token: string,
  statement: string,
  rowLimit = 5000,
) {
  return executeDatabricksSQL(conn.id, conn.workspace_host, conn.default_warehouse_id, token, {
    statement,
    rowLimit,
    waitTimeoutSecs: DATABRICKS_API_MAX_WAIT_SECS,
    asyncPolling: true,
  });
}

function buildSireFinSql(opts: { withPbiFilters: boolean }): string {
  const auditFilter = opts.withPbiFilters
    ? `
      AND status <> 'Rejected'
      AND manager_group <> 'SMIC'
      AND ReferenceNo IS NOT NULL`
  : '';

  return `
WITH audits_base AS (
  SELECT
    TRIM(CAST(imono AS STRING)) AS imo,
    AuditToDate AS aud_to,
    AuditFromDate AS aud_from,
    ReferenceNo,
    status,
    manager_group
  FROM reporting_layer.qhse.bi_vw_internalaudit
  WHERE 1 = 1
  ${auditFilter}
),
audits_with_next AS (
  SELECT
    a.*,
    (
      SELECT MIN(b.aud_from)
      FROM audits_base b
      WHERE b.imo = a.imo AND b.aud_from > a.aud_to
    ) AS next_aud_from
  FROM audits_base a
),
with_sire_check AS (
  SELECT
    a.*,
    (
      SELECT MAX(CONCAT(TRIM(s.IMO_NO), '-', DATE_FORMAT(s.DATE, 'yyyyMMdd')))
      FROM reporting_layer.qhse.bi_synergypool_vw_sire_2_0 s
      WHERE TRIM(CAST(s.IMO_NO AS STRING)) = a.imo
        AND s.DATE IS NOT NULL
        AND CAST(s.NO_OF_FINDINGS AS BIGINT) > 10
        AND s.DATE > a.aud_to
        AND a.next_aud_from IS NOT NULL
        AND s.DATE < a.next_aud_from
    ) AS sire_check
  FROM audits_with_next a
)
SELECT COUNT(DISTINCT sire_check) AS sire_fin
FROM with_sire_check
WHERE sire_check IS NOT NULL AND TRIM(CAST(sire_check AS STRING)) <> ''
`.trim();
}

async function main() {
  const sourceId = arg('--source-id') ?? DEFAULT_SOURCE;
  const source = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: sourceId } });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: source.connection_ref },
    select: { id: true, workspace_host: true, default_warehouse_id: true },
  });
  const token = await getAccessToken(conn.id, conn.workspace_host, 'metadata');

  console.log('Workspace', conn.workspace_host);
  console.log('Source', source.name ?? sourceId);

  for (const table of [
    'reporting_layer.qhse.bi_vw_internalaudit',
    'reporting_layer.qhse.bi_synergypool_vw_sire_2_0',
  ]) {
    const desc = await runSql(conn, token, `DESCRIBE TABLE ${table}`, 500);
    console.log(`\n--- ${table} (${desc.rows.length} columns) ---`);
    for (const row of desc.rows.slice(0, 15)) {
      console.log(row.col_name ?? row.column_name, row.data_type);
    }
    if (desc.rows.length > 15) console.log(`... +${desc.rows.length - 15} more`);
  }

  const sqlNoFilter = buildSireFinSql({ withPbiFilters: false });
  const sqlPbi = buildSireFinSql({ withPbiFilters: true });

  const outDir = path.join(process.cwd(), 'scripts', 'powerbi', 'sql');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'sire-fin-measure.sql'),
    [
      '-- SIRE_Fin parity SQL (scripts/powerbi/validate-sire-fin.ts)',
      '-- Audits: PQ filters on bi_vw_internalaudit (status, manager_group, ReferenceNo).',
      '-- SIRE 2_0: DATE IS NOT NULL, NO_OF_FINDINGS > 10, IMO as text (matches PBI import).',
      '-- SIRE_Check key: TRIM(IMO_NO) || "-" || yyyMMdd (PBI KeyConcatenate calc column).',
      '-- Measure: COUNT(DISTINCT sire_check) non-blank (PBI DISTINCTCOUNTNOBLANK).',
      '',
      sqlPbi,
      '',
    ].join('\n'),
    'utf8',
  );

  console.log('\n=== SIRE_Fin (all audit rows, no PQ filter) ===');
  const r1 = await runSql(conn, token, sqlNoFilter, 1);
  console.log('value', r1.rows[0]);

  console.log('\n=== SIRE_Fin (Power Query filters) ===');
  const r2 = await runSql(conn, token, sqlPbi, 1);
  const val = Number(r2.rows[0]?.sire_fin ?? r2.rows[0]?.SIRE_FIN);
  console.log('value', r2.rows[0]);
  console.log('PBI oracle target', PBI_ORACLE_TARGET, val === PBI_ORACLE_TARGET ? 'MATCH' : 'DIFF');

  const diagSql = sqlPbi.replace(
    /SELECT COUNT\(DISTINCT sire_check\) AS sire_fin[\s\S]*$/,
    'SELECT COUNT(*) AS audit_rows,\n  SUM(CASE WHEN sire_check IS NOT NULL AND TRIM(CAST(sire_check AS STRING)) <> \'\' THEN 1 ELSE 0 END) AS rows_with_sire,\n  COUNT(DISTINCT sire_check) AS distinct_sire\nFROM with_sire_check',
  );
  const r3 = await runSql(conn, token, diagSql, 1);
  console.log('\nDiagnostics (PQ filters)', r3.rows[0]);

  console.log('\nWrote', path.join(outDir, 'sire-fin-measure.sql'));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
