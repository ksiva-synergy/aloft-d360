/**
 * Backfill platform_spend_events from historical agent_cost_log and harvest jobs.
 *
 * Usage:
 *   npx tsx scripts/spend/backfill-spend-ledger.ts
 *   npx tsx scripts/spend/backfill-spend-ledger.ts --dry-run
 *   npx tsx scripts/spend/backfill-spend-ledger.ts --jobs-only
 *   npx tsx scripts/spend/backfill-spend-ledger.ts --agent-cost-only
 */
import prisma from '../../src/lib/db';
import { recordHarvestJobSpend, recordSpendEvent } from '../../src/lib/spend/record-spend-event';

function resolveOrgId(): string {
  const id = process.env.DEFAULT_ORG_ID;
  if (!id) throw new Error('DEFAULT_ORG_ID is not set in .env');
  return id;
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const jobsOnly = args.has('--jobs-only');
const agentOnly = args.has('--agent-cost-only');

async function backfillAgentCost(orgId: string): Promise<number> {
  const rows = await prisma.agent_cost_log.findMany({
    orderBy: { created_at: 'asc' },
    take: 5000,
    select: {
      id: true,
      agent_name: true,
      run_id: true,
      model: true,
      input_tokens: true,
      output_tokens: true,
      cost_usd: true,
      tool_calls: true,
      duration_ms: true,
      status: true,
      created_at: true,
    },
  });

  const sessionIds = [...new Set(rows.map((r) => r.run_id).filter(Boolean))] as string[];
  const sessions =
    sessionIds.length > 0
      ? await prisma.workbench_sessions.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, user_id: true, surface: true },
        })
      : [];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  let written = 0;
  for (const row of rows) {
    const usd = Number(row.cost_usd);
    if (!usd || usd <= 0) continue;
    const sess = row.run_id ? sessionById.get(row.run_id) : undefined;
    const surface =
      row.agent_name === 'InspectorChat'
        ? 'inspector'
        : row.agent_name.startsWith('catalog:')
          ? 'agent_use'
          : sess?.surface ?? 'interactive';
    const turnId = `backfill-cost-${row.id}`;
    if (dryRun) {
      written++;
      continue;
    }
    await recordSpendEvent({
      orgId,
      bucket: 'interactive',
      surface,
      action: 'turn',
      usd,
      userId: sess?.user_id ?? null,
      model: row.model ?? 'claude-sonnet-4',
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      sessionId: row.run_id,
      turnId,
      agentSlug: row.agent_name.startsWith('catalog:') ? row.agent_name.slice('catalog:'.length) : undefined,
      status: row.status ?? 'success',
      referenceType: 'agent_cost_log',
      referenceId: row.id,
      occurredAt: row.created_at ?? undefined,
      meta: { backfill: true, agent_name: row.agent_name },
    });
    written++;
  }
  return written;
}

async function backfillHarvestJobs(orgId: string): Promise<number> {
  const jobs = await prisma.platformContextJob.findMany({
    where: {
      org_id: orgId,
      status: { in: ['succeeded', 'partial', 'failed'] },
    },
    orderBy: { finished_at: 'desc' },
    take: 2000,
    select: { id: true, stats: true },
  });

  let written = 0;
  for (const job of jobs) {
    const stats = job.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue;
    const cost = (stats as Record<string, unknown>).cost_usd;
    if (typeof cost !== 'number' || cost <= 0) continue;
    if (dryRun) {
      written++;
      continue;
    }
    await recordHarvestJobSpend(job.id);
    written++;
  }
  return written;
}

async function main() {
  const orgId = resolveOrgId();
  console.log(`Org: ${orgId}${dryRun ? ' (dry-run)' : ''}`);

  if (!jobsOnly) {
    const n = await backfillAgentCost(orgId);
    console.log(`Agent cost log rows processed: ${n}`);
  }
  if (!agentOnly) {
    const n = await backfillHarvestJobs(orgId);
    console.log(`Harvest jobs processed: ${n}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
