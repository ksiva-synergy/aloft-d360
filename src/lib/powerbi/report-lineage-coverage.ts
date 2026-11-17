type CoverageReport = { model_id: string | null; props: unknown };
type CoverageModel = {
  id: string;
  props: unknown;
  tables: {
    partition_kind: string | null;
    sourceBinding: { uc_full_path: string | null } | null;
  }[];
};

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasDefinition(props: unknown): boolean {
  const definition = metadata(metadata(props).definition);
  return typeof definition.storage_path === 'string' && definition.storage_path.length > 0;
}

function isParsed(props: unknown, model: boolean): boolean {
  const value = metadata(props);
  const parsed = metadata(value.parse);
  const definition = metadata(value.definition);
  if (!parsed.parsed_at) return false;
  if (model) return Boolean(definition.content_hash && parsed.definition_hash === definition.content_hash);
  return !definition.fetched_at || String(parsed.parsed_at) >= String(definition.fetched_at);
}

export function summarizeReportLineageCoverage(reports: CoverageReport[], models: CoverageModel[]) {
  const modelById = new Map(models.map((model) => [model.id, model]));
  const usedModelIds = new Set(reports.map((report) => report.model_id));
  const usedModels = models.filter((model) => usedModelIds.has(model.id));
  const warehouseTables = usedModels.flatMap((model) => model.tables.filter((table) => table.partition_kind === 'warehouse_query'));
  return {
    reports: reports.length,
    definitions: reports.filter((report) => hasDefinition(report.props)).length,
    parsed_reports: reports.filter((report) => hasDefinition(report.props) && isParsed(report.props, false)).length,
    missing_models: reports.filter((report) => !report.model_id || !modelById.has(report.model_id)).length,
    models: usedModels.length,
    parsed_models: usedModels.filter((model) => hasDefinition(model.props) && isParsed(model.props, true)).length,
    warehouse_tables: warehouseTables.length,
    unresolved_tables: warehouseTables.filter((table) => !table.sourceBinding?.uc_full_path).length,
    non_warehouse_tables: usedModels.flatMap((model) => model.tables.filter((table) => table.partition_kind !== 'warehouse_query')).length,
  };
}

export type ReportLineageCoverage = ReturnType<typeof summarizeReportLineageCoverage>;