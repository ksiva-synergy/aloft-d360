/**
 * Phase A report lineage: report → measures → semantic tables → UC paths (Postgres-harvested model only).
 * Pure resolver — safe to import from unit tests (no Prisma).
 */

import {
  analyzeMeasureLogic,
  type MeasureLogicCatalog,
} from '@/lib/powerbi/measure-logic-analyze';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';
import type { ReportLineagePayload } from '@/lib/powerbi/report-lineage-types';
import type { ReportLineageTableSource } from '@/lib/powerbi/report-lineage-types';
import { describeReportTableSource, type ReportLineageTableMetadata } from '@/lib/powerbi/report-lineage-sources';

export type { ReportLineagePayload } from '@/lib/powerbi/report-lineage-types';

export type ReportLineageMeasure = {
  name: string;
  found_in_model: boolean;
  measure_table: string | null;
  tables_involved: string[];
  uc_paths: string[];
  sources: ReportLineageTableSource[];
};

function catalogHasUc(catalog: MeasureLogicCatalog): boolean {
  for (const meta of catalog.tableMeta.values()) {
    if (meta.uc_full_path?.trim()) return true;
  }
  return false;
}

export function resolveReportMeasureLineage(
  catalog: MeasureLogicCatalog,
  measureNames: string[],
  tableMetadata: ReportLineageTableMetadata[] = [],
): { measures: ReportLineageMeasure[]; sources: ReportLineageTableSource[]; uc_paths: string[]; warnings: string[] } {
  const hasUc = catalogHasUc(catalog);
  const measures: ReportLineageMeasure[] = [];
  const warnings: string[] = [];
  const ucUnion = new Set<string>();
  const sourcesByTable = new Map<string, ReportLineageTableSource>();
  const metadataByTable = new Map(tableMetadata.map((table) => [normalizePbiTableName(table.name).toLowerCase(), table]));
  for (const [key, table] of catalog.tableMeta) {
    const tableKey = normalizePbiTableName(key).toLowerCase();
    sourcesByTable.set(tableKey, describeReportTableSource(
      table.displayName, table.source_m, table.uc_full_path, catalog.sourceQueries, metadataByTable.get(tableKey),
    ));
  }

  for (const rawName of measureNames) {
    const key = rawName.trim().toLowerCase();
    const m = catalog.measures?.get(key) ?? catalog.measures?.get(rawName.trim());
    if (!m) {
      measures.push({
        name: rawName,
        found_in_model: false,
        measure_table: null,
        tables_involved: [],
        uc_paths: [],
        sources: [],
      });
      continue;
    }
    const analysis = analyzeMeasureLogic({ dax: m.dax, catalog, hasUc });
    const uc_paths = [
      ...new Set(
        analysis.tables_involved
          .map((t) => catalog.tableMeta.get(normalizePbiTableName(t).toLowerCase())?.uc_full_path?.trim())
          .filter((p): p is string => Boolean(p)),
      ),
    ];
    for (const p of uc_paths) ucUnion.add(p);
    const sources = analysis.tables_involved.map((table) => {
      const key = normalizePbiTableName(table).toLowerCase();
      let source = sourcesByTable.get(key);
      if (!source) {
        source = describeReportTableSource(table, null, null);
        sourcesByTable.set(key, source);
      }
      if (!source.referenced_by_measures.includes(m.name)) source.referenced_by_measures.push(m.name);
      return source;
    });
    measures.push({
      name: m.name,
      found_in_model: true,
      measure_table: m.table,
      tables_involved: analysis.tables_involved,
      uc_paths,
      sources,
    });
  }

  measures.sort((a, b) => a.name.localeCompare(b.name));

  if (!measureNames.length) {
    warnings.push('No explicit measure references detected in the report definition.');
  } else if (measures.some((x) => !x.found_in_model)) {
    warnings.push('Some measure names in the report were not found on the parsed model (stale definition or report-only measures).');
  }

  return {
    measures,
    sources: [...sourcesByTable.values()].sort((first, second) => first.table.localeCompare(second.table)),
    uc_paths: [...ucUnion].sort(), warnings,
  };
}