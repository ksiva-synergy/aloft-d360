/**
 * High-level lineage rollup: reports → measures → semantic tables → Unity Catalog.
 * Complements the detailed measure dependency graph (PQ steps, DAX nodes).
 */

import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import type { ReportConsumer } from '@/lib/powerbi/report-measure-refs';
import { resolveReportMeasureLineage } from '@/lib/powerbi/report-lineage';

export type ModelHighLevelLineage = {
  model_id: string;
  model_name: string;
  counts: {
    reports: number;
    measures_in_model: number;
    measures_on_reports: number;
    semantic_tables: number;
    warehouse_bound: number;
    warehouse_unbound: number;
  };
  /** Semantic tables with binding status (warehouse layer). */
  warehouse: Array<{
    pbi_table: string;
    uc_full_path: string | null;
    bound: boolean;
  }>;
  /** One row per report — measures detected + union of UC paths via those measures. */
  reports: Array<{
    id: string;
    name: string;
    measure_count: number;
    uc_paths: string[];
  }>;
  /** Unique UC paths across all bound semantic tables. */
  uc_paths: string[];
  warnings: string[];
};

const MAX_REPORT_ROWS = Math.min(
  2000,
  Math.max(40, Number(process.env.PBI_LINEAGE_MAX_REPORTS ?? 500) || 500),
);

export function buildModelHighLevelLineage(input: {
  modelId: string;
  modelName: string;
  catalog: MeasureLogicCatalog;
  reportConsumers: ReportConsumer[];
}): ModelHighLevelLineage {
  const warnings: string[] = [];
  const warehouse: ModelHighLevelLineage['warehouse'] = [];
  const ucSet = new Set<string>();
  let bound = 0;
  let unbound = 0;

  for (const [key, meta] of input.catalog.tableMeta) {
    const uc = meta.uc_full_path?.trim() || null;
    const isBound = Boolean(uc);
    if (isBound) {
      bound += 1;
      ucSet.add(uc!);
    } else unbound += 1;
    warehouse.push({
      pbi_table: meta.displayName ?? key,
      uc_full_path: uc,
      bound: isBound,
    });
  }
  warehouse.sort((a, b) => a.pbi_table.localeCompare(b.pbi_table));

  const allReportMeasures = new Set<string>();
  const reports: ModelHighLevelLineage['reports'] = [];

  for (const rc of input.reportConsumers.slice(0, MAX_REPORT_ROWS)) {
    for (const m of rc.measures) allReportMeasures.add(m);
    const { uc_paths } = resolveReportMeasureLineage(input.catalog, rc.measures);
    reports.push({
      id: rc.id,
      name: rc.name,
      measure_count: rc.measures.length,
      uc_paths,
    });
  }
  if (input.reportConsumers.length > MAX_REPORT_ROWS) {
    warnings.push(
      `Report list truncated to ${MAX_REPORT_ROWS} of ${input.reportConsumers.length} for summary (raise PBI_LINEAGE_MAX_REPORTS if needed).`,
    );
  }

  const measuresInModel = input.catalog.measures?.size ?? 0;
  if (input.reportConsumers.length === 0) {
    warnings.push('No reports linked to this model in inventory.');
  } else if (allReportMeasures.size === 0) {
    warnings.push('No measures detected on reports — harvest report definitions and run parse.');
  }
  if (bound === 0 && warehouse.length > 0) {
    warnings.push('No tables bound to Unity Catalog — run catalog link on this model.');
  }

  return {
    model_id: input.modelId,
    model_name: input.modelName,
    counts: {
      reports: input.reportConsumers.length,
      measures_in_model: measuresInModel,
      measures_on_reports: allReportMeasures.size,
      semantic_tables: warehouse.length,
      warehouse_bound: bound,
      warehouse_unbound: unbound,
    },
    warehouse,
    reports,
    uc_paths: [...ucSet].sort(),
    warnings,
  };
}
