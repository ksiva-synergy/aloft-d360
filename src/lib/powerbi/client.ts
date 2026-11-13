import 'server-only';

import { getPowerBiCredentials } from '@/lib/powerbi/credentials';

const PBI_API_ROOT = 'https://api.powerbi.com/v1.0/myorg';
const TOKEN_SCOPE = 'https://analysis.windows.net/powerbi/api/.default';

let cachedToken: { value: string; expiresAt: number } | null = null;

export class PowerBiApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'PowerBiApiError';
  }
}

export async function getPowerBiAccessToken(): Promise<string> {
  const creds = getPowerBiCredentials();
  if (!creds) {
    throw new PowerBiApiError('Power BI credentials missing (PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET)');
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const url = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: TOKEN_SCOPE,
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new PowerBiApiError(`Token request failed (${res.status})`, res.status);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new PowerBiApiError('Token response missing access_token');
  }
  const ttl = (json.expires_in ?? 3600) * 1000;
  cachedToken = { value: json.access_token, expiresAt: Date.now() + ttl };
  return json.access_token;
}

export async function powerBiGet<T>(path: string): Promise<T> {
  const token = await getPowerBiAccessToken();
  const url = path.startsWith('http') ? path : `${PBI_API_ROOT}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PowerBiApiError(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return res.json() as Promise<T>;
}

export interface PbiWorkspaceListItem {
  id: string;
  name?: string;
}

export interface PbiDatasetListItem {
  id: string;
  name?: string;
  description?: string;
  configuredBy?: string;
  isRefreshable?: boolean;
  targetStorageMode?: string;
  isEffectiveIdentityRequired?: boolean;
  isEffectiveIdentityRolesRequired?: boolean;
}

export interface PbiReportListItem {
  id: string;
  name?: string;
  reportType?: string;
  format?: string;
  datasetId?: string;
  webUrl?: string;
}

export async function listWorkspaces(): Promise<PbiWorkspaceListItem[]> {
  const data = await powerBiGet<{ value: PbiWorkspaceListItem[] }>('groups');
  return data.value ?? [];
}

export async function listDatasets(workspaceId: string): Promise<PbiDatasetListItem[]> {
  const data = await powerBiGet<{ value: PbiDatasetListItem[] }>(`groups/${workspaceId}/datasets`);
  return data.value ?? [];
}

export async function listReports(workspaceId: string): Promise<PbiReportListItem[]> {
  const data = await powerBiGet<{ value: PbiReportListItem[] }>(`groups/${workspaceId}/reports`);
  return data.value ?? [];
}

export async function listDatasetDatasources(
  workspaceId: string,
  datasetId: string,
): Promise<unknown[]> {
  const data = await powerBiGet<{ value: unknown[] }>(
    `groups/${workspaceId}/datasets/${datasetId}/datasources`,
  );
  return data.value ?? [];
}

export interface PbiExecuteQueriesResponse {
  results?: Array<{
    tables?: Array<{
      rows?: unknown[];
    }>;
    error?: { code?: string; message?: string };
  }>;
}

/** Run DAX against a dataset in a workspace (service principal). */
export async function executeDatasetQueries(
  workspaceId: string,
  datasetId: string,
  queries: string[],
): Promise<PbiExecuteQueriesResponse> {
  const token = await getPowerBiAccessToken();
  const url = `${PBI_API_ROOT}/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: queries.map((query) => ({ query })),
      serializerSettings: { includeNulls: true },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PowerBiApiError(
      `executeQueries ${datasetId} → ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }
  return res.json() as Promise<PbiExecuteQueriesResponse>;
}
