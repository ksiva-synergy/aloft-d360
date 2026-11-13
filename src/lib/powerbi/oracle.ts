import 'server-only';

import prisma from '@/lib/db';
import { executeDatasetQueries, PowerBiApiError } from '@/lib/powerbi/client';
import { buildMeasureOracleQuery } from '@/lib/powerbi/dax-query';
import { hashOracleRows } from '@/lib/powerbi/oracle-result-hash';

export interface PbiOracleResult {
  models_scanned: number;
  models_skipped_rls: number;
  measures_run: number;
  measures_failed: number;
  measures_skipped_no_targets: number;
  results_written: number;
  oracle_mode: 'sample' | 'translated';
  run_id: string;
}

const DEFAULT_MAX_MEASURES_PER_MODEL = 8;

export async function runPbiOracle(
  orgId: string,
  sourceId: string,
  opts: {
    runId: string;
    modelIds?: string[];
    maxMeasuresPerModel?: number;
    onlyCanonicalFamily?: boolean;
    /** After translate: oracle every measure that has draft SQL (parity ground truth). */
    onlyWithTranslation?: boolean;
    measureIds?: string[];
  },
): Promise<PbiOracleResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const maxPerModel = opts.maxMeasuresPerModel ?? DEFAULT_MAX_MEASURES_PER_MODEL;
  const oracleMode: 'sample' | 'translated' = opts.onlyWithTranslation
    ? 'translated'
    : 'sample';

  const models = await prisma.pbiModel.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
    },
    include: {
      workspace: { select: { pbi_workspace_id: true } },
    },
  });

  const measuresByModelId = new Map<string, { id: string; name: string }[]>();

  if (opts.onlyWithTranslation || opts.measureIds?.length) {
    const translations = await prisma.pbiTranslation.findMany({
      where: {
        org_id: orgId,
        measure_id: { not: null },
        sql_text: { not: null },
        ...(opts.measureIds?.length ? { measure_id: { in: opts.measureIds } } : {}),
        ...(opts.modelIds?.length
          ? { model: { pbi_model_id: { in: opts.modelIds } } }
          : {}),
      },
      select: {
        measure_id: true,
        model_id: true,
        measure: { select: { id: true, name: true } },
      },
    });
    for (const tr of translations) {
      if (!tr.measure_id || !tr.measure) continue;
      const bucket = measuresByModelId.get(tr.model_id) ?? [];
      if (!bucket.some((m) => m.id === tr.measure_id)) {
        bucket.push({ id: tr.measure.id, name: tr.measure.name });
      }
      measuresByModelId.set(tr.model_id, bucket);
    }
  } else {
    const capped = await prisma.pbiMeasure.findMany({
      where: {
        org_id: orgId,
        model: {
          lifecycle: 'active',
          ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
        },
      },
      orderBy: [{ model_id: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, model_id: true },
    });
    for (const m of capped) {
      let bucket = measuresByModelId.get(m.model_id);
      if (!bucket) {
        bucket = [];
        measuresByModelId.set(m.model_id, bucket);
      }
      if (bucket.length >= maxPerModel) continue;
      bucket.push({ id: m.id, name: m.name });
    }
  }

  let modelsScanned = 0;
  let modelsSkippedRls = 0;
  let measuresRun = 0;
  let measuresFailed = 0;
  let measuresSkippedNoTargets = 0;
  let resultsWritten = 0;

  for (const model of models) {
    if (model.rls_required) {
      modelsSkippedRls += 1;
      continue;
    }

    if (opts.onlyCanonicalFamily) {
      const fa = (model.props as Record<string, unknown>)?.family_assignment;
      if (
        fa &&
        typeof fa === 'object' &&
        (fa as Record<string, unknown>).is_canonical === false
      ) {
        continue;
      }
    }

    const measures = measuresByModelId.get(model.id) ?? [];
    if (measures.length === 0) {
      measuresSkippedNoTargets += 1;
      continue;
    }

    const wsId = model.workspace.pbi_workspace_id;
    const datasetId = model.pbi_model_id;
    modelsScanned += 1;

    for (const measure of measures) {
      measuresRun += 1;
      const dax = buildMeasureOracleQuery(measure.name);
      try {
        const response = await executeDatasetQueries(wsId, datasetId, [dax]);
        const block = response.results?.[0];
        if (block?.error) {
          measuresFailed += 1;
          continue;
        }
        const rows = block?.tables?.[0]?.rows ?? [];
        const preview = rows.slice(0, 20);
        const resultHash = hashOracleRows(rows);

        await prisma.pbiOracleResult.create({
          data: {
            org_id: orgId,
            model_id: model.id,
            measure_id: measure.id,
            measure_name: measure.name,
            dax_query: dax,
            result_hash: resultHash,
            row_count: rows.length,
            result_preview: preview as object,
            identity_kind: 'service_principal',
            model_refresh_at: model.last_refresh_at,
            run_id: opts.runId,
            props: { source_id: sourceId },
          },
        });
        resultsWritten += 1;
      } catch {
        measuresFailed += 1;
      }
    }
  }

  return {
    models_scanned: modelsScanned,
    models_skipped_rls: modelsSkippedRls,
    measures_run: measuresRun,
    measures_failed: measuresFailed,
    measures_skipped_no_targets: measuresSkippedNoTargets,
    results_written: resultsWritten,
    oracle_mode: oracleMode,
    run_id: opts.runId,
  };
}
