'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import { useSearchParams } from '@/lib/navigation';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  HeartPulse,
  ExternalLink,
  FileBarChart,
  Loader2,
  Search,
  Shield,
  Sigma,
  Table2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATALOG_BTN, CATALOG_SELECT, ESTATE_HEADER_CHIP } from '@/components/estate/catalog-ui';
import { Select } from '@/components/form/Select';
import { Callout, CodeBlock, Tag, TONE_COLOR, type Tone } from '@/components/estate/object-ui';
import { MeasureDependencyGraph, ModelHealthPanel } from '@/components/estate/ModelDependencyGraph';
import { ModelDataSources } from '@/components/estate/ModelDataSources';
import { ModelDefinitionCard } from '@/components/estate/ModelDefinitionCard';
import { ModelOwnershipCard } from '@/components/estate/ModelOwnershipCard';
import { ModelRecreationPanel } from '@/components/estate/ModelRecreationPanel';
import { PbiReportHarvestButton } from '@/components/estate/PbiModelHarvestMenu';
import { PbiPipelineRunButton } from '@/components/estate/PbiPipelineRunButton';
import { PATTERN_LABEL, RECREATION_STAGE_META, ROOT_CAUSE_LABEL } from '@/lib/powerbi/recreation-labels';
import type { MeasureRecreationStage } from '@/lib/powerbi/recreation-summary';
import type { MeasureDefinitionFlags, TableDefinitionFlags } from '@/lib/powerbi/definition-flags';
import { useSectionLevel } from '@/lib/sections/useSectionLevels';

// ── Types ────────────────────────────────────────────────────────────────────

type Summary = {
  workspaces: number;
  models: number;
  reports: number;
  tables: number;
  measures: number;
  models_parsed: number;
  models_answerable: number;
  models_caveated: number;
};

type WorkspaceRow = {
  id: string;
  name: string;
  model_count: number;
  report_count: number;
};

type ModelRow = {
  id: string;
  name: string;
  workspace_name: string;
  answerability: string | null;
  has_definition?: boolean;
  domain_key: string | null;
  domain_name: string | null;
  domain_confidence: number | null;
  family_name?: string | null;
  table_count: number;
  measure_count: number;
  report_count?: number;
  rls_required: boolean;
};

type DomainRow = {
  id: string;
  domain_key: string;
  name: string;
  model_count: number;
};

type ConflictRow = {
  id: string;
  metric_name: string;
  summary: string | null;
  status?: string;
  dax_hashes?: unknown;
  models?: { id: string; name: string | null }[];
};

type RecreationSummary = {
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
  by_stage?: Partial<Record<MeasureRecreationStage, number>>;
  root_causes?: Record<string, number>;
  causes_precise?: number;
  causes_total?: number;
  cause_precision_pct?: number;
  patterns?: Record<string, number>;
};

type ModelDetail = {
  id: string;
  pbi_model_id: string;
  name: string;
  description: string | null;
  has_definition?: boolean;
  parse?: { parsed_at?: string; table_count?: number; measure_count?: number } | null;
  classification: { answerability?: string } | null;
  domain: { domain_key: string; name: string; rollout_wave: number } | null;
  domain_assignment: { domain_key?: string; confidence?: number } | null;
  workspace: { name: string | null; pbi_workspace_id: string };
  tables: { id: string; name: string; partition_kind: string | null; binding: unknown; definition?: TableDefinitionFlags | null }[];
  measures: {
    id: string;
    name: string;
    definition?: MeasureDefinitionFlags | null;
    table_name: string;
    display_folder: string | null;
    dax_preview: string;
    recreation_stage?: MeasureRecreationStage;
    recreation_reason?: string | null;
    root_cause?: {
      category: string;
      detail: string;
      fix: string;
      precise?: boolean;
      evidence?: { detector: string; evidence: string; action: string }[];
    } | null;
    translation_tier?: string | null;
    parity_verdict?: string | null;
    verified_query_status?: string | null;
    uc_source_table?: string | null;
    column_resolution?: {
      mapped_count: number;
      ref_count: number;
      unmapped: string[];
    } | null;
    measure_logic?: {
      complexity_class: string;
      reproduction_strategy: string;
      block_automated_sql: boolean;
      block_reason: string | null;
      tables_involved: string[];
      calc_columns: string[];
      pq_filter_count: number;
      harvest_gap_refs: string[];
      aggregation_hint: string | null;
    } | null;
  }[];
  reports: {
    id: string;
    name: string;
    web_url: string | null;
    open_url: string | null;
    open_url_synthesized?: boolean;
    pbi_report_id?: string;
    report_format?: string | null;
  }[];
};

type StatusFilter = 'all' | 'answerable' | 'caveated' | 'blocked' | 'unparsed';
type DetailTab = 'measures' | 'tables' | 'reports' | 'health';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A model counts as parsed once it has a definition or a classification. */
function isParsed(m: ModelRow): boolean {
  return Boolean(m.has_definition) || Boolean(m.answerability) || m.table_count > 0 || m.measure_count > 0;
}

function statusOf(m: ModelRow): Exclude<StatusFilter, 'all'> {
  if (!isParsed(m)) return 'unparsed';
  const a = (m.answerability ?? '').toLowerCase();
  if (a === 'answerable' || a === 'caveated' || a === 'blocked') return a;
  return 'unparsed';
}

const STATUS_META: Record<Exclude<StatusFilter, 'all'>, { label: string; tone: Tone; hint: string }> = {
  answerable: { label: 'Answerable', tone: 'green', hint: 'Agents can answer from this model without caveats.' },
  caveated: { label: 'Caveated', tone: 'amber', hint: 'Agents can answer, but with stated caveats.' },
  blocked: { label: 'Blocked', tone: 'red', hint: 'Agents should not answer from this model.' },
  unparsed: { label: 'Not parsed', tone: 'neutral', hint: 'Inventoried only. Run PBI Parse from Jobs to read its definition.' },
};

const STATUS_STRIPE: Record<Exclude<StatusFilter, 'all'>, string> = {
  answerable: TONE_COLOR.green,
  caveated: TONE_COLOR.amber,
  blocked: TONE_COLOR.red,
  unparsed: 'var(--estate-text-dim)',
};

function StatusTag({ status }: { status: Exclude<StatusFilter, 'all'> }) {
  const meta = STATUS_META[status];
  return (
    <Tag tone={meta.tone} dot title={meta.hint}>
      {meta.label}
    </Tag>
  );
}

function modelHasParsedContent(detail: ModelDetail, row: ModelRow | null): boolean {
  return (
    detail.tables.length > 0 ||
    detail.measures.length > 0 ||
    Boolean(detail.parse?.parsed_at) ||
    (row?.table_count ?? 0) > 0 ||
    (row?.measure_count ?? 0) > 0
  );
}

function modelDisplayStatus(
  detail: ModelDetail,
  row: ModelRow | null,
): { filter: Exclude<StatusFilter, 'all'>; showParsedBadge: boolean } {
  const answer = (detail.classification?.answerability ?? row?.answerability ?? '').toLowerCase();
  if (answer === 'answerable' || answer === 'caveated' || answer === 'blocked') {
    return { filter: answer, showParsedBadge: false };
  }
  if (modelHasParsedContent(detail, row)) {
    return { filter: 'caveated', showParsedBadge: true };
  }
  return { filter: 'unparsed', showParsedBadge: false };
}

/**
 * Domain assignment "confidence" is a weighted signal total from
 * `src/lib/powerbi/domain-score.ts`, not a 0–1 probability, so it is shown as a score.
 */
function domainScoreLabel(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || score <= 0) return null;
  if (score <= 1) return `${Math.round(score * 100)}% match`;
  return `match score ${Math.round(score)}`;
}

function variantCount(c: ConflictRow): number | null {
  if (Array.isArray(c.dax_hashes)) return new Set(c.dax_hashes as unknown[]).size;
  if (c.dax_hashes && typeof c.dax_hashes === 'object') return Object.keys(c.dax_hashes as object).length;
  const m = c.summary?.match(/(\d+)\s+distinct DAX/i);
  return m ? Number(m[1]) : null;
}

function humanize(s: string | null | undefined): string {
  if (!s) return 'Unknown';
  const t = s.replace(/_/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Unknown';
}

function RecreationStageTag({ stage }: { stage: MeasureRecreationStage }) {
  const meta = RECREATION_STAGE_META[stage] ?? RECREATION_STAGE_META.no_uc;
  return (
    <Tag tone={meta.tone} title={meta.hint}>
      {meta.label}
    </Tag>
  );
}

const ESTATE_SELECT = cn(CATALOG_SELECT, 'h-8 w-full min-w-0 text-caption');

const INPUT =
  'h-8 w-full rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] pl-8 pr-7 text-ui-regular text-[var(--estate-ink)] outline-none placeholder:text-[var(--estate-text-dim)] focus-visible:shadow-[var(--focus-ring)]';

function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]"
      />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-[var(--estate-text-dim)] hover:text-[var(--estate-ink)]"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ── Stats bar ────────────────────────────────────────────────────────────────

/** Inline "value label" pair for the one-line stats bar. */
function Stat({ value, label, title }: { value: React.ReactNode; label: string; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={title}>
      <span className="text-ui font-semibold tabular-nums text-[var(--estate-ink)]">{value}</span>
      <span className="text-caption text-[var(--estate-text-muted)]">{label}</span>
    </span>
  );
}

function StatDivider() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-[var(--estate-border)]" />;
}

/** Small toggle pill in the stats bar (status filters, conflicts). */
function StatToggle({
  dot,
  value,
  label,
  active,
  onClick,
  title,
  icon,
}: {
  dot?: string;
  value: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 transition-colors duration-hover',
        'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        active
          ? 'border-[var(--brand-a)] bg-[var(--estate-active-bg)]'
          : 'border-[var(--estate-border)] bg-[var(--estate-surface)] hover:border-[var(--estate-text-muted)]',
      )}
    >
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />}
      {icon}
      <span className="text-ui font-semibold tabular-nums text-[var(--estate-ink)]">{value}</span>
      <span className="text-caption text-[var(--estate-text-secondary)]">{label}</span>
    </button>
  );
}

// ── Conflicts panel ──────────────────────────────────────────────────────────

function ConflictsPanel({
  conflicts,
  canSteward,
  busyId,
  onAcknowledge,
  onOpenModel,
  onClose,
}: {
  conflicts: ConflictRow[];
  canSteward: boolean;
  busyId: string | null;
  onAcknowledge: (id: string) => void;
  onOpenModel: (modelId: string, measure: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-label="Measure conflicts"
      className="mt-3 overflow-hidden rounded-card border border-[var(--estate-status-warning-border)] bg-[var(--estate-surface)]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--estate-status-warning-border)] bg-[var(--estate-status-warning-bg)] px-4 py-2">
        <AlertTriangle className="size-4" style={{ color: TONE_COLOR.amber }} aria-hidden />
        <h3 className="text-ui font-medium text-[var(--estate-ink)]">Measure conflicts</h3>
        <span className="text-caption text-[var(--estate-text-muted)]">
          Same measure name, different DAX across models. Pick a model to compare definitions.
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide conflicts"
          className="ml-auto rounded-xs p-1 text-[var(--estate-text-muted)] hover:text-[var(--estate-ink)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <ul className="max-h-64 divide-y divide-[var(--estate-border)] overflow-y-auto">
        {conflicts.map((c) => {
          const variants = variantCount(c);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
              <div className="flex min-w-[180px] flex-1 basis-[220px] items-center gap-2">
                <Sigma className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
                <span className="truncate font-mono text-ui-regular text-[var(--estate-ink)]" title={c.metric_name}>
                  {c.metric_name}
                </span>
                {variants != null && (
                  <Tag tone="amber" title={c.summary ?? undefined}>
                    {variants} DAX variants
                  </Tag>
                )}
              </div>
              <div className="flex min-w-0 flex-[2] basis-[320px] flex-wrap gap-1.5">
                {(c.models ?? []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpenModel(m.id, c.metric_name)}
                    title={`Open ${m.name ?? m.id} and show ${c.metric_name}`}
                    className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-xs border border-[var(--estate-border)] bg-[var(--estate-raised)] px-2 text-caption text-[var(--estate-text-secondary)] transition-colors hover:border-[var(--brand-a)] hover:text-[var(--estate-ink)]"
                  >
                    <span className="truncate">{m.name ?? m.id}</span>
                  </button>
                ))}
              </div>
              {canSteward && (
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => onAcknowledge(c.id)}
                  className={cn(CATALOG_BTN, 'shrink-0')}
                  title="Mark as reviewed. It leaves the proposed list."
                >
                  {busyId === c.id && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  Acknowledge
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Model list ───────────────────────────────────────────────────────────────

function ModelListItem({
  model,
  selected,
  onSelect,
}: {
  model: ModelRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = statusOf(model);
  const parsed = status !== 'unparsed';
  const meta = STATUS_META[status];
  const stripeColor = selected ? 'var(--brand-a)' : STATUS_STRIPE[status];
  const countHint = `${model.measure_count} measures · ${model.table_count} tables`;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        title={[model.name, meta.label, parsed ? countHint : meta.hint, model.rls_required ? 'RLS required' : '']
          .filter(Boolean)
          .join(' · ')}
        className={cn(
          'relative flex w-full items-center gap-2 rounded-ctl py-1 pl-2.5 pr-2 text-left transition-colors duration-hover',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
          selected ? 'bg-[var(--estate-active-bg)]' : 'hover:bg-[var(--estate-hover)]',
        )}
      >
        <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full" style={{ background: stripeColor }} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-caption leading-snug',
            parsed ? 'font-medium text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]',
          )}
        >
          {model.name}
        </span>
        {parsed ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--estate-text-muted)]" title={countHint}>
            {model.measure_count}m·{model.table_count}t
          </span>
        ) : (
          <span className="shrink-0 text-[10px] italic text-[var(--estate-text-dim)]">—</span>
        )}
        {model.rls_required && (
          <Shield className="size-3 shrink-0" style={{ color: TONE_COLOR.violet }} aria-label="RLS required" />
        )}
      </button>
    </li>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function partitionTone(kind: string | null): Tone {
  const k = (kind ?? '').toLowerCase();
  if (!k || k === 'unknown') return 'neutral';
  if (k.includes('warehouse') || k.includes('query') || k.includes('sql')) return 'blue';
  if (k.includes('embedded') || k.includes('calculated')) return 'violet';
  return 'neutral';
}

type Binding = { uc_full_path?: string; bind_status?: string; context_object_id?: string } | null;

/** Small marks after a measure name: hidden, dynamic format, quick measure, KPI. */
function MeasureFlagMarks({ flags }: { flags?: MeasureDefinitionFlags | null }) {
  if (!flags) return null;
  const marks: { label: string; title: string }[] = [];
  if (flags.hidden) marks.push({ label: 'hidden', title: 'Hidden in the Power BI field list (a building block for other measures)' });
  if (flags.displayHelper) marks.push({ label: 'label helper', title: 'Constant that exists for its dynamic format string — not published' });
  else if (flags.dynamicFormat) marks.push({ label: 'dynamic format', title: `Format string: ${flags.dynamicFormat}` });
  if (flags.quickMeasure) marks.push({ label: 'quick measure', title: `Quick measure template: ${flags.quickMeasure}` });
  if (flags.kpi) marks.push({ label: 'KPI', title: 'Has a KPI (target / status) in the model' });
  if (!marks.length) return null;
  return (
    <>
      {marks.map((m) => (
        <span key={m.label} title={m.title} className="ml-1.5 align-middle text-[10px] font-normal text-[var(--estate-text-dim)]">
          {m.label}
        </span>
      ))}
    </>
  );
}

type MeasureRow = ModelDetail['measures'][number];

const REGRESSED_PREFIX = 'Matched Power BI before, now: ';

function sentenceCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function clip(list: string[], n: number): string {
  return list.slice(0, n).join(', ') + (list.length > n ? ` +${list.length - n}` : '');
}

/** Eyebrow label for a section of the opened measure. */
function MeasureSectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--estate-text-muted)]">{children}</span>
      {aside}
    </div>
  );
}

/**
 * Opened measure: diagnosis → evidence → facts → DAX.
 * One message per idea — the parity summary appears once, not in detail, reason and regression note.
 */
function MeasureDetail({
  modelId,
  measure: m,
  graphOpen,
  onToggleGraph,
}: {
  modelId: string;
  measure: MeasureRow;
  graphOpen: boolean;
  onToggleGraph: () => void;
}) {
  const text = useMeasureText(modelId, m.id);
  const rc = m.root_cause ?? null;
  const stageMeta = m.recreation_stage ? RECREATION_STAGE_META[m.recreation_stage] : null;
  const regressed = m.recreation_stage === 'regressed';

  let reason = m.recreation_reason?.trim() || null;
  if (reason?.startsWith(REGRESSED_PREFIX)) reason = reason.slice(REGRESSED_PREFIX.length).trim() || null;
  const headline = rc?.detail?.trim() || reason;
  const extraReason =
    reason && headline && reason !== headline && !headline.includes(reason) && !reason.includes(headline) ? reason : null;

  const showDiagnosis = Boolean(rc || headline);
  const tone: Tone = stageMeta?.tone ?? 'neutral';
  const title = rc ? sentenceCase(ROOT_CAUSE_LABEL[rc.category] ?? rc.category) : stageMeta?.label ?? 'Status';

  const flags = m.definition;
  const logic = m.measure_logic;
  const cols = m.column_resolution;

  const facts: [string, React.ReactNode][] = [];
  if (m.uc_source_table) {
    facts.push([
      'Source',
      <span key="src" className="inline-flex flex-wrap items-center gap-1.5">
        <code className="font-mono text-[var(--estate-ink)]">{m.uc_source_table}</code>
        {m.translation_tier && <Tag title="Translation tier">{m.translation_tier} tier</Tag>}
      </span>,
    ]);
  }
  if (logic) {
    facts.push([
      'Logic',
      <span key="logic" className="font-mono">
        {logic.complexity_class} <span className="text-[var(--estate-text-dim)]">→</span> {logic.reproduction_strategy}
      </span>,
    ]);
    if (logic.aggregation_hint) facts.push(['Aggregation', <span key="agg" className="font-mono">{logic.aggregation_hint}</span>]);
    if (logic.calc_columns.length) facts.push(['Calc columns', <span key="calc" className="font-mono">{clip(logic.calc_columns, 3)}</span>]);
    if (logic.pq_filter_count > 0) facts.push(['Power Query', `${logic.pq_filter_count} filter step${logic.pq_filter_count === 1 ? '' : 's'}`]);
  }
  if (cols && cols.ref_count > 0) {
    facts.push([
      'Catalog columns',
      <span key="cols">
        {cols.mapped_count} of {cols.ref_count} DAX refs mapped
        {cols.unmapped.length > 0 && (
          <span className="text-[var(--estate-text-muted)]">
            {' '}· unmapped <span className="font-mono">{clip(cols.unmapped, 4)}</span>
          </span>
        )}
      </span>,
    ]);
  }
  if (flags?.dynamicFormat) {
    facts.push([
      'Dynamic format',
      <span key="fmt">
        <code className="font-mono">{flags.dynamicFormat}</code>
        {flags.displayHelper && <span className="text-[var(--estate-text-muted)]"> · label helper, not published</span>}
      </span>,
    ]);
  }
  if (flags?.synonyms?.length) {
    facts.push([
      'Also asked as',
      <span key="syn" className="inline-flex flex-wrap gap-1">
        {flags.synonyms.map((s) => (
          <Tag key={s}>{s}</Tag>
        ))}
      </span>,
    ]);
  }

  const harvestGap = logic?.harvest_gap_refs?.length ? logic.harvest_gap_refs : null;
  const blockReason = logic?.block_automated_sql ? logic.block_reason : null;

  return (
    <div className="space-y-4 border-t border-dashed border-[var(--estate-border)] bg-[var(--estate-hover)] px-4 pb-4 pl-10 pt-3">
      {flags?.description && <p className="max-w-[72ch] text-ui-regular text-[var(--estate-ink)]">{flags.description}</p>}

      {showDiagnosis && (
        <Callout
          tone={tone}
          icon={tone === 'red' ? <AlertCircle className="size-4" /> : tone === 'amber' ? <AlertTriangle className="size-4" /> : undefined}
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              {title}
              {regressed && (
                <span className="text-caption font-normal text-[var(--estate-text-muted)]">· matched Power BI before</span>
              )}
            </span>
          }
        >
          <div className="space-y-1.5">
            {headline && <p className="break-words text-[var(--estate-ink)]">{headline}</p>}
            {extraReason && <p className="break-words">{extraReason}</p>}
            {rc?.fix && (
              <p className="text-caption">
                <span className="font-semibold text-[var(--estate-text-secondary)]">What to check: </span>
                {rc.fix}
              </p>
            )}
          </div>
        </Callout>
      )}

      {(harvestGap || blockReason) && (
        <Callout tone="amber" icon={<AlertTriangle className="size-4" />} title={harvestGap ? 'Harvest gap' : 'SQL blocked'}>
          {harvestGap && (
            <p>
              Not captured: <span className="font-mono">{clip(harvestGap, 4)}</span>
            </p>
          )}
          {blockReason && <p>{blockReason}</p>}
        </Callout>
      )}

      {rc?.evidence?.length ? (
        <section className="space-y-2">
          <MeasureSectionLabel>Evidence</MeasureSectionLabel>
          <ul className="divide-y divide-[var(--estate-border)] overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-raised)]">
            {rc.evidence.map((f) => (
              <li key={f.detector} className="grid gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[180px_1fr]">
                <span>
                  <Tag tone="amber">{PATTERN_LABEL[f.detector] ?? f.detector}</Tag>
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-caption text-[var(--estate-ink)]">{f.evidence}</p>
                  {f.action && (
                    <p className="flex gap-1.5 text-caption text-[var(--estate-text-muted)]">
                      <ChevronRight className="mt-0.5 size-3 shrink-0" aria-hidden />
                      <span>{f.action}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {facts.length > 0 && (
        <section className="space-y-2">
          <MeasureSectionLabel>Recreation</MeasureSectionLabel>
          <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-6 gap-y-1.5 text-caption">
            {facts.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-[var(--estate-text-muted)]">{k}</dt>
                <dd className="m-0 min-w-0 break-words text-[var(--estate-ink)]">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex justify-end">
          <button
            type="button"
            aria-expanded={graphOpen}
            onClick={onToggleGraph}
            className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')}
          >
            <GitBranch className="size-3.5" aria-hidden />
            {graphOpen ? 'Hide dependency graph' : 'Show dependency graph'}
          </button>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <MeasureSectionLabel>Power BI DAX</MeasureSectionLabel>
            <CodeBlock code={text.data?.dax || m.dax_preview || '— no DAX captured —'} maxHeight={360} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <MeasureSectionLabel
              aside={
                text.data?.sql && m.translation_tier ? (
                  <span className="text-[10px] text-[var(--estate-text-muted)]">{m.translation_tier} tier</span>
                ) : undefined
              }
            >
              Databricks SQL
            </MeasureSectionLabel>
            {text.loading ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-[var(--estate-border)] bg-[var(--estate-bg)] px-3 py-2.5 text-caption text-[var(--estate-text-muted)]">
                <Loader2 className="size-3 animate-spin" aria-hidden /> Loading SQL…
              </p>
            ) : text.error ? (
              <p className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-bg)] px-3 py-2.5 text-caption text-[var(--estate-text-muted)]">
                Couldn’t load SQL: {text.error}
              </p>
            ) : text.data?.sql ? (
              <CodeBlock code={text.data.sql} maxHeight={360} />
            ) : (
              <p className="rounded-lg border border-dashed border-[var(--estate-border)] px-3 py-2.5 text-caption text-[var(--estate-text-muted)]">
                No Databricks SQL yet{m.recreation_stage === 'no_uc' ? ' — the measure has no Unity Catalog binding.' : ' — run Translate for this model.'}
              </p>
            )}
          </div>
        </div>
        {graphOpen && <MeasureDependencyGraph modelId={modelId} measure={m.name} />}
      </section>
    </div>
  );
}

type MeasureText = { dax: string; sql: string | null; tier: string | null; translated_at: string | null };

/** Full DAX + translated Databricks SQL for one measure, fetched when it is opened. */
function useMeasureText(modelId: string, measureId: string) {
  const [state, setState] = useState<{ key: string; data: MeasureText | null; error: string | null } | null>(null);
  const key = `${modelId}/${measureId}`;
  useEffect(() => {
    let alive = true;
    fetch(`/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/measures/${encodeURIComponent(measureId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        return json as MeasureText;
      })
      .then((data) => alive && setState({ key, data, error: null }))
      .catch((err: unknown) => alive && setState({ key, data: null, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      alive = false;
    };
  }, [key, modelId, measureId]);
  const current = state?.key === key ? state : null;
  return { loading: !current, data: current?.data ?? null, error: current?.error ?? null };
}

function MeasuresTab({
  modelId,
  measures,
  query,
  setQuery,
  focus,
}: {
  modelId: string;
  measures: ModelDetail['measures'];
  query: string;
  setQuery: (q: string) => void;
  /** Measure to open with its dependency graph (from Model health); `seq` re-triggers. */
  focus: { name: string; seq: number } | null;
}) {
  // undefined = no explicit choice yet, so a search that narrows to one measure opens it.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [graphOpen, setGraphOpen] = useState<Set<string>>(() => new Set());
  // Open a measure requested from Model health (once per request seq, adjusted during render).
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  if (focus && focus.seq !== handledFocus) {
    setHandledFocus(focus.seq);
    const m = measures.find((x) => x.name === focus.name);
    if (m) {
      setOpenId(m.id);
      setGraphOpen((prev) => new Set(prev).add(m.id));
    }
  }
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return measures;
    return measures.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.table_name.toLowerCase().includes(q) ||
        (m.display_folder ?? '').toLowerCase().includes(q),
    );
  }, [measures, query]);

  const autoOpenId = query && filtered.length === 1 ? filtered[0].id : null;

  if (measures.length === 0) {
    return <p className="py-6 text-ui-regular text-[var(--estate-text-muted)]">No measures in this model.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-full max-w-sm">
          <SearchInput value={query} onChange={setQuery} placeholder="Filter measures, tables, folders" label="Filter measures" />
        </div>
        <span className="text-caption text-[var(--estate-text-muted)]">
          {filtered.length === measures.length ? `${measures.length} measures` : `${filtered.length} of ${measures.length}`}
        </span>
      </div>
      <div className="overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-ui-regular text-[var(--estate-text-muted)]">No measures match “{query}”.</p>
        ) : (
          <ul className="divide-y divide-[var(--estate-border)]">
            {filtered.map((m) => {
              const open = openId === undefined ? autoOpenId === m.id : openId === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : m.id)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--estate-hover)]"
                  >
                    {open ? (
                      <ChevronDown className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
                    )}
                    <span
                      className="w-[32%] min-w-[140px] shrink-0 truncate text-ui font-medium text-[var(--estate-ink)]"
                      title={m.definition?.description ? `${m.name}\n\n${m.definition.description}` : m.name}
                    >
                      {m.name}
                      <MeasureFlagMarks flags={m.definition} />
                    </span>
                    <span className="w-[22%] min-w-[100px] shrink-0 truncate text-caption text-[var(--estate-text-muted)]">
                      {m.table_name}
                      {m.display_folder && <span className="text-[var(--estate-text-dim)]"> / {m.display_folder}</span>}
                    </span>
                    <span className="shrink-0">
                      {m.recreation_stage && <RecreationStageTag stage={m.recreation_stage} />}
                    </span>
                    {!open && (
                      <span className="min-w-0 flex-1 truncate font-mono text-caption text-[var(--estate-text-dim)]">
                        {m.dax_preview.replace(/\s+/g, ' ')}
                      </span>
                    )}
                  </button>
                  {open && (
                    <MeasureDetail
                      modelId={modelId}
                      measure={m}
                      graphOpen={graphOpen.has(m.id)}
                      onToggleGraph={() =>
                        setGraphOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function TablesTab({ tables }: { tables: ModelDetail['tables'] }) {
  if (tables.length === 0) {
    return <p className="py-6 text-ui-regular text-[var(--estate-text-muted)]">No tables in this model.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]">
      <table className="w-full min-w-[560px] text-left text-ui-regular">
        <thead className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg,var(--estate-raised))] text-caption text-[var(--estate-text-muted)]">
          <tr>
            <th className="px-4 py-2 font-medium">Table</th>
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium">Unity Catalog object</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--estate-border)]">
          {tables.map((t) => {
            const b = t.binding as Binding;
            return (
              <tr key={t.id} className="hover:bg-[var(--estate-hover)]">
                <td className="px-4 py-2 font-medium text-[var(--estate-ink)]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span title={t.definition?.description}>{t.name}</span>
                    {t.definition?.hidden && <Tag title="Hidden in the Power BI field list">hidden</Tag>}
                    {t.definition?.incrementalRefresh && (
                      <Tag tone="amber" title={`Incremental refresh: ${t.definition.incrementalRefresh}. Power BI holds only this window; recreated SQL applies it.`}>
                        incremental refresh
                      </Tag>
                    )}
                    {t.definition?.fieldParameter && <Tag tone="violet" title="Field parameter: lets report users switch fields; not data">field parameter</Tag>}
                    {t.definition?.calculationGroup != null && (
                      <Tag tone="violet" title="Calculation group: its items rewrite measures in visuals">{t.definition.calculationGroup} calc items</Tag>
                    )}
                  </div>
                  {t.definition?.description && (
                    <p className="mt-0.5 text-caption font-normal text-[var(--estate-text-muted)]">{t.definition.description}</p>
                  )}
                </td>
                <td className="px-4 py-2">
                  <Tag tone={partitionTone(t.partition_kind)}>{humanize(t.partition_kind)}</Tag>
                </td>
                <td className="px-4 py-2">
                  {b?.context_object_id ? (
                    <Link
                      href={`/agent-lab/estate/object/${b.context_object_id}`}
                      className="inline-flex items-center gap-1.5 font-mono text-caption text-[var(--brand-a)] hover:underline"
                    >
                      <Database className="size-3" aria-hidden />
                      {b.uc_full_path ?? 'Catalog object'}
                    </Link>
                  ) : b?.uc_full_path ? (
                    <span className="font-mono text-caption text-[var(--estate-text-secondary)]">{b.uc_full_path}</span>
                  ) : b?.bind_status ? (
                    <Tag tone="neutral">{humanize(b.bind_status)}</Tag>
                  ) : (
                    <span className="text-caption text-[var(--estate-text-dim)]">Not bound</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportsTab({
  reports,
  pbiModelId,
}: {
  reports: ModelDetail['reports'];
  pbiModelId: string;
}) {
  if (reports.length === 0) {
    return <p className="py-6 text-ui-regular text-[var(--estate-text-muted)]">No reports use this model.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--estate-border)] overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]">
      {reports.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
          <FileBarChart className="size-4 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ui text-[var(--estate-ink)]" title={r.name}>
            {r.name}
          </span>
          {r.report_format && (
            <Tag tone="neutral" mono>
              {humanize(r.report_format)}
            </Tag>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {r.pbi_report_id && (
              <PbiReportHarvestButton
                pbiModelId={pbiModelId}
                pbiReportId={r.pbi_report_id}
                reportName={r.name}
              />
            )}
            {r.open_url ? (
              <a
                href={r.open_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(CATALOG_BTN, 'shrink-0')}
                title={r.open_url_synthesized ? 'Link built from workspace + report id (not from Power BI webUrl)' : undefined}
              >
                Open in Power BI <ExternalLink className="size-3" aria-hidden />
                {r.open_url_synthesized && <span className="sr-only"> (synthesized link)</span>}
              </a>
            ) : (
              <span className="text-caption text-[var(--estate-text-dim)]" title="Run Refresh PBI inventory to load webUrl from Power BI">
                No link
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Pick any harvested report with a Power BI URL and open it. */
function OpenReportControl({
  reports,
  onBrowseReports,
}: {
  reports: ModelDetail['reports'];
  onBrowseReports?: () => void;
}) {
  const openable = useMemo(
    () => reports.filter((r): r is typeof r & { open_url: string } => Boolean(r.open_url)),
    [reports],
  );
  const [reportId, setReportId] = useState('');

  useEffect(() => {
    setReportId((prev) => (prev && openable.some((r) => r.id === prev) ? prev : (openable[0]?.id ?? '')));
  }, [openable]);

  const selected = openable.find((r) => r.id === reportId) ?? openable[0];

  if (openable.length === 0) {
    if (reports.length > 0) {
      return (
        <button
          type="button"
          onClick={onBrowseReports}
          className={cn(ESTATE_HEADER_CHIP, 'ml-auto max-w-none text-[var(--estate-text-secondary)]')}
        >
          Reports <span className="tabular-nums text-[var(--estate-text-muted)]">{reports.length}</span>
        </button>
      );
    }
    return null;
  }

  if (openable.length === 1) {
    const r = openable[0];
    return (
      <a
        href={r.open_url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(ESTATE_HEADER_CHIP, 'ml-auto min-w-0 max-w-[min(100%,20rem)] text-[var(--estate-text-secondary)]')}
        title={r.name}
      >
        <span className="truncate">Open · {r.name}</span>
        <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
      </a>
    );
  }

  return (
    <div className="ml-auto flex min-w-0 max-w-full shrink-0 items-center gap-1.5">
      <Select
        aria-label="Report"
        className={cn(ESTATE_SELECT, 'h-8 w-[min(13.5rem,38vw)] min-w-[8rem]')}
        value={reportId}
        onChange={(e) => setReportId(e.target.value)}
      >
        {openable.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <a
        href={selected?.open_url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(ESTATE_HEADER_CHIP, 'max-w-none shrink-0 text-[var(--estate-text-secondary)]')}
        title={selected ? `Open “${selected.name}” in Power BI` : undefined}
        aria-disabled={!selected}
      >
        Open <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
      </a>
    </div>
  );
}

function ModelDetailView({
  detail,
  recreation,
  row,
  measureQuery,
  setMeasureQuery,
  tab,
  setTab,
  onAfterHarvest,
}: {
  detail: ModelDetail;
  recreation: RecreationSummary | null;
  row: ModelRow | null;
  measureQuery: string;
  setMeasureQuery: (q: string) => void;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  onAfterHarvest?: () => void;
}) {
  const parsed = modelHasParsedContent(detail, row) || Boolean(detail.classification?.answerability ?? row?.answerability);
  const { filter: status, showParsedBadge } = modelDisplayStatus(detail, row);
  const reportPbiIds = detail.reports.map((r) => r.pbi_report_id).filter(Boolean) as string[];
  const bound = detail.tables.filter((t) => {
    const b = t.binding as Binding;
    return Boolean(b?.context_object_id || b?.uc_full_path);
  }).length;
  const score = domainScoreLabel(detail.domain_assignment?.confidence ?? row?.domain_confidence);

  const [measureFocus, setMeasureFocus] = useState<{ name: string; seq: number } | null>(null);
  const openMeasure = (name: string) => {
    setMeasureQuery(name);
    setMeasureFocus((prev) => ({ name, seq: (prev?.seq ?? 0) + 1 }));
    setTab('measures');
  };

  const tabs: { id: DetailTab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: 'measures', label: 'Measures', count: detail.measures.length, icon: <Sigma className="size-3.5" aria-hidden /> },
    { id: 'tables', label: 'Tables', count: detail.tables.length, icon: <Table2 className="size-3.5" aria-hidden /> },
    { id: 'reports', label: 'Reports', count: detail.reports.length, icon: <FileBarChart className="size-3.5" aria-hidden /> },
    { id: 'health', label: 'Model health', icon: <HeartPulse className="size-3.5" aria-hidden /> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="space-y-3 border-b border-[var(--estate-border)] pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-title-section text-[var(--estate-ink)]">{detail.name}</h3>
            {showParsedBadge ? (
              <Tag tone="blue" dot title="Semantic model loaded from TMDL (measures and tables in estate DB)">
                Parsed
              </Tag>
            ) : (
              <StatusTag status={status} />
            )}
            {detail.domain?.name && (
              <Tag tone="brand" title={score ? `Domain assignment, ${score}` : 'Business domain'}>
                {detail.domain.name}
              </Tag>
            )}
            {row?.rls_required && (
              <Tag tone="violet" title="Row-level security required">
                <Shield className="size-3" aria-hidden /> RLS
              </Tag>
            )}
          </div>
          <p className="mt-1 text-caption text-[var(--estate-text-muted)]">
            {detail.workspace.name ?? detail.workspace.pbi_workspace_id}
            {row?.family_name && <> · Family: {row.family_name}</>}
            {parsed && detail.tables.length > 0 && (
              <>
                {' · '}
                <span title="Tables whose source resolves to a Unity Catalog object">
                  {bound} of {detail.tables.length} tables bound to Unity Catalog
                </span>
              </>
            )}
          </p>
          {detail.description && (
            <p className="mt-1 max-w-3xl text-ui-regular text-[var(--estate-text-secondary)]">{detail.description}</p>
          )}
        </div>
        <div
          className="flex items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="toolbar"
          aria-label="Model actions"
        >
          {parsed && <ModelOwnershipCard key={detail.id} modelId={detail.id} compact />}
          {parsed && recreation && recreation.sql_drafted > 0 && (
            <ModelRecreationPanel
              modelName={detail.name}
              recreation={recreation}
              measures={detail.measures}
              onOpenMeasure={openMeasure}
            />
          )}
          {parsed && <OpenReportControl reports={detail.reports} onBrowseReports={() => setTab('reports')} />}
          <PbiPipelineRunButton
            key={`${detail.pbi_model_id}:${parsed}`}
            pbiModelId={detail.pbi_model_id}
            reportPbiIds={reportPbiIds}
            parsed={parsed}
            hasDefinition={detail.has_definition !== false}
            onQueued={onAfterHarvest}
            className={parsed ? undefined : 'ml-0'}
          />
        </div>
      </header>

      {!parsed ? (
        <Callout
          tone="neutral"
          icon={<AlertCircle className="size-4" />}
          title="This model has not been parsed yet"
        >
          Only inventory metadata is in the estate DB. Use <strong>Run pipeline</strong> above (harvest stages are added automatically) to fetch TMDL
          from Fabric and load tables and measures.
          {detail.has_definition === false && (
            <span className="mt-1 block text-caption text-[var(--estate-text-muted)]">
              No model definition on disk yet — run that flow (not Parse alone).
            </span>
          )}
        </Callout>
      ) : (
        <>
          <ModelDataSources key={`notice:${detail.id}`} modelId={detail.id} variant="notice" onShowSources={() => setTab('tables')} />
          <div>
            <div role="tablist" aria-label="Model contents" className="mb-3 flex gap-1 border-b border-[var(--estate-border)]">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-ui transition-colors duration-hover',
                    tab === t.id
                      ? 'border-[var(--brand-a)] text-[var(--estate-ink)]'
                      : 'border-transparent text-[var(--estate-text-muted)] hover:text-[var(--estate-ink)]',
                  )}
                >
                  {t.icon}
                  {t.label}
                  {t.count !== undefined && (
                    <span className="rounded-full bg-[var(--estate-raised)] px-1.5 text-caption tabular-nums text-[var(--estate-text-secondary)]">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {tab === 'measures' && (
                <MeasuresTab
                  key={detail.id}
                  modelId={detail.id}
                  measures={detail.measures}
                  query={measureQuery}
                  setQuery={setMeasureQuery}
                  focus={measureFocus}
                />
              )}
              {tab === 'tables' && (
                <div className="space-y-3">
                  <ModelDataSources key={`sources:${detail.id}`} modelId={detail.id} />
                  <ModelDefinitionCard key={`definition:${detail.id}`} modelId={detail.id} />
                  <TablesTab tables={detail.tables} />
                </div>
              )}
              {tab === 'reports' && (
                <ReportsTab reports={detail.reports} pbiModelId={detail.pbi_model_id} />
              )}
              {tab === 'health' && <ModelHealthPanel modelId={detail.id} onOpenMeasure={openMeasure} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<Exclude<StatusFilter, 'all'>, number> = {
  answerable: 0,
  caveated: 1,
  blocked: 2,
  unparsed: 3,
};

export default function EstatePowerBiPage() {
  const searchParams = useSearchParams();
  const initialModel = searchParams.get('model');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialModel);
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [recreation, setRecreation] = useState<RecreationSummary | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [conflictBusyId, setConflictBusyId] = useState<string | null>(null);
  const [measureQuery, setMeasureQuery] = useState('');
  const [tab, setTab] = useState<DetailTab>('measures');
  const pbiLevel = useSectionLevel('estate.powerbi');
  const canSteward = pbiLevel === 'manage';
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setErr(null);
    try {
      const modelQs = new URLSearchParams();
      if (workspaceFilter) modelQs.set('workspace_id', workspaceFilter);
      if (domainFilter) modelQs.set('domain_key', domainFilter);
      const modelUrl = `/api/agent-lab/powerbi/models${modelQs.size ? `?${modelQs}` : ''}`;

      const [sumRes, wsRes, modRes, domRes, conflictRes] = await Promise.all([
        fetch('/api/agent-lab/powerbi/summary'),
        fetch('/api/agent-lab/powerbi/workspaces'),
        fetch(modelUrl),
        fetch('/api/agent-lab/powerbi/domains'),
        fetch('/api/agent-lab/powerbi/conflicts?status=proposed'),
      ]);
      if (sumRes.status === 401) {
        setErr('Sign in to view Power BI harvest data.');
        return;
      }
      if (sumRes.status === 403) {
        setErr('You do not have access to the Power BI estate view (estate admin required).');
        return;
      }
      if (!sumRes.ok || !wsRes.ok || !modRes.ok) throw new Error('Failed to load Power BI data');
      setSummary((await sumRes.json()) as Summary);
      const wsJson = (await wsRes.json()) as { workspaces: WorkspaceRow[] };
      const modJson = (await modRes.json()) as { models: ModelRow[] };
      setWorkspaces(wsJson.workspaces);
      setModels(modJson.models);
      if (domRes.ok) {
        const domJson = (await domRes.json()) as { domains: DomainRow[] };
        setDomains(domJson.domains);
      }
      if (conflictRes.ok) {
        const cJson = (await conflictRes.json()) as { conflicts: ConflictRow[] };
        setConflicts(cJson.conflicts);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setListLoading(false);
      setInitialLoaded(true);
    }
  }, [workspaceFilter, domainFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  /**
   * Until the user picks one, show the first parsed model (from the unfiltered scope, so typing in
   * search does not swap the detail pane) so the page is never blank.
   */
  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    const parsed = models.filter((m) => statusOf(m) !== 'unparsed');
    parsed.sort((a, b) => STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)] || a.name.localeCompare(b.name));
    return parsed[0]?.id ?? null;
  }, [selectedId, models]);

  const loadDetail = useCallback(async (modelId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}`);
      if (!res.ok) throw new Error(`Detail ${res.status}`);
      const json = (await res.json()) as { model: ModelDetail; recreation?: RecreationSummary };
      setDetail(json.model);
      setRecreation(json.recreation ?? null);
    } catch {
      setDetail(null);
      setRecreation(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      setRecreation(null);
      return;
    }
    void loadDetail(activeId);
  }, [activeId, loadDetail]);

  /** Counts per status for the current workspace/domain scope (before search + status filter). */
  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: models.length, answerable: 0, caveated: 0, blocked: 0, unparsed: 0 };
    for (const m of models) c[statusOf(m)] += 1;
    return c;
  }, [models]);

  const visibleModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models
      .filter((m) => statusFilter === 'all' || statusOf(m) === statusFilter)
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (m.domain_name ?? '').toLowerCase().includes(q) ||
          (m.workspace_name ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)] || a.name.localeCompare(b.name));
  }, [models, statusFilter, query]);

  const selectedModel = useMemo(() => models.find((m) => m.id === activeId) ?? null, [models, activeId]);

  const selectModel = useCallback((id: string, focusMeasure?: string) => {
    setSelectedId(id);
    setMeasureQuery(focusMeasure ?? '');
    setTab('measures');
  }, []);

  const acknowledgeConflict = useCallback(
    async (id: string) => {
      if (!canSteward) return;
      setConflictBusyId(id);
      try {
        const res = await fetch(`/api/agent-lab/powerbi/conflicts/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'acknowledged' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setConflicts((prev) => prev.filter((c) => c.id !== id));
      } catch {
        /* keep in list */
      } finally {
        setConflictBusyId(null);
      }
    },
    [canSteward],
  );

  if (!initialLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--estate-text-muted)]">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="ml-2 text-ui-regular">Loading Power BI estate…</span>
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-8 text-[var(--estate-text-muted)]" aria-hidden />
        <p className="max-w-md text-ui-regular text-[var(--estate-text-secondary)]">{err}</p>
        <Link href="/agent-lab/estate/jobs" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1')}>
          Open Jobs
        </Link>
      </div>
    );
  }

  const parsedPct = summary && summary.models > 0 ? (summary.models_parsed / summary.models) * 100 : 0;
  const filtersActive = statusFilter !== 'all' || Boolean(query) || Boolean(workspaceFilter) || Boolean(domainFilter);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[var(--estate-bg)]">
      {/* ── Stats bar (the estate layout already shows the page title) ── */}
      <div className="shrink-0 border-b border-[var(--estate-border)] px-4 py-1.5 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
          {summary && (
            <>
              <Stat value={summary.models} label="models" title={`${summary.workspaces} workspaces · ${summary.reports} reports`} />
              <StatDivider />
              <span
                className="inline-flex items-center gap-2 whitespace-nowrap"
                title="Models whose definition has been read by PBI Parse"
              >
                <Stat value={`${summary.models_parsed}/${summary.models}`} label="parsed" />
                <span className="block h-1 w-14 overflow-hidden rounded-full bg-[var(--estate-border)]">
                  <span
                    className="block h-full rounded-full bg-[var(--brand-a)]"
                    style={{ width: `${Math.max(parsedPct > 0 ? 3 : 0, Math.min(100, parsedPct))}%` }}
                  />
                </span>
              </span>
              <span className="text-[var(--estate-text-muted)]" title="Use list filters for answerable / caveated / unparsed">
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: TONE_COLOR.green }} />
                  {summary.models_answerable}
                </span>
                {' · '}
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: TONE_COLOR.amber }} />
                  {summary.models_caveated}
                </span>
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {conflicts.length > 0 && (
              <StatToggle
                icon={<AlertTriangle className="size-3.5" style={{ color: TONE_COLOR.amber }} aria-hidden />}
                value={conflicts.length}
                label="measure conflicts"
                active={conflictsOpen}
                onClick={() => setConflictsOpen((o) => !o)}
                title="Same measure name with different DAX in several models"
              />
            )}
            <Link href="/agent-lab/estate/jobs" className={CATALOG_BTN}>
              Harvest jobs
            </Link>
          </div>
        </div>

        {conflictsOpen && conflicts.length > 0 && (
          <ConflictsPanel
            conflicts={conflicts}
            canSteward={canSteward}
            busyId={conflictBusyId}
            onAcknowledge={(id) => void acknowledgeConflict(id)}
            onOpenModel={(id, measure) => selectModel(id, measure)}
            onClose={() => setConflictsOpen(false)}
          />
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="flex w-[min(100%,300px)] shrink-0 flex-col border-r border-[var(--estate-border)] bg-[var(--estate-raised)] sm:w-[300px]">
          <div className="space-y-2 border-b border-[var(--estate-border)] p-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={filtersActive ? `Search ${visibleModels.length} shown…` : `Search ${models.length} models…`}
              label="Search models"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
                  Workspace
                </span>
                <Select
                  aria-label="Workspace"
                  className={ESTATE_SELECT}
                  value={workspaceFilter ?? ''}
                  onChange={(e) => {
                    setWorkspaceFilter(e.target.value || null);
                    setSelectedId(null);
                  }}
                >
                  <option value="">All workspaces</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.model_count})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
                  Domain
                </span>
                <Select
                  aria-label="Business domain"
                  className={ESTATE_SELECT}
                  value={domainFilter ?? ''}
                  onChange={(e) => {
                    setDomainFilter(e.target.value || null);
                    setSelectedId(null);
                  }}
                >
                  <option value="">All domains</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.domain_key}>
                      {d.name} ({d.model_count})
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <div role="group" aria-label="Filter by status" className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                {(['all', 'answerable', 'caveated', 'blocked', 'unparsed'] as StatusFilter[])
                  .filter((s) => s === 'all' || s === statusFilter || statusCounts[s] > 0)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={statusFilter === s}
                      onClick={() => setStatusFilter(s)}
                      title={s === 'all' ? undefined : STATUS_META[s].hint}
                      className={cn(
                        'inline-flex h-6 items-center gap-0.5 rounded-md border px-1.5 text-[11px] transition-colors duration-hover',
                        statusFilter === s
                          ? 'border-[color-mix(in_srgb,var(--brand-a)_35%,var(--estate-border))] bg-[var(--estate-active-bg)] text-[var(--estate-ink)]'
                          : 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]',
                      )}
                    >
                      {s !== 'all' && (
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{ background: STATUS_STRIPE[s] }}
                        />
                      )}
                      {s === 'all'
                        ? 'All'
                        : s === 'answerable'
                          ? 'Ans'
                          : s === 'caveated'
                            ? 'Cav'
                            : s === 'blocked'
                              ? 'Blk'
                              : 'Unparsed'}
                      <span className="tabular-nums opacity-80">{statusCounts[s]}</span>
                    </button>
                  ))}
              </div>
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all');
                    setQuery('');
                    setWorkspaceFilter(null);
                    setDomainFilter(null);
                  }}
                  className="shrink-0 text-[11px] text-[var(--brand-a)] hover:underline"
                >
                  Clear
                </button>
              )}
              {listLoading && <Loader2 className="size-3 shrink-0 animate-spin text-[var(--estate-text-dim)]" aria-hidden />}
            </div>
          </div>

          <ul className={cn('min-h-0 flex-1 overflow-y-auto px-1 pb-1', listLoading && 'opacity-60')}>
            {models.length === 0 ? (
              <li className="p-4 text-ui-regular text-[var(--estate-text-muted)]">
                No models in inventory. Run <strong>PBI Inventory</strong> and <strong>PBI Parse</strong> from Jobs.
              </li>
            ) : visibleModels.length === 0 ? (
              <li className="p-4 text-ui-regular text-[var(--estate-text-muted)]">No models match these filters.</li>
            ) : (
              visibleModels.map((m) => (
                <ModelListItem key={m.id} model={m} selected={activeId === m.id} onSelect={() => selectModel(m.id)} />
              ))
            )}
          </ul>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {!activeId ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <BarChart3 className="size-8 text-[var(--estate-text-dim)]" aria-hidden />
              <p className="text-ui font-medium text-[var(--estate-ink)]">Pick a semantic model</p>
              <p className="max-w-sm text-ui-regular text-[var(--estate-text-muted)]">
                See its measures with DAX, its tables and their Unity Catalog bindings, and the reports built on it.
              </p>
            </div>
          ) : detailLoading && !detail ? (
            <div className="flex items-center gap-2 text-[var(--estate-text-muted)]">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading {selectedModel?.name ?? 'model'}…
            </div>
          ) : detail ? (
            <div className={cn(detailLoading && 'opacity-60 transition-opacity')}>
              <ModelDetailView
                detail={detail}
                recreation={recreation}
                row={selectedModel}
                measureQuery={measureQuery}
                setMeasureQuery={setMeasureQuery}
                tab={tab}
                setTab={setTab}
                onAfterHarvest={() => {
                  void loadList();
                  if (activeId) void loadDetail(activeId);
                }}
              />
            </div>
          ) : (
            <p className="text-ui-regular text-[var(--estate-text-muted)]">Could not load model detail.</p>
          )}
        </main>
      </div>
    </div>
  );
}
