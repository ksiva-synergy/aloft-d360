/**
 * Databricks OAuth M2M token client.
 *
 * Exchanges client_id + client_secret for a short-lived access token via the
 * Databricks OIDC token endpoint. Tokens are cached in-process, keyed by
 * connectionId (default credential) or connectionId:role (role credential),
 * and refreshed ~60s before expiry.
 *
 * The token value is NEVER logged or surfaced outside this module.
 */

import { readCredentials } from './secrets';
import { envRoleCredentials, evictRoleBindings, resolveRoleBinding } from './sp-roles';
import type { DatabricksSpRole } from './sp-roles';

interface CachedToken {
  token: string;
  expiresAt: number; // ms since epoch
}

// Survive Next.js hot-module reloads in dev by anchoring the cache on globalThis.
// In production the module is loaded once so this is a no-op, but in dev every
// file save reloads the module and would otherwise evict all cached tokens.
const _g = globalThis as typeof globalThis & { _databricksTokenCache?: Map<string, CachedToken> };
if (!_g._databricksTokenCache) {
  _g._databricksTokenCache = new Map();
}
const tokenCache: Map<string, CachedToken> = _g._databricksTokenCache;

const EXPIRY_SKEW_MS = 60_000; // refresh 60s before actual expiry

export interface DatabricksConnectionTarget {
  id: string;
  workspace_host: string;
  default_warehouse_id: string;
}

export interface DatabricksSession {
  token: string;
  workspaceHost: string;
  warehouseId: string;
  role: DatabricksSpRole;
  /** 'default' when the role has no credential of its own. */
  credential: 'role' | 'default';
}

/**
 * Token and warehouse for running SQL on `conn` as `role`.
 * Prefer this over getAccessToken so a role's warehouse override applies.
 */
export async function openDatabricksSession(
  conn: DatabricksConnectionTarget,
  role: DatabricksSpRole,
): Promise<DatabricksSession> {
  const binding = await resolveRoleBinding(conn.id, role);
  const token = await getCredentialToken(conn.id, conn.workspace_host, binding ? role : null);
  return {
    token,
    workspaceHost: conn.workspace_host,
    warehouseId: binding?.warehouseId || conn.default_warehouse_id,
    role,
    credential: binding ? 'role' : 'default',
  };
}

/**
 * Acquire a valid access token for `role` on the given connection, falling
 * back to the connection's default credential when the role has none.
 */
export async function getAccessToken(
  connectionId: string,
  workspaceHost: string,
  role: DatabricksSpRole,
): Promise<string> {
  const binding = await resolveRoleBinding(connectionId, role);
  return getCredentialToken(connectionId, workspaceHost, binding ? role : null);
}

/**
 * Token for one exact credential, with no fallback: `role` null is the
 * connection's default credential. For connection tests and callers that
 * already resolved the role binding.
 *
 * Default credential resolution order:
 *   1. In-process cache
 *   2. DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET env vars — used when set,
 *      bypassing Secrets Manager. Intended for local dev and environments where
 *      Secrets Manager is unreachable.
 *   3. AWS Secrets Manager `aloft/databricks/{connectionId}`
 *
 * Role credential resolution order:
 *   1. In-process cache
 *   2. DATABRICKS_SP_<ROLE>_CLIENT_ID / _CLIENT_SECRET env vars (local dev)
 *   3. AWS Secrets Manager `aloft/databricks/{connectionId}/{role}`
 */
export async function getCredentialToken(
  connectionId: string,
  workspaceHost: string,
  role: DatabricksSpRole | null,
): Promise<string> {
  const cacheKey = role ? `${connectionId}:${role}` : connectionId;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt - now > EXPIRY_SKEW_MS) {
    return cached.token;
  }

  const creds = role
    ? envRoleCredentials(role) ?? await readCredentials(connectionId, role)
    : defaultEnvCredentials() ?? await readCredentials(connectionId);

  const token = await fetchToken(workspaceHost, creds.client_id, creds.client_secret);

  tokenCache.set(cacheKey, token);
  return token.token;
}

function defaultEnvCredentials(): { client_id: string; client_secret: string } | null {
  const client_id = process.env.DATABRICKS_CLIENT_ID;
  const client_secret = process.env.DATABRICKS_CLIENT_SECRET;
  return client_id && client_secret ? { client_id, client_secret } : null;
}

/**
 * Evict cached tokens and role bindings — call when a connection or one of
 * its role credentials is updated or deleted.
 */
export function evictToken(connectionId: string): void {
  tokenCache.delete(connectionId);
  for (const key of [...tokenCache.keys()]) {
    if (key.startsWith(`${connectionId}:`)) tokenCache.delete(key);
  }
  evictRoleBindings(connectionId);
}

async function fetchToken(
  workspaceHost: string,
  clientId: string,
  clientSecret: string,
): Promise<CachedToken> {
  const host = workspaceHost.replace(/^https?:\/\//, '');
  const url = `https://${host}/oidc/v1/token`;

  // Databricks requires HTTP Basic auth (base64 clientId:clientSecret),
  // NOT client_id/client_secret in the POST body.
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'all-apis',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Databricks host '${host}' did not respond within 20 s — check network connectivity or firewall rules`
        : `Network error reaching Databricks host '${host}': ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '(no body)');
    throw new Error(`Databricks token endpoint returned ${resp.status}: ${errText}`);
  }

  const json = await resp.json() as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  if (!json.access_token) {
    throw new Error('Databricks token endpoint returned no access_token');
  }

  const expiresAt = Date.now() + json.expires_in * 1000;

  return { token: json.access_token, expiresAt };
}
