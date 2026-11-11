/**
 * Print recent SQL text from system_tables.query.query_history.
 *
 * Credentials stay in .env. This script never prints them.
 * It uses HARVEST_DATABRICKS_* when those four keys are set,
 * otherwise DATABRICKS_*.
 *
 *   node scripts/query-history-text.mjs
 *   node scripts/query-history-text.mjs --days 1 --limit 20 --catalog curated_db
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const i = trimmed.indexOf('=');
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function pickCreds(env) {
  const harvest = ['CLIENT_ID', 'CLIENT_SECRET', 'HOST', 'HTTP_PATH'].every(
    (suffix) => env[`HARVEST_DATABRICKS_${suffix}`],
  );
  const prefix = harvest ? 'HARVEST_DATABRICKS' : 'DATABRICKS';
  return {
    prefix,
    clientId: env[`${prefix}_CLIENT_ID`],
    clientSecret: env[`${prefix}_CLIENT_SECRET`],
    host: (env[`${prefix}_HOST`] || '').replace(/^https?:\/\//, ''),
    warehouseId: (env[`${prefix}_HTTP_PATH`] || '').match(/warehouses\/([^/"]+)/)?.[1],
  };
}

const days = Math.max(1, Number(arg('--days', '1')) || 1);
const limit = Math.min(100, Math.max(1, Number(arg('--limit', '20')) || 20));
const catalog = arg('--catalog', '');
if (catalog && !/^[A-Za-z0-9_-]+$/.test(catalog)) {
  console.error('--catalog must be letters, numbers, _ or -');
  process.exit(1);
}

const env = { ...loadEnv(path.join(root, '.env')), ...loadEnv(path.join(root, '.env.local')) };
const creds = pickCreds(env);
if (!creds.clientId || !creds.clientSecret || !creds.host || !creds.warehouseId) {
  console.error(
    `Missing ${creds.prefix}_CLIENT_ID, _CLIENT_SECRET, _HOST, or _HTTP_PATH in .env`,
  );
  process.exit(1);
}

const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
const tokenResp = await fetch(`https://${creds.host}/oidc/v1/token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${basic}`,
  },
  body: 'grant_type=client_credentials&scope=all-apis',
});
if (!tokenResp.ok) {
  console.error(`Token request failed: HTTP ${tokenResp.status}`);
  process.exit(1);
}
const token = (await tokenResp.json()).access_token;

const catalogFilter = catalog
  ? `AND (LOWER(statement_text) LIKE '%${catalog.toLowerCase()}.%' OR LOWER(statement_text) LIKE '%\`${catalog.toLowerCase()}\`.%')`
  : '';
const statement = `
SELECT
  start_time,
  executed_as,
  statement_type,
  produced_rows,
  LEFT(statement_text, 8000) AS statement_text
FROM system_tables.query.query_history
WHERE start_time >= current_timestamp() - INTERVAL ${days} DAYS
  AND start_time < current_timestamp()
  AND statement_type = 'SELECT'
  AND statement_text IS NOT NULL
  ${catalogFilter}
ORDER BY start_time DESC
LIMIT ${limit}
`;

console.log(`Auth: ${creds.prefix}_* on ${creds.host}`);
console.log(`Query: last ${days} day(s), limit ${limit}${catalog ? `, catalog ${catalog}` : ''}`);

const sqlResp = await fetch(`https://${creds.host}/api/2.0/sql/statements`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    warehouse_id: creds.warehouseId,
    statement,
    wait_timeout: '50s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  }),
});
const sql = await sqlResp.json();
if (!sqlResp.ok || sql.status?.state === 'FAILED') {
  console.error(sql.status?.error?.message || `SQL failed: HTTP ${sqlResp.status}`);
  process.exit(1);
}

const columns = (sql.manifest?.schema?.columns ?? []).map((c) => c.name);
const rows = sql.result?.data_array ?? [];
console.log(`Rows: ${rows.length}`);
for (const row of rows) {
  const rec = Object.fromEntries(columns.map((name, i) => [name, row[i]]));
  console.log('---');
  console.log(`${rec.start_time}  ${rec.executed_as}  rows=${rec.produced_rows ?? ''}`);
  console.log(rec.statement_text ?? '');
}
