import { describe, expect, it } from 'vitest';
import { diffClusterProposals, diffTableProposals } from './compare-proposals';
import { toClusterProposal, toTableProposal } from './heuristic-proposal';
import {
  SAMPLE_CATALOG,
  SAMPLE_CLUSTER_CONTEXTS,
  SAMPLE_SCHEMA,
} from './__fixtures__/sample-cluster';

describe('T4 heuristic samples (fixture cluster)', () => {
  it('produces entities and FK-based joins for synthetic crew_ops schema', () => {
    const cluster = toClusterProposal(SAMPLE_CLUSTER_CONTEXTS, SAMPLE_CATALOG, SAMPLE_SCHEMA);
    expect(cluster.entities).toHaveLength(2);
    expect(cluster.entities[0].entity_label).toMatch(/Seafarer Contract/i);
    expect(cluster.joins.length).toBeGreaterThanOrEqual(1);
    expect(cluster.joins[0].to_path).toContain('seafarer');
  });

  it('classifies contract table columns into dims and measures', () => {
    const table = toTableProposal(SAMPLE_CLUSTER_CONTEXTS[0]);
    const measureCols = table.measures.map(m => m.column_name);
    const dimCols = table.dimensions.map(d => d.column_name);
    expect(measureCols).toContain('base_wage_usd');
    expect(dimCols).toContain('status');
    expect(dimCols).toContain('start_date');
  });
});

describe('T4 heuristic vs LLM (optional live compare)', () => {
  const runLive = process.env.RUN_T4_LLM_COMPARE === '1';

  it.skipIf(!runLive)('cluster: report diffs between heuristic and LLM on fixtures', async () => {
    const { llmClusterProposal } = await import('./llm-cluster-proposal');
    const heuristic = toClusterProposal(SAMPLE_CLUSTER_CONTEXTS, SAMPLE_CATALOG, SAMPLE_SCHEMA);
    const llm = await llmClusterProposal(SAMPLE_CLUSTER_CONTEXTS, SAMPLE_CATALOG, SAMPLE_SCHEMA);
    const diffs = diffClusterProposals(heuristic, llm);

    // eslint-disable-next-line no-console
    console.log('\n--- T4 cluster compare (fixture) ---');
    // eslint-disable-next-line no-console
    console.log('Heuristic entities:', JSON.stringify(heuristic.entities, null, 2));
    // eslint-disable-next-line no-console
    console.log('LLM entities:', JSON.stringify(llm.entities, null, 2));
    // eslint-disable-next-line no-console
    console.log('Diff lines:', diffs.length, diffs);

    expect(heuristic.entities.length).toBeGreaterThan(0);
    expect(llm.entities.length).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(!runLive)('table: report diffs on seafarer_contract', async () => {
    const { llmTableProposal } = await import('./llm-cluster-proposal');
    const ctx = SAMPLE_CLUSTER_CONTEXTS[0];
    const heuristic = toTableProposal(ctx);
    const llm = await llmTableProposal(ctx);
    const diffs = diffTableProposals(heuristic, llm);

    // eslint-disable-next-line no-console
    console.log('\n--- T4 table compare (seafarer_contract) ---');
    // eslint-disable-next-line no-console
    console.log('Heuristic:', JSON.stringify(heuristic, null, 2));
    // eslint-disable-next-line no-console
    console.log('LLM:', JSON.stringify(llm, null, 2));
    // eslint-disable-next-line no-console
    console.log('Diff lines:', diffs.length, diffs);

    expect(diffs).toBeDefined();
  }, 120_000);
});
