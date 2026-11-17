'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import { ArrowRight, GitBranch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tag } from '@/components/estate/object-ui';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import type { ReportLineagePayload } from '@/lib/powerbi/report-lineage-types';
import { ORIGIN_CLASS_LABEL, buildLineageGraph, classMix, lineageReadiness, liveLineageStatus } from '@/lib/powerbi/report-lineage-graph';
import { ReportLineageView, type ReportLineageSnapshot } from '@/components/estate/report-lineage/ReportLineageView';
import { ClassMixBar, ClassSwatch } from '@/components/estate/report-lineage/LaneCanvas';
import { StatusPill } from '@/components/estate/report-lineage/lineage-bits';

type LoadState =
  | { loading: true }
  | { loading: false; reportId: string; error: string | null; data: ReportLineagePayload | null; snapshot: ReportLineageSnapshot };

export function ReportLineageExplorer({
  reportId,
  variant = 'page',
  onOpenMeasure,
}: {
  reportId: string;
  variant?: 'embedded' | 'page';
  onOpenMeasure?: (name: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ loading: true });

  useEffect(() => {
    let alive = true;
    fetch(`/api/agent-lab/powerbi/reports/${encodeURIComponent(reportId)}/lineage`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        return json as { lineage: ReportLineagePayload; snapshot?: ReportLineageSnapshot };
      })
      .then((json) => alive && setState({ loading: false, reportId, error: null, data: json.lineage, snapshot: json.snapshot ?? null }))
      .catch((err: unknown) =>
        alive && setState({ loading: false, reportId, error: err instanceof Error ? err.message : String(err), data: null, snapshot: null }),
      );
    return () => {
      alive = false;
    };
  }, [reportId]);

  if (state.loading || state.reportId !== reportId) {
    return (
      <p className={cn('flex items-center gap-1.5 text-caption text-[var(--estate-text-muted)]', variant === 'embedded' && 'px-4 py-3')}>
        <Loader2 className="size-3 animate-spin" aria-hidden /> Loading report lineage…
      </p>
    );
  }
  if (state.error) {
    return (
      <p className={cn('text-caption text-[var(--estate-text-muted)]', variant === 'embedded' && 'px-4 py-3')}>
        Lineage unavailable: {state.error}
      </p>
    );
  }
  if (!state.data) return null;
  if (variant === 'page') return <ReportLineageView lineage={state.data} snapshot={state.snapshot} onOpenMeasure={onOpenMeasure} />;
  return <EmbeddedLineageSummary lineage={state.data} onOpenMeasure={onOpenMeasure} />;
}

/** Compact lineage inside a report row: where the data comes from, what needs attention, measures. */
function EmbeddedLineageSummary({ lineage, onOpenMeasure }: { lineage: ReportLineagePayload; onOpenMeasure?: (name: string) => void }) {
  const graph = useMemo(() => buildLineageGraph(lineage), [lineage]);
  const readiness = useMemo(() => lineageReadiness(lineage, graph), [lineage, graph]);
  const mix = classMix(graph.sources.map((source) => source.cls));
  const open = readiness.filter((item) => item.tone !== 'ok');
  return (
    <div className="space-y-3 border-t border-[var(--estate-border)] bg-[var(--estate-bg)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-[var(--estate-text-secondary)]">
        <StatusPill status={liveLineageStatus(readiness)} title="Computed from the current harvest" />
        <span><span className="text-[var(--estate-text-muted)]">Measures</span> <span className="tabular-nums">{graph.measures.length}</span></span>
        <span><span className="text-[var(--estate-text-muted)]">Model tables</span> <span className="tabular-nums">{graph.tables.length}</span></span>
        <span><span className="text-[var(--estate-text-muted)]">Original sources</span> <span className="tabular-nums">{graph.sources.length}</span></span>
        <Link href={`/agent-lab/estate/powerbi/reports/${encodeURIComponent(lineage.report.id)}/lineage`}
          className={cn(CATALOG_BTN, 'ml-auto inline-flex items-center gap-1 text-caption')}>
          Open lineage <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      {mix.length > 0 && (
        <div className="space-y-1.5">
          <ClassMixBar mix={mix} className="max-w-md" />
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-size-caption text-[var(--estate-text-muted)]">
            {mix.map((entry) => (
              <span key={entry.cls} className="inline-flex items-center gap-1.5"><ClassSwatch cls={entry.cls} />{ORIGIN_CLASS_LABEL[entry.cls]} {entry.count}</span>
            ))}
          </div>
        </div>
      )}
      {open.length > 0 && (
        <ul className="space-y-0.5 text-caption text-[var(--estate-text-secondary)]">
          {open.map((item) => (
            <li key={item.id}>
              <Tag tone={item.tone === 'bad' ? 'red' : 'amber'}>{item.title}</Tag>
              {item.detail && <span className="ml-2 text-[var(--estate-text-muted)]">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {graph.measures.length > 0 && (
        <ul className="divide-y divide-[var(--estate-border)] overflow-hidden rounded-lg border border-[var(--estate-border)]">
          {graph.measures.map(({ id, measure, classes }) => (
            <li key={id} className="flex flex-wrap items-center gap-2 bg-[var(--estate-surface)] px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-ui text-[var(--estate-ink)]" title={measure.name}>{measure.name}</span>
              <span className="flex gap-[3px]">{classes.map((cls) => <ClassSwatch key={cls} cls={cls} round title={ORIGIN_CLASS_LABEL[cls]} />)}</span>
              {!measure.found_in_model && <Tag tone="amber">not on model</Tag>}
              {measure.found_in_model && onOpenMeasure && (
                <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1 text-caption')} onClick={() => onOpenMeasure(measure.name)}>
                  <GitBranch className="size-3" aria-hidden /> Graph
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
