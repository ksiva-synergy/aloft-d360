#!/usr/bin/env npx tsx
/**
 * Locate PO Spend PBIX objects in Unity Catalog. Read-only SELECT/DESCRIBE.
 *
 * Credentials: load via `scripts/context/noserver.cjs` (reads .env.local / .env into
 * process.env — do not paste secrets in the shell). Uses DATABRICKS_CLIENT_* ,
 * DATABRICKS_HOST (or DATABRICKS_SERVER_HOSTNAME), DATABRICKS_HTTP_PATH.
 */
import { executeDatabricksSQL, DATABRICKS_API_MAX_WAIT_SECS } from '@/lib/databricks/execute';
import { getCredentialToken } from '@/lib/databricks/token-client';

const ENV_CONNECTION_ID = 'env-po-spend-probe';

function workspaceHostFromEnv(): string {
  const host =
    process.env.DATABRICKS_HOST?.trim() ||
    process.env.DATABRICKS_SERVER_HOSTNAME?.trim() ||
    '';
  if (!host) {
    throw new Error('Set DATABRICKS_HOST or DATABRICKS_SERVER_HOSTNAME in .env (loaded by noserver.cjs)');
  }
  return host;
}

function warehouseIdFromEnv(): string {
  const direct = process.env.DATABRICKS_WAREHOUSE_ID?.trim();
  if (direct) return direct;
  const httpPath = process.env.DATABRICKS_HTTP_PATH?.trim() ?? '';
  const m = httpPath.match(/warehouses\/([a-f0-9]+)/i);
  if (m?.[1]) return m[1];
  throw new Error('Set DATABRICKS_HTTP_PATH (/sql/1.0/warehouses/...) or DATABRICKS_WAREHOUSE_ID');
}

async function main() {
  const workspaceHost = workspaceHostFromEnv();
  const warehouseId = warehouseIdFromEnv();
  const token = await getCredentialToken(ENV_CONNECTION_ID, workspaceHost, null);

  console.log(
    JSON.stringify({
      workspace: workspaceHost.replace(/^https?:\/\//, ''),
      warehouseId,
      credential: 'DATABRICKS_CLIENT_ID from env (via dotenv loader)',
    }),
  );

  const queries: { label: string; sql: string; limit?: number }[] = [
    {
      label: 'pbix_exact_names',
      sql: `SELECT table_catalog, table_schema, table_name, table_type
            FROM system.information_schema.tables
            WHERE lower(table_name) IN (
              'po_spend_analysis','preference_data','fdl_abstract','doc_target',
              'purchase_business_volume','po_spend_analytics'
            )
            ORDER BY table_catalog, table_schema, table_name`,
    },
    {
      label: 'name_like_po_spend',
      sql: `SELECT table_catalog, table_schema, table_name
            FROM system.information_schema.tables
            WHERE lower(table_name) LIKE '%po_spend%' OR lower(table_name) LIKE '%spend_analysis%'
            ORDER BY table_catalog, table_schema, table_name`,
    },
    {
      label: 'schema_purchase_business_volume',
      sql: `SELECT table_catalog, table_schema, table_name, table_type
            FROM system.information_schema.tables
            WHERE lower(table_schema) = 'purchase_business_volume'
            ORDER BY table_catalog, table_name`,
    },
    {
      label: 'columns_preference_compliance',
      sql: `SELECT table_catalog, table_schema, table_name, column_name, data_type
            FROM system.information_schema.columns
            WHERE lower(column_name) IN (
              'preference','compliance_flag','preference_flag','reason_for_leakage',
              'final_category','status_flag','target_percentage'
            )
            AND (lower(table_name) LIKE '%po%' OR lower(table_name) LIKE '%spend%' OR lower(table_name) LIKE '%purchase%')
            ORDER BY table_catalog, table_schema, table_name, column_name
            LIMIT 80`,
    },
    {
      label: 'describe_purchase_business_volume',
      sql: 'DESCRIBE TABLE reporting_layer.purchase_business_volume.purchase_business_volume',
    },
    {
      label: 'sample_purchase_business_volume',
      sql: `SELECT PONO, DOC, FINAL_AMOUNT_USD, VENDORNAME, category, STATUS, imono
            FROM reporting_layer.purchase_business_volume.purchase_business_volume
            LIMIT 3`,
    },
  ];

  for (const q of queries) {
    try {
      const r = await executeDatabricksSQL(
        ENV_CONNECTION_ID,
        workspaceHost,
        warehouseId,
        token,
        {
          statement: q.sql,
          rowLimit: q.limit ?? 100,
          waitTimeoutSecs: DATABRICKS_API_MAX_WAIT_SECS,
          asyncPolling: true,
        },
      );
      console.log(
        JSON.stringify({
          label: q.label,
          ok: true,
          columns: r.columns,
          rowCount: r.rows.length,
          rows: r.rows,
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({
          label: q.label,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
