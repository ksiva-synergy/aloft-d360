import 'server-only';

import prisma from '@/lib/db';
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

    if (existing && existing.schema_hash !== schemaHash) {
      await prisma.kbVerifiedQuery.update({
        where: { id: existing.id },
        data: {
          status: 'candidate',
          last_validated_at: now,
          props: {
            ...(existing.props as object),
            demoted_reason: 'schema_hash_changed',
            ...provenance,
          },
          updated_at: now,
        },
      });
      await prisma.pbiTranslation.update({
        where: { id: tr.id },
        data: { status: 'draft', updated_at: now },
      });
      demoted += 1;
      continue;
    }

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
      props: provenance,
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

    await prisma.pbiTranslation.update({
      where: { id: tr.id },
      data: {
        status: 'published',
        props: {
          ...(tr.props as object),
          verified_query_id: row.id,
          published_at: now.toISOString(),
          publish_run_id: opts.runId,
        },
        updated_at: now,
      },
    });

    published += 1;
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
