import prisma from '@/lib/db';

const PATH = 'open_analytics_zone.ash_scratchpad.global_employee_master';

async function main() {
  const ctx = await prisma.$queryRawUnsafe<
    {
      full_path: string;
      lifecycle: string;
      last_t0_at: Date | null;
      last_t1_at: Date | null;
      last_t2_at: Date | null;
      last_t3_at: Date | null;
    }[]
  >(
    `SELECT full_path, lifecycle, last_t0_at, last_t1_at, last_t2_at, last_t3_at
     FROM platform_context_objects WHERE full_path = $1`,
    PATH,
  );
  console.log('Scanned object:', ctx[0] ?? '(missing)');

  const activeJobs = await prisma.platformContextJob.findMany({
    where: {
      status: { in: ['queued', 'running', 'orchestrating'] },
    },
    orderBy: { created_at: 'desc' },
    take: 10,
    select: { id: true, job_kind: true, status: true, scope: true, started_at: true, created_at: true },
  });
  console.log('\nActive jobs:', activeJobs.map(j => ({
    id: j.id.slice(0, 8),
    kind: j.job_kind,
    status: j.status,
    scope: j.scope,
  })));

  const recent = await prisma.platformContextJob.findMany({
    where: {
      job_kind: { in: ['t1_profile', 't2_semantic', 'embed'] },
      started_at: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    },
    orderBy: { started_at: 'desc' },
    take: 8,
    select: { id: true, job_kind: true, status: true, scope: true, stats: true, started_at: true },
  });
  console.log('\nRecent T1/T2/embed (6h):');
  for (const j of recent) {
    console.log(j.started_at?.toISOString(), j.job_kind, j.status, JSON.stringify(j.scope), JSON.stringify(j.stats));
  }
}

main().finally(() => prisma.$disconnect());
