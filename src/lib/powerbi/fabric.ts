import 'server-only';

import { getPowerBiCredentials } from '@/lib/powerbi/credentials';
import { PowerBiApiError } from '@/lib/powerbi/client';

const FABRIC_ROOT = 'https://api.fabric.microsoft.com/v1';
const FABRIC_SCOPE = 'https://api.fabric.microsoft.com/.default';

let cachedFabricToken: { value: string; expiresAt: number } | null = null;

export type FabricDefinitionPart = {
  path: string;
  payload: string;
};

async function getFabricAccessToken(): Promise<string> {
  const creds = getPowerBiCredentials();
  if (!creds) {
    throw new PowerBiApiError('Power BI credentials missing (PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET)');
  }
  if (cachedFabricToken && cachedFabricToken.expiresAt > Date.now() + 60_000) {
    return cachedFabricToken.value;
  }
  const url = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: FABRIC_SCOPE,
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new PowerBiApiError(`Fabric token request failed (${res.status})`, res.status);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new PowerBiApiError('Fabric token response missing access_token');
  }
  const ttl = (json.expires_in ?? 3600) * 1000;
  cachedFabricToken = { value: json.access_token, expiresAt: Date.now() + ttl };
  return json.access_token;
}

function errorText(res: Response, body: unknown): string {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    return `${String(o.errorCode ?? '')}: ${String(o.message ?? '')}`.replace(/^:\s*/, '');
  }
  return '';
}

async function waitForFabricOperation(
  token: string,
  response: Response,
): Promise<unknown> {
  const location = response.headers.get('Location');
  const opId = response.headers.get('x-ms-operation-id');
  let opUrl = location;
  if (!opUrl && opId) {
    opUrl = `${FABRIC_ROOT}/operations/${opId}`;
  }
  if (!opUrl) {
    throw new PowerBiApiError('Fabric getDefinition returned 202 without operation location');
  }

  let last = response;
  for (let attempt = 0; attempt < 60; attempt++) {
    const retry = Number(last.headers.get('Retry-After') ?? 5);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(retry, 2), 30) * 1000));
    const statusRes = await fetch(opUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!statusRes.ok) {
      const text = await statusRes.text().catch(() => '');
      throw new PowerBiApiError(`Fabric operation status ${statusRes.status}: ${text.slice(0, 200)}`);
    }
    const statusJson = (await statusRes.json()) as { status?: string; error?: unknown };
    if (statusJson.status === 'Succeeded') {
      const resultRes = await fetch(`${opUrl.replace(/\/$/, '')}/result`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!resultRes.ok) {
        const text = await resultRes.text().catch(() => '');
        throw new PowerBiApiError(`Fabric operation result ${resultRes.status}: ${text.slice(0, 200)}`);
      }
      return resultRes.json();
    }
    if (statusJson.status === 'Failed' || statusJson.status === 'Undefined') {
      throw new PowerBiApiError(`Fabric operation ${statusJson.status}: ${JSON.stringify(statusJson.error ?? '')}`);
    }
    last = statusRes;
  }
  throw new PowerBiApiError('Fabric getDefinition timed out');
}

async function fabricPostDefinition(url: string): Promise<FabricDefinitionPart[]> {
  const token = await getFabricAccessToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  let json: unknown;
  if (res.status === 200) {
    json = await res.json();
  } else if (res.status === 202) {
    json = await waitForFabricOperation(token, res);
  } else {
    const body = await res.json().catch(() => null);
    const detail = errorText(res, body) || (await res.text().catch(() => '')).slice(0, 200);
    throw new PowerBiApiError(`POST ${url} → ${res.status}: ${detail}`, res.status);
  }

  const parts = (json as { definition?: { parts?: FabricDefinitionPart[] } })?.definition?.parts;
  if (!parts?.length) {
    throw new PowerBiApiError('Fabric definition response has no parts');
  }
  return parts;
}

export async function fetchSemanticModelDefinitionTmdl(
  workspaceId: string,
  modelId: string,
): Promise<FabricDefinitionPart[]> {
  const url = `${FABRIC_ROOT}/workspaces/${workspaceId}/semanticModels/${modelId}/getDefinition?format=TMDL`;
  return fabricPostDefinition(url);
}

export async function fetchReportDefinition(
  workspaceId: string,
  reportId: string,
  format?: 'PBIR' | 'PBIR-Legacy',
): Promise<FabricDefinitionPart[]> {
  let url = `${FABRIC_ROOT}/workspaces/${workspaceId}/reports/${reportId}/getDefinition`;
  if (format) {
    url += `?format=${encodeURIComponent(format)}`;
  }
  return fabricPostDefinition(url);
}
