import 'server-only';

import prisma from '@/lib/db';
import { PowerBiApiError } from '@/lib/powerbi/client';
import { fetchReportDefinition, fetchSemanticModelDefinitionTmdl } from '@/lib/powerbi/fabric';
import { writeDefinitionParts } from '@/lib/powerbi/raw-store';

type DefinitionMeta = {
  storage_kind: string;
  storage_path: string;
  part_count: number;
  content_hash: string;
  inventory_hash: string | null;
  fetched_at: string;
  fetch_run_id: string;
  format?: string | null;
};

function readDefinitionMeta(props: unknown): DefinitionMeta | null {
  if (!props || typeof props !== 'object') return null;
  const def = (props as Record<string, unknown>).definition;
  if (!def || typeof def !== 'object') return null;
  return def as DefinitionMeta;
}

function needsModelFetch(contentHash: string | null, props: unknown): boolean {
  const meta = readDefinitionMeta(props);
  if (!meta?.fetched_at) return true;
  if (contentHash && meta.inventory_hash !== contentHash) return true;
  return false;
}

function reportDefinitionFormat(reportFormat: string | null): 'PBIR' | 'PBIR-Legacy' | undefined {
  const f = (reportFormat ?? '').toLowerCase();
  if (f.includes('legacy')) return 'PBIR-Legacy';
  if (f.includes('pbir')) return 'PBIR';
  return undefined;
}

export interface PbiDefinitionsResult {
  models_fetched: number;
  models_skipped: number;
  models_failed: number;
  reports_fetched: number;
  reports_skipped: number;
  reports_failed: number;
  run_id: string;
  capped: boolean;
}

export async function runPbiDefinitions(
  orgId: string,
  sourceId: string,
  opts: {
    runId: string;
    fetchModels?: boolean;
    fetchReports?: boolean;
    maxModels?: number;
    maxReports?: number;
    modelIds?: string[];
    reportIds?: string[];
  },
): Promise<PbiDefinitionsResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const maxModels = opts.maxModels ?? Number(process.env.PBI_DEFINITIONS_MAX_MODELS ?? 25);
  const maxReports = opts.maxReports ?? Number(process.env.PBI_DEFINITIONS_MAX_REPORTS ?? 25);
  const fetchModels = opts.fetchModels !== false;
  const fetchReports = opts.fetchReports !== false;

  const workspaces = await prisma.pbiWorkspace.findMany({
    where: { org_id: orgId, lifecycle: 'active' },
    select: { id: true, pbi_workspace_id: true },
  });
  const wsByInternal = new Map(workspaces.map((w) => [w.id, w.pbi_workspace_id]));

  let modelsFetched = 0;
  let modelsSkipped = 0;
  let modelsFailed = 0;
  let reportsFetched = 0;
  let reportsSkipped = 0;
  let reportsFailed = 0;
  let capped = false;

  if (fetchModels) {
    const models = await prisma.pbiModel.findMany({
      where: {
        org_id: orgId,
        lifecycle: 'active',
        ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
      },
      orderBy: { updated_at: 'desc' },
    });

    for (const model of models) {
      if (modelsFetched >= maxModels) {
        capped = true;
        break;
      }
      const wsPbiId = wsByInternal.get(model.workspace_id);
      if (!wsPbiId) {
        modelsFailed += 1;
        continue;
      }
      if (!needsModelFetch(model.content_hash, model.props)) {
        modelsSkipped += 1;
        continue;
      }
      try {
        const parts = await fetchSemanticModelDefinitionTmdl(wsPbiId, model.pbi_model_id);
        const stored = writeDefinitionParts('definitions', model.pbi_model_id, parts);
        const definition: DefinitionMeta = {
          storage_kind: 'definitions',
          storage_path: stored.relativeDir,
          part_count: stored.partCount,
          content_hash: stored.contentHash,
          inventory_hash: model.content_hash,
          fetched_at: new Date().toISOString(),
          fetch_run_id: opts.runId,
        };
        const props = { ...(model.props as Record<string, unknown>), definition };
        await prisma.pbiModel.update({
          where: { id: model.id },
          data: {
            props: props as object,
            updated_at: new Date(),
          },
        });
        modelsFetched += 1;
      } catch {
        modelsFailed += 1;
      }
    }
  }

  if (fetchReports) {
    const reports = await prisma.pbiReport.findMany({
      where: {
        org_id: orgId,
        lifecycle: 'active',
        ...(opts.reportIds?.length ? { pbi_report_id: { in: opts.reportIds } } : {}),
      },
      orderBy: { updated_at: 'desc' },
    });

    for (const report of reports) {
      if (reportsFetched >= maxReports) {
        capped = true;
        break;
      }
      const wsPbiId = wsByInternal.get(report.workspace_id);
      if (!wsPbiId) {
        reportsFailed += 1;
        continue;
      }
      if (!needsModelFetch(report.content_hash, report.props)) {
        reportsSkipped += 1;
        continue;
      }
      const fmt = reportDefinitionFormat(report.report_format);
      const storageKind =
        fmt === 'PBIR-Legacy' ? 'report-definitions-legacy' : 'report-definitions';
      try {
        const parts = await fetchReportDefinition(wsPbiId, report.pbi_report_id, fmt);
        const stored = writeDefinitionParts(storageKind, report.pbi_report_id, parts);
        const definition: DefinitionMeta = {
          storage_kind: storageKind,
          storage_path: stored.relativeDir,
          part_count: stored.partCount,
          content_hash: stored.contentHash,
          inventory_hash: report.content_hash,
          fetched_at: new Date().toISOString(),
          fetch_run_id: opts.runId,
          format: fmt ?? report.report_format,
        };
        const props = { ...(report.props as Record<string, unknown>), definition };
        await prisma.pbiReport.update({
          where: { id: report.id },
          data: {
            props: props as object,
            updated_at: new Date(),
          },
        });
        reportsFetched += 1;
      } catch {
        reportsFailed += 1;
      }
    }
  }

  return {
    models_fetched: modelsFetched,
    models_skipped: modelsSkipped,
    models_failed: modelsFailed,
    reports_fetched: reportsFetched,
    reports_skipped: reportsSkipped,
    reports_failed: reportsFailed,
    run_id: opts.runId,
    capped,
  };
}
