/**
 * Storage connections: input rules (including the endpoint pinning that stops a connection being
 * pointed at an internal address), secret redaction, and each provider against a fake client.
 * No network, AWS or Azure access.
 */
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_SCHEMA, SECRET_SCHEMA, parseAzureConnectionString, redact, scopedPath } from '../types';
import { s3Provider } from '../providers/s3';
import { azureBlobProvider } from '../providers/azure-blob';
import { sharepointProvider } from '../providers/sharepoint';

describe('connection settings', () => {
  it('accepts valid S3 settings and rejects bad regions, buckets and keys', () => {
    expect(CONFIG_SCHEMA.s3.safeParse({ region: 'ap-south-1', bucket: 'aloft-docs', rootFolder: '/invoices/' }).data).toEqual({ region: 'ap-south-1', bucket: 'aloft-docs', rootFolder: 'invoices' });
    expect(CONFIG_SCHEMA.s3.safeParse({ region: 'http://169.254.169.254', bucket: 'x' }).success).toBe(false);
    expect(CONFIG_SCHEMA.s3.safeParse({ region: 'us-east-1', bucket: 'Bad_Bucket' }).success).toBe(false);
    expect(CONFIG_SCHEMA.s3.safeParse({ region: 'us-east-1', bucket: 'ok-bucket', rootFolder: 'a/../b' }).success).toBe(false);
    expect(SECRET_SCHEMA.s3.safeParse({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }).success).toBe(true);
    expect(SECRET_SCHEMA.s3.safeParse({ accessKeyId: 'short', secretAccessKey: 'x' }).success).toBe(false);
  });

  it('only allows SharePoint sites on sharepoint.com over https', () => {
    const base = { tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47', clientId: '11111111-2222-3333-4444-555555555555' };
    expect(CONFIG_SCHEMA.sharepoint.safeParse({ ...base, siteUrl: 'https://contoso.sharepoint.com/sites/Finance' }).success).toBe(true);
    expect(CONFIG_SCHEMA.sharepoint.safeParse({ ...base, siteUrl: 'https://evil.example.com/sites/x' }).success).toBe(false);
    expect(CONFIG_SCHEMA.sharepoint.safeParse({ ...base, siteUrl: 'http://contoso.sharepoint.com/sites/x' }).success).toBe(false);
    expect(CONFIG_SCHEMA.sharepoint.safeParse({ ...base, clientId: 'not-a-guid', siteUrl: 'https://contoso.sharepoint.com' }).success).toBe(false);
  });

  it('parses an Azure connection string and refuses anything that is not an Azure blob endpoint', () => {
    const key = 'AccountKey=abc123==';
    expect(parseAzureConnectionString(`DefaultEndpointsProtocol=https;AccountName=aloftdocs;${key};EndpointSuffix=core.windows.net`)).toEqual({ ok: true, accountName: 'aloftdocs' });
    expect(parseAzureConnectionString('BlobEndpoint=https://aloftdocs.blob.core.windows.net/;SharedAccessSignature=sv=2022&sig=x')).toEqual({ ok: true, accountName: 'aloftdocs' });
    expect(parseAzureConnectionString(`BlobEndpoint=https://169.254.169.254/;AccountName=a;${key}`).ok).toBe(false);
    expect(parseAzureConnectionString(`BlobEndpoint=https://aloftdocs.blob.core.windows.net.evil.com/;AccountName=aloftdocs;${key}`).ok).toBe(false);
    expect(parseAzureConnectionString(`DefaultEndpointsProtocol=http;AccountName=aloftdocs;${key}`).ok).toBe(false);
    expect(parseAzureConnectionString(`AccountName=aloftdocs;${key};EndpointSuffix=evil.com`).ok).toBe(false);
    expect(parseAzureConnectionString('UseDevelopmentStorage=true').ok).toBe(false);
    expect(parseAzureConnectionString('AccountName=aloftdocs').ok).toBe(false);
  });

  it('removes secret values and SAS signatures from error text', () => {
    const msg = 'GET https://a.blob.core.windows.net/c?sv=2022&sig=SECRETSIG&se=2027 failed; AccountKey=K3y==; key wJalrXUtnFEMI was rejected';
    const out = redact(msg, ['wJalrXUtnFEMI']);
    expect(out).not.toMatch(/SECRETSIG|K3y==|wJalrXUtnFEMI/);
    expect(out).toContain('sig=[redacted]');
  });

  it('keeps browsing inside the root folder', () => {
    expect(scopedPath('invoices', '2026/oct/')).toBe('invoices/2026/oct');
    expect(scopedPath(undefined, '')).toBe('');
    expect(() => scopedPath('invoices', '../payroll')).toThrow();
  });
});

describe('S3 provider', () => {
  it('lists folders and files one level deep, relative to the root folder', async () => {
    const send = vi.fn().mockResolvedValue({
      CommonPrefixes: [{ Prefix: 'docs/2026/' }],
      Contents: [{ Key: 'docs/readme.pdf', Size: 120, LastModified: new Date('2026-10-01T00:00:00Z') }],
      IsTruncated: false,
    });
    const p = s3Provider({ region: 'ap-south-1', bucket: 'b', rootFolder: 'docs' }, { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'x'.repeat(40) }, (cfg) => {
      expect(cfg?.region).toBe('ap-south-1');
      return { send } as never;
    });
    const r = await p.list('', 50);
    expect(send.mock.calls[0]![0].input).toEqual({ Bucket: 'b', Prefix: 'docs/', Delimiter: '/', MaxKeys: 50 });
    expect(r.items).toEqual([
      { name: '2026', path: '2026', isFolder: true },
      { name: 'readme.pdf', path: 'readme.pdf', isFolder: false, size: 120, modified: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('reports a passing test', async () => {
    const p = s3Provider({ region: 'eu-west-1', bucket: 'b' }, { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'x'.repeat(40) }, () => ({ send: async () => ({ KeyCount: 1 }) }) as never);
    expect(await p.test()).toBe('Connected to s3://b/');
  });
});

describe('Azure Blob provider', () => {
  it('lists blobs and virtual folders under the root', async () => {
    const container = {
      listBlobsByHierarchy: (_d: string, opts: { prefix?: string }) => ({
        byPage: () => ({
          next: async () => {
            expect(opts.prefix).toBe('scans/2026/');
            return {
              done: false,
              value: {
                segment: { blobPrefixes: [{ name: 'scans/2026/oct/' }], blobItems: [{ name: 'scans/2026/a.pdf', properties: { contentLength: 9, lastModified: new Date('2026-10-02T00:00:00Z') } }] },
                continuationToken: 'more',
              },
            };
          },
        }),
      }),
    };
    const p = azureBlobProvider({ container: 'docs', rootFolder: 'scans', accountName: 'acct' }, { connectionString: 'x' }, () => container as never);
    const r = await p.list('2026', 10);
    expect(r).toEqual({
      path: '2026',
      items: [
        { name: 'oct', path: '2026/oct', isFolder: true },
        { name: 'a.pdf', path: '2026/a.pdf', isFolder: false, size: 9, modified: '2026-10-02T00:00:00.000Z' },
      ],
      truncated: true,
    });
  });
});

describe('SharePoint provider', () => {
  const config = { tenantId: 'contoso.onmicrosoft.com', clientId: '11111111-2222-3333-4444-555555555555', siteUrl: 'https://contoso.sharepoint.com/sites/Finance', library: 'Invoices' };

  function fakeGraph(overrides: Record<string, () => Response> = {}) {
    const calls: string[] = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const routes: Record<string, () => Response> = {
      token: () => json({ access_token: 'tok', expires_in: 3600 }),
      site: () => json({ id: 'site-1', displayName: 'Finance' }),
      drives: () => json({ value: [{ id: 'drive-9', name: 'Invoices' }, { id: 'drive-1', name: 'Documents' }] }),
      children: () => json({ value: [{ name: 'b.pdf', size: 5, lastModifiedDateTime: '2026-10-03T00:00:00Z' }, { name: 'Archive', folder: { childCount: 2 } }] }),
      ...overrides,
    };
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token')) {
        expect(String(init?.body)).toContain('grant_type=client_credentials');
        return routes.token!();
      }
      expect(url.startsWith('https://graph.microsoft.com/v1.0/')).toBe(true);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      if (url.endsWith('/sites/contoso.sharepoint.com:/sites/Finance')) return routes.site!();
      if (url.includes('/sites/site-1/drives')) return routes.drives!();
      if (url.includes('/children')) return routes.children!();
      return json({ error: { message: 'not found' } }, 404);
    });
    return { f, calls };
  }

  it('signs in, finds the site and library, and lists folders first', async () => {
    const { f, calls } = fakeGraph();
    const p = sharepointProvider(config, { clientSecret: 'super-secret' }, f as never);
    expect(await p.test()).toBe('Connected to Finance › Invoices');
    const r = await p.list('2026', 20);
    expect(calls.at(-1)).toBe('https://graph.microsoft.com/v1.0/drives/drive-9/root:/2026:/children?$top=20&$select=name,size,lastModifiedDateTime,folder');
    expect(r.items.map((i) => [i.name, i.isFolder, i.path])).toEqual([
      ['Archive', true, '2026/Archive'],
      ['b.pdf', false, '2026/b.pdf'],
    ]);
    // The token is reused, not fetched per call.
    expect(calls.filter((c) => c.includes('login.microsoftonline.com'))).toHaveLength(1);
  });

  it('explains a missing library and an Entra sign-in failure', async () => {
    const missing = fakeGraph({ drives: () => new Response(JSON.stringify({ value: [{ id: 'd', name: 'Documents' }] }), { status: 200 }) });
    await expect(sharepointProvider(config, { clientSecret: 's' }, missing.f as never).test()).rejects.toThrow('No document library named "Invoices" on this site. Found: Documents');
    const badSecret = fakeGraph({ token: () => new Response(JSON.stringify({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }), { status: 401 }) });
    await expect(sharepointProvider(config, { clientSecret: 's' }, badSecret.f as never).test()).rejects.toThrow('Signing in to Microsoft Entra failed (401): AADSTS7000215');
  });
});
