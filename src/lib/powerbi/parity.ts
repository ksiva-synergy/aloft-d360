import 'server-only';

import prisma from '@/lib/db';
import { systemPrincipal } from '@/lib/access/principal';
import { runWarehouseQuery } from '@/lib/access/warehouse';
import { PowerBiApiError } from '@/lib/powerbi/client';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';
import {
  decideParityVerdict,
  extractOracleScalar,
  extractSqlScalar,
} from '@/lib/powerbi/parity-compare';

async function resolveDatabricksSourceIdForTranslation(
  orgId: string,
  tr: {
    model_id: string;
    measure_id: string | null;
    props: unknown;
    measure?: {
      table: {
        sourceBinding: { databricks_source_id: string | null } | null;
      } | null;
    } | null;
  },
): Promise<string | null> {
  const props = (tr.props ?? {}) as Record<string, unknown>;
  const ucTable = typeof props.uc_source_table === 'string' ? props.uc_source_table : null;
  if (ucTable) {
    const rows = await prisma.pbiTable.findMany({
      where: { org_id: orgId, model_id: tr.model_id },
      select: {
        name: true,
        sourceBinding: { select: { databricks_source_id: true } },
      },
    });
    const hit = rows.find((r) => normalizePbiTableName(r.name) === normalizePbiTableName(ucTable));
    const ucSource = hit?.sourceBinding?.databricks_source_id;
    if (ucSource) return ucSource;
  }

  const home = tr.measure?.table.sourceBinding?.databricks_source_id;
  if (home) return home;

  const anyBinding = await prisma.pbiSourceBinding.findFirst({
    where: {
      org_id: orgId,
      bind_status: 'matched',
      databricks_source_id: { not: null },
      table: { is: { model_id: tr.model_id } },
    },
    select: { databricks_source_id: true },
  });
  return anyBinding?.databricks_source_id ?? null;
}

export interface PbiParityResult {
  translations_checked: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  run_id: string;
}

export async function runPbiParity(
  orgId: string,
  _sourceId: string,
  opts: { runId: string; modelIds?: string[] },
): Promise<PbiParityResult> {
  const translations = await prisma.pbiTranslation.findMany({
    where: {
      org_id: orgId,
      sql_text: { not: null },
      ...(opts.modelIds?.length
        ? { model: { pbi_model_id: { in: opts.modelIds } } }
        : {}),
    },
    include: {
      measure: {
        select: {
          id: true,
          table_id: true,
          table: {
            select: {
              sourceBinding: {
                select: { databricks_source_id: true },
              },
            },
          },
        },
      },
    },
  });

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  const principal = systemPrincipal('harvest', orgId);

  for (const tr of translations) {
    if (!tr.sql_text?.trim() || !tr.measure_id) {
      skipped += 1;
      continue;
    }

    const oracle = await prisma.pbiOracleResult.findFirst({
      where: { org_id: orgId, measure_id: tr.measure_id },
      orderBy: { created_at: 'desc' },
    });

    const oracleValue = oracle ? extractOracleScalar(oracle.result_preview) : null;

    const ctxSourceId = await resolveDatabricksSourceIdForTranslation(orgId, tr);
    if (!ctxSourceId) {
      const verdict = decideParityVerdict({ oracleValue, sqlValue: null });
      await prisma.pbiTranslation.update({
        where: { id: tr.id },
        data: {
          parity_verdict: 'skipped',
          props: {
            ...(tr.props as object),
            parity: {
              verdict: 'skipped',
              summary: 'No databricks_source_id on UC/home table binding',
              run_id: opts.runId,
            },
          },
          updated_at: new Date(),
        },
      });
      skipped += 1;
      continue;
    }

    const ctxSource = await prisma.platformContextSource.findFirst({
      where: { id: ctxSourceId, org_id: orgId, connection_kind: 'databricks' },
      select: { connection_ref: true },
    });
    const connectionId = ctxSource?.connection_ref;
    if (!connectionId) {
      skipped += 1;
      continue;
    }

    let sqlValue: number | null = null;
    let sqlError: string | null = null;

    try {
      const result = await runWarehouseQuery({
        connectionId,
        principal,
        statement: tr.sql_text,
        purpose: 'pbi_parity',
        level: 'read',
        surface: 'harvest',
      });
      sqlValue = extractSqlScalar(result.rows);
    } catch (err) {
      sqlError = err instanceof Error ? err.message : String(err);
    }

    const decision = decideParityVerdict({ oracleValue, sqlValue: sqlError ? null : sqlValue });
    const verdict = sqlError ? 'error' : decision.verdict;
    const summary = sqlError ? `SQL error: ${sqlError.slice(0, 200)}` : decision.summary;

    await prisma.pbiTranslation.update({
      where: { id: tr.id },
      data: {
        parity_verdict: verdict,
        props: {
          ...(tr.props as object),
          parity: {
            verdict,
            summary,
            oracle_value: oracleValue,
            sql_value: sqlValue,
            run_id: opts.runId,
          },
        },
        updated_at: new Date(),
      },
    });

    if (verdict === 'pass') passed += 1;
    else if (verdict === 'fail') failed += 1;
    else if (verdict === 'error') errors += 1;
    else skipped += 1;
  }

  if (translations.length === 0) {
    throw new PowerBiApiError('No rule-tier translations to check — run PBI Translate first');
  }

  return {
    translations_checked: translations.length,
    passed,
    failed,
    skipped,
    errors,
    run_id: opts.runId,
  };
}
