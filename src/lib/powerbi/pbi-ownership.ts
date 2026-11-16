import 'server-only';

/**
 * Ownership, access and refresh facts for one Power BI semantic model, from the standard
 * (non-admin) REST APIs the service principal can call as workspace member/admin:
 *   dataset (configuredBy, createdDate), refresh history + schedule, workspace users,
 *   dataset users, datasources, reports built on the dataset.
 * Report "created by / modified by" is only in the Fabric admin (scanner) API — not fetched here.
 */

import { powerBiGet } from '@/lib/powerbi/client';
import { resolveReportOpenUrl } from '@/lib/powerbi/report-url';

export type PbiOwnership = {
  fetched_at: string;
  dataset: {
    configured_by: string | null;
    created_date: string | null;
    storage_mode: string | null;
    is_refreshable: boolean | null;
    on_prem_gateway: boolean | null;
  };
  refresh: {
    last: { status: string; type: string | null; start: string | null; end: string | null; error: string | null } | null;
    last_success_at: string | null;
    recent_failures: number;
    recent_count: number;
    schedule: { enabled: boolean; days: string[]; times: string[]; time_zone: string | null } | null;
  };
  access: {
    workspace: { name: string; right: string; type: string }[];
    dataset: { name: string; right: string; type: string }[];
  };
  sources: { type: string; server: string | null; database: string | null; gateway: boolean }[];
  reports: { name: string; web_url: string | null }[];
  /** Sections the service principal could not read (permission or API errors). */
  unavailable: string[];
};

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

function refreshError(json: unknown): string | null {
  if (typeof json !== 'string' || !json.trim()) return null;
  try {
    const e = JSON.parse(json) as Raw;
    return [str(e.errorCode), str(e.errorDescription)].filter(Boolean).join(': ') || json.slice(0, 300);
  } catch {
    return json.slice(0, 300);
  }
}

export async function fetchModelOwnership(workspaceId: string, datasetId: string): Promise<PbiOwnership> {
  const unavailable: string[] = [];
  const get = async <T>(label: string, path: string): Promise<T | null> => {
    try {
      return await powerBiGet<T>(path);
    } catch {
      unavailable.push(label);
      return null;
    }
  };
  const base = `groups/${workspaceId}`;
  const [ds, refreshes, schedule, wsUsers, dsUsers, sources, reports] = await Promise.all([
    get<Raw>('dataset', `${base}/datasets/${datasetId}`),
    get<{ value?: Raw[] }>('refresh history', `${base}/datasets/${datasetId}/refreshes?$top=10`),
    get<Raw>('refresh schedule', `${base}/datasets/${datasetId}/refreshSchedule`),
    get<{ value?: Raw[] }>('workspace access', `${base}/users`),
    get<{ value?: Raw[] }>('dataset access', `${base}/datasets/${datasetId}/users`),
    get<{ value?: Raw[] }>('data sources', `${base}/datasets/${datasetId}/datasources`),
    get<{ value?: Raw[] }>('reports', `${base}/reports`),
  ]);

  const hist = refreshes?.value ?? [];
  const last = hist[0];
  const success = hist.find((r) => r.status === 'Completed' && str(r.endTime));

  const rightOrder = ['Admin', 'Member', 'Contributor', 'Viewer'];
  const people = (rows: Raw[] | undefined, rightKey: string) =>
    (rows ?? [])
      .map((u) => ({
        name: str(u.displayName) ?? str(u.emailAddress) ?? str(u.identifier) ?? 'unknown',
        right: str(u[rightKey]) ?? 'unknown',
        type: str(u.principalType) ?? 'unknown',
      }))
      .sort((a, b) => {
        const ra = rightOrder.indexOf(a.right);
        const rb = rightOrder.indexOf(b.right);
        return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || a.name.localeCompare(b.name);
      });

  return {
    fetched_at: new Date().toISOString(),
    dataset: {
      configured_by: str(ds?.configuredBy),
      created_date: str(ds?.createdDate),
      storage_mode: str(ds?.targetStorageMode),
      is_refreshable: typeof ds?.isRefreshable === 'boolean' ? ds.isRefreshable : null,
      on_prem_gateway: typeof ds?.isOnPremGatewayRequired === 'boolean' ? ds.isOnPremGatewayRequired : null,
    },
    refresh: {
      last: last
        ? {
            status: str(last.status) ?? 'Unknown',
            type: str(last.refreshType),
            start: str(last.startTime),
            end: str(last.endTime),
            error: refreshError(last.serviceExceptionJson),
          }
        : null,
      last_success_at: success ? str(success.endTime) : null,
      recent_failures: hist.filter((r) => r.status === 'Failed').length,
      recent_count: hist.length,
      schedule: schedule
        ? {
            enabled: schedule.enabled === true,
            days: Array.isArray(schedule.days) ? (schedule.days as string[]) : [],
            times: Array.isArray(schedule.times) ? (schedule.times as string[]) : [],
            time_zone: str(schedule.localTimeZoneId),
          }
        : null,
    },
    access: {
      workspace: people(wsUsers?.value, 'groupUserAccessRight'),
      dataset: people(dsUsers?.value, 'datasetUserAccessRight'),
    },
    sources: (sources?.value ?? []).map((s) => {
      const c = (s.connectionDetails ?? {}) as Raw;
      // Connectors such as Snowflake / Databricks report type "Extension" with {kind, path};
      // path is a JSON string ({"host": …, "httpPath": …}) or a plain name ("PowerBI").
      const path = str(c.path) ?? str(c.extensionDataSourcePath);
      let ext: Raw = {};
      if (path?.startsWith('{')) {
        try {
          ext = JSON.parse(path) as Raw;
        } catch {
          ext = {};
        }
      }
      const kind = str(c.kind) ?? str(c.extensionDataSourceKind);
      return {
        type: kind === 'PowerBI' ? 'Power BI dataflow / dataset' : (kind ?? str(s.datasourceType) ?? 'unknown'),
        server: str(c.server) ?? str(ext.host) ?? str(ext.server) ?? str(ext.account) ?? str(c.url) ?? (path && !path.startsWith('{') && path !== kind ? path : null),
        database: str(c.database) ?? str(ext.warehouse) ?? str(ext.httpPath) ?? str(ext.database),
        gateway: Boolean(str(s.gatewayId)),
      };
    }),
    reports: (reports?.value ?? [])
      .filter((r) => r.datasetId === datasetId)
      .map((r) => {
        const resolved = resolveReportOpenUrl({
          web_url: str(r.webUrl),
          pbi_report_id: str(r.id),
          report_format: str(r.format),
          workspace_pbi_id: workspaceId,
        });
        return { name: str(r.name) ?? 'report', web_url: resolved?.url ?? null };
      }),
    unavailable,
  };
}
