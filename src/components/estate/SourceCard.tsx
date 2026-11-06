'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Database, RefreshCw, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from '@/lib/navigation';
import { ESTATE_STAGE, formatCount, percentOf, estateStageDisplayLabel } from '@/lib/estate/stages';
import { CATALOG_BTN, OverflowMenu } from './catalog-ui';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';

export interface SourceCoverage {
  estate_total: number;
  objects_total: number;
  profiled: number;
  enriched: number;
  embedded: number;
  stale_count: number;
  queued_count: number;
}

interface SourceCardProps {
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  catalogName: string;
  /** Human relative time of the last scan, or null if never scanned. */
  lastScanned: string | null;
  coverage: SourceCoverage;
}

const KIND_LABELS: Record<string, string> = {
  databricks: 'Databricks',
  snowflake: 'Snowflake',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  bigquery: 'BigQuery',
  redshift: 'Redshift',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind.toLowerCase()] ?? kind;
}

/** Queue a T0 scan for a source; shared by the source row and the attention list. */
export async function queueSourceScan(sourceId: string): Promise<void> {
  try {
    const res = await fetch(`/api/agent-lab/context/sources/${sourceId}/harvest`, { method: 'POST' });
    if (res.status === 202) toast.success('Scan queued', { description: 'Track progress on the Jobs tab.' });
    else toast.error('Could not queue the scan');
  } catch {
    toast.error('Could not queue the scan');
  }
}

/** Shared grid template so the header and rows line up. */
export const SOURCE_GRID = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_88px_96px_148px] items-center gap-4';

/** Stacked bar: each stage is drawn as the part of `found` that reached it (stages are nested). */
export function StageStack({ coverage, className }: { coverage: SourceCoverage; className?: string }) {
  const found = Math.max(coverage.estate_total, coverage.objects_total);
  const scanned = coverage.objects_total;
  const profiled = Math.min(coverage.profiled, scanned);
  const described = Math.min(coverage.enriched, profiled || scanned);
  const searchable = Math.min(coverage.embedded, scanned);
  const pct = (n: number) => (found > 0 ? (n / found) * 100 : 0);
  const segs = [
    { key: 'searchable', w: pct(searchable), color: ESTATE_STAGE.searchable.color },
    { key: 'enriched', w: pct(Math.max(0, described - searchable)), color: ESTATE_STAGE.enriched.color },
    { key: 'profiled', w: pct(Math.max(0, profiled - Math.max(described, searchable))), color: ESTATE_STAGE.profiled.color },
    { key: 'scanned', w: pct(Math.max(0, scanned - Math.max(profiled, described, searchable))), color: ESTATE_STAGE.scanned.color },
  ];
  const tip = [
    `Found ${formatCount(found)}`,
    `Scanned ${formatCount(scanned)} (${percentOf(scanned, found)}%)`,
    `${estateStageDisplayLabel(ESTATE_STAGE.profiled)} ${formatCount(coverage.profiled)}`,
    `${estateStageDisplayLabel(ESTATE_STAGE.enriched)} ${formatCount(coverage.enriched)}`,
    `${estateStageDisplayLabel(ESTATE_STAGE.searchable)} ${formatCount(coverage.embedded)}`,
  ].join('\n');
  return (
    <div title={tip} className={cn('flex h-2 w-full overflow-hidden rounded-full bg-[var(--estate-hover)]', className)}>
      {segs.map((s) => s.w > 0 && <span key={s.key} className="h-full" style={{ width: `${s.w}%`, background: s.color }} />)}
    </div>
  );
}

export default function SourceCard({ sourceId, sourceName, sourceKind, catalogName, lastScanned, coverage }: SourceCardProps) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canAct = useCanRunEstatePipeline();
  const busy = scanning || refreshing;

  const found = Math.max(coverage.estate_total, coverage.objects_total);
  const scanned = coverage.objects_total;
  const neverScanned = scanned === 0;
  const searchablePct = percentOf(coverage.embedded, scanned);

  const handleScan = async () => {
    setScanning(true);
    await queueSourceScan(sourceId);
    setScanning(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/agent-lab/context/sources/${sourceId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 || (res.status === 200 && data.queued)) toast.success('Profile refresh queued');
      else if (data.reason === 'debounced' || !data.queued) toast.info('A refresh is already running');
      else toast.error('Could not queue the profile refresh');
    } catch {
      toast.error('Could not queue the profile refresh');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <li className={cn(SOURCE_GRID, 'px-5 py-3.5 transition-colors duration-hover hover:bg-[var(--estate-hover)]')}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-ctl bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink,var(--brand-a))]">
          <Database aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-ui text-[var(--estate-ink)]">{sourceName}</div>
          <div className="truncate text-caption text-[var(--estate-text-muted)]">
            {kindLabel(sourceKind)} <span aria-hidden>{'\u00b7'}</span> <span className="font-mono">{catalogName}</span>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        {neverScanned ? (
          <span className="text-ui-regular text-[var(--estate-text-muted)]">
            Not scanned yet{found > 0 ? ` \u00b7 ${formatCount(found)} objects found` : ''}
          </span>
        ) : (
          <>
            <StageStack coverage={coverage} />
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-caption tabular-nums text-[var(--estate-text-muted)]">
              <span>{formatCount(scanned)} of {formatCount(found)} scanned</span>
              {coverage.stale_count > 0 && (
                <span className="text-[var(--warn)]" title="Not re-scanned in the last 7 days">{formatCount(coverage.stale_count)} out of date</span>
              )}
              {coverage.queued_count > 0 && <span>{formatCount(coverage.queued_count)} queued</span>}
            </div>
          </>
        )}
      </div>

      <div className="text-right">
        {neverScanned ? (
          <span className="text-ui-regular text-[var(--estate-text-dim)]">{'\u2014'}</span>
        ) : (
          <span className="text-kpi-sm tabular-nums text-[var(--estate-ink)]">{searchablePct}%</span>
        )}
      </div>

      <div className="text-ui-regular text-[var(--estate-text-secondary)]">{lastScanned ?? 'Never'}</div>

      <div className="flex items-center justify-end gap-1.5">
        {canAct && <button type="button" onClick={handleScan} disabled={busy} className={cn(CATALOG_BTN, 'h-8')}>
          {scanning ? <RefreshCw aria-hidden className="size-3.5 animate-spin" /> : <ScanLine aria-hidden className="size-3.5" />}
          {scanning ? 'Queuing\u2026' : 'Scan now'}
        </button>}
        <OverflowMenu
          label={`More actions for ${sourceName}`}
          items={[
            ...(canAct ? [{
              label: refreshing ? 'Refreshing\u2026' : 'Refresh profiles',
              hint: neverScanned ? 'Scan the source first' : 'Recompute row counts and value statistics',
              onSelect: () => { void handleRefresh(); },
              disabled: busy || neverScanned,
            }] : []),
            {
              label: 'Open in Catalog',
              hint: 'Browse every object in this source',
              onSelect: () => { router.push('/agent-lab/estate/catalog'); },
            },
          ]}
        />
      </div>
    </li>
  );
}