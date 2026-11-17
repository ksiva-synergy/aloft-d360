import prisma from '@/lib/db';
import { loadMeasureLogicCatalog, type MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { collectReportMeasureRefs } from '@/lib/powerbi/report-measure-refs';
import { resolveReportMeasureLineage } from '@/lib/powerbi/report-lineage';
import type { ReportLineagePayload } from '@/lib/powerbi/report-lineage-types';
import { describeInventoryConnection, type ReportLineageTableMetadata } from '@/lib/powerbi/report-lineage-sources';

export async function buildReportLineage(
  orgId: string,
  reportId: string,
  catalogs?: Map<string, MeasureLogicCatalog>,
  sourceTables?: Map<string, ReportLineageTableMetadata[]>,
): Promise<ReportLineagePayload | null> {
  const report = await prisma.pbiReport.findFirst({
    where: { id: reportId, org_id: orgId, lifecycle: 'active' },
    select: {
      id: true,
      name: true,
      pbi_report_id: true,
      model_id: true,
      props: true,
      model: { select: {
        id: true, name: true, lifecycle: true,
        datasources: { select: { datasource_type: true, connection_server: true, connection_path: true, gateway_id: true, datasource_id: true, raw: true } },
      } },
    },
  });
  if (!report?.model_id || !report.model || report.model.lifecycle !== 'active') return null;

  const refs = collectReportMeasureRefs(report.props);
  const catalog = catalogs?.get(report.model_id) ?? await loadMeasureLogicCatalog(orgId, report.model_id);
  catalogs?.set(report.model_id, catalog);
  const metadata = sourceTables?.get(report.model_id) ?? await prisma.pbiTable.findMany({
    where: { org_id: orgId, model_id: report.model_id, lifecycle: 'active' },
    select: {
      name: true, partition_kind: true, storage_mode: true,
      sourceBinding: { select: { connector: true, connection_host: true, native_sql: true, bind_status: true, uc_full_path: true } },
    },
  });
  sourceTables?.set(report.model_id, metadata);
  const { measures, sources, uc_paths, warnings } = resolveReportMeasureLineage(catalog, refs.measures, metadata);

  if (!refs.has_definition_on_disk && refs.from_props.length === 0) {
    warnings.push('Report definition not on disk — use Harvest report definition on this report, then parse.');
  }

  return {
    report: {
      id: report.id,
      name: report.name,
      pbi_report_id: report.pbi_report_id,
      model_id: report.model.id,
      model_name: report.model.name,
    },
    harvest: {
      page_count: refs.page_count,
      measure_count: refs.measures.length,
      has_definition_on_disk: refs.has_definition_on_disk,
      from_props_count: refs.from_props.length,
      from_disk_count: refs.from_disk.length,
    },
    measures,
    sources,
    source_connections: report.model.datasources.map(describeInventoryConnection),
    uc_paths,
    warnings,
  };
}