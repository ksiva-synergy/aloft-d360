import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env', '.env.local']) {
  const fp = path.join(root, file);
  if (!fs.existsSync(fp)) continue;
  for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const host = url.match(/@([^:/]+)/)?.[1];
const port = url.match(/:(\d+)\//)?.[1] ?? '5432';

const out = { host, port, dns: null, connect: null, query: null };

try {
  await dns.lookup(host);
  out.dns = 'ok';
} catch (e) {
  out.dns = e instanceof Error ? e.message : String(e);
}

async function tryConnect(ssl) {
  const parsed = new URL(url.replace(/^postgresql:/, 'http:'));
  const database = parsed.pathname.replace(/^\//, '').split('?')[0];
  const client = new pg.Client({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    connectionTimeoutMillis: 20_000,
    ssl,
  });
  await client.connect();
  const res = await client.query(
    'SELECT 1 AS ok, current_database() AS db, current_user AS usr, version() AS version',
  );
  await client.end();
  return {
    ok: res.rows[0]?.ok,
    database: res.rows[0]?.db,
    user: res.rows[0]?.usr,
    version: String(res.rows[0]?.version ?? '').slice(0, 60),
  };
}

try {
  out.query = await tryConnect(undefined);
  out.connect = 'ok (default ssl from connection string)';
  console.log(JSON.stringify(out, null, 2));
} catch (e1) {
  out.connectDefaultSsl = e1 instanceof Error ? e1.message : String(e1);
  try {
    out.query = await tryConnect({ rejectUnauthorized: false });
    out.connect = 'ok (ssl rejectUnauthorized=false — RDS CA not in local trust store)';
    out.sslNote =
      'Server is reachable; fix prod apps with AWS RDS CA bundle or sslmode=verify-full + CA file';
    console.log(JSON.stringify(out, null, 2));
  } catch (e2) {
    out.connect = 'fail';
    out.error = e2 instanceof Error ? e2.message : String(e2);
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
}
