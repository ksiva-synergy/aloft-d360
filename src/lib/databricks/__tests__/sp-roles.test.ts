import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  readCredentials: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const db = { platformDatabricksCredential: { findMany: h.findMany } };
  return { default: db, prisma: db };
});
vi.mock('../secrets', () => ({ readCredentials: h.readCredentials }));

import { evictToken, getAccessToken, openDatabricksSession } from '../token-client';
import { MissingRoleCredentialError, queryRoleForTier } from '../sp-roles';

const conn = { id: 'conn-1', workspace_host: 'dbc.example.cloud.databricks.com', default_warehouse_id: 'wh-default' };

/** The token endpoint echoes the client id, so a token shows which credential was used. */
function mockTokenEndpoint() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    const clientId = Buffer.from(auth.replace('Basic ', ''), 'base64').toString().split(':')[0];
    return new Response(JSON.stringify({ access_token: `tok-${clientId}`, expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ENV_KEYS = [
  'DATABRICKS_CLIENT_ID',
  'DATABRICKS_CLIENT_SECRET',
  'DATABRICKS_SP_REQUIRED_ROLES',
  'DATABRICKS_SP_PROFILE_CLIENT_ID',
  'DATABRICKS_SP_PROFILE_CLIENT_SECRET',
];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  h.findMany.mockReset().mockResolvedValue([]);
  h.readCredentials.mockReset().mockImplementation(async (_id: string, role?: string) => ({
    client_id: role ? `sp-${role}` : 'sp-default',
    client_secret: 'x',
  }));
  evictToken(conn.id);
  mockTokenEndpoint();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('service principal roles', () => {
  it('falls back to the default credential and warehouse when the role has no credential', async () => {
    const s = await openDatabricksSession(conn, 'query_internal');
    expect(s).toMatchObject({ token: 'tok-sp-default', warehouseId: 'wh-default', credential: 'default', role: 'query_internal' });
    expect(h.readCredentials).toHaveBeenCalledWith('conn-1');
  });

  it('uses the role secret and warehouse when the role is configured', async () => {
    h.findMany.mockResolvedValue([{ role: 'profile', warehouse_id: 'wh-profile' }]);
    const s = await openDatabricksSession(conn, 'profile');
    expect(s).toMatchObject({ token: 'tok-sp-profile', warehouseId: 'wh-profile', credential: 'role' });
    expect(h.readCredentials).toHaveBeenCalledWith('conn-1', 'profile');
  });

  it('keeps role and default tokens apart in the cache', async () => {
    h.findMany.mockResolvedValue([{ role: 'publish', warehouse_id: null }]);
    expect(await getAccessToken(conn.id, conn.workspace_host, 'publish')).toBe('tok-sp-publish');
    expect(await getAccessToken(conn.id, conn.workspace_host, 'metadata')).toBe('tok-sp-default');
    expect(await getAccessToken(conn.id, conn.workspace_host, 'publish')).toBe('tok-sp-publish');
  });

  it('excludes disabled credentials when loading bindings', async () => {
    await openDatabricksSession(conn, 'metadata');
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { connection_id: 'conn-1', status: { not: 'disabled' } },
    }));
  });

  it('refuses to fall back for a required role', async () => {
    process.env.DATABRICKS_SP_REQUIRED_ROLES = 'publish,profile';
    await expect(openDatabricksSession(conn, 'publish')).rejects.toBeInstanceOf(MissingRoleCredentialError);
    await expect(openDatabricksSession(conn, 'metadata')).resolves.toMatchObject({ credential: 'default' });
  });

  it('treats `all` as every role required', async () => {
    process.env.DATABRICKS_SP_REQUIRED_ROLES = 'all';
    await expect(openDatabricksSession(conn, 'query_internal')).rejects.toBeInstanceOf(MissingRoleCredentialError);
  });

  it('uses the default credential when the credentials table does not exist yet', async () => {
    h.findMany.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: 'P2021' }));
    await expect(openDatabricksSession(conn, 'profile')).resolves.toMatchObject({ credential: 'default' });
  });

  it('rethrows other database errors instead of silently falling back', async () => {
    h.findMany.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'P1001' }));
    await expect(openDatabricksSession(conn, 'profile')).rejects.toThrow('connection refused');
  });

  it('applies the default env credential only to the default, not to configured roles', async () => {
    process.env.DATABRICKS_CLIENT_ID = 'env-default';
    process.env.DATABRICKS_CLIENT_SECRET = 'x';
    h.findMany.mockResolvedValue([{ role: 'profile', warehouse_id: null }]);
    expect((await openDatabricksSession(conn, 'metadata')).token).toBe('tok-env-default');
    expect((await openDatabricksSession(conn, 'profile')).token).toBe('tok-sp-profile');
  });

  it('uses per-role env credentials for local dev', async () => {
    process.env.DATABRICKS_SP_PROFILE_CLIENT_ID = 'env-profile';
    process.env.DATABRICKS_SP_PROFILE_CLIENT_SECRET = 'x';
    const s = await openDatabricksSession(conn, 'profile');
    expect(s).toMatchObject({ token: 'tok-env-profile', credential: 'role' });
    expect(h.readCredentials).not.toHaveBeenCalled();
  });

  it('picks the query role from the data tier', () => {
    expect(queryRoleForTier('internal')).toBe('query_internal');
    expect(queryRoleForTier('confidential')).toBe('query_confidential');
    expect(queryRoleForTier('restricted')).toBe('query_restricted');
  });
});
