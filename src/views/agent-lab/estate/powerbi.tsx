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
import { CATALOG_BTN, CATALOG_SELECT, CATALOG_SELECT_ARROW } from '@/components/estate/catalog-ui';
import { Callout, CodeBlock, Tag, type Tone } from '@/components/estate/object-ui';
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

type MeasureRecreationStage =
  | 'no_uc'
  | 'no_sql'
  | 'draft_sql'
  | 'parity_skip'
  | 'parity_error'
  | 'parity_fail'
  | 'recreated'
  | 'published';

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
};

type ModelDetail = {
  id: string;
  name: string;
  description: string | null;
  classification: { answerability?: string } | null;
  domain: { domain_key: string; name: string; rollout_wave: number } | null;
  domain_assignment: { domain_key?: string; confidence?: number } | null;
  workspace: { name: string | null; pbi_workspace_id: string };
  tables: { id: string; name: string; partition_kind: string | null; binding: unknown }[];
  measures: {
    id: string;
    name: string;
    table_name: string;
    display_folder: string | null;
    dax_preview: string;
    recreation_stage?: MeasureRecreationStage;
    recreation_reason?: string | null;
    translation_tier?: string | null;
    parity_verdict?: string | null;
    verified_query_status?: string | null;
    uc_source_table?: string | null;
    column_resolution?: {
      mapped_count: number;
      ref_count: number;
      unmapped: string[];
    } | null;
  }[];
  reports: { id: string; name: string; web_url: string | null }[];
};

type StatusFilter = 'all' | 'answerable' | 'caveated' | 'blocked' | 'unparsed';
type DetailTab = 'measures' | 'tables' | 'reports';

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

function StatusTag({ status }: { status: Exclude<StatusFilter, 'all'> }) {
  const meta = STATUS_META[status];
  return (
    <Tag tone={meta.tone} dot title={meta.hint}>
      {meta.label}
    </Tag>
  );
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

const RECREATION_STAGE: Record<
  MeasureRecreationStage,
  { label: string; tone: Tone; hint: string }
> = {
  published: {
    label: 'Published',
    tone: 'green',
    hint: 'Parity passed and a verified query is in the knowledge base.',
  },
  recreated: {
    label: 'Recreated',
    tone: 'green',
    hint: 'Databricks SQL matches Power BI oracle within tolerance; not published yet.',
  },
  parity_fail: { label: 'Mismatch', tone: 'red', hint: 'SQL ran but number differs from Power BI.' },
  parity_error: { label: 'SQL error', tone: 'red', hint: 'Warehouse rejected the translated SQL (often wrong columns).' },
  parity_skip: { label: 'Parity skipped', tone: 'amber', hint: 'Missing oracle or warehouse context.' },
  draft_sql: { label: 'Draft SQL', tone: 'blue', hint: 'Translation exists; parity not completed.' },
  no_sql: { label: 'No SQL', tone: 'amber', hint: 'UC bound but translate did not produce SQL.' },
  no_uc: { label: 'No UC', tone: 'neutral', hint: 'Cannot map measure to a Unity Catalog table.' },
};

function RecreationStageTag({ stage }: { stage: MeasureRecreationStage }) {
  const meta = RECREATION_STAGE[stage] ?? RECREATION_STAGE.no_uc;
  return (
    <Tag tone={meta.tone} title={meta.hint}>
      {meta.label}
    </Tag>
  );
}

function RecreationSummaryBar({ recreation }: { recreation: RecreationSummary }) {
  const { measures_total, parity_pass, published, sql_drafted, uc_resolved, parity_error } = recreation;
  if (measures_total === 0) return null;
  return (
    <div
      className="rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-3"
      title="Databricks recreation: Power BI measure value matches warehouse SQL (parity pass)"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-ui font-medium text-[var(--estate-ink)]">Databricks recreation</p>
        <p className="text-caption tabular-nums text-[var(--estate-text-muted)]">
          <span className="text-[var(--estate-ink)]">{parity_pass}</span> of {measures_total} measures match PBI (
          {recreation.recreation_pct}%)
          {published > 0 && (
            <>
              {' '}
              · <span className="text-[var(--estate-ink)]">{published}</span> published
            </>
          )}
        </p>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--estate-raised)]">
        {published > 0 && (
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${(published / measures_total) * 100}%` }}
            title={`${published} published`}
          />
        )}
        {(parity_pass - published) > 0 && (
          <div
            className="h-full bg-emerald-400"
            style={{ width: `${((parity_pass - published) / measures_total) * 100}%` }}
            title={`${parity_pass - published} parity pass (draft)`}
          />
        )}
        {parity_error > 0 && (
          <div
            className="h-full bg-red-400/80"
            style={{ width: `${(parity_error / measures_total) * 100}%` }}
            title={`${parity_error} SQL errors`}
          />
        )}
      </div>
      <p className="mt-2 text-caption text-[var(--estate-text-muted)]">
        UC-resolved {uc_resolved} · SQL drafted {sql_drafted}
        {recreation.parity_fail > 0 && <> · mismatch {recreation.parity_fail}</>}
        {recreation.parity_skip > 0 && <> · parity skipped {recreation.parity_skip}</>}
      </p>
    </div>
  );
}

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
      className="mt-3 overflow-hidden rounded-card border border-amber-500/30 bg-[var(--estate-surface)]"
    >
      <header className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" aria-hidden />
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
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'relative flex w-full flex-col gap-1 rounded-ctl px-3 py-2 text-left transition-colors duration-hover',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
          selected ? 'bg-[var(--estate-active-bg)]' : 'hover:bg-[var(--estate-hover)]',
        )}
      >
        {selected && (
          <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--brand-a)]" />
        )}
        <span
          className={cn(
            'truncate text-ui',
            parsed ? 'font-medium text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]',
          )}
          title={model.name}
        >
          {model.name}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-caption text-[var(--estate-text-muted)]">
          {parsed ? (
            <>
              <span
                aria-hidden
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  status === 'answerable' && 'bg-emerald-500',
                  status === 'caveated' && 'bg-amber-500',
                  status === 'blocked' && 'bg-red-500',
                )}
              />
              <span className="shrink-0">{STATUS_META[status].label}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">
                {model.measure_count} measures, {model.table_count} tables
              </span>
            </>
          ) : (
            <span className="shrink-0 italic">Not parsed</span>
          )}
          {model.rls_required && (
            <span className="inline-flex shrink-0 items-center gap-0.5" title="Row-level security required">
              <Shield className="size-3" aria-hidden /> RLS
            </span>
          )}
        </span>
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

function MeasuresTab({
  measures,
  query,
  setQuery,
}: {
  measures: ModelDetail['measures'];
  query: string;
  setQuery: (q: string) => void;
}) {
  // undefined = no explicit choice yet, so a search that narrows to one measure opens it.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
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
                    <span className="w-[32%] min-w-[140px] shrink-0 truncate text-ui font-medium text-[var(--estate-ink)]" title={m.name}>
                      {m.name}
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
                    <div className="space-y-2 px-4 pb-3 pl-10">
                      {m.recreation_reason && (
                        <p className="text-caption text-[var(--estate-text-secondary)]">
                          {m.recreation_reason}
                          {m.uc_source_table && (
                            <span className="text-[var(--estate-text-muted)]">
                              {' '}
                              · UC via {m.uc_source_table}
                              {m.translation_tier && ` · ${m.translation_tier} tier`}
                            </span>
                          )}
                        </p>
                      )}
                      {m.column_resolution && m.column_resolution.ref_count > 0 && (
                        <p className="text-caption text-[var(--estate-text-muted)]">
                          Catalog columns: {m.column_resolution.mapped_count}/
                          {m.column_resolution.ref_count} DAX refs mapped
                          {m.column_resolution.unmapped.length > 0 && (
                            <span className="text-[var(--estate-text-secondary)]">
                              {' '}
                              · unmapped: {m.column_resolution.unmapped.slice(0, 4).join(', ')}
                              {m.column_resolution.unmapped.length > 4 ? '…' : ''}
                            </span>
                          )}
                        </p>
                      )}
                      <CodeBlock code={m.dax_preview || '— no DAX captured —'} maxHeight={320} />
                    </div>
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
                <td className="px-4 py-2 font-medium text-[var(--estate-ink)]">{t.name}</td>
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

function ReportsTab({ reports }: { reports: ModelDetail['reports'] }) {
  if (reports.length === 0) {
    return <p className="py-6 text-ui-regular text-[var(--estate-text-muted)]">No reports use this model.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--estate-border)] overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]">
      {reports.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
          <FileBarChart className="size-4 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ui text-[var(--estate-ink)]">{r.name}</span>
          {r.web_url && (
            <a href={r.web_url} target="_blank" rel="noopener noreferrer" className={cn(CATALOG_BTN, 'shrink-0')}>
              Open in Power BI <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </li>
      ))}
    </ul>
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
}: {
  detail: ModelDetail;
  recreation: RecreationSummary | null;
  row: ModelRow | null;
  measureQuery: string;
  setMeasureQuery: (q: string) => void;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
}) {
  const answer = (detail.classification?.answerability ?? row?.answerability ?? '').toLowerCase();
  const parsed = detail.tables.length > 0 || detail.measures.length > 0 || Boolean(answer);
  const status: Exclude<StatusFilter, 'all'> =
    answer === 'answerable' || answer === 'caveated' || answer === 'blocked' ? answer : 'unparsed';
  const bound = detail.tables.filter((t) => {
    const b = t.binding as Binding;
    return Boolean(b?.context_object_id || b?.uc_full_path);
  }).length;
  const score = domainScoreLabel(detail.domain_assignment?.confidence ?? row?.domain_confidence);
  const firstReportUrl = detail.reports.find((r) => r.web_url)?.web_url ?? null;

  const tabs: { id: DetailTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'measures', label: 'Measures', count: detail.measures.length, icon: <Sigma className="size-3.5" aria-hidden /> },
    { id: 'tables', label: 'Tables', count: detail.tables.length, icon: <Table2 className="size-3.5" aria-hidden /> },
    { id: 'reports', label: 'Reports', count: detail.reports.length, icon: <FileBarChart className="size-3.5" aria-hidden /> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-title-section text-[var(--estate-ink)]">{detail.name}</h3>
            <StatusTag status={status} />
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
        {firstReportUrl && (
          <a href={firstReportUrl} target="_blank" rel="noopener noreferrer" className={cn(CATALOG_BTN, 'shrink-0')}>
            Open in Power BI <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </header>

      {recreation && recreation.sql_drafted > 0 && (
        <RecreationSummaryBar recreation={recreation} />
      )}

      {!parsed ? (
        <Callout
          tone="neutral"
          icon={<AlertCircle className="size-4" />}
          title="This model has not been parsed yet"
          action={
            <Link href="/agent-lab/estate/jobs" className={CATALOG_BTN}>
              Open Jobs
            </Link>
          }
        >
          Only inventory metadata is available. Run <strong>PBI Parse</strong> to read its tables, measures and
          Unity Catalog bindings.
        </Callout>
      ) : (
        <>
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
                  <span className="rounded-full bg-[var(--estate-raised)] px-1.5 text-caption tabular-nums text-[var(--estate-text-secondary)]">
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {tab === 'measures' && (
                <MeasuresTab key={detail.id} measures={detail.measures} query={measureQuery} setQuery={setMeasureQuery} />
              )}
              {tab === 'tables' && <TablesTab tables={detail.tables} />}
              {tab === 'reports' && <ReportsTab reports={detail.reports} />}
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

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      setRecreation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/agent-lab/powerbi/models/${encodeURIComponent(activeId)}`);
        if (!res.ok) throw new Error(`Detail ${res.status}`);
        const json = (await res.json()) as { model: ModelDetail; recreation?: RecreationSummary };
        if (!cancelled) {
          setDetail(json.model);
          setRecreation(json.recreation ?? null);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
          setRecreation(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

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
  const toggleStatus = (s: StatusFilter) => setStatusFilter((cur) => (cur === s ? 'all' : s));
  const filtersActive = statusFilter !== 'all' || Boolean(query) || Boolean(workspaceFilter) || Boolean(domainFilter);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[var(--estate-bg)]">
      {/* ── Stats bar (the estate layout already shows the page title) ── */}
      <div className="shrink-0 border-b border-[var(--estate-border)] px-6 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {summary && (
            <>
              <Stat value={summary.workspaces} label={summary.workspaces === 1 ? 'workspace' : 'workspaces'} />
              <Stat value={summary.models} label="models" />
              <Stat value={summary.reports} label="reports" />
              <StatDivider />
              <span
                className="inline-flex items-center gap-2 whitespace-nowrap"
                title="Models whose definition has been read by PBI Parse"
              >
                <Stat value={`${summary.models_parsed} / ${summary.models}`} label="parsed" />
                <span className="block h-1 w-16 overflow-hidden rounded-full bg-[var(--estate-border)]">
                  <span
                    className="block h-full rounded-full bg-[var(--brand-a)]"
                    style={{ width: `${Math.max(parsedPct > 0 ? 3 : 0, Math.min(100, parsedPct))}%` }}
                  />
                </span>
              </span>
              <StatToggle
                dot="bg-emerald-500"
                value={summary.models_answerable}
                label="answerable"
                active={statusFilter === 'answerable'}
                onClick={() => toggleStatus('answerable')}
                title="Show only answerable models"
              />
              <StatToggle
                dot="bg-amber-500"
                value={summary.models_caveated}
                label="caveated"
                active={statusFilter === 'caveated'}
                onClick={() => toggleStatus('caveated')}
                title="Show only caveated models"
              />
              <StatDivider />
              <Stat value={summary.measures} label="measures" />
              <Stat value={summary.tables} label="tables" />
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {conflicts.length > 0 && (
              <StatToggle
                icon={<AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-300" aria-hidden />}
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
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-[var(--estate-border)] bg-[var(--estate-raised)]">
          <div className="space-y-2.5 border-b border-[var(--estate-border)] p-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Search models" label="Search models" />
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Workspace"
                className={cn(CATALOG_SELECT, 'h-8 w-full min-w-0 text-ui-regular')}
                style={CATALOG_SELECT_ARROW}
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
              </select>
              <select
                aria-label="Business domain"
                className={cn(CATALOG_SELECT, 'h-8 w-full min-w-0 text-ui-regular')}
                style={CATALOG_SELECT_ARROW}
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
              </select>
            </div>
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
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
                      'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-caption transition-colors duration-hover',
                      statusFilter === s
                        ? 'border-[var(--brand-a)] bg-[var(--brand-a)] text-[var(--on-brand)]'
                        : 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)]',
                    )}
                  >
                    {s === 'all' ? 'All' : STATUS_META[s].label}
                    <span className="tabular-nums opacity-75">{statusCounts[s]}</span>
                  </button>
                ))}
            </div>
          </div>

          <div className="flex items-center gap-2 px-4 pb-1 pt-2 text-caption text-[var(--estate-text-muted)]">
            {listLoading && <Loader2 className="size-3 animate-spin" aria-hidden />}
            <span>
              {visibleModels.length === models.length
                ? `${models.length} models`
                : `${visibleModels.length} of ${models.length} models`}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setQuery('');
                  setWorkspaceFilter(null);
                  setDomainFilter(null);
                }}
                className="ml-auto text-[var(--brand-a)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          <ul className={cn('min-h-0 flex-1 overflow-y-auto px-2 pb-2', listLoading && 'opacity-60')}>
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
