import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { collectReportMeasureRefs } from '@/lib/powerbi/report-measure-refs';
import { denyUnlessSection } from '@/lib/sections/server';
import { summarizeReportLineageCoverage } from '@/lib/powerbi/report-lineage-coverage';
import { PBI_LINEAGE_KINDS } from '@/lib/powerbi/launch-scope';
import { loadSnapshotSummaries } from '@/lib/powerbi/report-lineage-snapshot-load';
import { isLineageQuestion, matchesQuestion, summarizeEstate } from '@/lib/powerbi/report-lineage-snapshot-summary';
import {
  pbiAllReportsJobBlocksUi,
  reapAbandonedPbiAllReportsJobs,
} from '@/lib/powerbi/reap-stale-lineage-jobs';
import { inferAllReportsLineageResume, resumeStageLabel } from '@/lib/powerbi/resume-all-reports-lineage';

export const dynamic = 'force-dynamic';

/** Search harvested reports for the Report lineage explorer. */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    if (req.nextUrl.searchParams.get('coverage') === 'true') {
      await reapAbandonedPbiAllReportsJobs();
      const [reports, models, latestJob, snapshots] = await Promise.all([
        prisma.pbiReport.findMany({
          where: { org_id: orgId, lifecycle: 'active' },
          select: { model_id: true, props: true },
        }),
        prisma.pbiModel.findMany({
          where: { org_id: orgId, lifecycle: 'active', reports: { some: { lifecycle: 'active' } } },
          select: {
            id: true, props: true,
            tables: { where: { lifecycle: 'active' }, select: {
              partition_kind: true, sourceBinding: { select: { uc_full_path: true } },
            } },
          },
        }),
        prisma.platformContextJob.findFirst({
          where: { org_id: orgId, job_kind: { in: [...PBI_LINEAGE_KINDS] }, scope: { path: ['all_reports'], equals: true } },
          orderBy: { created_at: 'desc' },
          select: { id: true, job_kind: true, status: true, updated_at: true, scope: true },
        }),
        prisma.pbiReportLineage.groupBy({
          by: ['status'],
          where: { org_id: orgId, report: { lifecycle: 'active' } },
          _count: { _all: true },
        }),
      ]);
      const estate = summarizeEstate((await loadSnapshotSummaries(orgId)).values());
      const coverage = summarizeReportLineageCoverage(reports, models);
      const resume = inferAllReportsLineageResume(coverage);
      return NextResponse.json({
        coverage,
        latest_job: latestJob,
        latest_job_blocks_ui: pbiAllReportsJobBlocksUi(latestJob),
        resume_from: resumeStageLabel(resume.startKind),
        estate,
        snapshots: {
          saved: snapshots.reduce((total, row) => total + row._count._all, 0),
          statuses: Object.fromEntries(snapshots.map((row) => [row.status, row._count._all])),
        },
      });
    }
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const modelId = req.nextUrl.searchParams.get('model_id')?.trim();
    const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 100) || 100));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset') ?? 0) || 0);
    const filter = req.nextUrl.searchParams.get('filter');
    // Saved questions (reads files, unmapped warehouse tables, …) filter on stored snapshot facts.
    const questionIds = isLineageQuestion(filter)
      ? [...(await loadSnapshotSummaries(orgId)).entries()].filter(([, summary]) => matchesQuestion(summary, filter)).map(([id]) => id)
      : null;

    const where = {
      org_id: orgId,
      lifecycle: 'active' as const,
      ...(modelId ? { model_id: modelId } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(questionIds ? { id: { in: questionIds } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.pbiReport.count({ where }),
      prisma.pbiReport.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip: offset,
        take: limit,
      select: {
        id: true,
        name: true,
        pbi_report_id: true,
        report_format: true,
        props: true,
        model: { select: { id: true, name: true } },
      },
      }),
    ]);

    // Snapshot facts are optional per row: the list still works before the snapshot table exists.
    const summaries = await loadSnapshotSummaries(orgId, rows.map((r) => r.id)).catch((err: unknown) => {
      console.warn('[api/powerbi/reports GET] snapshot facts unavailable', err instanceof Error ? err.message : err);
      return new Map<string, never>();
    });
    return NextResponse.json({
      total,
      offset,
      limit,
      filter: questionIds ? filter : null,
      reports: rows.map((r) => {
        const refs = collectReportMeasureRefs(r.props);
        return {
          id: r.id,
          name: r.name,
          pbi_report_id: r.pbi_report_id,
          report_format: r.report_format,
          model_id: r.model?.id ?? null,
          model_name: r.model?.name ?? null,
          measure_count: refs.measures.length,
          page_count: refs.page_count,
          has_definition_on_disk: refs.has_definition_on_disk,
          snapshot: summaries.get(r.id) ?? null,
        };
      }),
    });
  } catch (err) {
    console.error('[api/powerbi/reports GET]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}