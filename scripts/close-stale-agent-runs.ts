/**
 * close-stale-agent-runs.ts — closes platform_agent_runs rows left as `running` or `pending`.
 *
 * No code in this repository writes platform_agent_runs; the rows found on 27 Oct 2026 (27 running,
 * 19 pending, all from 8–12 June 2026) were left by an older runtime and will never finish. They
 * make the agents look busy and hide that their cost was never recorded. This marks every such row
 * older than the cut-off as `error` with a clear message and a completed_at. Nothing is deleted.
 *
 * Agent runs are now recorded in agent_turn_log / agent_loop_log (src/lib/agents/run-catalog-agent.ts).
 *
 * Usage (reads by default; writes only with --apply):
 *   npx tsx --env-file=.env scripts/close-stale-agent-runs.ts                 # report only
 *   npx tsx --env-file=.env scripts/close-stale-agent-runs.ts --apply         # close rows older than 7 days
 *   npx tsx --env-file=.env scripts/close-stale-agent-runs.ts --apply --days=30
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice('--days='.length)) : 7;

async function main() {
  if (!Number.isFinite(days) || days < 1) throw new Error('--days must be a whole number of days, at least 1');
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const where = { status: { in: ['running', 'pending'] }, created_at: { lt: cutoff } };

  const stale = await prisma.platformAgentRun.groupBy({ by: ['status'], where, _count: true, _min: { created_at: true }, _max: { created_at: true } });
  const total = stale.reduce((n, s) => n + s._count, 0);
  console.log(`Runs left running or pending for more than ${days} days: ${total}`);
  for (const s of stale) console.log(`  ${s.status}: ${s._count} (created ${s._min.created_at?.toISOString()} … ${s._max.created_at?.toISOString()})`);

  if (!apply) {
    console.log('Report only. Re-run with --apply to mark them as error.');
    return;
  }
  const res = await prisma.platformAgentRun.updateMany({
    where,
    data: { status: 'error', error_message: `Closed by close-stale-agent-runs: no completion was recorded within ${days} days`, completed_at: new Date() },
  });
  console.log(`Marked ${res.count} runs as error.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
