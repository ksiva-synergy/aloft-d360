import type { ReportLineageConnection, ReportLineageTableSource } from '@/lib/powerbi/report-lineage-types';
import { describeSourceOrigins, emptyOrigin, referencedQueries } from '@/lib/powerbi/source-origin';

export type ReportLineageTableMetadata = {
  name: string;
  partition_kind: string | null;
  storage_mode: string | null;
  sourceBinding: {
    connector: string | null;
    connection_host: string | null;
    native_sql: string | null;
    bind_status: string;
    uc_full_path: string | null;
  } | null;
};

export function redactSourceDetail(value: string | null): string | null {
  if (!value) return value;
  return value
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&;](?:access_token|token|sig|signature|key|api[_-]?key|client_secret|password|pwd|accountkey|sharedaccesssignature)=)[^&;\s"']+/gi, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]');
}

function navigationSteps(sourceM: string | null, queries: Map<string, string>, table: string) {
  const steps: ReportLineageTableSource['navigation'] = [];
  const visited = new Set([table]);
  const walk = (text: string, query: string, depth: number) => {
    for (const selection of text.matchAll(/\{\s*\[([^\]]+)\]\s*\}/g)) {
      const fields: Record<string, string> = {};
      for (const field of selection[1]!.matchAll(/(?:^|,)\s*(Name|Kind|Schema|Item|Id|ItemKind|workspaceId|lakehouseId|warehouseId|dataflowId|entity|version|workspaceName|dataflowName)\s*=\s*"((?:[^"]|"")*)"/gi)) {
        fields[field[1]!] = redactSourceDetail(field[2]!.replace(/""/g, '"')) ?? '';
      }
      if (Object.keys(fields).length) steps.push({ query, fields });
    }
    if (depth >= 8) return;
    for (const name of referencedQueries(text, queries)) {
      if (visited.has(name)) continue;
      visited.add(name);
      walk(queries.get(name)!, name, depth + 1);
    }
  };
  if (sourceM) walk(sourceM, table, 0);
  return steps;
}

export function describeReportTableSource(
  table: string,
  sourceM: string | null,
  ucPath: string | null,
  queries: Map<string, string> = new Map(),
  metadata?: ReportLineageTableMetadata,
): ReportLineageTableSource {
  const origins = describeSourceOrigins(sourceM, queries, { selfName: table, partitionKind: metadata?.partition_kind });
  if (metadata?.storage_mode?.toLowerCase() === 'directlake' && origins.every((origin) => origin.system === 'unknown' || origin.system === 'calculated')) {
    const origin = emptyOrigin('fabric', 'Direct Lake');
    const property = (name: string) => sourceM?.match(new RegExp(`^\\s*${name}\\s*:\\s*([^\\r\\n]+)`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null;
    const schema = property('schemaName');
    const entity = property('entityName');
    origin.object = entity ? [schema, entity].filter(Boolean).join('.') : null;
    origins.splice(0, origins.length, origin);
  }
  const navigation = navigationSteps(sourceM, queries, table);
  const binding = metadata?.sourceBinding;
  if (!origins.length) origins.push(emptyOrigin('unknown', binding?.connector));
  const safeOrigins = origins.map((origin) => {
    let object = origin.object;
    if (!object && origins.length === 1) {
      const selected = navigation.find((step) => step.fields.Schema && step.fields.Item);
      if (selected) object = `${selected.fields.Schema}.${selected.fields.Item}`;
    }
    return {
      ...origin,
      system: origin.system === 'sql_server' && /\.datawarehouse\.fabric\.microsoft\.com\/?$/i.test(origin.location ?? '')
        ? 'fabric' as const : origin.system,
      location: redactSourceDetail(origin.location ?? (origins.length === 1 ? binding?.connection_host ?? null : null)),
      folder: redactSourceDetail(origin.folder),
      file: redactSourceDetail(origin.file),
      database: redactSourceDetail(origin.database),
      object: redactSourceDetail(object),
      query: redactSourceDetail(origin.query ?? (origins.length === 1 ? binding?.native_sql ?? null : null)),
    };
  });
  return {
    table, origins: safeOrigins, uc_full_path: ucPath, referenced_by_measures: [], navigation,
    partition_kind: metadata?.partition_kind ?? null,
    storage_mode: metadata?.storage_mode ?? null,
    connection: binding ? {
      connector: binding.connector,
      host: redactSourceDetail(binding.connection_host),
      native_query: redactSourceDetail(binding.native_sql),
      bind_status: binding.bind_status,
    } : null,
  };
}

export function describeInventoryConnection(source: {
  datasource_type: string | null; connection_server: string | null; connection_path: string | null;
  gateway_id: string | null; datasource_id: string | null; raw: unknown;
}): ReportLineageConnection {
  const raw = source.raw && typeof source.raw === 'object' ? source.raw as Record<string, unknown> : {};
  const value = raw.connectionDetails ?? raw.datasourceDetails;
  const details = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof details[key] === 'string' ? redactSourceDetail(details[key]) : null;
  const extra: Record<string, string> = {};
  for (const key of ['url', 'kind', 'account', 'domain', 'warehouse', 'httpPath', 'extensionDataSourceKind']) {
    const detail = text(key);
    if (detail) extra[key] = detail;
  }
  return {
    type: source.datasource_type,
    server: redactSourceDetail(source.connection_server) ?? text('server'),
    path: redactSourceDetail(source.connection_path) ?? text('path'),
    database: text('database'), details: extra,
    gateway_id: source.gateway_id, datasource_id: source.datasource_id,
  };
}