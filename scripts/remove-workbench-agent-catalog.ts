/**
 * Hard-delete unwanted workbench commissioned agents from agent_catalog.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/remove-workbench-agent-catalog.ts
 *   npx tsx --env-file=.env scripts/remove-workbench-agent-catalog.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

/** Match slug prefix and/or exact catalog name. */
const TARGETS: { slugPrefix?: string; name?: string }[] = [
  { slugPrefix: 'databricks-jobs-agent', name: 'Databricks Jobs Agent' },
  { slugPrefix: 'invoice-harmonization-analyst', name: 'Invoice Harmonization Analyst' },
];

async function main() {
  const rows = await prisma.agent_catalog.findMany({
    where: {
      OR: TARGETS.flatMap((t) => {
        const parts: { slug?: { startsWith: string }; name?: string }[] = [];
        if (t.slugPrefix) parts.push({ slug: { startsWith: t.slugPrefix } });
        if (t.name) parts.push({ name: t.name });
        return parts;
      }),
    },
    select: { id: true, slug: true, name: true, status: true, updated_at: true },
    orderBy: { updated_at: 'desc' },
  });

  console.log(`Matching agent_catalog rows: ${rows.length}`);
  for (const row of rows) {
    console.log(`  ${row.id}  ${row.slug ?? '(no slug)'}  ${row.name}  ${row.status}  ${row.updated_at?.toISOString() ?? ''}`);
  }

  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const ids = rows.map((r) => r.id);
  const slugs = rows.map((r) => r.slug).filter((s): s is string => Boolean(s));

  const platformAgents = slugs.length
    ? await prisma.platformAgent.findMany({
        where: { slug: { in: slugs } },
        select: { id: true, slug: true, org_id: true },
      })
    : [];

  console.log(`Linked platform_agents rows: ${platformAgents.length}`);
  for (const pa of platformAgents) console.log(`  ${pa.id}  ${pa.slug}  org=${pa.org_id}`);

  const sessions = await prisma.workbench_sessions.findMany({
    where: { saved_agent_id: { in: ids } },
    select: { id: true, title: true, saved_agent_id: true },
  });
  console.log(`Workbench sessions pointing at these catalog ids: ${sessions.length}`);

  if (!apply) {
    console.log('Report only. Re-run with --apply to delete catalog rows and clear links.');
    return;
  }

  if (sessions.length) {
    const cleared = await prisma.workbench_sessions.updateMany({
      where: { saved_agent_id: { in: ids } },
      data: { saved_agent_id: null },
    });
    console.log(`Cleared saved_agent_id on ${cleared.count} workbench session(s).`);
  }

  if (platformAgents.length) {
    const deletedRuns = await prisma.platformAgentRun.deleteMany({
      where: { agent_id: { in: platformAgents.map((p) => p.id) } },
    });
    console.log(`Deleted ${deletedRuns.count} platform_agent_run row(s).`);
    const deletedPlatform = await prisma.platformAgent.deleteMany({
      where: { id: { in: platformAgents.map((p) => p.id) } },
    });
    console.log(`Deleted ${deletedPlatform.count} platform_agents row(s).`);
  }

  const deleted = await prisma.agent_catalog.deleteMany({ where: { id: { in: ids } } });
  console.log(`Deleted ${deleted.count} agent_catalog row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
