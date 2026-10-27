import { FileTooLargeError, fileName, scopedPath, type BrowseResult, type SharepointConfig, type SharepointSecret, type StorageProvider } from '../types';

// SharePoint through Microsoft Graph with an Entra app (tenant id, client id, client secret) using the
// client-credentials flow. Requests go only to login.microsoftonline.com and graph.microsoft.com; the
// site URL is used as a lookup key, never fetched. A download uses the short-lived, pre-authorised
// link Graph returns, and only when it is on *.sharepoint.com (no token is sent with it). Grant the
// app `Sites.Selected` (or Sites.Read.All) with admin consent. Read-only: list and download files.

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;
type DriveItem = { name: string; size?: number; lastModifiedDateTime?: string; folder?: unknown };

async function graphError(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } | string; error_description?: string };
  const detail = typeof body.error === 'string' ? body.error_description ?? body.error : body.error?.message ?? body.error?.code;
  return new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

export function sharepointProvider(config: SharepointConfig, secret: SharepointSecret, fetchImpl: Fetch = fetch): StorageProvider {
  let token: { value: string; expires: number } | null = null;
  let driveId: string | null = null;
  const root = config.rootFolder;

  async function getToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const res = await fetchImpl(`${LOGIN}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: secret.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw await graphError(res, 'Signing in to Microsoft Entra');
    const data = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return token.value;
  }

  async function graph<T>(path: string, what: string): Promise<T> {
    const res = await fetchImpl(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw await graphError(res, what);
    return (await res.json()) as T;
  }

  async function resolveDrive(): Promise<{ siteName: string; driveName: string }> {
    const url = new URL(config.siteUrl);
    const sitePath = url.pathname.replace(/\/+$/, '');
    const site = await graph<{ id: string; displayName?: string }>(`/sites/${url.hostname}${sitePath ? `:${sitePath}` : ''}`, 'Finding the SharePoint site');
    let drive: { id: string; name: string };
    if (config.library) {
      const drives = await graph<{ value: { id: string; name: string }[] }>(`/sites/${site.id}/drives?$select=id,name`, 'Listing document libraries');
      const found = drives.value.find((d) => d.name.toLowerCase() === config.library!.toLowerCase());
      if (!found) throw new Error(`No document library named "${config.library}" on this site. Found: ${drives.value.map((d) => d.name).join(', ') || 'none'}`);
      drive = found;
    } else {
      drive = await graph<{ id: string; name: string }>(`/sites/${site.id}/drive?$select=id,name`, 'Opening the default document library');
    }
    driveId = drive.id;
    return { siteName: site.displayName ?? sitePath, driveName: drive.name };
  }

  const itemPath = (full: string) => (full ? `/root:/${full.split('/').map(encodeURIComponent).join('/')}:` : '/root');

  return {
    async test() {
      const { siteName, driveName } = await resolveDrive();
      if (root) await graph(`/drives/${driveId}${itemPath(root)}?$select=id`, `Opening the folder "${root}"`);
      return `Connected to ${siteName} › ${driveName}${root ? ` › ${root}` : ''}`;
    },

    async list(path, max): Promise<BrowseResult> {
      if (!driveId) await resolveDrive();
      const full = scopedPath(root, path);
      const data = await graph<{ value: DriveItem[]; '@odata.nextLink'?: string }>(
        `/drives/${driveId}${itemPath(full)}/children?$top=${max}&$select=name,size,lastModifiedDateTime,folder`,
        'Listing files',
      );
      const base = path.replace(/^\/+|\/+$/g, '');
      const items = data.value.map((i) => ({
        name: i.name,
        path: [base, i.name].filter(Boolean).join('/'),
        isFolder: !!i.folder,
        size: i.folder ? undefined : i.size,
        modified: i.lastModifiedDateTime,
      }));
      items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
      return { path: base, items, truncated: !!data['@odata.nextLink'] };
    },

    async read(path, maxBytes) {
      if (!driveId) await resolveDrive();
      const full = scopedPath(root, path);
      const item = await graph<DriveItem & { file?: { mimeType?: string }; '@microsoft.graph.downloadUrl'?: string }>(`/drives/${driveId}${itemPath(full)}`, `Opening "${fileName(full)}"`);
      if (!item.file) throw new Error(`"${fileName(full)}" is a folder, not a file`);
      if ((item.size ?? 0) > maxBytes) throw new FileTooLargeError(item.name, item.size!, maxBytes);
      const link = item['@microsoft.graph.downloadUrl'];
      if (!link || !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.sharepoint\.com\//i.test(link)) throw new Error('SharePoint did not return a download link on sharepoint.com');
      const res = await fetchImpl(link, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
      if (!res.ok) throw new Error(`Downloading "${item.name}" failed (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new FileTooLargeError(item.name, bytes.byteLength, maxBytes);
      return { name: item.name, bytes, contentType: item.file.mimeType };
    },
  };
}
