#!/usr/bin/env node
/**
 * Read-only Aurora/Postgres backup via pg_dump (custom format).
 * Usage: node --env-file=.env scripts/backup-postgres.mjs [output-dir]
 * Does not print DATABASE_URL.
 *
 * Retries transient connection failures (timeout, reset) — same idea as scripts/db/prisma-rds-retry.mjs.
 * Env: PG_DUMP_RETRY_ATTEMPTS (default 12), PG_DUMP_RETRY_DELAY_MS (default 5000)
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const maxAttempts = Math.max(1, Number(process.env.PG_DUMP_RETRY_ATTEMPTS ?? 12) || 12);
const delayMs = Math.max(500, Number(process.env.PG_DUMP_RETRY_DELAY_MS ?? 5000) || 5000);

const outDir = path.resolve(process.argv[2] ?? 'backups');
fs.mkdirSync(outDir, { recursive: true });
// Include time so re-runs never overwrite an earlier dump (do not delete old files).
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const outFile = path.join(outDir, `pre-powerbi-bridge-${stamp}.dump`);

/** Prisma adds ?schema=public (and pool params) — pg_dump rejects unknown query keys. */
function pgDumpConnectionString(connectionString) {
  const u = new URL(connectionString);
  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer']) {
    u.searchParams.delete(key);
  }
  return u.toString();
}

function parseDbUrl(connectionString) {
  const u = new URL(pgDumpConnectionString(connectionString));
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '').split('?')[0],
    ssl: u.searchParams.get('sslmode') === 'require' || u.searchParams.get('sslmode') === 'verify-full',
  };
}

function isVersionMismatch(text) {
  return text.toLowerCase().includes('server version mismatch');
}

function isRetryableError(text) {
  const t = text.toLowerCase();
  if (t.includes('password authentication failed') || t.includes('no pg_hba.conf entry')) {
    return false;
  }
  if (isVersionMismatch(text)) {
    return true;
  }
  return (
    t.includes('timed out') ||
    t.includes('timeout') ||
    t.includes('could not connect') ||
    t.includes('connection refused') ||
    t.includes('connection reset') ||
    t.includes('server closed the connection') ||
    t.includes("can't reach") ||
    t.includes('econnrefused') ||
    t.includes('econnreset') ||
    t.includes('network is unreachable') ||
    t.includes('p1001')
  );
}

function removePartialDump(outPath) {
  try {
    if (fs.existsSync(outPath)) {
      const size = fs.statSync(outPath).size;
      if (size === 0) fs.unlinkSync(outPath);
    }
  } catch {
    /* ignore */
  }
}

/** @returns {string | null} */
function findWindowsPgDump() {
  if (process.platform !== 'win32') return null;
  const base = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PostgreSQL');
  if (!fs.existsSync(base)) return null;
  const versions = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const ver of versions) {
    const exe = path.join(base, ver, 'bin', 'pg_dump.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function resolvePgDumpExecutable() {
  const fromWin = findWindowsPgDump();
  if (fromWin) return fromWin;
  try {
    const resolved = execSync(process.platform === 'win32' ? 'where.exe pg_dump' : 'which pg_dump', {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && fs.existsSync(l));
    if (resolved) return resolved;
  } catch {
    /* not on PATH */
  }
  return null;
}

function localPgDumpMajorVersion(pgDumpExe) {
  try {
    const v = execFileSync(pgDumpExe, ['--version'], { encoding: 'utf8' });
    const m = v.match(/(\d+)\./);
    return m ? Number(m[1]) : 99;
  } catch {
    return 99;
  }
}

/** @returns {{ ok: boolean; retryable: boolean; detail: string }} */
function runPgDumpExe(pgDumpExe, outPath, connectionString) {
  const { host, port, user, password, database, ssl } = parseDbUrl(connectionString);
  const args = ['-h', host, '-p', port, '-U', user, '-d', database, '-Fc', '-f', outPath];
  try {
    execFileSync(pgDumpExe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PGPASSWORD: password,
        PGSSLMODE: ssl ? 'require' : (process.env.PGSSLMODE ?? 'prefer'),
      },
      maxBuffer: 64 * 1024,
    });
    const ok = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
    return { ok, retryable: !ok, detail: ok ? '' : 'pg_dump produced an empty file' };
  } catch (err) {
    const stderr = (err.stderr && Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : String(err.stderr ?? '')).trim();
    const detail = stderr || err.message || 'pg_dump failed';
    if (stderr) console.error(stderr.slice(0, 800));
    return { ok: false, retryable: isRetryableError(detail), detail };
  }
}

function dockerDaemonReachable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ ok: boolean; retryable: boolean; detail: string }} */
function runDockerPgDump(outPath, connectionString) {
  if (!dockerDaemonReachable()) {
    return { ok: false, retryable: true, detail: 'Docker daemon not running' };
  }
  const { host, port, user, password, database, ssl } = parseDbUrl(connectionString);
  const outDir = path.dirname(outPath);
  const outBase = path.basename(outPath);
  const containerPath = `/out/${outBase}`;
  const args = [
    'run',
    '--rm',
    '-v',
    `${outDir}:/out`,
    '-e',
    `PGPASSWORD=${password}`,
    ...(ssl ? ['-e', 'PGSSLMODE=require'] : []),
    'postgres:18-alpine',
    'pg_dump',
    '-h',
    host,
    '-p',
    port,
    '-U',
    user,
    '-d',
    database,
    '-Fc',
    '-f',
    containerPath,
  ];
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  if (combined) {
    const line = combined.split(/\r?\n/).slice(-5).join('\n');
    if (result.status !== 0) console.error(line.slice(0, 800));
  }
  if (result.status === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return { ok: true, retryable: false, detail: '' };
  }
  const detail = combined || `docker pg_dump exit ${result.status ?? 'unknown'}`;
  return { ok: false, retryable: isRetryableError(detail) || result.status !== 0, detail };
}

async function runOneAttempt(dumpUrl, pgDumpExe, opts) {
  removePartialDump(outFile);
  const skipLocal = opts.skipLocalPgDump === true;

  if (!skipLocal && pgDumpExe) {
    const local = runPgDumpExe(pgDumpExe, outFile, dumpUrl);
    if (local.ok) return { ok: true, retryable: false, skipLocalPgDump: false };
    if (isVersionMismatch(local.detail)) {
      console.warn('[backup-postgres] local pg_dump is older than the server — will use Docker postgres:18 on next tries');
    }
    const docker = runDockerPgDump(outFile, dumpUrl);
    if (docker.ok) return { ok: true, retryable: false, skipLocalPgDump: true };
    const detail = docker.detail || local.detail;
    return {
      ok: false,
      retryable: local.retryable || docker.retryable || isVersionMismatch(local.detail),
      detail,
      skipLocalPgDump: isVersionMismatch(local.detail) || skipLocal,
    };
  }

  const docker = runDockerPgDump(outFile, dumpUrl);
  return {
    ok: docker.ok,
    retryable: docker.retryable || docker.detail.includes('not running'),
    detail: docker.detail,
    skipLocalPgDump: skipLocal || !pgDumpExe,
  };
}

async function main() {
  const dumpUrl = pgDumpConnectionString(url);
  const pgDumpExe = resolvePgDumpExecutable();
  let lastDetail = '';
  let skipLocalPgDump = false;
  if (pgDumpExe && localPgDumpMajorVersion(pgDumpExe) < 18) {
    skipLocalPgDump = true;
    console.warn(
      '[backup-postgres] local pg_dump is older than server PG 18 — using Docker postgres:18-alpine only',
    );
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      console.warn(`[backup-postgres] retry ${attempt}/${maxAttempts} in ${delayMs}ms…`);
      await sleep(delayMs);
    }
    const result = await runOneAttempt(dumpUrl, pgDumpExe, { skipLocalPgDump });
    if (result.skipLocalPgDump) skipLocalPgDump = true;
    if (result.ok) {
      console.log(
        `Backup written: ${outFile} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MiB)`,
      );
      if (attempt > 1) console.log(`[backup-postgres] succeeded on attempt ${attempt}`);
      return;
    }
    lastDetail = result.detail;
    removePartialDump(outFile);
    if (!result.retryable) {
      console.error(`[backup-postgres] non-retryable error; stopping (${lastDetail.slice(0, 200)})`);
      break;
    }
    if (attempt < maxAttempts) {
      console.warn(`[backup-postgres] connection failed (${lastDetail.slice(0, 120)}…)`);
    }
  }

  console.error(`
Backup failed after ${maxAttempts} attempt(s).
Last error: ${lastDetail.slice(0, 300)}

If errors are timeouts, the host may still be unreachable from this network (VPN, security group, or run from a host with DB access).
Optional: PG_DUMP_RETRY_ATTEMPTS, PG_DUMP_RETRY_DELAY_MS

Otherwise:
  - Install pg_dump (winget install PostgreSQL.PostgreSQL.17), or
  - Start Docker Desktop for the container fallback, or
  - Ask cloud ops for an RDS snapshot.
`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
