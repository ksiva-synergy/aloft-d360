/**
 * Compare Power BI "CII" model AER 2026 (executeQueries export) to Databricks SQL.
 * Loads Databricks settings from repo .env (never prints secrets).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(root, '.env'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        const k = l.slice(0, i).trim();
        let v = l.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return [k, v];
      }),
  );
}

async function getToken(env) {
  const clientId = env.DATABRICKS_CLIENT_ID;
  const clientSecret = env.DATABRICKS_CLIENT_SECRET;
  const host = (env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '');
  if (!clientId || !clientSecret || !host) {
    throw new Error('Set DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, DATABRICKS_HOST in .env');
  }
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
  if (!tokenResp.ok) throw new Error(`Token failed ${tokenResp.status}: ${tokenText.slice(0, 200)}`);
  return { host, accessToken: JSON.parse(tokenText).access_token };
}

async function runSql(host, accessToken, warehouseId, statement) {
  const resp = await fetch(`https://${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement,
      wait_timeout: '50s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
      on_wait_timeout: 'CONTINUE',
    }),
  });
  const body = JSON.parse(await resp.text());
  if (!resp.ok) throw new Error(`SQL post failed: ${JSON.stringify(body).slice(0, 500)}`);
  let stmt = body;
  while (stmt.status?.state === 'PENDING' || stmt.status?.state === 'RUNNING') {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://${host}/api/2.0/sql/statements/${stmt.statement_id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    stmt = JSON.parse(await poll.text());
  }
  if (stmt.status?.state !== 'SUCCEEDED') {
    throw new Error(stmt.status?.error?.message || `SQL state ${stmt.status?.state}`);
  }
  const cols = stmt.manifest.schema.columns.map((c) => c.name);
  const rows = (stmt.result?.data_array || []).map((arr) =>
    Object.fromEntries(arr.map((v, i) => [cols[i], v]))
  );
  let next = stmt.manifest?.chunks?.[0]?.next_chunk_index;
  let idx = stmt.manifest?.chunks?.[0]?.chunk_index ?? 0;
  while (next != null) {
    const chunkResp = await fetch(
      `https://${host}/api/2.0/sql/statements/${stmt.statement_id}/result/chunks/${next}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const chunk = JSON.parse(await chunkResp.text());
    for (const arr of chunk.data_array || []) {
      rows.push(Object.fromEntries(arr.map((v, i) => [cols[i], v])));
    }
    next = chunk.next_chunk_index;
    idx = next ?? idx;
  }
  return rows;
}

function buildVesselAllDwtsCte() {
  const csvPath = path.join(root, 'powerbi-estate', 'lookups', 'cii_vessel_all_dwts.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing ${csvPath}. Run scripts/extract_pbi_embedded_table.py first.`);
  }
  const values = [];
  for (const line of fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/)) {
    const lastComma = line.lastIndexOf(',');
    const prevComma = line.lastIndexOf(',', lastComma - 1);
    const imo = Number(line.slice(prevComma + 1, lastComma));
    const dwt = Number(line.slice(lastComma + 1));
    if (!Number.isFinite(imo) || !Number.isFinite(dwt)) continue;
    values.push(`(${imo}, CAST(${dwt} AS DOUBLE))`);
  }
  return `vessel_all_dwts AS (
  SELECT imo_number, MAX(dwt) AS dwt
  FROM VALUES
    ${values.join(',\n    ')}
  AS t(imo_number, dwt)
  GROUP BY imo_number
),`;
}

function relClose(a, b, relTol = 0.01, absTol = 0.05) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const fa = Number(a);
  const fb = Number(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return false;
  const diff = Math.abs(fa - fb);
  const denom = Math.max(Math.abs(fa), Math.abs(fb), 1e-9);
  return diff <= absTol || diff / denom <= relTol;
}

const env = loadEnv();
const warehouseId = (env.DATABRICKS_HTTP_PATH || '').match(/warehouses\/([^/"']+)/)?.[1];
if (!warehouseId) throw new Error('DATABRICKS_HTTP_PATH must contain warehouses/<id>');

const sqlPath = path.join(root, 'powerbi-estate', 'sql', 'cii_model_aer_2026_by_vessel.sql');
const pbiPath = path.join(root, 'powerbi-estate', 'dax', 'cii_model_2026_by_vessel.json');
const sql = fs
  .readFileSync(sqlPath, 'utf8')
  .replace('/*@@VESSEL_ALL_DWTS@@*/', buildVesselAllDwtsCte());
const pbiRows = JSON.parse(fs.readFileSync(pbiPath, 'utf8'));

const { host, accessToken } = await getToken(env);
const dbRows = await runSql(host, accessToken, warehouseId, sql);

const dbByImo = new Map(dbRows.map((r) => [Number(r.imo_no), r]));
const pbiByImo = new Map();
for (const r of pbiRows) {
  const imo = Number(r['CII[IMO Number]']);
  const aer = r['[AER_2026]'];
  if (!pbiByImo.has(imo) || aer != null) pbiByImo.set(imo, { aer, name: r['CII[Vessel Name]'] });
}

let bothWithAer = 0;
let match = 0;
let mismatch = 0;
let pbiOnly = 0;
let dbOnly = 0;
const samples = [];

for (const [imo, pbi] of pbiByImo) {
  const db = dbByImo.get(imo);
  if (!db) {
    if (pbi.aer != null) pbiOnly++;
    continue;
  }
  const pa = pbi.aer;
  const da = db.aer_2026 == null ? null : Number(db.aer_2026);
  if (pa == null && da == null) continue;
  if (pa == null || da == null) {
    mismatch++;
    if (samples.length < 8) samples.push({ imo, name: pbi.name, pbi: pa, db: da, note: 'null mismatch' });
    continue;
  }
  bothWithAer++;
  if (relClose(pa, da)) match++;
  else {
    mismatch++;
    if (samples.length < 12) {
      samples.push({
        imo,
        name: pbi.name,
        pbi: pa,
        db: da,
        pct: (100 * Math.abs(pa - da)) / Math.max(Math.abs(pa), 1e-9),
      });
    }
  }
}

for (const [imo, db] of dbByImo) {
  if (!pbiByImo.has(imo) && db.aer_2026 != null) dbOnly++;
}

const outPath = path.join(root, 'powerbi-estate', 'dax', 'cii_model_2026_parity_summary.json');
const summary = {
  generated_at: new Date().toISOString(),
  pbi_rows: pbiRows.length,
  db_rows: dbRows.length,
  vessel_all_dwts_rows: fs.existsSync(path.join(root, 'powerbi-estate', 'lookups', 'cii_vessel_all_dwts.csv'))
    ? fs.readFileSync(path.join(root, 'powerbi-estate', 'lookups', 'cii_vessel_all_dwts.csv'), 'utf8').trim().split(/\r?\n/).length
    : 0,
  vessels_compared_with_aer: bothWithAer,
  within_1pct_or_0_05: match,
  mismatch,
  pbi_has_aer_db_missing: pbiOnly,
  db_has_aer_not_in_pbi: dbOnly,
  sample_mismatches: samples,
};
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${outPath}`);
