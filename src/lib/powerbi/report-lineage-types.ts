import type { SourceOrigin } from '@/lib/powerbi/source-origin';

export type ReportLineageTableSource = {
  table: string;
  origins: SourceOrigin[];
  uc_full_path: string | null;
  referenced_by_measures: string[];
  partition_kind: string | null;
  storage_mode: string | null;
  connection: { connector: string | null; host: string | null; native_query: string | null; bind_status: string | null } | null;
  navigation: { query: string; fields: Record<string, string> }[];
};

export type ReportLineageConnection = {
  type: string | null;
  server: string | null;
  path: string | null;
  database: string | null;
  details: Record<string, string>;
  gateway_id: string | null;
  datasource_id: string | null;
};

export type ReportLineagePayload = {
  report: {
    id: string;
    name: string;
    pbi_report_id: string;
    model_id: string;
    model_name: string;
  };
  harvest: {
    page_count: number | null;
    measure_count: number;
    has_definition_on_disk: boolean;
    from_props_count: number;
    from_disk_count: number;
  };
  measures: Array<{
    name: string;
    found_in_model: boolean;
    measure_table: string | null;
    tables_involved: string[];
    uc_paths: string[];
    sources: ReportLineageTableSource[];
  }>;
  sources: ReportLineageTableSource[];
  source_connections: ReportLineageConnection[];
  uc_paths: string[];
  warnings: string[];
};