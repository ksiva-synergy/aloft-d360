'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, GitBranch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Callout, Tag } from '@/components/estate/object-ui';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
type Summary = {
  counts: {
    reports: number;
    measures_in_model: number;
    measures_on_reports: number;
    semantic_tables: number;
    warehouse_bound: number;
    warehouse_unbound: number;
  };
  warehouse: Array<{ pbi_table: string; uc_full_path: string | null; bound: boolean }>;
  reports: Array<{ id: string; name: string; measure_count: number; uc_paths: string[] }>;
  uc_paths: string[];
  warnings: string[];
};

function Layer({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2">
      <p className="text-size-eyebrow font-semibold uppercase tracking-wider text-[var(--estate-text-muted)]">{label}</p>
      <p className="mt-0.5 text-ui font-medium text-[var(--estate-ink)]">{value}</p>
      {detail ? <p className="mt-1 text-caption text-[var(--estate-text-secondary)]">{detail}</p> : null}
    </div>
  );
}

export function ModelHighLevelLineage({
  modelId,
  onOpenReports,
}: {
  modelId: string;
  onOpenReports?: () => void;
}) {
  const [state, setState] = useState<
    { loading: true } | { loading: false; error: string | null; data: Summary | null }
  >({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetch(`/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/lineage`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        return (json as { summary: Summary }).summary;
      })
      .then((data) => alive && setState({ loading: false, error: null, data }))
      .catch((err: unknown) =>
        alive && setState({ loading: false, error: err instanceof Error ? err.message : String(err), data: null }),
      );
    return () => {
      alive = false;
    };
  }, [modelId]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-[var(--estate-text-muted)]">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Loading high-level lineage…
      </p>
    );
  }
  if (state.error || !state.data) {
    return (
      <p className="text-caption text-[var(--estate-text-muted)]">
        High-level lineage unavailable{state.error ? `: ${state.error}` : ''}.
      </p>
    );
  }

  const s = state.data;
  const c = s.counts;

  return (
    <section className="space-y-3 rounded-card border border-[var(--estate-border)] bg-[var(--estate-bg)] p-3" aria-label="High-level lineage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-1.5 text-ui font-medium text-[var(--estate-ink)]">
          <GitBranch className="size-4 text-[var(--estate-text-muted)]" aria-hidden />
          High-level lineage
        </h4>
        <span className="text-caption text-[var(--estate-text-muted)]">
          Rollup only — use measure <strong className="font-medium text-[var(--estate-text-secondary)]">dependency graph</strong> for PQ steps and DAX.
        </span>
      </div>

      <div className="grid gap-1 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-stretch">
        <Layer
          label="Consumers"
          value={`${c.reports} report${c.reports === 1 ? '' : 's'}`}
          detail={`${c.measures_on_reports} measure name${c.measures_on_reports === 1 ? '' : 's'} on reports`}
        />
        <ArrowDown className="mx-auto hidden size-4 text-[var(--estate-text-dim)] sm:block sm:rotate-[-90deg]" aria-hidden />
        <Layer
          label="Semantic model"
          value={`${c.measures_in_model} measures`}
          detail={`${c.semantic_tables} tables`}
        />
        <ArrowDown className="mx-auto hidden size-4 text-[var(--estate-text-dim)] sm:block sm:rotate-[-90deg]" aria-hidden />
        <Layer
          label="Unity Catalog"
          value={`${c.warehouse_bound} bound`}
          detail={c.warehouse_unbound > 0 ? `${c.warehouse_unbound} not bound` : 'All tables mapped'}
        />
      </div>

      {s.uc_paths.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.uc_paths.slice(0, 12).map((p) => (
            <code
              key={p}
              className="max-w-full truncate rounded bg-[var(--estate-raised)] px-1.5 py-0.5 font-mono text-caption text-[var(--estate-ink)]"
              title={p}
            >
              {p}
            </code>
          ))}
          {s.uc_paths.length > 12 && (
            <span className="text-caption text-[var(--estate-text-muted)]">+{s.uc_paths.length - 12} more</span>
          )}
        </div>
      )}

      {s.warnings.length > 0 && (
        <Callout tone="neutral" title="Notes">
          <ul className="list-inside list-disc text-caption">
            {s.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      {onOpenReports && c.reports > 0 && (
        <button type="button" className={cn(CATALOG_BTN, 'text-caption')} onClick={onOpenReports}>
          Open Reports tab for per-report detail
        </button>
      )}
    </section>
  );
}