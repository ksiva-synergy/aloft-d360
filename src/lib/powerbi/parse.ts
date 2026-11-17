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
import { summarizeReportDefinitionDir } from '@/lib/powerbi/report-measure-refs';
import { describeSourceOrigins, parseTmdlExpressions, warehouseNavigationPath } from '@/lib/powerbi/source-origin';
import { readMParameters } from '@/lib/powerbi/m-parameters';
import {
  parseTmdlCultureFile,
  parseTmdlDatabaseFile,
  parseTmdlModelFile,
  parseTmdlRelationshipsFile,
  parseTmdlRoleFile,
  parseTmdlTableFile,
  unhandledTmdlKeywords,
} from '@/lib/powerbi/tmdl-parse';

type DefinitionMeta = {
  storage_kind: string;
  storage_path: string;
  content_hash: string;
  inventory_hash: string | null;
};

/**
 * Bump when parsing changes what is stored for an unchanged definition, so existing models are
 * re-parsed once on the next parse run. 2026-11-15: shared expressions stored, file sources
 * classified before joins; full TMDL metadata (flags, descriptions, RLS filters, cardinality,
 * refresh policies, hierarchies, synonyms …); bare flags no longer stored as DAX.
 */
export const PBI_PARSER_VERSION = '2026-11-15.tmdl-complete';

/** Shared expressions kept on the model (helper queries tables call); capped. */
const MAX_EXPRESSIONS = 500;
const MAX_EXPRESSION_CHARS = 50_000;

type ParseMeta = {
  parser_version?: string;
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
  if (meta.parser_version !== PBI_PARSER_VERSION) return true;
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
    /** Re-harvest columns/measures even when definition hash matches last parse. */
    forceReparse?: boolean;
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
    if (!opts.forceReparse && !needsModelParse(defMeta.content_hash, model.props)) {
      modelsSkipped += 1;
      continue;
    }

    const absDir = path.join(root, defMeta.storage_path);
    try {
      const partitionKinds: PartitionKind[] = [];
      let tableCount = 0;
      let measureCount = 0;
      let expressions: { name: string; m: string }[] = [];
      let modelDefinition: Record<string, unknown> = {};
      let synonyms: { culture: string | null; entries: Record<string, string[]>; authored: number } | null = null;
      const tmdlUnhandled: Record<string, number> = {};

      await prisma.$transaction(async (tx) => {
        // Reconcile instead of wipe-and-rebuild: tables and measures keep their ids across
        // re-parses (matched by TMDL lineageTag, then name), so translations, oracle results,
        // verified queries and steward source bindings stay attached. Stateless children
        // (columns, relationships, roles, embedded-table rows) are rebuilt.
        const existingTables = await tx.pbiTable.findMany({
          where: { model_id: model.id },
          select: { id: true, name: true, lineage_tag: true, props: true },
        });
        const existingMeasures = await tx.pbiMeasure.findMany({
          where: { model_id: model.id },
          select: { id: true, name: true, lineage_tag: true, table_id: true, props: true },
        });
        const existingBindings = await tx.pbiSourceBinding.findMany({
          where: { model_id: model.id },
          select: { id: true, table_id: true, source_m_hash: true },
        });
        const tableByTag = new Map(
          existingTables.filter((t) => t.lineage_tag).map((t) => [t.lineage_tag!, t]),
        );
        const tableByName = new Map(existingTables.map((t) => [t.name, t]));
        const measureByTag = new Map(
          existingMeasures.filter((m) => m.lineage_tag).map((m) => [m.lineage_tag!, m]),
        );
        const measureByTableName = new Map(existingMeasures.map((m) => [`${m.table_id}\0${m.name}`, m]));
        const measureByName = new Map<string, (typeof existingMeasures)[number] | null>();
        for (const m of existingMeasures) {
          measureByName.set(m.name, measureByName.has(m.name) ? null : m); // null = ambiguous
        }
        const bindingByTable = new Map(existingBindings.map((b) => [b.table_id, b]));
        const seenTables = new Set<string>();
        const seenMeasures = new Set<string>();

        await tx.pbiColumn.deleteMany({ where: { model_id: model.id } });
        await tx.pbiEmbeddedTable.deleteMany({ where: { model_id: model.id } });
        await tx.pbiRelationship.deleteMany({ where: { model_id: model.id } });
        await tx.pbiRole.deleteMany({ where: { model_id: model.id } });

        const tmdlFiles = walkTmdl(absDir);
        for (const file of tmdlFiles) {
          const rel = path.relative(absDir, file).replace(/\\/g, '/');
          const text = fs.readFileSync(file, 'utf8');
          for (const [k, v] of Object.entries(unhandledTmdlKeywords(text))) tmdlUnhandled[k] = (tmdlUnhandled[k] ?? 0) + v;

          if (rel === 'model.tmdl' || rel.endsWith('/model.tmdl')) {
            const m = parseTmdlModelFile(text);
            if (m) modelDefinition = { ...modelDefinition, ...m };
            continue;
          }
          if (rel === 'database.tmdl' || rel.endsWith('/database.tmdl')) {
            modelDefinition = { ...modelDefinition, ...parseTmdlDatabaseFile(text) };
            continue;
          }
          if (rel.startsWith('cultures/') || rel.includes('/cultures/')) {
            const c = parseTmdlCultureFile(text);
            // one culture is enough for synonyms; prefer the model culture when several exist
            if (!synonyms || Object.keys(c.synonyms).length > Object.keys(synonyms.entries).length) {
              synonyms = { culture: c.culture, entries: c.synonyms, authored: c.authored };
            }
            continue;
          }

          if (rel === 'expressions.tmdl' || rel.endsWith('/expressions.tmdl')) {
            expressions = parseTmdlExpressions(text)
              .slice(0, MAX_EXPRESSIONS)
              .map((e) => ({ name: e.name, m: e.m.slice(0, MAX_EXPRESSION_CHARS) }));
            continue;
          }

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
                  cardinality: relRow.cardinality,
                  props: { tmdl: relRow.meta } as object,
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
                  props: {
                    model_permission: role.modelPermission,
                    table_permissions: role.tablePermissions,
                    column_permissions: role.columnPermissions,
                    members: role.members,
                    tmdl: role.meta,
                  } as object,
                  content_hash: sha256Short(JSON.stringify(role)),
                },
              });
            }
            continue;
          }

          if (!rel.includes('/tables/') && !rel.startsWith('tables/')) continue;

          const parsed = parseTmdlTableFile(text);
          if (!parsed) continue;

          const kind = classifyPartitionSource(
            parsed.partitionSourceM,
            parsed.name,
            parsed.partitionType,
          );
          if (kind !== 'auto_date_table') {
            partitionKinds.push(kind);
          }

          const tableData = {
            name: parsed.name,
            lineage_tag: parsed.lineageTag,
            partition_kind: kind,
            storage_mode: parsed.partitionMode,
            hidden: parsed.hidden,
            props: {} as object, // set below, merged with what the table already carries
            source_m: parsed.partitionSourceM.slice(0, 500_000) || null,
            is_auto_date: kind === 'auto_date_table',
            content_hash: sha256Short(text),
            last_seen_run: opts.runId,
            lifecycle: 'active',
          };
          const prior =
            (parsed.lineageTag ? tableByTag.get(parsed.lineageTag) : undefined) ??
            tableByName.get(parsed.name);
          // the first partition's source is already source_m: keep only the others in full
          const tableTmdl = {
            ...parsed.meta,
            ...(parsed.meta.partitions
              ? { partitions: parsed.meta.partitions.map((p, idx) => (idx === 0 ? { ...p, source: null } : p)) }
              : {}),
          };
          tableData.props = { ...((prior?.props as Record<string, unknown> | null) ?? {}), tmdl: tableTmdl } as object;
          const table =
            prior && !seenTables.has(prior.id)
              ? await tx.pbiTable.update({ where: { id: prior.id }, data: tableData })
              : await tx.pbiTable.create({
                  data: {
                    org_id: orgId,
                    model_id: model.id,
                    first_seen_run: opts.runId,
                    ...tableData,
                  },
                });
          seenTables.add(table.id);
          tableCount += 1;

          const priorBinding = bindingByTable.get(table.id);
          if (kind === 'warehouse_query') {
            const nativeSql = extractNativeSql(parsed.partitionSourceM);
            const host = extractDatabricksHost(parsed.partitionSourceM);
            const paths = nativeSql ? extractTablePathsFromSql(nativeSql) : [];
            const ucPath = paths[0] ?? warehouseNavigationPath(parsed.partitionSourceM);
            const sourceHash = sha256Short(parsed.partitionSourceM);
            const bindingData = {
              partition_kind: kind,
              connector: describeSourceOrigins(parsed.partitionSourceM)[0]?.system ?? 'unknown',
              connection_host: host,
              native_sql: nativeSql,
              source_m_hash: sourceHash,
            };
            if (priorBinding && priorBinding.source_m_hash === sourceHash) {
              // unchanged source: keep match status, UC object and steward edits
              await tx.pbiSourceBinding.update({ where: { id: priorBinding.id }, data: bindingData });
            } else if (priorBinding) {
              await tx.pbiSourceBinding.update({
                where: { id: priorBinding.id },
                data: {
                  ...bindingData,
                  uc_full_path: ucPath,
                  bind_status: 'pending',
                  context_object_id: null,
                  databricks_source_id: null,
                },
              });
            } else {
              await tx.pbiSourceBinding.create({
                data: {
                  org_id: orgId,
                  model_id: model.id,
                  table_id: table.id,
                  uc_full_path: ucPath,
                  bind_status: 'pending',
                  ...bindingData,
                },
              });
            }
          } else if (priorBinding) {
            await tx.pbiSourceBinding.delete({ where: { id: priorBinding.id } });
          }
          if (kind === 'embedded_table') {
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
                display_folder: col.displayFolder,
                props: (Object.keys(col.meta).length ? { tmdl: col.meta } : {}) as object,
                content_hash: sha256Short(JSON.stringify(col)),
              },
            });
          }

          for (const m of parsed.measures) {
            if (!m.name) continue;
            measureCount += 1;
            const measureData = {
              table_id: table.id,
              name: m.name,
              dax: m.dax.slice(0, 500_000) || ' ',
              dax_hash: sha256Short(m.dax),
              lineage_tag: m.lineageTag,
              format_string: m.formatString,
              display_folder: m.displayFolder,
              content_hash: sha256Short(JSON.stringify(m)),
              lifecycle: 'active',
              props: {} as object,
            };
            const priorMeasure =
              (m.lineageTag ? measureByTag.get(m.lineageTag) : undefined) ??
              measureByTableName.get(`${table.id}\0${m.name}`) ??
              measureByName.get(m.name) ??
              undefined;
            const priorProps = (priorMeasure?.props as Record<string, unknown> | null) ?? {};
            measureData.props = { ...priorProps, tmdl: m.meta } as object;
            if (priorMeasure && !seenMeasures.has(priorMeasure.id)) {
              await tx.pbiMeasure.update({ where: { id: priorMeasure.id }, data: measureData });
              seenMeasures.add(priorMeasure.id);
            } else {
              const created = await tx.pbiMeasure.create({
                data: { org_id: orgId, model_id: model.id, ...measureData },
              });
              seenMeasures.add(created.id);
            }
          }
        }

        // Only what is really gone from the model definition is removed.
        await tx.pbiMeasure.deleteMany({
          where: { model_id: model.id, id: { notIn: [...seenMeasures] } },
        });
        await tx.pbiTable.deleteMany({
          where: { model_id: model.id, id: { notIn: [...seenTables] } },
        });
      }, { maxWait: PARSE_TX_MAX_WAIT_MS, timeout: PARSE_TX_TIMEOUT_MS });

      const answerability = classifyModelAnswerability({
        rlsRequired: model.rls_required,
        partitionKinds,
      });

      const parseMeta: ParseMeta = {
        parser_version: PBI_PARSER_VERSION,
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
        expressions,
        parameters: readMParameters(expressions),
        model_definition: modelDefinition,
        synonyms,
        tmdl_unhandled: tmdlUnhandled,
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
    if (!fs.existsSync(absDir)) {
      reportsSkipped += 1;
      continue;
    }
    try {
      const summary = summarizeReportDefinitionDir(absDir);
      if (summary.measureRefs.length === 0 && summary.pageCount === 0) {
        reportsSkipped += 1;
        continue;
      }
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
