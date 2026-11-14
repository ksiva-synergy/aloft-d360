import 'server-only';

/**
 * LLM investigator (Architecture v2, Phase 4 — "brain v2").
 *
 * For a measure that is not recreated, builds a case file under the data policy (metadata +
 * aggregates), gives it with the matching playbooks to the LLM, runs the probes it asks for
 * (vetted scalar DAX, evaluated in Power BI and as gated SQL — bounded rounds / probes / tokens),
 * and records its diagnosis. Then acts on the proposed fix:
 *   rule      → synthesize the DAX function rule, prove it against Power BI (differential harness);
 *               when it verifies, re-check the measure itself
 *   compiler  → open a case file for a coding agent (fix + test + golden check → PR, human review)
 *   steward / owner → an action request for the person who must act
 * It never edits compiler code, publishes, or writes SQL that bypasses parity.
 */

import prisma from '@/lib/db';
import { harvestLlmComplete } from '@/lib/context/harvest-llm';
import type { Probe, ProbeResult } from '@/lib/powerbi/decompose-plan';
import { investigateMeasure, runProbesOnBothSides } from '@/lib/powerbi/decompose-run';
import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { classifySource } from '@/lib/powerbi/fidelity-gate';
import {
  INVESTIGATOR_PROMPT_VERSION,
  InvestigatorReply,
  LIMITS,
  SYSTEM_PROMPT,
  buildCaseFile,
  probeResultsForLlm,
  vetProbe,
} from '@/lib/powerbi/investigator-protocol';
import { LLM_DATA_POLICY } from '@/lib/powerbi/investigator-policy';
import { parseMLineage } from '@/lib/powerbi/m-lineage';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph, measureNodeId } from '@/lib/powerbi/model-graph';
import { matchPlaybooks } from '@/lib/powerbi/playbooks';
import { classifyRootCause } from '@/lib/powerbi/recreation-root-cause';
import { stageFromTranslation } from '@/lib/powerbi/recreation-summary';
import { resolveDiffTestTarget } from '@/lib/powerbi/rule-difftest-run';
import { synthesizeDaxRule } from '@/lib/powerbi/rule-synthesize';
import { estimateHarvestLlmCostUsd, getPbiTranslateLlmRouting } from '@/lib/powerbi/translate-llm';
import { extractJsonObject } from '@/lib/powerbi/translate-llm-validate';

export type LlmInvestigation = {
  version: string;
  at: string;
  policy: typeof LLM_DATA_POLICY;
  llm_model: string | null;
  rounds: number;
  probes: ReturnType<typeof probeResultsForLlm>;
  playbooks: string[];
  reply: InvestigatorReply | null;
  outcome:
    | { action: 'rule'; status: 'verified' | 'rejected' | 'skipped'; detail: string; measure_matches?: boolean | null }
    | { action: 'case_file'; detail: string }
    | { action: 'request'; to: 'steward' | 'owner'; detail: string }
    | { action: 'none'; detail: string };
  tokens: { input: number; output: number };
  cost_usd: number;
  /** Translate fingerprint at investigation time (re-investigate only when inputs change). */
  fingerprint: string | null;
  ms: number;
  error?: string;
};

export async function investigateWithLlm(input: {
  orgId: string;
  modelId: string;
  measure: string;
  /** Allow synthesizing + verifying registry rules (default true). */
  applyRules?: boolean;
}): Promise<LlmInvestigation> {
  const started = Date.now();
  const routing = getPbiTranslateLlmRouting();
  const model = await prisma.pbiModel.findFirst({
    where: { id: input.modelId, org_id: input.orgId },
    select: { name: true },
  });
  if (!model) throw new Error('Model not found');
  const measureRow = await prisma.pbiMeasure.findFirst({
    where: { org_id: input.orgId, model_id: input.modelId, name: input.measure },
    select: { id: true, dax: true },
  });
  if (!measureRow) throw new Error(`Measure not found: ${input.measure}`);
  const tr = await prisma.pbiTranslation.findFirst({
    where: { org_id: input.orgId, measure_id: measureRow.id },
    select: { sql_text: true, parity_verdict: true, tier: true, status: true, props: true },
  });
  const vq = await prisma.kbVerifiedQuery.findFirst({
    where: { org_id: input.orgId, pbi_measure_id: measureRow.id },
    select: { status: true },
  });

  const catalog = await loadMeasureLogicCatalog(input.orgId, input.modelId);
  const graph = buildModelGraph(catalog);
  const props = (tr?.props ?? {}) as Record<string, unknown>;
  const stage = stageFromTranslation(tr ?? null, vq?.status ?? null).stage;
  const rootCause = classifyRootCause({
    stage: stage === 'regressed' ? (tr?.parity_verdict === 'error' ? 'parity_error' : 'parity_fail') : stage,
    dax: measureRow.dax ?? '',
    tier: tr?.tier ?? null,
    props,
    catalog,
  });

  // the measure's dependency closure, as metadata
  const closure = graph.closure(measureNodeId(input.measure));
  const calledMeasures: { name: string; dax: string }[] = [];
  const calcColumns: { table: string; column: string; dax: string }[] = [];
  const tableKeys = new Set<string>();
  for (const id of closure) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    if (n.kind === 'measure' && n.name.toLowerCase() !== input.measure.toLowerCase()) {
      calledMeasures.push({ name: n.name, dax: catalog.measures?.get(n.name.toLowerCase())?.dax ?? '' });
    } else if (n.kind === 'calc_column') {
      const tk = id.slice(2).split('/')[0]!;
      calcColumns.push({ table: n.table ?? tk, column: n.name, dax: catalog.columnsByTable.get(tk)?.get(n.name)?.calculated_dax ?? '' });
    } else if (n.kind === 'table' || n.kind === 'calc_table') {
      tableKeys.add(id.slice(2));
    }
  }
  const tables = [...tableKeys].map((tk) => {
    const meta = catalog.tableMeta.get(tk);
    const lin = meta?.source_m ? parseMLineage(meta.source_m, catalog.rules, { culture: catalog.queryCulture }) : null;
    return {
      name: meta?.displayName ?? tk,
      source: meta ? classifySource(meta.source_m, Boolean(meta.uc_full_path)) : null,
      uc: meta?.uc_full_path ?? null,
      pqSteps: [
        ...(lin?.baseTable ? [`reads query ${lin.baseTable}`] : []),
        ...(lin?.joins ?? []).map((j) => `${j.kind} merge with ${j.table} on ${j.rightKeys.join(', ')}`),
        ...(lin?.where.length ? [`${lin.where.length} row filter(s)`] : []),
        ...(lin?.unsupported ?? []).map((u) => `NOT MODELED: ${u}`),
      ],
    };
  });
  const names = new Set([...tables.map((t) => t.name.toLowerCase())]);
  const relationships = (catalog.relationships ?? [])
    .filter((r) => names.has(r.fromTable.toLowerCase()) || names.has(r.toTable.toLowerCase()))
    .map((r) => `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]${r.both ? ' (both directions)' : ''}${r.active ? '' : ' (inactive)'}`);

  // decomposition: reuse the stored one, or run it for value mismatches
  let decomposition = ((props.investigation ?? null) as { probes?: ProbeResult[]; first_difference?: ProbeResult | null } | null) ?? null;
  if (!decomposition && (stage === 'parity_fail' || stage === 'regressed')) {
    decomposition = await investigateMeasure({ orgId: input.orgId, modelId: input.modelId, measure: input.measure });
  }

  const failure = (props.expand_failure ?? props.llm_failure ?? null) as Record<string, unknown> | null;
  const parity = (props.parity ?? null) as Record<string, unknown> | null;
  const errorText = [failure?.reason, parity?.summary].filter((x) => typeof x === 'string').join(' ');
  const playbooks = matchPlaybooks({
    rootCause: rootCause?.category,
    detectors: (rootCause?.evidence ?? []).map((e) => e.detector),
    errorText,
    firstDifference: decomposition?.first_difference?.kind ?? null,
  });

  const caseFile = buildCaseFile({
    model: model.name,
    measure: input.measure,
    dax: measureRow.dax ?? '',
    calledMeasures,
    calcColumns,
    tables,
    relationships,
    rootCause: rootCause ? { category: rootCause.category, detail: rootCause.detail, precise: rootCause.precise } : null,
    detectors: (rootCause?.evidence ?? []).map((e) => ({ detector: e.detector, evidence: e.evidence })),
    failure,
    parity,
    probes: decomposition?.probes ?? [],
    playbooks,
  });

  // conversation loop
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: JSON.stringify(caseFile) },
  ];
  const tokens = { input: 0, output: 0 };
  const extraProbes: ProbeResult[] = [];
  let reply: InvestigatorReply | null = null;
  let rounds = 0;
  let error: string | undefined;
  while (rounds < LIMITS.rounds) {
    rounds += 1;
    let text: string;
    try {
      const resp = await harvestLlmComplete({ system: SYSTEM_PROMPT, messages, maxTokens: 1500, temperature: 0.1 }, routing);
      tokens.input += resp.inputTokens;
      tokens.output += resp.outputTokens;
      text = resp.text;
    } catch (e) {
      error = `LLM call failed: ${(e as Error).message.slice(0, 300)}`;
      break;
    }
    const parsed = (() => {
      try {
        return InvestigatorReply.safeParse(JSON.parse(extractJsonObject(text)));
      } catch {
        return null;
      }
    })();
    if (!parsed?.success) {
      error = 'LLM reply was not valid JSON for the investigator schema';
      break;
    }
    reply = parsed.data;
    messages.push({ role: 'assistant', content: text });
    if (reply.status === 'diagnosed') break;

    const budget = LIMITS.probesTotal - extraProbes.length;
    const requested = reply.probes.slice(0, Math.min(LIMITS.probesPerRound, budget));
    if (!requested.length) break;
    const vetted: Probe[] = [];
    const rejected: { dax: string; reason: string }[] = [];
    requested.forEach((r, i) => {
      const v = vetProbe(r.dax);
      if (v.ok) vetted.push({ id: `llm${extraProbes.length + i}`, kind: 'measure', label: r.why || 'probe', dax: v.dax });
      else rejected.push({ dax: r.dax.slice(0, 200), reason: v.reason });
    });
    const results = vetted.length
      ? await runProbesOnBothSides({ orgId: input.orgId, modelId: input.modelId, probes: vetted, catalog, purpose: 'pbi_investigator' })
      : [];
    extraProbes.push(...results);
    const last = rounds >= LIMITS.rounds || extraProbes.length >= LIMITS.probesTotal;
    messages.push({
      role: 'user',
      content: JSON.stringify({
        probe_results: probeResultsForLlm(results),
        rejected_probes: rejected,
        instruction: last ? 'Probe budget used up: answer with status "diagnosed" now.' : 'Diagnose, or ask for more probes.',
      }),
    });
  }

  // act on the proposed fix
  let outcome: LlmInvestigation['outcome'] = { action: 'none', detail: error ?? 'no fix proposed' };
  const fix = reply?.fix;
  if (fix?.kind === 'rule' && fix.dax_function) {
    if (input.applyRules === false) {
      outcome = { action: 'rule', status: 'skipped', detail: 'rule synthesis disabled for this run' };
    } else {
      const fn = fix.dax_function;
      const synth = await synthesizeDaxRule({
        orgId: input.orgId,
        name: fn.name,
        arity: fn.arity,
        usageExamples: [measureRow.dax ?? '', ...calledMeasures.map((m) => m.dax)].filter((d) =>
          new RegExp(`\\b${fn.name}\\s*\\(`, 'i').test(d),
        ),
        target: await resolveDiffTestTarget(input.orgId),
        existingRules: catalog.rules,
      });
      let measureMatches: boolean | null = null;
      if (synth.status === 'verified') {
        const fresh = await loadMeasureLogicCatalog(input.orgId, input.modelId);
        const c = compileMeasureToSql({ measureDax: measureRow.dax ?? '', catalog: fresh });
        if (c.ok) {
          const [check] = await runProbesOnBothSides({
            orgId: input.orgId,
            modelId: input.modelId,
            probes: [{ id: 'self', kind: 'measure', label: input.measure, dax: `[${input.measure.replace(/]/g, ']]')}]` }],
            catalog: fresh,
            purpose: 'pbi_investigator_verify',
          });
          measureMatches = check?.status === 'match';
        }
      }
      outcome = {
        action: 'rule',
        status: synth.status,
        detail: `${fn.name}/${fn.arity}: ${synth.status} after ${synth.attempts} attempt(s)${synth.error ? ` — ${synth.error}` : ''}`,
        measure_matches: measureMatches,
      };
    }
  } else if (fix && (fix.kind === 'compiler' || reply?.category === 'new_pattern')) {
    outcome = { action: 'case_file', detail: fix.summary || reply?.diagnosis || 'compiler change needed' };
  } else if (fix && (fix.kind === 'steward' || fix.kind === 'owner')) {
    outcome = { action: 'request', to: fix.kind, detail: fix.summary || reply?.diagnosis || '' };
  }

  const result: LlmInvestigation = {
    version: INVESTIGATOR_PROMPT_VERSION,
    at: new Date().toISOString(),
    policy: LLM_DATA_POLICY,
    llm_model: routing.modelId ?? null,
    rounds,
    probes: probeResultsForLlm(extraProbes),
    playbooks: playbooks.map((p) => p.id),
    reply,
    outcome,
    tokens,
    cost_usd: estimateHarvestLlmCostUsd(tokens.input, tokens.output),
    fingerprint: typeof props.fingerprint === 'string' ? props.fingerprint : null,
    ms: Date.now() - started,
    ...(error ? { error } : {}),
  };

  const patch: Record<string, unknown> = { investigation_llm: result };
  if (outcome.action === 'case_file' && reply) {
    patch.case_file = {
      status: 'open',
      created_at: result.at,
      model: model.name,
      measure: input.measure,
      category: reply.category,
      confidence: reply.confidence,
      diagnosis: reply.diagnosis,
      fix: reply.fix,
      case: caseFile,
      probes: result.probes,
    };
  }
  if (outcome.action === 'request') {
    patch.action_request = { to: outcome.to, detail: outcome.detail, at: result.at, status: 'open' };
  }
  await prisma.$executeRaw`UPDATE pbi_translations
    SET props = COALESCE(props, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    WHERE org_id = ${input.orgId} AND measure_id = ${measureRow.id}::uuid`;
  console.log(
    `[pbi_investigator] ${model.name} / ${input.measure}: ${reply?.category ?? 'no diagnosis'} (${Math.round((reply?.confidence ?? 0) * 100)}%) → ${outcome.action}; rounds ${rounds}, probes ${extraProbes.length}, $${result.cost_usd.toFixed(4)}`,
  );
  return result;
}
