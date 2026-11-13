import { readFileSync } from 'node:fs';
import path from 'node:path';

import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';

const pilot = JSON.parse(
  readFileSync(path.join(process.cwd(), 'eval/powerbi/cii-pilot-five-reports.json'), 'utf8'),
) as { report_ids: string[]; report_labels?: string[] };

async function main(): Promise<void> {
  const orgId = getDefaultOrg().id;
  const ids = pilot.report_ids;

  const jobs = await prisma.platformContextJob.findMany({
    where: { org_id: orgId, job_kind: { startsWith: 'pbi_' } },
    orderBy: { created_at: 'desc' },
    take: 25,
    select: { id: true, job_kind: true, status: true, created_at: true, error: true, stats: true },
  });

  const reports = await prisma.pbiReport.findMany({
    where: { org_id: orgId, pbi_report_id: { in: ids } },
    select: { pbi_report_id: true, name: true, props: true },
  });

  const defFetched = reports.filter(r => {
    const p = r.props as Record<string, unknown> | null;
    const d = p?.definition as Record<string, unknown> | undefined;
    return Boolean(d?.fetched_at);
  });

  const translations = await prisma.pbiTranslation.count({
    where: {
      org_id: orgId,
      measure: { model: { reports: { some: { pbi_report_id: { in: ids } } } } },
    },
  });

  const verified = await prisma.kbVerifiedQuery.count({
    where: { org_id: orgId, origin: 'powerbi' },
  });

  const byKind: Record<string, string> = {};
  for (const j of jobs) {
    if (!byKind[j.job_kind]) byKind[j.job_kind] = j.status;
  }

  console.log(
    JSON.stringify(
      {
        summary: {
          inventory: byKind.pbi_inventory,
          definitions: byKind.pbi_definitions,
          parse: byKind.pbi_parse,
          publish: byKind.pbi_publish,
          pilot_reports_with_definitions: `${defFetched.length}/${ids.length}`,
          verified_queries: verified,
        },
        pilot_report_ids: ids,
        latest_jobs: jobs.slice(0, 12),
        report_names: reports.map(r => ({ id: r.pbi_report_id, name: r.name, has_def: defFetched.some(d => d.pbi_report_id === r.pbi_report_id) })),
        translation_rows: translations,
      },
      null,
      2,
    ),
  );
}

main()
  .finally(() => prisma.$disconnect());
