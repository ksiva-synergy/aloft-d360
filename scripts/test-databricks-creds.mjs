import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      const k = l.slice(0, i).trim();
      let v = l.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return [k, v];
    }),
);

const clientId = env.DATABRICKS_CLIENT_ID;
const clientSecret = env.DATABRICKS_CLIENT_SECRET;
const host = (env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '');
const warehouseId = (env.DATABRICKS_HTTP_PATH || '').match(/warehouses\/([^/"]+)/)?.[1];

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
const tokenResp = await fetch(`https://${host}/oidc/v1/token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${basic}`,
  },
  body: 'grant_type=client_credentials&scope=all-apis',
});
const tokenText = await tokenResp.text();
if (!tokenResp.ok) {
  console.log('TOKEN: FAIL', tokenResp.status, tokenText.slice(0, 200));
  process.exit(1);
}
const tokenJson = JSON.parse(tokenText);
console.log('TOKEN: OK (expires_in', tokenJson.expires_in, 's)');

const sqlResp = await fetch(`https://${host}/api/2.0/sql/statements`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${tokenJson.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    warehouse_id: warehouseId,
    statement: 'SELECT 1 AS ok',
    wait_timeout: '30s',
  }),
});
const sqlText = await sqlResp.text();
if (!sqlResp.ok) {
  console.log('SQL: FAIL', sqlResp.status, sqlText.slice(0, 350));
  process.exit(1);
}
const sql = JSON.parse(sqlText);
const state = sql.status?.state;
if (state === 'SUCCEEDED') {
  console.log('SQL: OK (SELECT 1 succeeded) warehouse', warehouseId);
  process.exit(0);
}
console.log('SQL: FAIL state=', state, sql.status?.error?.message || sqlText.slice(0, 200));
process.exit(1);
