/**
 * Memory Orchestrator — Session-scoped Advisory Lock via FNV-1a 64-bit hashing.
 *
 * Uses pg_try_advisory_lock(bigint) which is SESSION-scoped: the lock is held
 * until explicitly released via pg_advisory_unlock OR the connection closes.
 *
 * Uses a raw pg.Client on DIRECT_URL — NOT a PrismaClient — because Prisma
 * manages its own internal connection pool even with connection_limit=1 appended
 * to the URL (that param is only honored by Prisma Accelerate/Data Proxy, not
 * against a direct Aurora endpoint). Each concurrent invocation via PrismaClient
 * would get its own physical backend and its own independent lock grant, breaking
 * mutual exclusion entirely. A raw pg.Client guarantees exactly one connection,
 * no pool, no proxy — the advisory lock is truly session-scoped to that socket.
 *
 * Returns { acquired, release } so the caller can hold the lock for the entire
 * DAG run duration and release in a finally block.
 */

import { Client } from 'pg';

// ── FNV-1a 64-bit ────────────────────────────────────────────────────────────

const FNV_OFFSET_64 = BigInt('14695981039346656037');
const FNV_PRIME_64  = BigInt('1099511628211');

export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asIntN(64, hash * FNV_PRIME_64);
  }
  return BigInt.asIntN(64, hash);
}

// ── Advisory lock ─────────────────────────────────────────────────────────────

export interface LockHandle {
  acquired: boolean;
  release: () => Promise<void>;
}

function getDirectUrl(): string {
  const direct = process.env.DIRECT_URL;
  if (direct) return direct;
  const fallback = process.env.DATABASE_URL ?? '';
  if (!fallback) throw new Error('[lock] Neither DIRECT_URL nor DATABASE_URL is set');
  return fallback;
}

/**
 * Strip sslmode/ssl query params from a postgres URL so that pg.Client
 * honours the ssl:{rejectUnauthorized:false} option object instead.
 * The RDS CA bundle is absent in node:alpine images; stripping the URL
 * param lets us use TLS without cert verification (safe inside the VPC).
 */
function stripSslMode(url: string): string {
  return url
    .replace(/[?&]sslmode=[^&]*/g, '')
    .replace(/[?&]ssl=[^&]*/g, '')
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '');
}

/**
 * Acquire a session-scoped advisory lock for an arbitrary string key.
 *
 * Generic primitive — the caller is responsible for choosing a key that is
 * unambiguous within the platform. Uses a raw pg.Client on DIRECT_URL to
 * guarantee a single physical backend with no connection pool — bypasses any
 * pooler (PgBouncer, RDS Proxy) that may sit in front of DATABASE_URL.
 * Acquire + hold + release all execute on the same TCP socket.
 *
 * If acquired=false, calling release() is a no-op (safe to call unconditionally).
 *
 * Recommended key conventions:
 *   Memory DAG:         `mem-orch:${orgId}:${group}`
 *   Maxwell sentinel:   `maxwell-sentinel:${orgId}:cycle`
 */
export async function acquireAdvisoryLock(key: string): Promise<LockHandle> {
  const lockId = fnv1a64(key);

  const client = new Client({
    connectionString: stripSslMode(getDirectUrl()),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
    [lockId.toString()],
  );
  const acquired = result.rows[0]?.acquired ?? false;

  if (!acquired) {
    await client.end();
    return { acquired: false, release: async () => {} };
  }

  const release = async () => {
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockId.toString()]);
    } finally {
      await client.end();
    }
  };

  return { acquired: true, release };
}

/**
 * Acquire a session-scoped advisory lock for the given org + DAG group.
 * Delegates to acquireAdvisoryLock with key `mem-orch:${orgId}:${group}`.
 * Kept for backward compatibility with existing memory DAG callers.
 */
export async function acquireOrchestratorLock(
  orgId: string,
  group: string,
): Promise<LockHandle> {
  return acquireAdvisoryLock(`mem-orch:${orgId}:${group}`);
}
