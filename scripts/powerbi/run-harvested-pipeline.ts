#!/usr/bin/env npx tsx
/**
 * Recreation pipeline for harvested models: translate (compile-first) → oracle → parity →
 * publish, then a per-model recreation summary with root causes.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-harvested-pipeline.ts
 *   … run-harvested-pipeline.ts --models "CII,CII SDK"      (by model name)
 *   … run-harvested-pipeline.ts --steps translate           (subset: translate,oracle,parity,investigate,publish)
 *
 * Translate checkpoints: measures whose compiler version, model content and DAX are unchanged
 * since their last final outcome are skipped, so reruns resume instead of starting over.
 */
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { investigateMeasure } from '@/lib/powerbi/decompose-run';
import { investigateWithLlm } from '@/lib/powerbi/investigator';
import { runDetectors } from '@/lib/powerbi/recreation-detectors';
import { buildModelRecreationSummary } from '@/lib/powerbi/recreation-summary';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    select: { id: true },
  });
  if (!source) throw new Error('No active powerbi source');

  const wanted = arg('--models')?.split(',').map((s) => s.trim()).filter(Boolean);
  const models = await prisma.pbiModel.findMany({
    where: { org_id: orgId, lifecycle: 'active' },
    select: { id: true, pbi_model_id: true, name: true, props: true },
  });
  const harvested = models.filter((m) => {
    const def = (m.props as Record<string, unknown>)?.definition as Record<string, unknown> | undefined;
    if (!def?.storage_path || !def?.content_hash) return false;
    return !wanted || wanted.includes(m.name);
  });
  if (!harvested.length) throw new Error('No matching harvested models');
  const ids = harvested.map((m) => m.pbi_model_id);
  console.log(`[pipeline] ${ids.length} models: ${harvested.map((m) => m.name).join(', ')}`);

  const scope = {
    model_ids: ids,
    max_models: ids.length,
    pilot: false,
    oracle_only_translated: true,
    llm_translate: true,
    max_llm_measures: 60,
  };
  const { runQueuedJobById } = await import('../context/orchestrator');
  const transient = (msg: string) => /Can't reach database server|ECONNRESET|ETIMEDOUT|P1001|P1017/i.test(msg);
  const allSteps = ['pbi_translate', 'pbi_oracle', 'pbi_parity', 'pbi_publish'] as const;
  const stepArg = arg('--steps')?.split(',').map((s) => `pbi_${s.trim().replace(/^pbi_/, '')}`);
  const steps = stepArg ? allSteps.filter((k) => stepArg.includes(k)) : allSteps;
  const investigate = !stepArg || stepArg.includes('pbi_investigate');
  for (const kind of steps) {
    // Steps are idempotent (upserts), so a connectivity blip is retried instead of failing the run.
    for (let attempt = 1; ; attempt++) {
      const t0 = Date.now();
      let status = 'failed';
      let error = '';
      try {
        const job = await enqueue(kind, source.id, scope, 'on_demand', orgId);
        const result = await runQueuedJobById(orgId, job.id);
        status = result.status;
        error = result.error ?? '';
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      console.log(`[pipeline] ${kind} ${status} in ${Math.round((Date.now() - t0) / 1000)}s (attempt ${attempt})`, error.split('\n')[0] ?? '');
      if (status !== 'failed') break;
      if (attempt >= 3 || !transient(error)) throw new Error(error || `${kind} failed`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }

  // L5: decompose every parity mismatch no detector already explains (max 15 per model).
  if (investigate) {
    for (const m of harvested) {
      const failing = await prisma.pbiTranslation.findMany({
        where: { org_id: orgId, model_id: m.id, parity_verdict: 'fail' },
        select: { measure_name: true, props: true },
        orderBy: { measure_name: 'asc' },
      });
      const NAMED = new Set(['scale_mismatch', 'sign_flip', 'row_fanout', 'type_mismatch']);
      const todo = failing
        .filter((t) => !runDetectors(t.props as Record<string, unknown>).some((f) => NAMED.has(f.detector)))
        .slice(0, 15);
      for (const t of todo) {
        try {
          const inv = await investigateMeasure({ orgId, modelId: m.id, measure: t.measure_name });
          console.log(`[investigate] ${m.name} / ${t.measure_name}: ${inv.conclusion}`);
        } catch (e) {
          console.log(`[investigate] ${m.name} / ${t.measure_name}: skipped — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // L5 v2: the LLM investigator works on causes nobody has named yet (not precise), at most
  // PBI_INVESTIGATOR_MAX per model (default 5), once per fingerprint (no repeat cost).
  if (investigate && process.env.PBI_INVESTIGATOR !== '0') {
    const maxPerModel = Math.max(0, Number(process.env.PBI_INVESTIGATOR_MAX ?? '5') || 0);
    for (const m of harvested) {
      const { measures } = await buildModelRecreationSummary(orgId, m.id);
      const trs = await prisma.pbiTranslation.findMany({
        where: { org_id: orgId, model_id: m.id },
        select: { measure_name: true, props: true },
      });
      const byName = new Map(trs.map((t) => [t.measure_name.toLowerCase(), (t.props ?? {}) as Record<string, unknown>]));
      const todo = measures
        .filter((r) => r.root_cause && !r.root_cause.precise)
        .filter((r) => {
          const p = byName.get(r.measure_name.toLowerCase()) ?? {};
          const prev = p.investigation_llm as { fingerprint?: string | null } | undefined;
          return !prev || prev.fingerprint !== p.fingerprint;
        })
        .slice(0, maxPerModel);
      for (const r of todo) {
        try {
          const inv = await investigateWithLlm({ orgId, modelId: m.id, measure: r.measure_name });
          console.log(`[investigator] ${m.name} / ${r.measure_name}: ${inv.reply?.category ?? 'no diagnosis'} → ${inv.outcome.action}`);
        } catch (e) {
          console.log(`[investigator] ${m.name} / ${r.measure_name}: skipped — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  const all: Record<string, unknown> = {};
  for (const m of harvested) {
    const { summary } = await buildModelRecreationSummary(orgId, m.id);
    all[m.name] = summary;
    console.log(
      `\n[summary] ${m.name}: ${summary.parity_pass}/${summary.measures_total} match (${summary.recreation_pct}%), published ${summary.published}${summary.regressions ? `, ⚠ REGRESSIONS ${summary.regressions}` : ''}${summary.stale ? `, dataset stale ${summary.stale} (re-checked after refresh)` : ''}, precise causes ${summary.causes_precise}/${summary.causes_total} (${summary.cause_precision_pct}%)`,
      JSON.stringify(summary.root_causes),
      JSON.stringify(summary.patterns),
    );
  }
  console.log('\n=== SUMMARIES ===\n' + JSON.stringify(all, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
