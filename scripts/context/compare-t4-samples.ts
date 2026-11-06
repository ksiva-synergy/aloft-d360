/**
 * Compare heuristic T4 (shipped) vs LLM cluster/table propose (legacy-style) on samples.
 *
 * Fixtures (no DB, no API key):
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/compare-t4-samples.ts
 *
 * Live LLM on fixtures (needs XAI_API_KEY or Bedrock):
 *   RUN_T4_LLM_COMPARE=1 npx tsx --require ./scripts/context/noserver.cjs scripts/context/compare-t4-samples.ts --llm
 *
 * Live DB objects (comma-separated context object UUIDs):
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/compare-t4-samples.ts --ids <id1>,<id2> [--llm]
 */
import { diffClusterProposals, diffTableProposals } from '@/lib/context/t4/compare-proposals';
import { toClusterProposal, toTableProposal } from '@/lib/context/t4/heuristic-proposal';
import { loadObjectT2Context } from '@/lib/context/t4/context-loader';
import {
  SAMPLE_CATALOG,
  SAMPLE_CLUSTER_CONTEXTS,
  SAMPLE_SCHEMA,
} from '@/lib/context/t4/__fixtures__/sample-cluster';
import type { ObjectT2Context } from '@/lib/context/t4/object-t2-context';

async function main() {
  const args = process.argv.slice(2);
  const useLlm = args.includes('--llm') || process.env.RUN_T4_LLM_COMPARE === '1';
  const idsIdx = args.indexOf('--ids');
  const ids =
    idsIdx >= 0 && args[idsIdx + 1]
      ? args[idsIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
      : null;

  let contexts: ObjectT2Context[];
  let catalog = SAMPLE_CATALOG;
  let schema = SAMPLE_SCHEMA;

  if (ids?.length) {
    const loaded: ObjectT2Context[] = [];
    for (const id of ids) {
      const ctx = await loadObjectT2Context(id);
      if (ctx) loaded.push(ctx);
      else console.warn(`[compare-t4] missing object id=${id}`);
    }
    if (loaded.length === 0) {
      console.error('No objects loaded — check DATABASE_URL and ids');
      process.exit(1);
    }
    contexts = loaded;
    catalog = loaded[0].catalog_name ?? catalog;
    schema = loaded[0].schema_name ?? schema;
    console.log(`Loaded ${loaded.length} object(s) from DB`);
  } else {
    contexts = SAMPLE_CLUSTER_CONTEXTS;
    console.log('Using built-in fixture cluster (curated_db.crew_ops, 2 tables)');
  }

  const heuristicCluster = toClusterProposal(contexts, catalog, schema);
  console.log('\n=== Heuristic cluster proposal ===');
  console.log(JSON.stringify(heuristicCluster, null, 2));

  for (const ctx of contexts) {
    const hTable = toTableProposal(ctx);
    console.log(`\n=== Heuristic table: ${ctx.full_path} ===`);
    console.log(JSON.stringify(hTable, null, 2));
  }

  if (!useLlm) {
    console.log('\n(LLM compare skipped — pass --llm or RUN_T4_LLM_COMPARE=1 to compare with legacy-style AI propose)');
    return;
  }

  const { llmClusterProposal, llmTableProposal } = await import('@/lib/context/t4/llm-cluster-proposal');
  console.log('\n=== LLM cluster proposal (legacy-style) ===');
  const llmCluster = await llmClusterProposal(contexts, catalog, schema);
  console.log(JSON.stringify(llmCluster, null, 2));
  const clusterDiffs = diffClusterProposals(heuristicCluster, llmCluster);
  console.log(`\nCluster diffs: ${clusterDiffs.length}`);
  for (const d of clusterDiffs) {
    console.log(`  [${d.area}] ${d.path}\n    heuristic: ${d.heuristic}\n    llm:       ${d.llm}`);
  }

  for (const ctx of contexts) {
    const hTable = toTableProposal(ctx);
    const lTable = await llmTableProposal(ctx);
    const diffs = diffTableProposals(hTable, lTable);
    console.log(`\n=== Table diffs: ${ctx.full_path} (${diffs.length} lines) ===`);
    for (const d of diffs) {
      console.log(`  [${d.area}] ${d.path}\n    heuristic: ${d.heuristic}\n    llm:       ${d.llm}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
