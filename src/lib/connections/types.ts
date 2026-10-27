import { z } from 'zod';

// Storage connections: S3, Azure Blob and SharePoint. Each kind splits its input into `config`
// (stored in Postgres, shown in the UI) and `secret` (stored only in AWS Secrets Manager, never
// returned). Validation here also pins every connection to the provider's own endpoints, so a
// connection can never be pointed at an internal address.

export const CONNECTION_KINDS = ['s3', 'azure_blob', 'sharepoint'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const KIND_LABEL: Record<ConnectionKind, string> = {
  s3: 'Amazon S3',
  azure_blob: 'Azure Blob Storage',
  sharepoint: 'SharePoint',
};

const folder = z
  .string()
  .max(512)
  .transform((v) => v.trim().replace(/^\/+|\/+$/g, ''))
  .refine((v) => !v.split('/').includes('..'), 'must not contain ".."')
  .optional();

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a GUID');

export const s3Config = z.object({
  region: z.string().regex(/^[a-z]{2}(-gov)?-[a-z]+-\d$/, 'must be an AWS region such as ap-south-1'),
  bucket: z.string().regex(/^(?!xn--)(?!.*-s3alias$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name'),
  rootFolder: folder,
});
export const s3Secret = z.object({
  accessKeyId: z.string().regex(/^[A-Z0-9]{16,128}$/, 'must be an AWS access key ID'),
  secretAccessKey: z.string().min(16).max(256),
});

export const azureBlobConfig = z.object({
  container: z.string().regex(/^(?!.*--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$|^\$root$/, 'must be a valid container name'),
  rootFolder: folder,
});
export const azureBlobSecret = z.object({ connectionString: z.string().min(20).max(4000) });

export const sharepointConfig = z.object({
  tenantId: z.union([guid, z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'must be a tenant GUID or domain')]),
  clientId: guid,
  siteUrl: z
    .string()
    .url()
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === 'https:' && /^[a-z0-9-]+\.sharepoint\.com$/i.test(url.hostname);
    }, 'must be an https://<tenant>.sharepoint.com site URL'),
  library: z.string().max(200).optional(),
  rootFolder: folder,
});
export const sharepointSecret = z.object({ clientSecret: z.string().min(8).max(512) });

export const CONFIG_SCHEMA = { s3: s3Config, azure_blob: azureBlobConfig, sharepoint: sharepointConfig } as const;
export const SECRET_SCHEMA = { s3: s3Secret, azure_blob: azureBlobSecret, sharepoint: sharepointSecret } as const;

export type S3Config = z.infer<typeof s3Config>;
export type S3Secret = z.infer<typeof s3Secret>;
export type AzureBlobConfig = z.infer<typeof azureBlobConfig> & { accountName?: string };
export type AzureBlobSecret = z.infer<typeof azureBlobSecret>;
export type SharepointConfig = z.infer<typeof sharepointConfig>;
export type SharepointSecret = z.infer<typeof sharepointSecret>;

/** Azure endpoint suffixes a connection string may use (public, US Gov and China clouds). */
const AZURE_SUFFIXES = ['core.windows.net', 'core.usgovcloudapi.net', 'core.chinacloudapi.cn'];

/**
 * Parses an Azure Storage connection string and checks it can only reach Azure's blob endpoint.
 * Returns the account name (safe to show) or an error. The key or SAS is never returned.
 */
export function parseAzureConnectionString(cs: string): { ok: true; accountName: string } | { ok: false; error: string } {
  const parts = new Map<string, string>();
  for (const seg of cs.split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts.set(seg.slice(0, i).trim().toLowerCase(), seg.slice(i + 1).trim());
  }
  if (parts.has('usedevelopmentstorage')) return { ok: false, error: 'Development storage is not allowed' };
  const protocol = parts.get('defaultendpointsprotocol');
  if (protocol && protocol.toLowerCase() !== 'https') return { ok: false, error: 'The connection string must use https' };
  if (!parts.get('accountkey') && !parts.get('sharedaccesssignature')) return { ok: false, error: 'The connection string needs an AccountKey or a SharedAccessSignature' };
  const suffix = (parts.get('endpointsuffix') ?? 'core.windows.net').toLowerCase();
  if (!AZURE_SUFFIXES.includes(suffix)) return { ok: false, error: `EndpointSuffix must be one of ${AZURE_SUFFIXES.join(', ')}` };
  const blobEndpoint = parts.get('blobendpoint');
  let accountName = parts.get('accountname') ?? '';
  if (blobEndpoint) {
    let host: string;
    try {
      const url = new URL(blobEndpoint);
      if (url.protocol !== 'https:') return { ok: false, error: 'BlobEndpoint must use https' };
      host = url.hostname.toLowerCase();
    } catch {
      return { ok: false, error: 'BlobEndpoint is not a valid URL' };
    }
    const m = host.match(/^([a-z0-9]{3,24})\.blob\.(.+)$/);
    if (!m || !AZURE_SUFFIXES.includes(m[2]!)) return { ok: false, error: 'BlobEndpoint must be an Azure blob endpoint (<account>.blob.core.windows.net)' };
    accountName ||= m[1]!;
  }
  if (!/^[a-z0-9]{3,24}$/.test(accountName)) return { ok: false, error: 'The connection string needs a valid AccountName' };
  return { ok: true, accountName };
}

/** What the UI and API return for a connection. Never includes secrets or the secret reference. */
/** `private`: only the owner (and platform admins). `org`: everyone in the organisation may use it. */
export const VISIBILITIES = ['private', 'org'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type ConnectionSummary = {
  id: string;
  name: string;
  kind: ConnectionKind;
  config: Record<string, unknown>;
  status: string;
  lastTestedAt: Date | null;
  lastError: string | null;
  visibility: Visibility;
  createdBy: string;
  /** Display name of the owner, when known. */
  ownerName: string | null;
  /** The caller owns it. */
  mine: boolean;
  /** The caller may change, share or delete it (owner or platform admin). */
  canManage: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type BrowseItem = { name: string; path: string; isFolder: boolean; size?: number; modified?: string };
export type BrowseResult = { path: string; items: BrowseItem[]; truncated: boolean };

/** A live client for one connection. Implementations live in ./providers. */
export interface StorageProvider {
  /** Proves the credentials work and the bucket / container / site is reachable. Returns a short description. */
  test(): Promise<string>;
  /** Lists one level under `path` (relative to the connection's root folder). */
  list(path: string, max: number): Promise<BrowseResult>;
}

/** Joins a connection's root folder and a browse path, refusing to climb above the root. */
export function scopedPath(root: string | undefined, path: string): string {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (clean.split('/').includes('..')) throw new Error('The path must not contain ".."');
  return [root, clean].filter(Boolean).join('/');
}

/** Removes secret values and SAS signatures from provider error text before it is shown or stored. */
export function redact(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out
    .replace(/([?&](sig|se|sp|sv|st|spr|srt|ss|skoid|sktid|skt|ske|sks|skv)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/(AccountKey=)[^;\s"']+/gi, '$1[redacted]')
    .replace(/(SharedAccessSignature=)[^;\s"']+/gi, '$1[redacted]')
    .slice(0, 500);
}
