'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isJobsLaunchWizardEnabled } from '@/lib/estate/job-ui';
import { ESTATE_STAGE, percentOf, estateStageDisplayLabel, type EstateStageKey } from '@/lib/estate/stages';

export type ScannedTier = 't0' | 't1' | 't2' | 'embed';

interface PipelineHealth {
  discovery_objects: number;
  scanned_objects: number;
  profiled_objects: number;
  enriched_objects: number;
  embedded_objects: number;
  discovery_not_scanned: number;
}

interface Recommendation {
  title: string;
  detail: string;
  kinds: string[];
  sequential: boolean;
  includePatterns: string[];
  estimatedTables: number;
  sampleSchemas?: string[];
}

interface CockpitResponse {
  health: PipelineHealth;
  recommendation: Recommendation | null;
}

const EXPANDED_KEY = 'aloft.jobs.coverageExpanded';

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function JobsCockpitPanel({
  sourceId,
  canRunPipeline = false,
  onLaunched,
  onOpenWizard,
  onStageClick,
  defaultExpanded = false,
}: {
  sourceId?: string | null;
  canRunPipeline?: boolean;
  onLaunched?: () => void;
  onOpenWizard?: () => void;
  /** Open the scanned-objects list filtered to a pipeline stage. */
  onStageClick?: (tier: ScannedTier) => void;
  /** Show coverage details open unless the user has collapsed them before. */
  defaultExpanded?: boolean;
}) {
  const [data, setData] = useState<CockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(EXPANDED_KEY);
      return stored === null ? defaultExpanded : stored === '1';
    } catch { return defaultExpanded; }
  });
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(EXPANDED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : '';
      const res = await fetch(`/api/agent-lab/context/jobs/cockpit${q}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runRecommended() {
    const rec = data?.recommendation;
    if (!rec) return;
    setLaunching(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: rec.kinds,
          includePatterns: rec.includePatterns,
          excludeSchemas: [],
          sequential: rec.sequential,
          ...(sourceId ? { sourceId } : {}),
        }),
      });
      if (res.ok) {
        toast.success('Recommended job started', { description: rec.title });
        onLaunched?.();
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('Could not start the job', { description: err.message ?? err.error ?? 'Unknown error' });
      }
    } catch {
      toast.error('Network error');
    } finally {
      setLaunching(false);
    }
  }

  const h = data?.health;
  const rec = data?.recommendation;
  const base = h?.discovery_objects ?? 0;

  const steps: Array<{
    key: EstateStageKey;
    label: string;
    plainLabel?: string;
    help: string;
    color: string;
    value: number;
    gap?: number;
    tier: ScannedTier | null;
  }> = h
    ? [
        { ...ESTATE_STAGE.discovered, value: h.discovery_objects, gap: h.discovery_not_scanned, tier: null },
        { ...ESTATE_STAGE.scanned, value: h.scanned_objects, tier: 't0' },
        { ...ESTATE_STAGE.profiled, value: h.profiled_objects, tier: 't1' },
        { ...ESTATE_STAGE.enriched, value: h.enriched_objects, tier: 't2' },
        { ...ESTATE_STAGE.searchable, value: h.embedded_objects, tier: 'embed' },
      ]
    : [];

  const shownSchemas = rec?.sampleSchemas ?? [];

  const coverageSummary = h ? steps.filter(s => s.key !== 'discovered') : [];
  const notScannedPct = h && base > 0 ? 100 - percentOf(h.scanned_objects, base) : 0;

  return (
    <section
      aria-label="Suggested next step"
      className="flex h-full flex-col overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)]"
    >
      <div className="flex flex-1 flex-col px-4 pb-3 pt-3">
        <div className="text-caption font-medium text-[var(--estate-text-muted)]">Suggested next step</div>
        {rec ? (
          <>
            <div className="mt-1 text-ui font-medium text-[var(--estate-ink)]">{rec.title}</div>
            <p className="mt-0.5 text-caption text-[var(--estate-text-secondary)]">{rec.detail}</p>
            {canRunPipeline ? (
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                <Button size="sm" disabled={launching || loading} onClick={runRecommended}>
                  {launching ? 'Starting…' : 'Run now'}
                </Button>
                {isJobsLaunchWizardEnabled() && onOpenWizard && (
                  <Button variant="outline" size="sm" onClick={onOpenWizard}>
                    Choose scope…
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-auto pt-3 text-caption text-[var(--estate-text-muted)]">A platform admin can run this.</p>
            )}
          </>
        ) : loading && !data ? (
          <div className="mt-2 space-y-2" aria-hidden>
            <div className="h-4 w-3/4 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)]" />
          </div>
        ) : (
          <div className="mt-1 text-ui text-[var(--estate-text-secondary)]">Nothing to do — the pipeline is up to date.</div>
        )}
      </div>

      {h && (
        <div className="border-t border-[var(--line-1)]">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-controls="jobs-coverage-details"
            title={`Share of ${fmt(base)} discovered tables that reached each stage`}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-caption transition-colors duration-hover hover:bg-[color-mix(in_srgb,var(--ink-1)_3%,transparent)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <span className="shrink-0 text-[var(--estate-text-muted)]">Estate coverage</span>
            <span className="min-w-0 flex-1 truncate text-[var(--estate-text-secondary)]">
              {coverageSummary.map((step, i) => (
                <React.Fragment key={step.key}>
                  {i > 0 && ' · '}
                  <span className="font-medium tabular-nums text-[var(--estate-ink)]">{percentOf(step.value, base)}%</span>{' '}
                  {step.plainLabel?.toLowerCase() ?? step.label.toLowerCase()}
                </React.Fragment>
              ))}
            </span>
            <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 text-[var(--estate-text-muted)] transition-transform duration-hover', expanded && 'rotate-180')} />
          </button>

          {expanded && (
            <div id="jobs-coverage-details" className="space-y-3 px-4 pb-3">
              <ol className="space-y-0.5">
                {steps.map(step => {
                  const pct = step.key === 'discovered' ? 100 : percentOf(step.value, base);
                  const clickable = Boolean(onStageClick && step.tier);
                  const Row = clickable ? 'button' : 'div';
                  return (
                    <li key={step.key}>
                      <Row
                        {...(clickable
                          ? {
                              type: 'button' as const,
                              onClick: () => onStageClick?.(step.tier as ScannedTier),
                              'aria-label': `${estateStageDisplayLabel(step)}: ${fmt(step.value)} tables (${pct}% of discovered). Open in Scanned objects`,
                            }
                          : {})}
                        title={step.help}
                        className={cn(
                          'grid w-full grid-cols-[88px_minmax(0,1fr)_64px_36px] items-center gap-3 rounded-ctl px-1.5 py-1 text-left',
                          clickable && 'cursor-pointer transition-colors duration-hover hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-size-ui text-[var(--estate-text-secondary)]">
                          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: step.color }} />
                          {estateStageDisplayLabel(step)}
                        </span>
                        <span className="relative h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                              width: `${Math.max(step.value > 0 ? 1 : 0, pct)}%`,
                              backgroundColor: step.key === 'discovered' ? 'color-mix(in srgb, var(--ink-1) 22%, transparent)' : step.color,
                            }}
                          />
                        </span>
                        <span className="text-right font-mono text-size-ui tabular-nums text-[var(--estate-ink)]">{fmt(step.value)}</span>
                        <span className="text-right font-mono text-caption tabular-nums text-[var(--estate-text-muted)]">{pct}%</span>
                      </Row>
                    </li>
                  );
                })}
              </ol>
              {h.discovery_not_scanned > 0 && (
                <p className="text-caption text-[var(--estate-text-secondary)]">
                  <span className="font-medium text-[var(--warning)]">{fmt(h.discovery_not_scanned)}</span>{' '}
                  discovered table{h.discovery_not_scanned !== 1 ? 's have' : ' has'} not been scanned yet ({notScannedPct}%).
                </p>
              )}
              {shownSchemas.length > 0 && (
                <div className="text-caption">
                  <div className="mb-1 text-[var(--estate-text-muted)]">The suggested run covers:</div>
                  <div className="flex flex-wrap gap-1">
                    {shownSchemas.map(s => (
                      <span
                        key={s}
                        title={s}
                        className="max-w-full truncate rounded border border-[var(--line-1)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-caption text-[var(--estate-text-secondary)]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-caption text-[var(--estate-text-muted)]">Click a stage to list its tables. Per-source coverage is on the Overview tab.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
