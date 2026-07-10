/**
 * Databricks OAuth M2M token client.
 *
 * Exchanges client_id + client_secret for a short-lived access token via the
 * Databricks OIDC token endpoint. Tokens are cached in-process, keyed by
 * connectionId, and refreshed ~60s before expiry.
 *
 * The token value is NEVER logged or surfaced outside this module.
 */

import { readCredentials } from './secrets';

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

/**
 * Acquire a valid access token for the given connection.
 * Uses the cache if the current token won't expire within EXPIRY_SKEW_MS.
 *
 * Credential resolution order:
 *   1. In-process cache (keyed by connectionId)
 *   2. DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET env vars — used when set,
 *      bypassing Secrets Manager. Intended for local dev and environments where
 *      Secrets Manager is unreachable.
 *   3. AWS Secrets Manager (production path)
 */
export async function getAccessToken(
  connectionId: string,
  workspaceHost: string,
): Promise<string> {
  const cached = tokenCache.get(connectionId);
  const now = Date.now();

  if (cached && cached.expiresAt - now > EXPIRY_SKEW_MS) {
    return cached.token;
  }

  // Env-var shortcut — bypasses Secrets Manager for local dev
  const envClientId = process.env.DATABRICKS_CLIENT_ID;
  const envClientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const usingEnvCreds = !!(envClientId && envClientSecret);
  const creds = usingEnvCreds
    ? { client_id: envClientId, client_secret: envClientSecret }
    : await readCredentials(connectionId);

  const token = await fetchToken(workspaceHost, creds.client_id, creds.client_secret);

  tokenCache.set(connectionId, token);
  return token.token;
}

/**
 * Evict a cached token — call when a connection is updated or deleted.
 */
export function evictToken(connectionId: string): void {
  tokenCache.delete(connectionId);
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
