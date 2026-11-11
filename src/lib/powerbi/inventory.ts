import 'server-only';

import { createHash } from 'node:crypto';
import prisma from '@/lib/db';
import {
  listDatasetDatasources,
  listDatasets,
  listReports,
  listWorkspaces,
  PowerBiApiError,
} from '@/lib/powerbi/client';

function sha256Short(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function isPersonalFileDatasource(ds: Record<string, unknown>): boolean {
  const details = (ds.connectionDetails ?? ds.datasourceDetails) as Record<string, unknown> | undefined;
  const url = String(details?.url ?? details?.server ?? '').toLowerCase();
  return url.includes('-my.sharepoint.com/personal/');
}

function parseDatasourceRow(ds: Record<string, unknown>): {
  datasource_type: string | null;
  connection_server: string | null;
  connection_path: string | null;
  gateway_id: string | null;
  datasource_id: string | null;
  is_personal_file: boolean;
} {
  const details = (ds.connectionDetails ?? ds.datasourceDetails) as Record<string, unknown> | undefined;
  return {
    datasource_type: typeof ds.datasourceType === 'string' ? ds.datasourceType : null,
    connection_server: typeof details?.server === 'string' ? details.server : null,
    connection_path: typeof details?.path === 'string' ? details.path : null,
    gateway_id: typeof ds.gatewayId === 'string' ? ds.gatewayId : null,
    datasource_id: typeof ds.datasourceId === 'string' ? ds.datasourceId : null,
    is_personal_file: isPersonalFileDatasource(ds),
  };
}

export interface PbiInventoryResult {
  workspaces: number;
  models: number;
  reports: number;
  datasources: number;
  datasource_errors: number;
  run_id: string;
}

export async function runPbiInventory(
  orgId: string,
  sourceId: string,
  opts: { runId: string; workspaceIds?: string[]; fetchDatasources?: boolean },
): Promise<PbiInventoryResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const scopeInclude = Array.isArray(source.scope_include)
    ? (source.scope_include as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  let workspaces = await listWorkspaces();
  const filterIds = opts.workspaceIds?.length ? opts.workspaceIds : scopeInclude;
  if (filterIds.length > 0) {
    const allow = new Set(filterIds);
    workspaces = workspaces.filter((w) => allow.has(w.id));
  }

  let modelCount = 0;
  let reportCount = 0;
  let datasourceCount = 0;
  let datasourceErrors = 0;
  const fetchDatasources = opts.fetchDatasources !== false;

  const modelInternalIdByPbiId = new Map<string, string>();

  for (const ws of workspaces) {
    const wsHash = sha256Short(JSON.stringify(ws));
    const workspace = await prisma.pbiWorkspace.upsert({
      where: {
        org_id_pbi_workspace_id: { org_id: orgId, pbi_workspace_id: ws.id },
      },
      create: {
        org_id: orgId,
        pbi_workspace_id: ws.id,
        name: ws.name ?? ws.id,
        content_hash: wsHash,
        first_seen_run: opts.runId,
        last_seen_run: opts.runId,
      },
      update: {
        name: ws.name ?? ws.id,
        content_hash: wsHash,
        last_seen_run: opts.runId,
        lifecycle: 'active',
        updated_at: new Date(),
      },
    });

    const datasets = await listDatasets(ws.id);
    for (const ds of datasets) {
      modelCount += 1;
      const rls =
        Boolean(ds.isEffectiveIdentityRequired) || Boolean(ds.isEffectiveIdentityRolesRequired);
      const modelHash = sha256Short(JSON.stringify(ds));
      const model = await prisma.pbiModel.upsert({
        where: {
          org_id_pbi_model_id: { org_id: orgId, pbi_model_id: ds.id },
        },
        create: {
          org_id: orgId,
          workspace_id: workspace.id,
          pbi_model_id: ds.id,
          name: ds.name ?? ds.id,
          description: ds.description ?? null,
          configured_by: ds.configuredBy ?? null,
          is_refreshable: ds.isRefreshable ?? null,
          storage_mode: ds.targetStorageMode ?? null,
          rls_required: rls,
          content_hash: modelHash,
          first_seen_run: opts.runId,
          last_seen_run: opts.runId,
        },
        update: {
          workspace_id: workspace.id,
          name: ds.name ?? ds.id,
          description: ds.description ?? null,
          configured_by: ds.configuredBy ?? null,
          is_refreshable: ds.isRefreshable ?? null,
          storage_mode: ds.targetStorageMode ?? null,
          rls_required: rls,
          content_hash: modelHash,
          last_seen_run: opts.runId,
          lifecycle: 'active',
          updated_at: new Date(),
        },
      });
      modelInternalIdByPbiId.set(ds.id, model.id);

      if (fetchDatasources) {
        try {
          await prisma.pbiModelDatasource.deleteMany({ where: { model_id: model.id } });
          const sources = await listDatasetDatasources(ws.id, ds.id);
          for (const raw of sources) {
            const row = parseDatasourceRow(raw as Record<string, unknown>);
            await prisma.pbiModelDatasource.create({
              data: {
                org_id: orgId,
                model_id: model.id,
                ...row,
                raw: raw as object,
              },
            });
            datasourceCount += 1;
          }
        } catch {
          datasourceErrors += 1;
        }
      }
    }

    const reports = await listReports(ws.id);
    for (const rp of reports) {
      reportCount += 1;
      const rpHash = sha256Short(JSON.stringify(rp));
      const linkedModelId =
        rp.datasetId && modelInternalIdByPbiId.has(rp.datasetId)
          ? modelInternalIdByPbiId.get(rp.datasetId)
          : null;
      await prisma.pbiReport.upsert({
        where: {
          org_id_pbi_report_id: { org_id: orgId, pbi_report_id: rp.id },
        },
        create: {
          org_id: orgId,
          workspace_id: workspace.id,
          model_id: linkedModelId,
          pbi_report_id: rp.id,
          pbi_model_id: rp.datasetId ?? null,
          name: rp.name ?? rp.id,
          report_type: rp.reportType ?? null,
          report_format: rp.format ?? null,
          web_url: rp.webUrl ?? null,
          content_hash: rpHash,
          first_seen_run: opts.runId,
          last_seen_run: opts.runId,
        },
        update: {
          workspace_id: workspace.id,
          model_id: linkedModelId,
          pbi_model_id: rp.datasetId ?? null,
          name: rp.name ?? rp.id,
          report_type: rp.reportType ?? null,
          report_format: rp.format ?? null,
          web_url: rp.webUrl ?? null,
          content_hash: rpHash,
          last_seen_run: opts.runId,
          lifecycle: 'active',
          updated_at: new Date(),
        },
      });
    }
  }

  return {
    workspaces: workspaces.length,
    models: modelCount,
    reports: reportCount,
    datasources: datasourceCount,
    datasource_errors: datasourceErrors,
    run_id: opts.runId,
  };
}
