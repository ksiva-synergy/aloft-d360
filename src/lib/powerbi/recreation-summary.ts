import 'server-only';

import prisma from '@/lib/db';
import {
  analyzeMeasureLogic,
  loadMeasureLogicCatalog,
  summarizeMeasureLogic,
  type MeasureLogicSummary,
} from '@/lib/powerbi/measure-logic-analyze';
import {
  classifyRootCause,
  type RootCause,
  type RootCauseCategory,
} from '@/lib/powerbi/recreation-root-cause';
import {
  normalizePbiTableName,
  resolveUcForMeasure,
  type TableUcRow,
} from '@/lib/powerbi/translate-dax-refs';

export type MeasureRecreationStage =
  | 'no_uc'
  | 'no_sql'
  | 'draft_sql'
  | 'parity_skip'
  | 'parity_error'
  | 'parity_fail'
  | 'recreated'
  | 'published'
  /** Was verified/published, but its SQL no longer matches Power BI (guardrail: never hidden). */
  | 'regressed'
  /** Differs only because the Power BI dataset is older than the warehouse; re-checked after refresh. */
  | 'stale';

export type ModelRecreationSummary = {
  measures_total: number;
  uc_resolved: number;
  sql_drafted: number;
  parity_pass: number;
  parity_fail: number;
  parity_error: number;
  parity_skip: number;
  published: number;
  recreation_pct: number;
  published_pct: number;
  by_stage: Record<MeasureRecreationStage, number>;
  /** Not-recreated measures grouped by root cause. */
  root_causes: Partial<Record<RootCauseCategory, number>>;
  /** Measures that matched Power BI before and no longer do (guardrail alert). */
  regressions: number;
  /** Differ only because the dataset is older than the warehouse (not a recreation failure). */
  stale: number;
  /** Not-recreated measures whose cause is precise (Phase 3 exit metric). */
  causes_precise: number;
  causes_total: number;
  /** causes_precise / causes_total, as a percentage (100 when nothing failed). */
  cause_precision_pct: number;
  /** Detector patterns across not-recreated measures. */
  patterns: Record<string, number>;
  failures: {
    measure_name: string;
    stage: MeasureRecreationStage;
    reason: string;
    root_cause: RootCauseCategory | null;
  }[];
};

export type MeasureColumnResolutionSummary = {
  mapped_count: number;
  ref_count: number;
  unmapped: string[];
};

export type MeasureRecreationRow = {
  measure_id: string;
  measure_name: string;
  stage: MeasureRecreationStage;
  reason: string | null;
  translation_tier: string | null;
  parity_verdict: string | null;
  verified_query_status: string | null;
  uc_source_table: string | null;
  column_resolution: MeasureColumnResolutionSummary | null;
  measure_logic: MeasureLogicSummary | null;
  root_cause: RootCause | null;
};

function measureLogicFromProps(props: unknown): MeasureLogicSummary | null {
  if (!props || typeof props !== 'object') return null;
  const raw = (props as Record<string, unknown>).measure_logic_analysis;
  if (!raw || typeof raw !== 'object') return null;
  try {
    return summarizeMeasureLogic(raw as Parameters<typeof summarizeMeasureLogic>[0]);
  } catch {
    return null;
  }
}

function columnResolutionFromProps(props: unknown): MeasureColumnResolutionSummary | null {
  if (!props || typeof props !== 'object') return null;
  const cr = (props as Record<string, unknown>).column_resolution;
  if (!cr || typeof cr !== 'object') return null;
  const o = cr as Record<string, unknown>;
  return {
    mapped_count: typeof o.mapped_count === 'number' ? o.mapped_count : 0,
    ref_count: typeof o.ref_count === 'number' ? o.ref_count : 0,
    unmapped: Array.isArray(o.unmapped) ? o.unmapped.map(String) : [],
  };
}

function parityPropsSummary(props: unknown): string | null {
  if (!props || typeof props !== 'object') return null;
  const parity = (props as Record<string, unknown>).parity;
  if (!parity || typeof parity !== 'object') return null;
  const summary = (parity as Record<string, unknown>).summary;
  return typeof summary === 'string' ? summary : null;
}

export function stageFromTranslation(
  tr: {
    sql_text: string | null;
    parity_verdict: string | null;
    tier: string;
    status: string;
    props: unknown;
  } | null,
  verifiedStatus: string | null,
): { stage: MeasureRecreationStage; reason: string | null } {
  if (!tr?.sql_text?.trim()) {
    const props = tr?.props as Record<string, unknown> | undefined;
    const logic = measureLogicFromProps(props);
    const expandReason = (props?.expand_failure as { reason?: string } | undefined)?.reason;
    if (tr?.tier === 'logic_gate' && (expandReason || logic?.block_reason)) {
      return { stage: 'no_sql', reason: expandReason ?? logic!.block_reason };
    }
    const failure =
      (props?.fidelity_block as { reason?: string } | undefined)?.reason ??
      (props?.expand_failure as { reason?: string } | undefined)?.reason ??
      (props?.llm_failure as { reason?: string } | undefined)?.reason;
    return { stage: 'no_sql', reason: failure ?? (tr ? 'Translation row without SQL' : null) };
  }
  const verdict = tr.parity_verdict;
  if (verdict === 'stale') {
    return { stage: 'stale', reason: parityPropsSummary(tr.props) };
  }
  const regressedAt = (tr.props as Record<string, unknown> | null)?.regressed_at;
  if ((verdict === 'fail' || verdict === 'error') && (verifiedStatus === 'verified' || typeof regressedAt === 'string')) {
    return { stage: 'regressed', reason: `Matched Power BI before, now: ${parityPropsSummary(tr.props) ?? verdict}` };
  }
  if (verifiedStatus === 'verified') {
    return {
      stage: 'published',
      reason: parityPropsSummary(tr.props),
    };
  }
  if (verdict === 'pass') {
    return { stage: 'recreated', reason: parityPropsSummary(tr.props) };
  }
  if (verdict === 'fail') {
    return { stage: 'parity_fail', reason: parityPropsSummary(tr.props) };
  }
  if (verdict === 'error') {
    return { stage: 'parity_error', reason: parityPropsSummary(tr.props) };
  }
  if (verdict === 'skipped') {
    return { stage: 'parity_skip', reason: parityPropsSummary(tr.props) };
  }
  return { stage: 'draft_sql', reason: 'SQL drafted; parity not run or pending' };
}

export async function buildModelRecreationSummary(
  orgId: string,
  internalModelId: string,
): Promise<{ summary: ModelRecreationSummary; measures: MeasureRecreationRow[] }> {
  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: orgId, model_id: internalModelId },
    select: {
      id: true,
      name: true,
      dax: true,
      table: { select: { name: true, sourceBinding: { select: { bind_status: true, uc_full_path: true, native_sql: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  const tables = await prisma.pbiTable.findMany({
    where: { org_id: orgId, model_id: internalModelId },
    select: {
      name: true,
      sourceBinding: { select: { bind_status: true, uc_full_path: true, native_sql: true } },
    },
  });
  const logicCatalog = await loadMeasureLogicCatalog(orgId, internalModelId);

  const ucMap = new Map<string, TableUcRow>();
  for (const t of tables) {
    const b = t.sourceBinding;
    if (b?.bind_status === 'matched' && b.uc_full_path?.trim()) {
      ucMap.set(normalizePbiTableName(t.name), {
        uc: b.uc_full_path.trim(),
        nativeSql: b.native_sql ?? null,
      });
    }
  }

  const translations = await prisma.pbiTranslation.findMany({
    where: { org_id: orgId, model_id: internalModelId },
    select: {
      measure_id: true,
      tier: true,
      status: true,
      sql_text: true,
      parity_verdict: true,
      props: true,
    },
  });
  const trByMeasure = new Map(translations.map((t) => [t.measure_id, t]));

  const verified = await prisma.kbVerifiedQuery.findMany({
    where: {
      org_id: orgId,
      pbi_measure_id: { in: measures.map((m) => m.id) },
    },
    select: { pbi_measure_id: true, status: true },
  });
  const vqByMeasure = new Map(
    verified.filter((v) => v.pbi_measure_id).map((v) => [v.pbi_measure_id!, v.status]),
  );

  const byStage: Record<MeasureRecreationStage, number> = {
    no_uc: 0,
    no_sql: 0,
    draft_sql: 0,
    parity_skip: 0,
    parity_error: 0,
    parity_fail: 0,
    recreated: 0,
    published: 0,
    regressed: 0,
    stale: 0,
  };

  const rows: MeasureRecreationRow[] = [];
  const rootCauses: Partial<Record<RootCauseCategory, number>> = {};
  let causesTotal = 0;
  let causesPrecise = 0;
  const patterns: Record<string, number> = {};
  const failures: ModelRecreationSummary['failures'] = [];
  let ucResolved = 0;

  for (const m of measures) {
    const hb = m.table.sourceBinding;
    const homeUc =
      hb?.bind_status === 'matched' && hb.uc_full_path?.trim() ? hb.uc_full_path.trim() : null;
    const resolved = resolveUcForMeasure({
      dax: m.dax ?? '',
      homeTableName: m.table.name,
      homeUc,
      homeNativeSql: hb?.native_sql ?? null,
      modelTables: ucMap,
    });

    const tr = trByMeasure.get(m.id) ?? null;
    const vqStatus = vqByMeasure.get(m.id) ?? null;

    let stage: MeasureRecreationStage;
    let reason: string | null;

    if (!resolved) {
      stage = 'no_uc';
      reason = !(m.dax ?? '').trim()
        ? 'Empty DAX in catalog'
        : 'No Unity Catalog binding for DAX table refs';
      if (tr) {
        const fromTr = stageFromTranslation(tr, vqStatus);
        stage = fromTr.stage;
        reason = fromTr.reason ?? reason;
      }
    } else {
      ucResolved += 1;
      if (!tr) {
        stage = 'no_sql';
        reason = 'UC resolved; no translation row — run PBI Translate';
      } else {
        const fromTr = stageFromTranslation(tr, vqStatus);
        stage = fromTr.stage;
        reason = fromTr.reason;
      }
    }

    const props = tr?.props as Record<string, unknown> | undefined;
    const ucTable =
      typeof props?.uc_source_table === 'string' ? props.uc_source_table : resolved?.sourceTable ?? null;

    let measureLogic = measureLogicFromProps(props);
    if (!measureLogic && resolved) {
      measureLogic = summarizeMeasureLogic(
        analyzeMeasureLogic({
          dax: m.dax ?? '',
          catalog: logicCatalog,
          hasUc: true,
        }),
      );
    } else if (!measureLogic) {
      measureLogic = summarizeMeasureLogic(
        analyzeMeasureLogic({
          dax: m.dax ?? '',
          catalog: logicCatalog,
          hasUc: false,
        }),
      );
    }

    if (
      !reason &&
      measureLogic.block_automated_sql &&
      measureLogic.block_reason &&
      stage === 'no_sql'
    ) {
      reason = measureLogic.block_reason;
    }

    const rootCause = classifyRootCause({
      // a regression is classified like any mismatch / SQL error
      stage: stage === 'regressed' ? (tr?.parity_verdict === 'error' ? 'parity_error' : 'parity_fail') : stage,
      dax: m.dax ?? '',
      tier: tr?.tier ?? null,
      props: (props ?? null) as Record<string, unknown> | null,
      catalog: logicCatalog,
    });
    if (rootCause) {
      rootCauses[rootCause.category] = (rootCauses[rootCause.category] ?? 0) + 1;
      causesTotal += 1;
      if (rootCause.precise) causesPrecise += 1;
      for (const f of rootCause.evidence ?? []) patterns[f.detector] = (patterns[f.detector] ?? 0) + 1;
    }

    byStage[stage] += 1;
    if (
      stage === 'no_uc' ||
      stage === 'no_sql' ||
      stage === 'parity_error' ||
      stage === 'parity_fail' ||
      stage === 'parity_skip' ||
      stage === 'regressed'
    ) {
      failures.push({
        measure_name: m.name,
        stage,
        reason: reason ?? stage,
        root_cause: rootCause?.category ?? null,
      });
    }

    rows.push({
      measure_id: m.id,
      measure_name: m.name,
      stage,
      reason,
      translation_tier: tr?.tier ?? null,
      parity_verdict: tr?.parity_verdict ?? null,
      verified_query_status: vqStatus,
      uc_source_table: ucTable,
      column_resolution: columnResolutionFromProps(tr?.props),
      measure_logic: measureLogic,
      root_cause: rootCause,
    });
  }

  const sqlDrafted = translations.filter((t) => t.sql_text?.trim()).length;
  const summary: ModelRecreationSummary = {
    measures_total: measures.length,
    uc_resolved: ucResolved,
    sql_drafted: sqlDrafted,
    parity_pass: byStage.recreated + byStage.published,
    parity_fail: byStage.parity_fail,
    parity_error: byStage.parity_error,
    parity_skip: byStage.parity_skip,
    published: byStage.published,
    regressions: byStage.regressed,
    stale: byStage.stale,
    recreation_pct:
      measures.length > 0
        ? Math.round(((byStage.recreated + byStage.published) / measures.length) * 1000) / 10
        : 0,
    published_pct:
      measures.length > 0 ? Math.round((byStage.published / measures.length) * 1000) / 10 : 0,
    by_stage: byStage,
    root_causes: rootCauses,
    causes_precise: causesPrecise,
    causes_total: causesTotal,
    cause_precision_pct: causesTotal ? Math.round((causesPrecise / causesTotal) * 1000) / 10 : 100,
    patterns,
    failures: failures.sort((a, b) => a.measure_name.localeCompare(b.measure_name)),
  };

  return { summary, measures: rows };
}
