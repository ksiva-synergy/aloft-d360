/**
 * Downloading one file through each provider (fake clients, no network): the path stays inside the
 * root folder, a file over the limit is refused before its content is fetched, and SharePoint only
 * follows a download link on sharepoint.com and sends no token with it.
 */
import { describe, expect, it, vi } from 'vitest';
import { FileTooLargeError } from '../types';
import { s3Provider } from '../providers/s3';
import { azureBlobProvider } from '../providers/azure-blob';
import { sharepointProvider } from '../providers/sharepoint';

const s3Secret = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'x'.repeat(40) };

describe('S3 read', () => {
  it('downloads the object under the root folder', async () => {
    const send = vi.fn(async () => ({ ContentLength: 3, ContentType: 'application/pdf', Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }));
    const p = s3Provider({ region: 'ap-south-1', bucket: 'crew', rootFolder: 'certs' }, s3Secret, () => ({ send }) as never);
    expect(await p.read('2026/smith.pdf', 100)).toEqual({ name: 'smith.pdf', bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' });
    expect((send.mock.calls[0] as unknown as [{ input: unknown }])[0].input).toEqual({ Bucket: 'crew', Key: 'certs/2026/smith.pdf' });
    await expect(p.read('../payroll/x.pdf', 100)).rejects.toThrow(/must not contain/);
  });

  it('refuses an object over the limit without reading its body', async () => {
    const destroy = vi.fn();
    const transformToByteArray = vi.fn();
    const p = s3Provider({ region: 'ap-south-1', bucket: 'crew' }, s3Secret, () => ({ send: async () => ({ ContentLength: 5000, Body: { destroy, transformToByteArray } }) }) as never);
    await expect(p.read('big.pdf', 1000)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(destroy).toHaveBeenCalled();
    expect(transformToByteArray).not.toHaveBeenCalled();
  });
});

describe('Azure Blob read', () => {
  it('checks the size first, then downloads', async () => {
    const downloadToBuffer = vi.fn(async () => Buffer.from([7, 8]));
    const getBlobClient = vi.fn(() => ({ getProperties: async () => ({ contentLength: 2, contentType: 'image/png' }), downloadToBuffer }));
    const p = azureBlobProvider({ container: 'docs', rootFolder: 'scans' }, { connectionString: 'x' }, () => ({ getBlobClient }) as never);
    expect(await p.read('a.png', 10)).toEqual({ name: 'a.png', bytes: new Uint8Array([7, 8]), contentType: 'image/png' });
    expect(getBlobClient).toHaveBeenCalledWith('scans/a.png');

    const big = azureBlobProvider({ container: 'docs' }, { connectionString: 'x' }, () => ({ getBlobClient: () => ({ getProperties: async () => ({ contentLength: 99 }), downloadToBuffer }) }) as never);
    downloadToBuffer.mockClear();
    await expect(big.read('b.pdf', 10)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(downloadToBuffer).not.toHaveBeenCalled();
  });
});

describe('SharePoint read', () => {
  const config = { tenantId: 'contoso.onmicrosoft.com', clientId: '11111111-2222-3333-4444-555555555555', siteUrl: 'https://contoso.sharepoint.com/sites/Crew' };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  function fake(downloadUrl: string, size = 4) {
    const calls: { url: string; auth?: string }[] = [];
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url.includes('login.microsoftonline.com')) return json({ access_token: 'tok', expires_in: 3600 });
      if (url.endsWith('/sites/contoso.sharepoint.com:/sites/Crew')) return json({ id: 'site-1' });
      if (url.includes('/sites/site-1/drive?')) return json({ id: 'drive-1', name: 'Documents' });
      if (url.includes('/drives/drive-1/root:/certs/smith.pdf:')) return json({ name: 'smith.pdf', size, file: { mimeType: 'application/pdf' }, '@microsoft.graph.downloadUrl': downloadUrl });
      if (url === downloadUrl) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    return { f, calls };
  }

  it('downloads through the pre-authorised sharepoint.com link without sending the token', async () => {
    const link = 'https://contoso.sharepoint.com/sites/Crew/_layouts/15/download.aspx?UniqueId=abc&tempauth=xyz';
    const { f, calls } = fake(link);
    const p = sharepointProvider(config, { clientSecret: 's' }, f as never);
    expect(await p.read('certs/smith.pdf', 100)).toEqual({ name: 'smith.pdf', bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'application/pdf' });
    expect(calls.find((c) => c.url === link)!.auth).toBeUndefined();
  });

  it('refuses a download link outside sharepoint.com and a file over the limit', async () => {
    const evil = fake('https://attacker.example.com/file.pdf');
    await expect(sharepointProvider(config, { clientSecret: 's' }, evil.f as never).read('certs/smith.pdf', 100)).rejects.toThrow(/download link on sharepoint\.com/);
    expect(evil.calls.some((c) => c.url.startsWith('https://attacker'))).toBe(false);

    const big = fake('https://contoso.sharepoint.com/dl', 5000);
    await expect(sharepointProvider(config, { clientSecret: 's' }, big.f as never).read('certs/smith.pdf', 100)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(big.calls.some((c) => c.url === 'https://contoso.sharepoint.com/dl')).toBe(false);
  });
});
