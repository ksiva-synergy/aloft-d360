import { randomUUID } from 'node:crypto';
import prisma from '@/lib/db';
import { enqueue, type JobKind } from '@/lib/context/queue';
import { failJobsAfterLaunchError } from '@/lib/context/orphan-jobs';
import { launchHarvesterTask } from '@/lib/context/launch-harvester';
import { getOrgId } from '@/lib/databricks/connections';
import { filterSourcesForJobKind, resolveLaunchSources } from '@/lib/context/resolve-launch-source';
import { findScopedLaunchConflict } from '@/lib/context/enqueue-and-launch';
import { mergeJobScope, PBI_LINEAGE_KINDS, pbiJobScopeFromLaunchBody } from '@/lib/powerbi/launch-scope';
import { reapAbandonedPbiAllReportsJobs } from '@/lib/powerbi/reap-stale-lineage-jobs';
import { inferAllReportsLineageResume, resumeStageLabel } from '@/lib/powerbi/resume-all-reports-lineage';
import { summarizeReportLineageCoverage } from '@/lib/powerbi/report-lineage-coverage';

export type LaunchAllReportsLineageResult =
  | {
    ok: true;
    jobId: string;
    taskId: string | null;
    startKind: JobKind;
    resumeFrom: string;
    reaped: { runningReaped: number; pipelineReaped: number };
  }
  | { ok: false; error: string; reaped?: { runningReaped: number; pipelineReaped: number } };

/** Clear stale all-reports rows, then enqueue inventory with the parse/catalog chain. */
export async function launchAllReportsLineage(opts: {
  uiSurface?: string;
  triggeredByUserId?: string | null;
  reapFirst?: boolean;
} = {}): Promise<LaunchAllReportsLineageResult> {
  const reaped = opts.reapFirst !== false ? await reapAbandonedPbiAllReportsJobs() : { runningReaped: 0, pipelineReaped: 0 };

  const orgId = await getOrgId();
  try {
    await prisma.pbiReportLineage.count({ where: { org_id: orgId } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return { ok: false, error: 'LINEAGE_STORAGE_NOT_READY', reaped };
    }
    throw error;
  }

  const sources = filterSourcesForJobKind(
    await resolveLaunchSources(orgId, undefined),
    'pbi_inventory',
  ).slice(0, 1);
  if (sources.length === 0) {
    return { ok: false, error: 'NO_POWERBI_SOURCE', reaped };
  }

  const kinds = [...PBI_LINEAGE_KINDS] as JobKind[];
  const conflict = await findScopedLaunchConflict(sources[0].id, kinds, []);
  if (conflict) {
    return {
      ok: false,
      error: `ACTIVE_JOB_OVERLAP: ${conflict.job_kind} (${conflict.id})`,
      reaped,
    };
  }

  const [reports, models] = await Promise.all([
    prisma.pbiReport.findMany({
      where: { org_id: orgId, lifecycle: 'active' },
      select: { model_id: true, props: true },
    }),
    prisma.pbiModel.findMany({
      where: { org_id: orgId, lifecycle: 'active', reports: { some: { lifecycle: 'active' } } },
      select: {
        id: true,
        props: true,
        tables: {
          where: { lifecycle: 'active' },
          select: { partition_kind: true, sourceBinding: { select: { uc_full_path: true } } },
        },
      },
    }),
  ]);
  const coverage = summarizeReportLineageCoverage(reports, models);
  const { startKind, chain } = inferAllReportsLineageResume(coverage);

  const pbiScope = pbiJobScopeFromLaunchBody({ pbiAllReports: true });
  const pipelineRunId = randomUUID();
  let scope: Record<string, unknown> = {
    chain,
    ui_surface: opts.uiSurface ?? 'estate.powerbi.report-lineage.all',
    pipeline_run_id: pipelineRunId,
    resume_from: resumeStageLabel(startKind),
    ...pbiScope,
  };
  scope = mergeJobScope(scope, pbiScope);

  const row = await enqueue(
    startKind,
    sources[0].id,
    scope,
    'on_demand',
    orgId,
    opts.triggeredByUserId ?? null,
  );

  const { taskId, error } = await launchHarvesterTask(['--kind', startKind]);
  if (!taskId) {
    await failJobsAfterLaunchError([row.id], error ?? 'Harvester launch failed');
    return { ok: false, error: error ?? 'Harvester launch failed', reaped };
  }

  await prisma.$executeRaw`
    UPDATE platform_context_jobs
    SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
    WHERE id = ${row.id}::uuid
  `;

  return {
    ok: true,
    jobId: row.id,
    taskId,
    startKind,
    resumeFrom: resumeStageLabel(startKind),
    reaped,
  };
}