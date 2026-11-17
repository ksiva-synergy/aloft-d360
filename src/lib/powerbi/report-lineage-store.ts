import type { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildReportLineage } from '@/lib/powerbi/report-lineage-build';
import { summarizeReportLineageCoverage } from '@/lib/powerbi/report-lineage-coverage';
import type { ReportLineageTableMetadata } from '@/lib/powerbi/report-lineage-sources';

export async function persistReportLineage(
  orgId: string,
  opts: { runId: string; modelIds?: string[]; reportIds?: string[] },
) {
  const reports = await prisma.pbiReport.findMany({
    where: {
      org_id: orgId, lifecycle: 'active',
      ...(opts.modelIds?.length ? { model: { pbi_model_id: { in: opts.modelIds } } } : {}),
      ...(opts.reportIds?.length ? { pbi_report_id: { in: opts.reportIds } } : {}),
    },
    select: {
      id: true, name: true, pbi_report_id: true, model_id: true, props: true,
      model: { select: {
        id: true, props: true, lifecycle: true,
        tables: { where: { lifecycle: 'active' }, select: {
          partition_kind: true, sourceBinding: { select: { uc_full_path: true } },
        } },
      } },
    },
    orderBy: { id: 'asc' },
  });
  const catalogs = new Map<string, MeasureLogicCatalog>();
  const sourceTables = new Map<string, ReportLineageTableMetadata[]>();
  const stats = { saved: 0, ready: 0, partial: 0, blocked: 0, failed: 0 };
  for (const report of reports) {
    let status: 'ready' | 'partial' | 'blocked' | 'failed' = 'blocked';
    let warnings: string[] = [];
    let lineage: Prisma.InputJsonValue = { report_id: report.id, measures: [], sources: [], source_connections: [], uc_paths: [] };
    let ucPaths: string[] = [];
    let measureCount = 0;
    try {
      const payload = await buildReportLineage(orgId, report.id, catalogs, sourceTables);
      if (payload) {
        lineage = payload as unknown as Prisma.InputJsonValue;
        warnings = [...payload.warnings];
        ucPaths = payload.uc_paths;
        measureCount = payload.measures.length;
        const coverage = summarizeReportLineageCoverage([report], report.model?.lifecycle === 'active' ? [report.model] : []);
        if (coverage.parsed_reports === 0 || coverage.parsed_models === 0) {
          warnings.push('Report or model definition is missing, unparsed, or stale.');
        } else {
          const unknownSources = payload.sources.filter((source) => source.origins.every((origin) => origin.system === 'unknown'));
          if (unknownSources.length) warnings.push(`Original source is unknown for ${unknownSources.length} model tables.`);
          status = coverage.unresolved_tables > 0 || unknownSources.length > 0 || payload.measures.some((measure) => !measure.found_in_model) ? 'partial' : 'ready';
        }
      } else {
        warnings.push('Report has no active semantic model in the estate.');
      }
    } catch (error) {
      status = 'failed';
      warnings = [error instanceof Error ? error.message : String(error)];
    }
    const data = {
      org_id: orgId, model_id: report.model_id, run_id: opts.runId, status,
      measure_count: measureCount, uc_paths: ucPaths, lineage, warnings, generated_at: new Date(),
    };
    await prisma.pbiReportLineage.upsert({
      where: { report_id: report.id },
      create: { report_id: report.id, ...data },
      update: data,
    });
    stats.saved += 1;
    stats[status] += 1;
  }
  return stats;
}