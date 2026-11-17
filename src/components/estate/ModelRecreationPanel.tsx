'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ESTATE_HEADER_CHIP } from '@/components/estate/catalog-ui';
import { Tag, TONE_COLOR, type Tone } from '@/components/estate/object-ui';
import {
  PATTERN_LABEL,
  RECREATION_STAGE_META,
  ROOT_CAUSE_LABEL,
} from '@/lib/powerbi/recreation-labels';
import type { MeasureRecreationStage } from '@/lib/powerbi/recreation-summary';

export type ModelRecreationSummary = {
  measures_total: number;
  uc_resolved: number;
  sql_drafted: number;
  parity_pass: number;
  parity_error: number;
  parity_fail: number;
  parity_skip: number;
  published: number;
  recreation_pct: number;
  published_pct: number;
  /** Matched Power BI before, no longer does (guardrail alert). */
  regressions?: number;
  /** Differ only because the dataset is older than the warehouse. */
  stale?: number;
  by_stage?: Partial<Record<MeasureRecreationStage, number>>;
  root_causes?: Record<string, number>;
  causes_precise?: number;
  causes_total?: number;
  cause_precision_pct?: number;
  patterns?: Record<string, number>;
};

export type RecreationMeasureRow = {
  id: string;
  name: string;
  table_name: string;
  display_folder: string | null;
  recreation_stage?: MeasureRecreationStage;
  recreation_reason?: string | null;
  root_cause?: { category: string; fix: string } | null;
};

const BLOCKED_STAGES = new Set<MeasureRecreationStage>([
  'regressed',
  'no_uc',
  'no_sql',
  'parity_error',
  'parity_fail',
  'parity_skip',
]);

const STAGE_ORDER: MeasureRecreationStage[] = [
  'regressed',
  'published',
  'recreated',
  'stale',
  'draft_sql',
  'parity_skip',
  'parity_fail',
  'parity_error',
  'no_sql',
  'no_uc',
];

function rootCauseTone(key: string): Tone {
  if (key.includes('timeout') || key.includes('error') || key.includes('fail')) return 'red';
  if (key.includes('unsupported') || key.includes('missing') || key.includes('unmapped')) return 'amber';
  return 'neutral';
}

function RecreationRing({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' | 'lg' }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const ring = `conic-gradient(${TONE_COLOR.green} ${clamped * 3.6}deg, var(--estate-raised) 0)`;
  const box = size === 'sm' ? 'size-8 p-[2px]' : size === 'lg' ? 'size-24 p-[4px]' : 'size-[4.25rem] p-[3px]';
  const text = size === 'sm' ? 'text-size-eyebrow' : size === 'lg' ? 'text-title-section' : 'text-ui';
  return (
    <div
      className={cn('relative shrink-0 rounded-full', box)}
      style={{ background: ring }}
      role="img"
      aria-label={`${pct}% recreation progress`}
    >
      <div className="flex size-full items-center justify-center rounded-full bg-[var(--estate-surface)]">
        <span className={cn('font-semibold tabular-nums text-[var(--estate-ink)]', text)}>{pct}%</span>
      </div>
    </div>
  );
}

function RecreationPipelineStep({
  label,
  value,
  total,
  fill,
}: {
  label: string;
  value: number;
  total: number;
  fill: string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
      <div
        className="flex h-16 items-end justify-center overflow-hidden rounded-md border border-[var(--estate-border)] bg-[var(--estate-bg)] px-2 pb-1 pt-2"
        title={`${value} of ${total} measures`}
      >
        <div className="w-full max-w-9 rounded-sm" style={{ height: `${Math.max(6, pct)}%`, background: fill }} />
      </div>
      <p className="text-center text-ui-regular font-semibold tabular-nums text-[var(--estate-ink)]">{value}</p>
      <p className="text-center text-size-eyebrow leading-tight text-[var(--estate-text-muted)]">{label}</p>
    </div>
  );
}

function BreakdownTable({
  items,
  labels,
}: {
  items: Record<string, number>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(items).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return (
    <table className="w-full text-caption">
      <tbody>
        {entries.map(([key, count]) => (
          <tr key={key} className="border-b border-[var(--estate-border)]/70 last:border-0">
            <td className="w-10 py-1.5 pr-2 text-right font-semibold tabular-nums text-[var(--estate-ink)]">{count}</td>
            <td className="py-1.5 text-[var(--estate-text-secondary)]" title={labels[key] ?? key}>
              {labels[key] ?? key}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StageTag({ stage }: { stage: MeasureRecreationStage }) {
  const meta = RECREATION_STAGE_META[stage] ?? RECREATION_STAGE_META.no_uc;
  return (
    <Tag tone={meta.tone} title={meta.hint}>
      {meta.label}
    </Tag>
  );
}

function RecreationDashboard({ recreation }: { recreation: ModelRecreationSummary }) {
  const { measures_total, parity_pass, published, sql_drafted, uc_resolved, parity_error } = recreation;
  const parityDraft = Math.max(0, parity_pass - published);
  const parityFail = recreation.parity_fail ?? 0;
  const paritySkip = recreation.parity_skip ?? 0;
  const regressed = recreation.regressions ?? 0;
  const stale = recreation.stale ?? 0;
  const remaining = Math.max(0, measures_total - parity_pass - parity_error - parityFail - paritySkip - regressed - stale);

  const pipeline = [
    { label: 'UC bound', value: uc_resolved, fill: TONE_COLOR.blue },
    { label: 'SQL drafted', value: sql_drafted, fill: TONE_COLOR.blue },
    { label: 'Parity OK', value: parity_pass, fill: TONE_COLOR.green },
    { label: 'Published', value: published, fill: TONE_COLOR.green },
  ];

  const legend = [
    regressed > 0 && { color: TONE_COLOR.red, label: `Regressed ${regressed}` },
    published > 0 && { color: TONE_COLOR.green, label: `Published ${published}` },
    parityDraft > 0 && { color: TONE_COLOR.blue, label: `Parity pass ${parityDraft}` },
    stale > 0 && { color: TONE_COLOR.amber, label: `Dataset stale ${stale}` },
    parity_error > 0 && { color: TONE_COLOR.red, label: `SQL error ${parity_error}` },
    parityFail > 0 && { color: TONE_COLOR.amber, label: `Mismatch ${parityFail}` },
    paritySkip > 0 && { color: 'var(--estate-text-dim)', label: `Skipped ${paritySkip}` },
    remaining > 0 && { color: 'var(--estate-border)', label: `Other ${remaining}` },
  ].filter(Boolean) as { color: string; label: string }[];

  const byStage =
    recreation.by_stage ??
    ({} as Partial<Record<MeasureRecreationStage, number>>);

  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
        <div className="flex items-center gap-4">
          <RecreationRing pct={recreation.recreation_pct} size="lg" />
          <div>
            <p className="text-caption text-[var(--estate-text-muted)]">Warehouse parity</p>
            <p className="text-title-section tabular-nums text-[var(--estate-ink)]">
              {parity_pass}
              <span className="text-ui font-normal text-[var(--estate-text-muted)]"> / {measures_total} measures</span>
            </p>
            <p className="mt-1 text-caption text-[var(--estate-text-muted)]">
              {recreation.published_pct}% published to knowledge base
            </p>
            {recreation.causes_total != null && recreation.causes_total > 0 && (
              <p className="mt-1 text-size-eyebrow text-[var(--estate-text-muted)]">
                Root-cause precision {recreation.causes_precise}/{recreation.causes_total} (
                {recreation.cause_precision_pct}%)
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2" aria-label="Recreation pipeline">
          {pipeline.map((step) => (
            <RecreationPipelineStep
              key={step.label}
              label={step.label}
              value={step.value}
              total={measures_total}
              fill={step.fill}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex h-2 overflow-hidden rounded-full bg-[var(--estate-raised)]">
          {regressed > 0 && (
            <div
              className="h-full"
              style={{ width: `${(regressed / measures_total) * 100}%`, background: TONE_COLOR.red }}
            />
          )}
          {published > 0 && (
            <div
              className="h-full"
              style={{ width: `${(published / measures_total) * 100}%`, background: TONE_COLOR.green }}
            />
          )}
          {stale > 0 && (
            <div
              className="h-full opacity-60"
              title="Differs only because the Power BI dataset is older than the warehouse"
              style={{ width: `${(stale / measures_total) * 100}%`, background: TONE_COLOR.amber }}
            />
          )}
          {parityDraft > 0 && (
            <div
              className="h-full"
              style={{ width: `${(parityDraft / measures_total) * 100}%`, background: TONE_COLOR.blue }}
            />
          )}
          {parity_error > 0 && (
            <div
              className="h-full"
              style={{ width: `${(parity_error / measures_total) * 100}%`, background: TONE_COLOR.red }}
            />
          )}
          {parityFail > 0 && (
            <div
              className="h-full"
              style={{ width: `${(parityFail / measures_total) * 100}%`, background: TONE_COLOR.amber }}
            />
          )}
          {paritySkip > 0 && (
            <div
              className="h-full"
              style={{ width: `${(paritySkip / measures_total) * 100}%`, background: 'var(--estate-text-dim)' }}
            />
          )}
          {remaining > 0 && (
            <div
              className="h-full"
              style={{ width: `${(remaining / measures_total) * 100}%`, background: 'var(--estate-border)' }}
            />
          )}
        </div>
        {legend.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-size-eyebrow text-[var(--estate-text-muted)]">
            {legend.map((item) => (
              <li key={item.label} className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ background: item.color }} aria-hidden />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {Object.keys(byStage).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {STAGE_ORDER.filter((s) => (byStage[s] ?? 0) > 0).map((s) => (
            <Tag key={s} tone={RECREATION_STAGE_META[s].tone} title={RECREATION_STAGE_META[s].hint}>
              {RECREATION_STAGE_META[s].label}
              <span className="tabular-nums opacity-80"> {byStage[s]}</span>
            </Tag>
          ))}
        </div>
      )}

      {(recreation.root_causes && Object.keys(recreation.root_causes).length > 0) ||
      (recreation.patterns && Object.keys(recreation.patterns).length > 0) ? (
        <div className="grid gap-4 md:grid-cols-2">
          {recreation.root_causes && Object.keys(recreation.root_causes).length > 0 && (
            <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-bg)] p-3">
              <h4 className="mb-2 text-size-eyebrow font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
                Not recreated
              </h4>
              <BreakdownTable items={recreation.root_causes} labels={ROOT_CAUSE_LABEL} />
            </div>
          )}
          {recreation.patterns && Object.keys(recreation.patterns).length > 0 && (
            <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-bg)] p-3">
              <h4 className="mb-2 text-size-eyebrow font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
                Patterns
              </h4>
              <BreakdownTable items={recreation.patterns} labels={PATTERN_LABEL} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecreationMeasureExplorer({
  measures,
  onOpenMeasure,
}: {
  measures: RecreationMeasureRow[];
  onOpenMeasure?: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<MeasureRecreationStage | 'all' | 'blocked'>('all');

  const withStage = measures.filter((m) => m.recreation_stage);
  const stageCounts = useMemo(() => {
    const m = new Map<MeasureRecreationStage, number>();
    for (const row of withStage) {
      if (!row.recreation_stage) continue;
      m.set(row.recreation_stage, (m.get(row.recreation_stage) ?? 0) + 1);
    }
    return m;
  }, [withStage]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return withStage.filter((m) => {
      if (stageFilter === 'blocked') {
        if (!m.recreation_stage || !BLOCKED_STAGES.has(m.recreation_stage)) return false;
      } else if (stageFilter !== 'all' && m.recreation_stage !== stageFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.table_name.toLowerCase().includes(q) ||
        (m.display_folder ?? '').toLowerCase().includes(q) ||
        (ROOT_CAUSE_LABEL[m.root_cause?.category ?? ''] ?? m.root_cause?.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [withStage, query, stageFilter]);

  const blockedCount = withStage.filter((m) => m.recreation_stage && BLOCKED_STAGES.has(m.recreation_stage)).length;

  return (
    <section className="space-y-3" aria-label="Measures by recreation stage">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4 className="text-ui font-medium text-[var(--estate-ink)]">Measures</h4>
          <p className="text-caption text-[var(--estate-text-muted)]">
            Open a measure in the model inspector for DAX, SQL, and dependency graph.
          </p>
        </div>
        <span className="text-caption text-[var(--estate-text-muted)]">
          {filtered.length === withStage.length ? `${withStage.length} total` : `${filtered.length} shown`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <small className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search measure, table, blocker…"
            aria-label="Search measures"
            className="h-8 w-full rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] pl-8 pr-2 text-caption text-[var(--estate-ink)] outline-none placeholder:text-[var(--estate-text-dim)] focus-visible:shadow-[var(--focus-ring)]"
          />
        </small>
      </div>

      <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-1">
        <button
          type="button"
          aria-pressed={stageFilter === 'all'}
          onClick={() => setStageFilter('all')}
          className={cn(
            'inline-flex h-7 items-center rounded-md border px-2 text-size-eyebrow',
            stageFilter === 'all'
              ? 'border-[color-mix(in_srgb,var(--brand-a)_35%,var(--estate-border))] bg-[var(--estate-active-bg)] text-[var(--estate-ink)]'
              : 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)]',
          )}
        >
          All
        </button>
        {blockedCount > 0 && (
          <button
            type="button"
            aria-pressed={stageFilter === 'blocked'}
            onClick={() => setStageFilter('blocked')}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-size-eyebrow',
              stageFilter === 'blocked'
                ? 'border-[color-mix(in_srgb,var(--brand-a)_35%,var(--estate-border))] bg-[var(--estate-active-bg)] text-[var(--estate-ink)]'
                : 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)]',
            )}
          >
            Blocked <span className="tabular-nums">{blockedCount}</span>
          </button>
        )}
        {STAGE_ORDER.filter((s) => (stageCounts.get(s) ?? 0) > 0).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={stageFilter === s}
            onClick={() => setStageFilter(s)}
            title={RECREATION_STAGE_META[s].hint}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-size-eyebrow',
              stageFilter === s
                ? 'border-[color-mix(in_srgb,var(--brand-a)_35%,var(--estate-border))] bg-[var(--estate-active-bg)] text-[var(--estate-ink)]'
                : 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)]',
            )}
          >
            {RECREATION_STAGE_META[s].label}
            <span className="tabular-nums">{stageCounts.get(s)}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)]">
        <div className="max-h-[min(42vh,480px)] overflow-y-auto">
          <table className="w-full text-left text-caption">
            <thead className="sticky top-0 z-[1] border-b border-[var(--estate-border)] bg-[var(--estate-raised)] text-size-eyebrow font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Measure</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Table</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Blocker</th>
                <th className="w-20 px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--estate-border)]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[var(--estate-text-muted)]">
                    No measures match this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-[var(--estate-hover)]">
                    <td className="max-w-[14rem] truncate px-3 py-2 font-medium text-[var(--estate-ink)]" title={m.name}>
                      {m.name}
                    </td>
                    <td className="hidden max-w-[10rem] truncate px-3 py-2 text-[var(--estate-text-muted)] sm:table-cell">
                      {m.table_name}
                    </td>
                    <td className="px-3 py-2">
                      {m.recreation_stage && <StageTag stage={m.recreation_stage} />}
                    </td>
                    <td className="hidden max-w-xs truncate px-3 py-2 text-[var(--estate-text-secondary)] md:table-cell" title={m.root_cause?.fix}>
                      {m.root_cause
                        ? (ROOT_CAUSE_LABEL[m.root_cause.category] ?? m.root_cause.category)
                        : m.recreation_reason ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {onOpenMeasure && (
                        <button
                          type="button"
                          onClick={() => onOpenMeasure(m.name)}
                          className="text-size-eyebrow font-medium text-[var(--estate-text-secondary)] underline-offset-2 hover:text-[var(--estate-ink)] hover:underline"
                        >
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function RecreationFullPage({
  open,
  onClose,
  modelName,
  recreation,
  measures,
  onOpenMeasure,
}: {
  open: boolean;
  onClose: () => void;
  modelName: string;
  recreation: ModelRecreationSummary;
  measures: RecreationMeasureRow[];
  onOpenMeasure?: (name: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const headerTags = (
    <>
      {(recreation.regressions ?? 0) > 0 && (
        <Tag tone="red" title="Matched Power BI before and no longer do">
          ⚠ {recreation.regressions} regressed
        </Tag>
      )}
      <Tag tone="green">
        {recreation.recreation_pct}% parity
      </Tag>
      <Tag tone="blue">
        {recreation.sql_drafted} SQL drafted
      </Tag>
      {recreation.parity_error > 0 && (
        <Tag tone="red">
          {recreation.parity_error} SQL errors
        </Tag>
      )}
      {(recreation.parity_fail ?? 0) > 0 && (
        <Tag tone="amber">
          {recreation.parity_fail} mismatch
        </Tag>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-[var(--estate-bg)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recreation-full-title"
    >
      <button
        type="button"
        className="sr-only"
        aria-label="Close recreation view"
        onClick={onClose}
      />
      <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-size-eyebrow font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
            Databricks recreation
          </p>
          <h2 id="recreation-full-title" className="text-title-section text-[var(--estate-ink)]">
            {modelName}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">{headerTags}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--estate-border)] p-2 text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]"
          aria-label="Close"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <RecreationDashboard recreation={recreation} />
          <RecreationMeasureExplorer
            measures={measures}
            onOpenMeasure={
              onOpenMeasure
                ? (name) => {
                    onClose();
                    onOpenMeasure(name);
                  }
                : undefined
            }
          />
        </div>
      </div>

      <footer className="shrink-0 border-t border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-2 text-center text-size-eyebrow text-[var(--estate-text-dim)] sm:px-6">
        Esc to close · Power BI measure values compared to warehouse SQL (parity)
      </footer>
    </div>
  );
}

/** Compact header control — opens a full-page recreation inspector. */
export function ModelRecreationPanel({
  modelName,
  recreation,
  measures,
  onOpenMeasure,
  className,
}: {
  modelName: string;
  recreation: ModelRecreationSummary;
  measures: RecreationMeasureRow[];
  onOpenMeasure?: (name: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (recreation.measures_total === 0 || recreation.sql_drafted === 0) return null;

  const topRoot = recreation.root_causes
    ? Object.entries(recreation.root_causes).sort((a, b) => b[1] - a[1])[0]
    : null;
  const regressions = recreation.regressions ?? 0;
  const chipTitle = [
    regressions > 0 ? `⚠ ${regressions} measure(s) regressed — matched Power BI before, no longer do` : null,
    `${recreation.recreation_pct}% warehouse parity`,
    `${recreation.parity_pass} of ${recreation.measures_total} measures`,
    topRoot
      ? `Top blocker: ${topRoot[1]}× ${ROOT_CAUSE_LABEL[topRoot[0]] ?? topRoot[0]}`
      : null,
    'Open full recreation view',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(ESTATE_HEADER_CHIP, className)}
        aria-haspopup="dialog"
        aria-controls="recreation-full-title"
        title={chipTitle}
      >
        <span className="shrink-0 tabular-nums font-semibold text-[var(--estate-ink)]">{recreation.recreation_pct}%</span>
        <span className="shrink-0 font-medium">Recreation</span>
        {regressions > 0 && (
          <span className="shrink-0 font-semibold tabular-nums" style={{ color: TONE_COLOR.red }}>
            ⚠ {regressions}
          </span>
        )}
        <span className="min-w-0 truncate tabular-nums text-[var(--estate-text-muted)]">
          {recreation.parity_pass}/{recreation.measures_total}
        </span>
        <ChevronRight className="size-3 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
      </button>

      <RecreationFullPage
        open={open}
        onClose={() => setOpen(false)}
        modelName={modelName}
        recreation={recreation}
        measures={measures}
        onOpenMeasure={onOpenMeasure}
      />
    </>
  );
}