import 'server-only';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/lib/db';
import { PowerBiApiError } from '@/lib/powerbi/client';
import {
  classifyModelAnswerability,
  classifyPartitionSource,
  extractDatabricksHost,
  extractNativeSql,
  type PartitionKind,
} from '@/lib/powerbi/partition-kind';
import { extractTablePathsFromSql } from '@/lib/powerbi/native-sql';
import { getPbiRawStoreRoot } from '@/lib/powerbi/raw-store';
import { parseLegacyReportJson } from '@/lib/powerbi/report-parse-legacy';
import {
  parseTmdlRelationshipsFile,
  parseTmdlRoleFile,
  parseTmdlTableFile,
} from '@/lib/powerbi/tmdl-parse';

type DefinitionMeta = {
  storage_kind: string;
  storage_path: string;
  content_hash: string;
  inventory_hash: string | null;
};

type ParseMeta = {
  parsed_at: string;
  parse_run_id: string;
  definition_hash: string;
  table_count: number;
  measure_count: number;
  answerability: string;
};

function sha256Short(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Interactive tx default is 5s — CII models need many column/measure inserts over VPN. */
const PARSE_TX_MAX_WAIT_MS = Number(process.env.PBI_PARSE_TX_MAX_WAIT_MS ?? 60_000);
const PARSE_TX_TIMEOUT_MS = Number(process.env.PBI_PARSE_TX_TIMEOUT_MS ?? 600_000);

function readDefinitionMeta(props: unknown): DefinitionMeta | null {
  if (!props || typeof props !== 'object') return null;
  const def = (props as Record<string, unknown>).definition;
  if (!def || typeof def !== 'object') return null;
  return def as DefinitionMeta;
}

function needsModelParse(definitionHash: string | null, props: unknown): boolean {
  if (!definitionHash) return false;
  const meta = (props as Record<string, unknown>)?.parse as ParseMeta | undefined;
  if (!meta?.definition_hash) return true;
  return meta.definition_hash !== definitionHash;
}

function walkTmdl(definitionDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.tmdl')) out.push(full);
    }
  }
  walk(definitionDir);
  return out;
}

export interface PbiParseResult {
  models_parsed: number;
  models_skipped: number;
  models_failed: number;
  reports_parsed: number;
  reports_skipped: number;
  reports_failed: number;
  run_id: string;
}

export async function runPbiParse(
  orgId: string,
  sourceId: string,
  opts: {
    runId: string;
    modelIds?: string[];
    reportIds?: string[];
    maxModels?: number;
    maxReports?: number;
  },
): Promise<PbiParseResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const maxModels = opts.maxModels ?? Number(process.env.PBI_PARSE_MAX_MODELS ?? 50);
  const maxReports = opts.maxReports ?? Number(process.env.PBI_PARSE_MAX_REPORTS ?? 50);
  const root = getPbiRawStoreRoot();

  let modelsParsed = 0;
  let modelsSkipped = 0;
  let modelsFailed = 0;
  let reportsParsed = 0;
  let reportsSkipped = 0;
  let reportsFailed = 0;

  const models = await prisma.pbiModel.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
    },
    orderBy: { updated_at: 'desc' },
  });

  for (const model of models) {
    if (modelsParsed >= maxModels) break;
    const defMeta = readDefinitionMeta(model.props);
    if (!defMeta?.storage_path || !defMeta.content_hash) {
      modelsSkipped += 1;
      continue;
    }
    if (!needsModelParse(defMeta.content_hash, model.props)) {
      modelsSkipped += 1;
      continue;
    }

    const absDir = path.join(root, defMeta.storage_path);
    try {
      const partitionKinds: PartitionKind[] = [];
      let tableCount = 0;
      let measureCount = 0;

      await prisma.$transaction(async (tx) => {
        await tx.pbiMeasure.deleteMany({ where: { model_id: model.id } });
        await tx.pbiColumn.deleteMany({ where: { model_id: model.id } });
        await tx.pbiSourceBinding.deleteMany({ where: { model_id: model.id } });
        await tx.pbiEmbeddedTable.deleteMany({ where: { model_id: model.id } });
        await tx.pbiRelationship.deleteMany({ where: { model_id: model.id } });
        await tx.pbiRole.deleteMany({ where: { model_id: model.id } });
        await tx.pbiTable.deleteMany({ where: { model_id: model.id } });

        const tmdlFiles = walkTmdl(absDir);
        for (const file of tmdlFiles) {
          const rel = path.relative(absDir, file).replace(/\\/g, '/');
          const text = fs.readFileSync(file, 'utf8');

          if (rel === 'relationships.tmdl' || rel.endsWith('/relationships.tmdl')) {
            for (const relRow of parseTmdlRelationshipsFile(text)) {
              await tx.pbiRelationship.create({
                data: {
                  org_id: orgId,
                  model_id: model.id,
                  pbi_relationship_id: relRow.id,
                  from_column: relRow.fromColumn,
                  to_column: relRow.toColumn,
                  cross_filtering: relRow.crossFiltering,
                  is_active: relRow.isActive,
                  content_hash: sha256Short(JSON.stringify(relRow)),
                },
              });
            }
            continue;
          }

          if (rel.startsWith('roles/') || rel.includes('/roles/')) {
            const role = parseTmdlRoleFile(text);
            if (role) {
              await tx.pbiRole.create({
                data: {
                  org_id: orgId,
                  model_id: model.id,
                  name: role.name,
                  filter_dax: role.filterDax,
                  content_hash: sha256Short(role.filterDax ?? role.name),
                },
              });
            }
            continue;
          }

          if (!rel.includes('/tables/') && !rel.startsWith('tables/')) continue;

          const parsed = parseTmdlTableFile(text);
          if (!parsed) continue;

          const kind = classifyPartitionSource(parsed.partitionSourceM, parsed.name);
          if (kind !== 'auto_date_table') {
            partitionKinds.push(kind);
          }

          const table = await tx.pbiTable.create({
            data: {
              org_id: orgId,
              model_id: model.id,
              name: parsed.name,
              lineage_tag: parsed.lineageTag,
              partition_kind: kind,
              storage_mode: parsed.partitionMode,
              hidden: parsed.hidden,
              source_m: parsed.partitionSourceM.slice(0, 500_000) || null,
              is_auto_date: kind === 'auto_date_table',
              content_hash: sha256Short(text),
              first_seen_run: opts.runId,
              last_seen_run: opts.runId,
            },
          });
          tableCount += 1;

          if (kind === 'warehouse_query') {
            const nativeSql = extractNativeSql(parsed.partitionSourceM);
            const host = extractDatabricksHost(parsed.partitionSourceM);
            const paths = nativeSql ? extractTablePathsFromSql(nativeSql) : [];
            const ucPath = paths[0] ?? null;
            await tx.pbiSourceBinding.create({
              data: {
                org_id: orgId,
                model_id: model.id,
                table_id: table.id,
                partition_kind: kind,
                connector: 'databricks',
                connection_host: host,
                native_sql: nativeSql,
                uc_full_path: ucPath,
                bind_status: 'pending',
                source_m_hash: sha256Short(parsed.partitionSourceM),
              },
            });
          } else if (kind === 'embedded_table') {
            await tx.pbiEmbeddedTable.create({
              data: {
                org_id: orgId,
                model_id: model.id,
                table_id: table.id,
                row_count: null,
                content_sha256: sha256Short(parsed.partitionSourceM),
                pii_checked: false,
              },
            });
          }

          for (const col of parsed.columns) {
            if (!col.name) continue;
            await tx.pbiColumn.create({
              data: {
                org_id: orgId,
                model_id: model.id,
                table_id: table.id,
                name: col.name,
                data_type: col.dataType,
                source_column: col.sourceColumn,
                lineage_tag: col.lineageTag,
                format_string: col.formatString,
                summarize_by: col.summarizeBy,
                calculated_dax: col.calculatedDax,
                content_hash: sha256Short(JSON.stringify(col)),
              },
            });
          }

          for (const m of parsed.measures) {
            if (!m.name) continue;
            measureCount += 1;
            await tx.pbiMeasure.create({
              data: {
                org_id: orgId,
                model_id: model.id,
                table_id: table.id,
                name: m.name,
                dax: m.dax.slice(0, 500_000) || ' ',
                dax_hash: sha256Short(m.dax),
                lineage_tag: m.lineageTag,
                format_string: m.formatString,
                display_folder: m.displayFolder,
                content_hash: sha256Short(JSON.stringify(m)),
              },
            });
          }
        }
      }, { maxWait: PARSE_TX_MAX_WAIT_MS, timeout: PARSE_TX_TIMEOUT_MS });

      const answerability = classifyModelAnswerability({
        rlsRequired: model.rls_required,
        partitionKinds,
      });

      const parseMeta: ParseMeta = {
        parsed_at: new Date().toISOString(),
        parse_run_id: opts.runId,
        definition_hash: defMeta.content_hash,
        table_count: tableCount,
        measure_count: measureCount,
        answerability,
      };

      const props = {
        ...(model.props as Record<string, unknown>),
        parse: parseMeta,
        classification: { answerability, partition_kinds: partitionKinds },
      };

      await prisma.pbiModel.update({
        where: { id: model.id },
        data: { props: props as object, updated_at: new Date() },
      });

      modelsParsed += 1;
    } catch (err) {
      console.error(
        `[pbi_parse] model ${model.pbi_model_id} (${model.name}):`,
        err instanceof Error ? err.message : err,
      );
      modelsFailed += 1;
    }
  }

  const reports = await prisma.pbiReport.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      ...(opts.reportIds?.length ? { pbi_report_id: { in: opts.reportIds } } : {}),
    },
    orderBy: { updated_at: 'desc' },
  });

  for (const report of reports) {
    if (reportsParsed >= maxReports) break;
    const defMeta = readDefinitionMeta(report.props);
    if (!defMeta?.storage_path) {
      reportsSkipped += 1;
      continue;
    }
    const absDir = path.join(root, defMeta.storage_path);
    const reportJson = path.join(absDir, 'report.json');
    if (!fs.existsSync(reportJson)) {
      reportsSkipped += 1;
      continue;
    }
    try {
      const summary = parseLegacyReportJson(fs.readFileSync(reportJson, 'utf8'));
      const props = {
        ...(report.props as Record<string, unknown>),
        parse: {
          parsed_at: new Date().toISOString(),
          parse_run_id: opts.runId,
          page_count: summary.pageCount,
          measure_refs: summary.measureRefs,
        },
      };
      await prisma.pbiReport.update({
        where: { id: report.id },
        data: { props: props as object, updated_at: new Date() },
      });
      reportsParsed += 1;
    } catch {
      reportsFailed += 1;
    }
  }

  return {
    models_parsed: modelsParsed,
    models_skipped: modelsSkipped,
    models_failed: modelsFailed,
    reports_parsed: reportsParsed,
    reports_skipped: reportsSkipped,
    reports_failed: reportsFailed,
    run_id: opts.runId,
  };
}
