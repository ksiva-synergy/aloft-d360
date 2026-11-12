/**
 * Connection API: self-service ownership and sharing (who may see, use and change what), that
 * credentials go only to Secrets Manager (never to the database or any response), the per-user
 * limit, cleanup when storing them fails, and redaction of provider errors.
 * Prisma, Secrets Manager and the providers are replaced with in-memory fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';

const h = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const secrets = new Map<string, Record<string, string>>();
  let n = 0;
  return {
    rows,
    secrets,
    resolveAuth: vi.fn(),
    providerTest: vi.fn(),
    providerList: vi.fn(),
    failSecretWrite: { value: false },
    prisma: {
      platformConnection: {
        findMany: async ({ where }: { where: { org_id: string; kind?: string; OR?: Record<string, unknown>[] } }) =>
          [...rows.values()].filter(
            (r) => r.org_id === where.org_id && (!where.kind || r.kind === where.kind) && (!where.OR || where.OR.some((c) => Object.entries(c).every(([k, v]) => r[k] === v))),
          ),
        findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
        count: async ({ where }: { where: { org_id: string; created_by: string } }) => [...rows.values()].filter((r) => r.org_id === where.org_id && r.created_by === where.created_by).length,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if ([...rows.values()].some((r) => r.org_id === data.org_id && r.created_by === data.created_by && r.name === data.name)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          const row = { id: `c${++n}`, secret_ref: '', status: 'untested', visibility: 'private', last_tested_at: null, last_error: null, created_at: new Date(), updated_at: new Date(), ...data };
          rows.set(row.id, row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = { ...rows.get(where.id)!, ...data };
          rows.set(where.id, row);
          return row;
        },
        delete: async ({ where }: { where: { id: string } }) => rows.delete(where.id),
      },
      user: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, name: id === 'u-ana' ? 'Ana Owner' : null, email: `${id}@example.com` })),
      },
    },
  };
});

vi.mock('@/middleware/auth', () => ({
  resolveAuth: h.resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden', { required: key });
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.prisma }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/connections/secrets', () => ({
  writeConnectionSecret: async (id: string, v: Record<string, string>) => {
    if (h.failSecretWrite.value) throw new Error('AccessDeniedException');
    h.secrets.set(`aloft/connections/${id}`, v);
    return `aloft/connections/${id}`;
  },
  readConnectionSecret: async (ref: string) => h.secrets.get(ref)!,
  deleteConnectionSecret: async (ref: string) => void h.secrets.delete(ref),
}));
vi.mock('@/lib/connections/providers/s3', () => ({ s3Provider: () => ({ test: h.providerTest, list: h.providerList }) }));
vi.mock('@/lib/connections/providers/azure-blob', () => ({ azureBlobProvider: () => ({ test: h.providerTest, list: h.providerList }) }));
vi.mock('@/lib/connections/providers/sharepoint', () => ({ sharepointProvider: () => ({ test: h.providerTest, list: h.providerList }) }));

import { GET as listGET, POST as createPOST } from '../route';
import { DELETE as oneDELETE, PATCH as onePATCH } from '../[id]/route';
import { POST as testPOST } from '../[id]/test/route';
import { GET as browseGET } from '../[id]/browse/route';

const ana = { userId: 'u-ana', role: 'member', permissions: new Set(['inspector:use', 'section:govern.connections:manage']) };
const ben = { userId: 'u-ben', role: 'member', permissions: new Set(['inspector:use', 'section:govern.connections:manage']) };
const orgAdmin = { userId: 'u-admin', role: 'admin', permissions: new Set(['inspector:use']) };
const platformAdmin = { userId: 'u-pa', role: 'platform_admin', permissions: new Set(['inspector:use']) };
const viewer = { userId: 'u-view', role: 'readonly', permissions: new Set<string>() };
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://test/api/connections${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const s3Body = { name: 'Invoices bucket', kind: 's3', config: { region: 'ap-south-1', bucket: 'aloft-invoices' }, secret: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: SECRET_KEY } };

beforeEach(() => {
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  h.rows.clear();
  h.secrets.clear();
  h.failSecretWrite.value = false;
  h.resolveAuth.mockReset().mockResolvedValue(ana);
  h.providerTest.mockReset();
  h.providerList.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('connections API', () => {
  it('stores credentials only in Secrets Manager and never returns them', async () => {
    const res = await createPOST(req('POST', '', s3Body), undefined);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(text).not.toContain('secret_ref');
    const row = [...h.rows.values()][0]!;
    expect(JSON.stringify(row)).not.toContain(SECRET_KEY);
    expect(row.secret_ref).toBe(`aloft/connections/${row.id}`);
    expect(h.secrets.get(row.secret_ref as string)).toEqual(s3Body.secret);

    const list = await (await listGET(req('GET', ''), undefined)).text();
    expect(list).toContain('Invoices bucket');
    expect(list).not.toContain(SECRET_KEY);
  });

  it('lets any builder create a connection; it is private to the owner by default', async () => {
    const created = await (await createPOST(req('POST', '', s3Body), undefined)).json();
    expect(created.connection).toMatchObject({ visibility: 'private', mine: true, canManage: true, ownerName: 'Ana Owner', createdBy: 'u-ana' });
    const id = created.connection.id as string;

    // Another member (even an org admin) cannot see, use or change it: 404, so its existence does not leak.
    for (const other of [ben, orgAdmin]) {
      h.resolveAuth.mockResolvedValue(other);
      expect((await (await listGET(req('GET', ''), undefined)).json()).connections).toEqual([]);
      expect((await testPOST(req('POST', `/${id}/test`), params(id))).status).toBe(404);
      expect((await browseGET(req('GET', `/${id}/browse`), params(id))).status).toBe(404);
      expect((await onePATCH(req('PATCH', `/${id}`, { name: 'y' }), params(id))).status).toBe(404);
      expect((await oneDELETE(req('DELETE', `/${id}`), params(id))).status).toBe(404);
    }
    expect(h.providerTest).not.toHaveBeenCalled();

    // Without inspector:use nobody gets in at all.
    h.resolveAuth.mockResolvedValue(viewer);
    expect((await createPOST(req('POST', '', { ...s3Body, name: 'x' }), undefined)).status).toBe(403);
  });

  it('lets the owner share a connection: others may then use it but not change, share or delete it', async () => {
    const id = (await (await createPOST(req('POST', '', s3Body), undefined)).json()).connection.id as string;
    h.rows.get(id)!.status = 'ok';
    const shared = await (await onePATCH(req('PATCH', `/${id}`, { visibility: 'org' }), params(id))).json();
    expect(shared.connection.visibility).toBe('org');
    expect(h.rows.get(id)!.status).toBe('ok'); // sharing is not a settings change: no re-test needed

    h.resolveAuth.mockResolvedValue(ben);
    const list = (await (await listGET(req('GET', ''), undefined)).json()).connections;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Invoices bucket', mine: false, canManage: false, ownerName: 'Ana Owner' });
    expect(JSON.stringify(list)).not.toContain(SECRET_KEY);
    h.providerTest.mockResolvedValueOnce('Connected to s3://aloft-invoices/');
    expect((await testPOST(req('POST', `/${id}/test`), params(id))).status).toBe(200);
    h.providerList.mockResolvedValueOnce({ path: '', items: [], truncated: false });
    expect((await browseGET(req('GET', `/${id}/browse`), params(id))).status).toBe(200);
    expect((await onePATCH(req('PATCH', `/${id}`, { name: 'mine now' }), params(id))).status).toBe(403);
    expect((await onePATCH(req('PATCH', `/${id}`, { visibility: 'private' }), params(id))).status).toBe(403);
    expect((await oneDELETE(req('DELETE', `/${id}`), params(id))).status).toBe(403);
    expect(h.rows.get(id)!.name).toBe('Invoices bucket');

    // Ben may still create his own connection with the same name.
    expect((await createPOST(req('POST', '', s3Body), undefined)).status).toBe(201);
  });

  it("lets Automate's picker list shared connections for someone with Automate but no Connections, and nothing more", async () => {
    const id = (await (await createPOST(req('POST', '', s3Body), undefined)).json()).connection.id as string;
    await onePATCH(req('PATCH', `/${id}`, { visibility: 'org' }), params(id));
    expect((await (await listGET(req('GET', ''), undefined)).json()).canCreate).toBe(true);

    const automator = { userId: 'u-auto', role: 'member', permissions: new Set(['inspector:use', 'section:build.automate:manage']) };
    h.resolveAuth.mockResolvedValue(automator);
    const listed = await (await listGET(req('GET', ''), undefined)).json();
    expect(listed.connections.map((c: { name: string }) => c.name)).toEqual(['Invoices bucket']);
    expect(listed.canCreate).toBe(false);
    // Everything else on Connections still needs the Connections section.
    expect((await createPOST(req('POST', '', { ...s3Body, name: 'x' }), undefined)).status).toBe(403);
    expect((await testPOST(req('POST', `/${id}/test`), params(id))).status).toBe(403);
    expect((await browseGET(req('GET', `/${id}/browse`), params(id))).status).toBe(403);

    // Automate at View is enough to list (the picker shows saved flows too), but not without Automate at all.
    h.resolveAuth.mockResolvedValue({ ...automator, permissions: new Set(['inspector:use', 'section:build.automate:view']) });
    expect((await listGET(req('GET', ''), undefined)).status).toBe(200);
    h.resolveAuth.mockResolvedValue({ ...automator, permissions: new Set(['inspector:use']) });
    expect((await listGET(req('GET', ''), undefined)).status).toBe(403);
  });

  it('lets a platform admin see and manage every connection, private ones included', async () => {
    const id = (await (await createPOST(req('POST', '', s3Body), undefined)).json()).connection.id as string;
    h.resolveAuth.mockResolvedValue(platformAdmin);
    const list = (await (await listGET(req('GET', ''), undefined)).json()).connections;
    expect(list[0]).toMatchObject({ id, mine: false, canManage: true });
    expect((await onePATCH(req('PATCH', `/${id}`, { visibility: 'sideways' }), params(id))).status).toBe(422);
    expect((await oneDELETE(req('DELETE', `/${id}`), params(id))).status).toBe(200);
    expect(h.secrets.size).toBe(0);
  });

  it('caps how many connections one person may own', async () => {
    vi.stubEnv('CONNECTIONS_MAX_PER_USER', '2');
    expect((await createPOST(req('POST', '', { ...s3Body, name: 'a' }), undefined)).status).toBe(201);
    expect((await createPOST(req('POST', '', { ...s3Body, name: 'b' }), undefined)).status).toBe(201);
    const third = await createPOST(req('POST', '', { ...s3Body, name: 'c' }), undefined);
    expect(third.status).toBe(409);
    expect((await third.json()).error).toMatch(/already have 2 connections/);
    expect(h.secrets.size).toBe(2);
    h.resolveAuth.mockResolvedValue(ben);
    expect((await createPOST(req('POST', '', { ...s3Body, name: 'c' }), undefined)).status).toBe(201);
  });

  it('rejects a Blob connection string that points outside Azure, and keeps the derived account name', async () => {
    const bad = await createPOST(req('POST', '', { name: 'b', kind: 'azure_blob', config: { container: 'docs' }, secret: { connectionString: 'BlobEndpoint=https://10.0.0.5/;AccountName=a;AccountKey=k' } }), undefined);
    expect(bad.status).toBe(422);
    expect(h.secrets.size).toBe(0);
    const good = await createPOST(req('POST', '', { name: 'b', kind: 'azure_blob', config: { container: 'docs' }, secret: { connectionString: 'DefaultEndpointsProtocol=https;AccountName=aloftdocs;AccountKey=k3y==;EndpointSuffix=core.windows.net' } }), undefined);
    expect((await good.json()).connection.config).toEqual({ container: 'docs', accountName: 'aloftdocs' });
  });

  it('leaves nothing behind when the credentials cannot be stored', async () => {
    h.failSecretWrite.value = true;
    const res = await createPOST(req('POST', '', s3Body), undefined);
    expect(res.status).toBe(502);
    expect(h.rows.size).toBe(0);
  });

  it('records a test result and redacts secrets from a failure', async () => {
    await createPOST(req('POST', '', s3Body), undefined);
    const id = [...h.rows.keys()][0]!;
    h.providerTest.mockResolvedValueOnce('Connected to s3://aloft-invoices/');
    const okRes = await (await testPOST(req('POST', `/${id}/test`), params(id))).json();
    expect(okRes).toMatchObject({ ok: true, detail: 'Connected to s3://aloft-invoices/', connection: { status: 'ok' } });

    h.providerTest.mockRejectedValueOnce(new Error(`The request signature we calculated does not match (key ${SECRET_KEY})`));
    const bad = await (await testPOST(req('POST', `/${id}/test`), params(id))).json();
    expect(bad.ok).toBe(false);
    expect(bad.detail).not.toContain(SECRET_KEY);
    expect(h.rows.get(id)!.last_error).not.toContain(SECRET_KEY);
    expect(bad.connection.status).toBe('error');
  });

  it('replaces credentials only when new ones are sent, and resets the test status', async () => {
    await createPOST(req('POST', '', s3Body), undefined);
    const id = [...h.rows.keys()][0]!;
    h.rows.get(id)!.status = 'ok';
    await onePATCH(req('PATCH', `/${id}`, { name: 'Renamed', config: { region: 'eu-west-1', bucket: 'aloft-invoices' } }), params(id));
    expect(h.secrets.get(`aloft/connections/${id}`)).toEqual(s3Body.secret);
    expect(h.rows.get(id)).toMatchObject({ name: 'Renamed', status: 'untested', config: { region: 'eu-west-1', bucket: 'aloft-invoices' } });
    await onePATCH(req('PATCH', `/${id}`, { secret: { accessKeyId: 'AKIAIOSFODNN7NEWKEY0', secretAccessKey: 'n'.repeat(40) } }), params(id));
    expect(h.secrets.get(`aloft/connections/${id}`)!.accessKeyId).toBe('AKIAIOSFODNN7NEWKEY0');
  });

  it('browses inside the root only, and deleting removes the credentials too', async () => {
    await createPOST(req('POST', '', s3Body), undefined);
    const id = [...h.rows.keys()][0]!;
    expect((await browseGET(req('GET', `/${id}/browse?path=../payroll`), params(id))).status).toBe(400);
    h.providerList.mockResolvedValueOnce({ path: '', items: [{ name: 'a.pdf', path: 'a.pdf', isFolder: false }], truncated: false });
    expect((await (await browseGET(req('GET', `/${id}/browse?path=`), params(id))).json()).items).toHaveLength(1);
    expect((await oneDELETE(req('DELETE', `/${id}`), params(id))).status).toBe(200);
    expect(h.rows.size).toBe(0);
    expect(h.secrets.size).toBe(0);
  });

  it('refuses a duplicate name', async () => {
    await createPOST(req('POST', '', s3Body), undefined);
    const res = await createPOST(req('POST', '', s3Body), undefined);
    expect(res.status).toBe(409);
  });
});
