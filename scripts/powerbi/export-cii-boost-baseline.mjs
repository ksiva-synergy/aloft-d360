/**
 * Export platform_boost_runs for suite cii_pilot_v1 into eval/powerbi validation JSON.
 *
 *   node --env-file=.env scripts/powerbi/export-cii-boost-baseline.mjs --label before-phase3
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CII_SUITE = 'cii_pilot_v1';

function parseArgs() {
  const labelIdx = process.argv.indexOf('--label');
  return { label: labelIdx >= 0 ? process.argv[labelIdx + 1] : 'cii-boost-export' };
}

function inferValidationPath(toolTrajectory) {
  const traj = Array.isArray(toolTrajectory) ? toolTrajectory : [];
  let catalog = 0;
  let data = 0;
  for (const step of traj) {
    const kind = step?.kind ?? step?.type;
    if (kind === 'catalog' || step?.phantomCatalogCall) catalog++;
    if (kind === 'data') data++;
  }
  if (data > 0 && catalog === 0) return 'catalog_llm';
  if (data > 0) return 'catalog_llm';
  return 'other';
}

function mapOutcome(run) {
  if (run.outcome === 'errored' || run.outcome === 'incompatible') return 'refused';
  if (run.groundedness != null && run.groundedness < 0.5) return 'wrong_number';
  if (run.semantic_score != null && run.semantic_score < 0.4) return 'draft_sql';
  return 'draft_sql';
}

async function main() {
  const { label } = parseArgs();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const runs = await prisma.platform_boost_runs.findMany({
    where: { suite_version: CII_SUITE },
    orderBy: { created_at: 'desc' },
    take: 500,
  });

  const cases = runs.map((run) => ({
    boost_run_id: run.id,
    case_id: run.case_id,
    captured_at: run.created_at?.toISOString?.() ?? null,
    model_key: run.model_key,
    context_mode: run.context_mode,
    outcome_automated: mapOutcome(run),
    path_inferred: inferValidationPath(run.tool_trajectory),
    boost_outcome: run.outcome,
    groundedness: run.groundedness,
    semantic_score: run.semantic_score,
    loops: run.loops,
    latency_ms: run.latency_ms,
    steward_outcome: null,
    steward_notes: 'Fill after steward review — automated scores are proxies only',
  }));

  const summary = {
    label,
    suite_version: CII_SUITE,
    exported_at: new Date().toISOString(),
    run_count: runs.length,
    note: 'Re-run compare_cii_pbi_databricks.mjs for numeric oracle; stewards override outcome_automated.',
    cases,
  };

  const outDir = path.join(root, 'eval', 'powerbi', 'runs');
  fs.mkdirSync(outDir, { recursive: true });
  const safe = label.replace(/[^\w.-]+/g, '_');
  const outFile = path.join(outDir, `${summary.exported_at.slice(0, 10)}-${safe}-cii-boost.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`[export-cii-boost-baseline] wrote ${path.relative(root, outFile)} (${runs.length} runs)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
