'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/lib/navigation/link';
import { ChevronRight, Loader2, Network, Play, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CATALOG_BTN, CATALOG_SELECT, formatFull, formatRelative } from '@/components/estate/catalog-ui';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';
import type { ReportLineageCoverage } from '@/lib/powerbi/report-lineage-coverage';
import { ORIGIN_CLASS_LABEL, ORIGIN_CLASS_ORDER } from '@/lib/powerbi/report-lineage-graph';
import { LINEAGE_QUESTIONS, type LineageQuestionId, type SnapshotSummary } from '@/lib/powerbi/report-lineage-snapshot-summary';
import type { OriginClass } from '@/lib/powerbi/source-origin';
import { ClassMixBar, ClassSwatch } from '@/components/estate/report-lineage/LaneCanvas';
import { STATUS_COLOR, StatusPill, asLineageStatus, type LineageStatus } from '@/components/estate/report-lineage/lineage-bits';

type ReportRow = {
  id: string;
  name: string;
  model_name: string | null;
  measure_count: number;
  page_count: number | null;
  snapshot?: SnapshotSummary | null;
};

type Estate = { classes: Record<OriginClass, number>; questions: Record<LineageQuestionId, number> };

const STATUS_ORDER: LineageStatus[] = ['ready', 'partial', 'blocked', 'failed', 'none'];

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function Stage({ label, value, of, detail, drop }: { label: string; value: number; of: number; detail?: string; drop?: number }) {
  return (
    <div className="min-w-0 border-b border-r border-[var(--estate-border)] px-3.5 py-3 md:border-b-0">
      <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">{label}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
        <span className="text-kpi-md font-semibold tabular-nums text-[var(--estate-ink)]">{`${value} / ${of}`}</span>
        {drop ? <span className="rounded-[5px] bg-[var(--warn-bg)] px-1.5 text-size-caption font-medium text-[var(--warn)]" title="Dropped at this stage">−{drop}</span> : null}
      </p>
      {detail && <p className="truncate text-size-caption text-[var(--estate-text-muted)]">{detail}</p>}
      <div className="mt-2 h-1 overflow-hidden rounded-sm bg-[var(--estate-active-bg)]">
        <i className="block h-full bg-[var(--brand-a)]" style={{ width: `${of ? (value / of) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function UcMeter({ bound, candidates }: { bound: number; candidates: number }) {
  if (!candidates) return <span className="text-[var(--estate-text-dim)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-caption tabular-nums" title={`${bound} of ${candidates} warehouse tables mapped to Unity Catalog`}>
      <span className="h-[5px] w-14 overflow-hidden rounded-full bg-[var(--estate-active-bg)]">
        <i className="block h-full bg-[var(--lineage-warehouse)]" style={{ width: `${(bound / candidates) * 100}%` }} />
      </span>
      {bound}/{candidates}
    </span>
  );
}

export default function PowerBiReportLineageHubPage() {
  const canRun = useCanRunEstatePipeline();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [launching, setLaunching] = useState(false);
  const [coverage, setCoverage] = useState<ReportLineageCoverage | null>(null);
  const [snapshots, setSnapshots] = useState<{ saved: number; statuses: Record<string, number> } | null>(null);
  const [estate, setEstate] = useState<Estate | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [latestJob, setLatestJob] = useState<{ id: string; job_kind: string; status: string } | null>(null);
  const [latestJobBlocksUi, setLatestJobBlocksUi] = useState(false);
  const [resumeFrom, setResumeFrom] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [question, setQuestion] = useState<LineageQuestionId | null>(null);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pageSize = 100;

  const fetchCoverage = useCallback(() => fetch('/api/agent-lab/powerbi/reports?coverage=true')
    .then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCoverage(json.coverage);
      setSnapshots(json.snapshots);
      setEstate(json.estate ?? null);
      setLatestJob(json.latest_job);
      setLatestJobBlocksUi(json.latest_job_blocks_ui === true);
      setResumeFrom(typeof json.resume_from === 'string' ? json.resume_from : null);
      setCoverageError(null);
    })
    .catch((error: unknown) => {
      setCoverageError(error instanceof Error ? error.message : String(error));
    })
    .finally(() => setRefreshing(false)), []);

  useEffect(() => {
    void fetchCoverage();
    const timer = window.setInterval(() => { void fetchCoverage(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [fetchCoverage]);

  const runAllReports = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pbiAllReports: true, uiSurface: 'estate.powerbi.report-lineage.all' }),
      });
      const json = await res.json();
      if (!res.ok || json.failures?.length) {
        throw new Error(json.message ?? json.error ?? json.failures?.[0]?.reason ?? 'Could not start lineage pipeline');
      }
      toast.success(
        json.resume_from
          ? `Lineage resumed from ${json.resume_from} (already-finished work is skipped)`
          : 'All-reports lineage pipeline queued',
      );
      dialogRef.current?.close();
      void fetchCoverage();
    } catch (error) {
      toast.error('Could not start lineage pipeline', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setLaunching(false);
    }
  };

  const active = latestJobBlocksUi;

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    (nextOffset: number, append: boolean) => {
      const params = new URLSearchParams();
      if (debounced) params.set('q', debounced);
      if (question) params.set('filter', question);
      params.set('limit', String(pageSize));
      params.set('offset', String(nextOffset));
      return fetch(`/api/agent-lab/powerbi/reports?${params}`).then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        const data = json as { reports: ReportRow[]; total: number; offset: number };
        setErr(null);
        setTotal(data.total);
        setOffset(nextOffset + data.reports.length);
        setRows((prev) => (append ? [...(prev ?? []), ...data.reports] : data.reports));
      }).catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e));
      }).finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
    },
    [debounced, question, pageSize],
  );

  useEffect(() => {
    void fetchPage(0, false);
  }, [fetchPage]);

  const statusCounts: Record<LineageStatus, number> | null = coverage && snapshots ? {
    ready: snapshots.statuses.ready ?? 0,
    partial: snapshots.statuses.partial ?? 0,
    blocked: snapshots.statuses.blocked ?? 0,
    failed: snapshots.statuses.failed ?? 0,
    none: Math.max(0, coverage.reports - snapshots.saved),
  } : null;
  const classTotal = estate ? ORIGIN_CLASS_ORDER.reduce((sum, cls) => sum + (estate.classes[cls] ?? 0), 0) : 0;
  const questionLabel = LINEAGE_QUESTIONS.find((item) => item.id === question)?.label;

  return (
    <div className="mx-auto max-w-[1400px] space-y-3.5 px-4 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title-section text-[var(--estate-ink)]">Report lineage</h1>
          <p className="mt-0.5 max-w-[68ch] text-caption text-[var(--estate-text-muted)]">
            Where every report&apos;s numbers come from: its measures, the model tables behind them, and the original files, databases and warehouse tables.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/agent-lab/estate/powerbi/source-impact" className={cn(CATALOG_BTN, 'inline-flex min-h-9 items-center gap-1.5')}>
            <Network className="size-3.5" aria-hidden /> Source impact
          </Link>
          <Link href="/agent-lab/estate/jobs?tab=active" className={cn(CATALOG_BTN, 'inline-flex min-h-9 items-center')}>Jobs</Link>
          <button type="button" title="Refresh lineage coverage" aria-label="Refresh lineage coverage" disabled={refreshing}
            className={cn(CATALOG_BTN, 'inline-flex size-9 items-center justify-center p-0')}
            onClick={() => { setRefreshing(true); setLoading(true); void fetchCoverage(); void fetchPage(0, false); }}>
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
          </button>
          {canRun && (
            <button type="button" className={cn(CATALOG_BTN, 'inline-flex min-h-9 max-w-full items-center gap-1.5 whitespace-normal')}
              disabled={launching || active} title={active ? 'An all-reports lineage run is in progress (see status below)' : undefined}
              onClick={() => dialogRef.current?.showModal()}>
              {launching ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : <Play className="size-3.5 shrink-0" aria-hidden />}
              Continue lineage for all reports
            </button>
          )}
        </div>
      </header>

      <section aria-label="Lineage coverage" className="overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)]">
        {coverage && (
          <div className="grid grid-cols-2 md:grid-cols-5">
            <Stage label="Definitions recorded" value={coverage.definitions} of={coverage.reports} detail={`${plural(coverage.reports, 'active report')}`} />
            <Stage label="Reports parsed" value={coverage.parsed_reports} of={coverage.reports} drop={coverage.definitions - coverage.parsed_reports} />
            <Stage label="Models parsed" value={coverage.parsed_models} of={coverage.models} detail={`Unresolved UC paths: ${coverage.unresolved_tables} / ${coverage.warehouse_tables}`} />
            <Stage label="Snapshots stored" value={snapshots?.saved ?? 0} of={coverage.reports} drop={snapshots ? Math.max(0, coverage.parsed_reports - snapshots.saved) : undefined} />
            <div className="col-span-2 min-w-0 px-3.5 py-3 md:col-span-1">
              <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">Lineage status</p>
              {statusCounts && (
                <>
                  <p className="mt-0.5 text-kpi-md font-semibold tabular-nums text-[var(--estate-ink)]">
                    {statusCounts.ready} <span className="text-size-caption font-medium text-[var(--estate-text-muted)]">ready of {coverage.reports}</span>
                  </p>
                  <div className="mt-2 flex h-1 gap-px overflow-hidden rounded-sm bg-[var(--estate-active-bg)]">
                    {STATUS_ORDER.map((status) => statusCounts[status] > 0 && (
                      <i key={status} className="block h-full" title={`${status}: ${statusCounts[status]}`}
                        style={{ width: `${(statusCounts[status] / Math.max(1, coverage.reports)) * 100}%`, background: STATUS_COLOR[status] }} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--estate-border)] px-3.5 py-2 text-caption text-[var(--estate-text-muted)] empty:hidden">
          {snapshots && <span>Stored snapshots: {snapshots.saved} / {coverage?.reports ?? 0}</span>}
          {coverage && coverage.missing_models > 0 && <span>{plural(coverage.missing_models, 'report')} without an active model</span>}
          {coverage && coverage.non_warehouse_tables > 0 && <span>{coverage.non_warehouse_tables} non-warehouse tables</span>}
          {latestJob && (
            <span role="status">
              <Link href={`/agent-lab/estate/jobs?highlight=${encodeURIComponent(latestJob.id)}`} className="underline underline-offset-2">
                {latestJob.job_kind.replace('pbi_', '').replaceAll('_', ' ')}: {latestJob.status}
              </Link>
            </span>
          )}
          {coverageError && <span role="alert">Coverage unavailable: {coverageError}</span>}
        </div>
      </section>

      {canRun && <dialog ref={dialogRef} aria-labelledby="all-reports-lineage-title"
        className="m-auto w-[calc(100%_-_2rem)] max-w-[30rem] rounded-md border border-[var(--estate-border)] bg-[var(--estate-surface)] p-4 text-[var(--estate-ink)] backdrop:bg-black/40">
        <div className="flex items-start justify-between gap-3">
          <h2 id="all-reports-lineage-title" className="text-ui font-semibold">Continue lineage for all reports</h2>
          <button type="button" title="Close" aria-label="Close" disabled={launching} onClick={() => dialogRef.current?.close()}
            className={cn(CATALOG_BTN, 'inline-flex size-8 shrink-0 items-center justify-center p-0')}><X className="size-4" aria-hidden /></button>
        </div>
        <dl className="mt-3 space-y-3 text-caption">
          <div><dt className="text-[var(--estate-text-muted)]">Scope</dt><dd>All accessible workspaces, reports and semantic models</dd></div>
          <div><dt className="text-[var(--estate-text-muted)]">Resume from</dt><dd>{resumeFrom ? `Next stage: ${resumeFrom} (earlier stages and downloads are reused)` : 'Checking coverage…'}</dd></div>
          <div><dt className="text-[var(--estate-text-muted)]">Stages</dt><dd>Inventory → Definitions → Parse → Catalog link</dd></div>
          <div><dt className="text-[var(--estate-text-muted)]">Report/model limit</dt><dd>Entire estate</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={launching} className={CATALOG_BTN} onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="button" disabled={launching} className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')} onClick={() => void runAllReports()}>
            {launching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {launching ? 'Starting…' : 'Continue'}
          </button>
        </div>
      </dialog>}

      <div className="grid items-start gap-3.5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="space-y-5 rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3.5">
          <div className="space-y-1">
            <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">Common questions</p>
            {LINEAGE_QUESTIONS.map((item) => (
              <button key={item.id} type="button" aria-pressed={question === item.id}
                onClick={() => { setLoading(true); setQuestion((current) => (current === item.id ? null : item.id)); }}
                className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-caption',
                  question === item.id ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)] text-[var(--estate-ink)]' : 'border-transparent text-[var(--estate-text-secondary)] hover:bg-[var(--estate-hover)]')}>
                <span className="min-w-0 flex-1">{item.label}</span>
                {estate && <span className="tabular-nums text-[var(--estate-text-muted)]">{estate.questions[item.id] ?? 0}</span>}
              </button>
            ))}
          </div>
          {estate && classTotal > 0 && (
            <div className="space-y-1.5">
              <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">Where data comes from · tables</p>
              <ClassMixBar mix={ORIGIN_CLASS_ORDER.map((cls) => ({ cls, count: estate.classes[cls] ?? 0 }))} className="h-2" />
              {ORIGIN_CLASS_ORDER.map((cls) => (
                <p key={cls} className="flex items-center gap-2 px-0.5 text-caption text-[var(--estate-text-secondary)]">
                  <ClassSwatch cls={cls} />{ORIGIN_CLASS_LABEL[cls]}
                  <span className="ml-auto tabular-nums text-[var(--estate-text-muted)]">{estate.classes[cls] ?? 0}</span>
                </p>
              ))}
            </div>
          )}
          {statusCounts && (
            <div className="space-y-1.5">
              <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">Status</p>
              {STATUS_ORDER.map((status) => (
                <p key={status} className="flex items-center gap-2 px-0.5 text-caption">
                  <StatusPill status={status} /><span className="ml-auto tabular-nums text-[var(--estate-text-muted)]">{statusCounts[status]}</span>
                </p>
              ))}
            </div>
          )}
        </aside>

        <section aria-label="Reports" className="min-w-0 overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)]">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--estate-border)] px-3 py-2.5">
            <div className="relative min-w-0 flex-[1_1_240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => { setLoading(e.target.value.trim() !== debounced); setQ(e.target.value); }}
                placeholder="Search report name…"
                className={cn(CATALOG_SELECT, 'h-9 w-full pl-9')}
                aria-label="Search reports"
              />
            </div>
            {!loading && total > 0 && (
              <span className="text-caption text-[var(--estate-text-muted)]">
                Showing {rows?.length ?? 0} of {total} active reports{debounced ? ` matching “${debounced}”` : ''}.
              </span>
            )}
            {question && (
              <button type="button" className={cn(CATALOG_BTN, 'inline-flex h-7 items-center gap-1 text-caption')} onClick={() => { setLoading(true); setQuestion(null); }}>
                {questionLabel} <X className="size-3" aria-hidden />
              </button>
            )}
          </div>

          {loading && (
            <p className="flex items-center gap-1.5 px-4 py-3 text-caption text-[var(--estate-text-muted)]">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Loading reports…
            </p>
          )}
          {err && <p className="px-4 py-3 text-caption text-[var(--estate-text-muted)]">{err}</p>}
          {!loading && rows && rows.length === 0 && (
            <p className="px-4 py-8 text-center text-ui-regular text-[var(--estate-text-muted)]">
              {question ? 'No reports match this question. Clear the filter or run lineage again.' : 'No reports match. Run Power BI inventory first.'}
            </p>
          )}

          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-caption">
                <thead className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)] text-size-caption text-[var(--estate-text-muted)]">
                  <tr>
                    {['Report', 'Status', 'Measures', 'Source mix', 'Unity Catalog', 'Snapshot', ''].map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--estate-border)]">
                  {rows.map((r) => {
                    const snap = r.snapshot ?? null;
                    const mix = snap ? ORIGIN_CLASS_ORDER.map((cls) => ({ cls, count: snap.mix[cls] ?? 0 })).filter((e) => e.count > 0) : [];
                    const href = `/agent-lab/estate/powerbi/reports/${encodeURIComponent(r.id)}/lineage`;
                    return (
                      <tr key={r.id} className="group hover:bg-[var(--brand-a-soft)]">
                        <td className="max-w-[340px] px-3 py-2.5">
                          <Link href={href} className="block truncate text-ui text-[var(--estate-ink)] hover:underline" title={r.name}>{r.name}</Link>
                          <p className="truncate text-size-caption text-[var(--estate-text-muted)]">{r.model_name ?? 'Unknown model'}</p>
                        </td>
                        <td className="px-3 py-2.5"><StatusPill status={asLineageStatus(snap?.status)} /></td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                          {r.measure_count}{r.page_count != null && <span className="text-[var(--estate-text-dim)]"> · {r.page_count} pg</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {snap && snap.tables > 0 ? (
                            <div className="w-[120px]" title={mix.map((e) => `${ORIGIN_CLASS_LABEL[e.cls]}: ${e.count}`).join('\n')}>
                              <ClassMixBar mix={mix} className="h-2" />
                              <p className="mt-0.5 text-size-caption tabular-nums text-[var(--estate-text-dim)]">{plural(snap.tables, 'table')}</p>
                            </div>
                          ) : <span className="text-[var(--estate-text-dim)]">—</span>}
                        </td>
                        <td className="px-3 py-2.5">{snap ? <UcMeter bound={snap.uc_bound} candidates={snap.uc_candidates} /> : <span className="text-[var(--estate-text-dim)]">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[var(--estate-text-muted)]" title={snap ? formatFull(snap.generated_at) : undefined}>
                          {snap ? formatRelative(snap.generated_at) : 'not run'}
                          {snap && snap.warning_count > 0 && <span className="ml-1.5 rounded-[5px] bg-[var(--warn-bg)] px-1.5 text-size-caption text-[var(--warn)]">{plural(snap.warning_count, 'note')}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link href={href} className={cn(CATALOG_BTN, 'inline-flex items-center gap-1 whitespace-nowrap')}>
                            View lineage <ChevronRight className="size-3" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows && offset < total && (
            <div className="border-t border-[var(--estate-border)] p-2.5">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => { setLoadingMore(true); void fetchPage(offset, true); }}
                className={cn(CATALOG_BTN, 'w-full justify-center')}
              >
                {loadingMore ? 'Loading…' : `Load more (${total - offset} remaining)`}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
