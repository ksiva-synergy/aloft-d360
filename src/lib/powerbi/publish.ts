import 'server-only';

import prisma from '@/lib/db';
import { isFreshnessGap } from '@/lib/powerbi/recreation-root-cause';
import { PowerBiApiError } from '@/lib/powerbi/client';
import {
  buildAltPhrasings,
  buildVerifiedQueryQuestion,
} from '@/lib/powerbi/publish-question';
import { computeSchemaHash } from '@/lib/powerbi/schema-hash';
import {
  composeVerifiedQueryEmbedText,
  upsertVerifiedQueryEmbedding,
} from '@/lib/powerbi/verified-query-embed';

export interface PbiPublishResult {
  candidates: number;
  published: number;
  skipped: number;
  demoted: number;
  run_id: string;
}

function tablesFromTranslationProps(props: unknown, fallbackUc?: string | null): string[] {
  const p = props && typeof props === 'object' ? (props as Record<string, unknown>) : {};
  const uc = typeof p.uc_full_path === 'string' ? p.uc_full_path : fallbackUc;
  return uc?.trim() ? [uc.trim()] : [];
}

/**
 * Re-parse assigns new PbiMeasure ids. Verified queries still pointing at ids that no longer
 * exist would keep answering with superseded SQL, so demote them (reversible: status
 * `candidate` + `demoted_reason`, the same path as a schema-hash change).
 */
export async function retireStaleVerifiedQueries(
  orgId: string,
  pbiModelIds?: string[],
): Promise<number> {
  const models = await prisma.pbiModel.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      ...(pbiModelIds?.length ? { pbi_model_id: { in: pbiModelIds } } : {}),
    },
    select: { pbi_model_id: true, measures: { select: { id: true } } },
  });
  const now = new Date();
  let retired = 0;
  for (const m of models) {
    const stale = await prisma.kbVerifiedQuery.findMany({
      where: {
        org_id: orgId,
        origin: 'powerbi',
        status: 'verified',
        props: { path: ['pbi_model_id'], equals: m.pbi_model_id },
        pbi_measure_id: { notIn: m.measures.map((x) => x.id) },
      },
      select: { id: true, props: true },
    });
    for (const vq of stale) {
      await prisma.kbVerifiedQuery.update({
        where: { id: vq.id },
        data: {
          status: 'candidate',
          props: {
            ...(vq.props as object),
            demoted_reason: 'measure_removed',
            demoted_at: now.toISOString(),
          },
          updated_at: now,
        },
      });
      retired += 1;
    }
  }
  return retired;
}

/**
 * Guardrail: a verified (published) query whose measure no longer matches Power BI must not keep
 * answering silently. If the mismatch is explained by a stale dataset (the warehouse is newer), the
 * SQL is right and stays published with a warning; otherwise it is demoted (reversible: status
 * `candidate`, demoted_reason `parity_regression`) and the translation is marked `regressed_at`,
 * which the recreation summary reports as a regression until it matches again.
 */
export async function handleRegressions(
  orgId: string,
  pbiModelIds: string[] | undefined,
  runId: string,
): Promise<{ demoted: number; flagged: number; measures: string[] }> {
  const failing = await prisma.pbiTranslation.findMany({
    where: {
      org_id: orgId,
      parity_verdict: { in: ['fail', 'error'] },
      ...(pbiModelIds?.length ? { model: { pbi_model_id: { in: pbiModelIds } } } : {}),
    },
    select: { id: true, measure_id: true, measure_name: true, parity_verdict: true, props: true },
  });
  let demoted = 0;
  let flagged = 0;
  const measures: string[] = [];
  const now = new Date();
  for (const tr of failing) {
    if (!tr.measure_id) continue;
    const vq = await prisma.kbVerifiedQuery.findFirst({
      where: { org_id: orgId, pbi_measure_id: tr.measure_id, status: 'verified' },
      select: { id: true, props: true },
    });
    if (!vq) continue;
    const props = (tr.props ?? {}) as Record<string, unknown>;
    const parity = (props.parity ?? null) as Record<string, unknown> | null;
    const detail = {
      verdict: tr.parity_verdict,
      summary: typeof parity?.summary === 'string' ? parity.summary : null,
      at: now.toISOString(),
      run_id: runId,
    };
    measures.push(tr.measure_name);
    if (tr.parity_verdict === 'fail' && isFreshnessGap(parity)) {
      await prisma.kbVerifiedQuery.update({
        where: { id: vq.id },
        data: { props: { ...(vq.props as object), stale_dataset_warning: detail }, updated_at: now },
      });
      flagged += 1;
    } else {
      await prisma.kbVerifiedQuery.update({
        where: { id: vq.id },
        data: {
          status: 'candidate',
          props: { ...(vq.props as object), demoted_reason: 'parity_regression', demoted_at: now.toISOString(), regression: detail },
          updated_at: now,
        },
      });
      demoted += 1;
    }
    await prisma.pbiTranslation.update({
      where: { id: tr.id },
      data: { props: { ...props, regressed_at: now.toISOString(), regression: detail }, updated_at: now },
    });
  }
  return { demoted, flagged, measures };
}

export async function runPbiPublish(
  orgId: string,
  _sourceId: string,
  opts: {
    runId: string;
    modelIds?: string[];
    requireApproved?: boolean;
    verifiedBy?: string | null;
  },
): Promise<PbiPublishResult> {
  const translations = await prisma.pbiTranslation.findMany({
    where: {
      org_id: orgId,
      parity_verdict: 'pass',
      sql_text: { not: null },
      ...(opts.modelIds?.length
        ? { model: { pbi_model_id: { in: opts.modelIds } } }
        : {}),
    },
    include: {
      model: { select: { id: true, name: true, rls_required: true, pbi_model_id: true } },
      measure: { select: { id: true, name: true, dax_hash: true } },
    },
  });

  let published = 0;
  let skipped = 0;
  let demoted = 0;

  const now = new Date();

  for (const tr of translations) {
    if (!tr.sql_text?.trim() || !tr.measure_id) {
      skipped += 1;
      continue;
    }
    if (tr.model.rls_required) {
      skipped += 1;
      continue;
    }
    if (opts.requireApproved && tr.status !== 'approved') {
      skipped += 1;
      continue;
    }

    const tablesUsed = tablesFromTranslationProps(tr.props);
    const schemaHash = computeSchemaHash({
      tablesUsed,
      daxHash: tr.dax_hash ?? tr.measure?.dax_hash,
      sqlText: tr.sql_text,
    });

    const question = buildVerifiedQueryQuestion(
      tr.measure_name,
      tr.model.name,
    );
    const altPhrasings = buildAltPhrasings(tr.measure_name, tr.model.name);

    const provenance = {
      pbi_model_id: tr.model.pbi_model_id,
      model_name: tr.model.name,
      measure_name: tr.measure_name,
      translation_id: tr.id,
      parity_verdict: tr.parity_verdict,
      publish_run_id: opts.runId,
    };

    const existing = await prisma.kbVerifiedQuery.findFirst({
      where: { org_id: orgId, pbi_measure_id: tr.measure_id },
    });

    // SQL/schema changed since the last publish. Translate clears parity_verdict on every
    // rewrite, so a `pass` here means parity re-verified the *new* SQL against Power BI:
    // replace the verified query in place (history kept) instead of demoting it forever.
    const supersededHash =
      existing && existing.schema_hash !== schemaHash ? existing.schema_hash : null;

    const baseData = {
      question,
      alt_phrasings: altPhrasings,
      sql: tr.sql_text,
      tables_used: tablesUsed,
      schema_hash: schemaHash,
      status: 'verified',
      origin: 'powerbi',
      pbi_translation_id: tr.id,
      pbi_measure_id: tr.measure_id,
      verified_by: opts.verifiedBy ?? 'harvest',
      verified_at: now,
      last_validated_at: now,
      props: supersededHash
        ? { ...provenance, superseded_schema_hash: supersededHash, superseded_at: now.toISOString() }
        : provenance,
    };

    const row = existing
      ? await prisma.kbVerifiedQuery.update({
          where: { id: existing.id },
          data: { ...baseData, updated_at: now },
        })
      : await prisma.kbVerifiedQuery.create({
          data: { org_id: orgId, ...baseData },
        });

    const embedText = composeVerifiedQueryEmbedText({
      question,
      altPhrasings,
      measureName: tr.measure_name,
      modelName: tr.model.name,
    });
    await upsertVerifiedQueryEmbedding(row.id, embedText);

    // matches again: drop any earlier regression mark
    const { regressed_at: _r, regression: _g, ...cleanProps } = (tr.props ?? {}) as Record<string, unknown>;
    await prisma.pbiTranslation.update({
      where: { id: tr.id },
      data: {
        status: 'published',
        props: {
          ...cleanProps,
          verified_query_id: row.id,
          published_at: now.toISOString(),
          publish_run_id: opts.runId,
        },
        updated_at: now,
      },
    });

    published += 1;
  }

  demoted += await retireStaleVerifiedQueries(orgId, opts.modelIds);
  const reg = await handleRegressions(orgId, opts.modelIds, opts.runId);
  demoted += reg.demoted;
  if (reg.demoted || reg.flagged) {
    console.warn(
      `[pbi_publish] REGRESSION: ${reg.demoted} verified queries demoted, ${reg.flagged} kept but flagged (stale dataset): ${reg.measures.slice(0, 10).join(', ')}`,
    );
  }

  if (translations.length === 0) {
    throw new PowerBiApiError(
      'No translations with parity pass — run PBI Translate then PBI Parity first',
    );
  }

  return {
    candidates: translations.length,
    published,
    skipped,
    demoted,
    run_id: opts.runId,
  };
}
