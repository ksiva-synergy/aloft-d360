/**
 * Run CII boost suite locally and write today's response record to eval/powerbi/runs/.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs -r ./scripts/context/noserver.cjs scripts/powerbi/run-cii-boost-baseline.ts
 *   npx tsx --env-file=.env scripts/powerbi/run-cii-boost-baseline.ts  (if tsx supports --env-file via node)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOST_SUITE_CII_PILOT, BOOST_SUITE_CII_VERSION } from '@/lib/boost/suite-cii';
import { BOOST_MODELS } from '@/lib/boost/models';
import { runBenchmarkCase } from '@/lib/boost/runner';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const label = argValue('--label', `baseline-${new Date().toISOString().slice(0, 10)}`);
  const modelKey = argValue('--model', 'sonnet-4-6');
  const modesArg = argValue('--modes', 'harvested');
  const contextModes = modesArg.split(',').filter((m) => m === 'harvested' || m === 'warehouse_only') as (
    | 'harvested'
    | 'warehouse_only'
  )[];

  const boostModel = BOOST_MODELS.find((m) => m.key === modelKey);
  if (!boostModel) {
    console.error(`Unknown model key: ${modelKey}`);
    process.exit(1);
  }
  if (!contextModes.length) {
    console.error('No valid context modes');
    process.exit(1);
  }

  const capturedAt = new Date().toISOString();
  const results: Record<string, unknown>[] = [];

  console.log(
    `[cii-boost] ${BOOST_SUITE_CII_PILOT.length} cases × ${contextModes.join('+')} × ${modelKey} (suite ${BOOST_SUITE_CII_VERSION})`,
  );

  for (const boostCase of BOOST_SUITE_CII_PILOT) {
    for (const contextMode of contextModes) {
      console.log(`[cii-boost] running ${boostCase.id} (${contextMode})…`);
      const t0 = Date.now();
      const result = await runBenchmarkCase({ caseId: boostCase.id, modelKey, contextMode });
      const row = result.row as Record<string, unknown> | undefined;
      results.push({
        case_id: boostCase.id,
        title: boostCase.title,
        prompt: boostCase.prompt,
        validation: boostCase.validation ?? null,
        context_mode: contextMode,
        model_key: modelKey,
        elapsed_ms: Date.now() - t0,
        ok: result.ok,
        error: result.error ?? null,
        boost_run_id: row?.id ?? null,
        outcome: row?.outcome ?? result.error ?? 'unknown',
        answer_excerpt: row?.answer_excerpt ?? null,
        answer_full: row?.answer_full ?? null,
        error_detail: row?.error_detail ?? null,
        tool_calls_total: row?.tool_calls_total ?? null,
        loops: row?.loops ?? null,
        latency_ms: row?.latency_ms ?? null,
      });
      console.log(`[cii-boost]   → ${row?.outcome ?? result.error} (${Date.now() - t0}ms)`);
    }
  }

  const outDir = path.join(root, 'eval', 'powerbi', 'runs');
  fs.mkdirSync(outDir, { recursive: true });
  const safeLabel = label.replace(/[^\w.-]+/g, '_');
  const outFile = path.join(outDir, `${capturedAt.slice(0, 10)}-${safeLabel}-cii-boost-recorded.json`);

  const errored = results.filter((r) => r.outcome === 'errored').length;
  const payload = {
    label,
    suite_version: BOOST_SUITE_CII_VERSION,
    captured_at: capturedAt,
    model_key: modelKey,
    context_modes: contextModes,
    run_environment: {
      hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown',
      db_reachable_for_runs: results.some((r) => r.boost_run_id != null),
      cases_errored: errored,
      cases_total: results.length,
    },
    steward_outcome_note: 'Automated run — stewards fill steward_outcome after oracle review',
    cases: results,
  };

  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[cii-boost] wrote ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
