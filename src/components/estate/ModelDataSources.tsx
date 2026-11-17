'use client';

/**
 * Where a Power BI model's data comes from, traced through Power Query and its helper queries:
 * Excel / CSV files on SharePoint or OneDrive, web feeds, dataflows, databases, Databricks.
 * `variant="notice"` shows a warning only when measures cannot be recreated because their data
 * is not in the warehouse; the default variant lists every source with the tables that read it.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { AlertTriangle, ArrowRight, Database, ExternalLink, FileSpreadsheet, FileText, Globe, Sigma, Workflow } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Callout, Tag, type Tone } from '@/components/estate/object-ui';
import type { ModelSourceGroup, ModelSourcesResponse } from '@/app/api/agent-lab/powerbi/models/[id]/sources/route';

const CLASS_META: Record<ModelSourceGroup['class'], { label: string; tone: Tone; hint: string }> = {
  file: {
    label: 'Not in warehouse',
    tone: 'amber',
    hint: 'Files, sites, feeds or dataflows: there is no Databricks table to recreate measures from',
  },
  database: {
    label: 'Database',
    tone: 'blue',
    hint: 'A SQL database: measures can be recreated when a Databricks replica is bound (Catalog link)',
  },
  warehouse: { label: 'In Databricks', tone: 'green', hint: 'Read directly from Databricks' },
  model: { label: 'In the model', tone: 'violet', hint: 'Rows entered in Power BI or a DAX calculated table' },
  unknown: { label: 'Unknown', tone: 'neutral', hint: 'Source could not be read from Power Query' },
};

function SourceIcon({ g }: { g: ModelSourceGroup }) {
  const cls = 'size-4 shrink-0 text-[var(--estate-text-dim)]';
  const f = g.origin.format;
  if (f === 'excel') return <FileSpreadsheet className={cls} aria-hidden />;
  if (f === 'csv' || f === 'text' || f === 'json' || f === 'xml' || f === 'pdf' || f === 'parquet') return <FileText className={cls} aria-hidden />;
  if (g.origin.system === 'web' || g.origin.system === 'odata') return <Globe className={cls} aria-hidden />;
  if (g.origin.system === 'dataflow') return <Workflow className={cls} aria-hidden />;
  if (g.class === 'model') return <Sigma className={cls} aria-hidden />;
  return <Database className={cls} aria-hidden />;
}

function useModelSources(modelId: string) {
  const [data, setData] = useState<ModelSourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // callers key this component by model id, so state starts empty for each model
    let alive = true;
    fetch(`/api/agent-lab/powerbi/models/${modelId}/sources`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ModelSourcesResponse;
      })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [modelId]);
  return { data, error };
}

function LocationLink({ href }: { href: string }) {
  if (!/^https?:\/\//i.test(href)) return <span className="break-all font-mono text-size-eyebrow">{href}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-w-0 items-center gap-1 break-all text-[var(--brand-a)] hover:underline"
    >
      {href}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

/** Display order: what blocks recreation first, then what already works. */
const CLASS_ORDER: ModelSourceGroup['class'][] = ['file', 'database', 'unknown', 'warehouse', 'model'];

/** Sources that share a server + database are listed under one connection heading. */
function connectionOf(g: ModelSourceGroup): { key: string; label: string; detail: string | null } | null {
  if (g.class !== 'database' && g.class !== 'warehouse') return null;
  const o = g.origin;
  if (!o.location && !o.database) return null;
  return {
    key: [o.system, o.connector, o.location, o.database].join('|'),
    label: g.title,
    detail: [o.location, o.database].filter(Boolean).join(' / ') || null,
  };
}

const CHIP = 'inline-flex max-w-full items-center rounded border border-[var(--estate-border)] px-1.5 py-px text-size-eyebrow leading-4';

function TableChip({ t }: { t: ModelSourceGroup['tables'][number] }) {
  if (t.context_object_id) {
    return (
      <Link
        href={`/agent-lab/estate/object/${t.context_object_id}`}
        title={t.uc_full_path ? `Bound to ${t.uc_full_path}` : 'Open catalog object'}
        className={cn(CHIP, 'bg-[var(--estate-surface)] text-[var(--brand-a)] hover:underline')}
      >
        <span className="truncate">{t.name}</span>
      </Link>
    );
  }
  return (
    <span
      title={[t.uc_full_path && `Bound to ${t.uc_full_path}`, t.bind_status && `Binding: ${t.bind_status}`].filter(Boolean).join(' · ') || undefined}
      className={cn(CHIP, 'bg-[var(--estate-surface)] text-[var(--estate-text-secondary)]')}
    >
      <span className="truncate">{t.name}</span>
    </span>
  );
}

/** One source on one line: what it reads → the Power BI tables that read it. */
function SourceRow({ g, nested }: { g: ModelSourceGroup; nested: boolean }) {
  const o = g.origin;
  const isObject = !!o.object && !o.file;
  const primary = o.file ?? o.object ?? g.title;

  // second line only carries what is not already in the connection heading
  const secondary: React.ReactNode[] = [];
  if (o.items.length) secondary.push(o.items.map((i) => i.name).join(' · '));
  if (!nested) {
    const where = o.folder ?? (o.location ? parentOf(o.location, o.file) : null);
    if (where) secondary.push(<LocationLink key="loc" href={where} />);
    if (o.database && o.system === 'dataflow') secondary.push(`Dataflow ${o.database}`);
    if (o.file && g.title) secondary.unshift(g.title);
  }
  if (o.query && !o.object) secondary.push(<span key="q" className="font-mono text-size-eyebrow">{o.query.slice(0, 120)}</span>);

  return (
    <li className="grid gap-x-4 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-2.5">
        {!nested && <SourceIcon g={g} />}
        <div className="min-w-0">
          <div
            className={cn(
              'truncate text-[var(--estate-ink)]',
              isObject ? 'font-mono text-size-caption' : 'text-ui font-medium',
            )}
            title={primary}
          >
            {primary}
          </div>
          {secondary.length > 0 && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-[var(--estate-text-muted)]">
              {secondary.map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span aria-hidden>·</span>}
                  <span className="min-w-0 truncate">{s}</span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <ArrowRight className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" aria-label="read by" />
        <div className="flex min-w-0 flex-wrap gap-1">
          {g.tables.map((t) => (
            <TableChip key={t.name} t={t} />
          ))}
        </div>
      </div>
      <div className="sm:text-right">
        {g.blocked_measures > 0 && (
          <Tag tone="amber" title="Measures that can’t be recreated because they read this source">
            {g.blocked_measures} measure{g.blocked_measures === 1 ? '' : 's'} blocked
          </Tag>
        )}
      </div>
    </li>
  );
}

function ClassSection({ cls, sources }: { cls: ModelSourceGroup['class']; sources: ModelSourceGroup[] }) {
  const meta = CLASS_META[cls];
  // keep first-seen order of connections; unconnected sources come first
  const loose: ModelSourceGroup[] = [];
  const conns = new Map<string, { label: string; detail: string | null; icon: ModelSourceGroup; items: ModelSourceGroup[] }>();
  for (const g of sources) {
    const c = connectionOf(g);
    if (!c) {
      loose.push(g);
      continue;
    }
    const hit = conns.get(c.key);
    if (hit) hit.items.push(g);
    else conns.set(c.key, { label: c.label, detail: c.detail, icon: g, items: [g] });
  }
  const blocked = sources.reduce((n, g) => n + g.blocked_measures, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-y border-[var(--estate-border)] bg-[var(--estate-raised)] px-4 py-1.5">
        <Tag tone={meta.tone} dot>
          {meta.label}
        </Tag>
        <span className="text-caption font-medium text-[var(--estate-text-secondary)]">
          {sources.length} source{sources.length === 1 ? '' : 's'}
        </span>
        <span className="hidden text-caption text-[var(--estate-text-muted)] sm:inline">{meta.hint}</span>
        {blocked > 0 && (
          <span className="ml-auto text-caption text-[var(--estate-text-muted)]">
            {blocked} measure{blocked === 1 ? '' : 's'} blocked
          </span>
        )}
      </div>
      {loose.length > 0 && (
        <ul className="divide-y divide-[var(--estate-border)]">
          {loose.map((g) => (
            <SourceRow key={g.key} g={g} nested={false} />
          ))}
        </ul>
      )}
      {[...conns.entries()].map(([key, c]) => (
        <div key={key} className="border-t border-[var(--estate-border)] first:border-t-0">
          <div className="flex min-w-0 items-center gap-2.5 px-4 pb-1 pt-2.5">
            <SourceIcon g={c.icon} />
            <span className="shrink-0 text-ui font-medium text-[var(--estate-ink)]">{c.label}</span>
            {c.detail && (
              <span className="min-w-0 truncate font-mono text-size-eyebrow text-[var(--estate-text-muted)]" title={c.detail}>
                {c.detail}
              </span>
            )}
            <span className="ml-auto shrink-0 text-caption text-[var(--estate-text-muted)]">
              {c.items.length} object{c.items.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="ml-[42px] divide-y divide-[var(--estate-border)] [&>li]:pl-0">
            {c.items.map((g) => (
              <SourceRow key={g.key} g={g} nested />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Folder part of a path or URL when it ends with the file name (the name is already shown as the heading). */
function parentOf(location: string, file: string | null): string {
  if (!file) return location;
  const trimmed = location.replace(/[\\/]+$/, '');
  if (!trimmed.toLowerCase().endsWith(file.toLowerCase())) return location;
  return trimmed.slice(0, trimmed.length - file.length).replace(/[\\/]+$/, '') || location;
}

/** One blocked source in the notice: name, measure count, sheets, where it lives, tables that read it. */
function NoticeSourceRow({ g }: { g: ModelSourceGroup }) {
  const o = g.origin;
  const name = o.file ?? o.object ?? g.title;
  const where = o.folder ?? (o.location ? parentOf(o.location, o.file) : null);
  const chip =
    'inline-flex max-w-full items-center rounded border border-[var(--estate-border)] bg-[var(--estate-surface)] px-1.5 py-px text-size-eyebrow leading-4 text-[var(--estate-text-secondary)]';
  return (
    <li className="rounded-md border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <SourceIcon g={g} />
        <span className="min-w-0 truncate font-medium text-[var(--estate-ink)]" title={name}>
          {name}
        </span>
        <span className="hidden shrink-0 text-caption text-[var(--estate-text-muted)] sm:inline">{g.title}</span>
        <span className="ml-auto shrink-0">
          <Tag tone="amber">
            {g.blocked_measures} measure{g.blocked_measures === 1 ? '' : 's'}
          </Tag>
        </span>
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 pl-6 text-caption">
        {o.items.length > 0 && (
          <>
            <dt className="text-[var(--estate-text-muted)]">{o.items.length > 1 ? 'Sheets' : o.items[0]!.kind === 'Table' ? 'Table' : 'Sheet'}</dt>
            <dd className="flex flex-wrap gap-1">
              {o.items.map((i) => (
                <span key={`${i.kind}:${i.name}`} className={chip}>
                  {i.name}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt className="text-[var(--estate-text-muted)]">Used by</dt>
        <dd className="flex flex-wrap gap-1">
          {g.tables.map((t) => (
            <span key={t.name} className={chip}>
              {t.name}
            </span>
          ))}
        </dd>
        {where && (
          <>
            <dt className="text-[var(--estate-text-muted)]">Location</dt>
            <dd className="truncate font-mono text-size-eyebrow text-[var(--estate-text-muted)]" title={o.location ?? where}>
              {where}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}

export function ModelDataSources({
  modelId,
  variant = 'list',
  onShowSources,
  className,
}: {
  modelId: string;
  variant?: 'list' | 'notice';
  /** notice only: open the full list (e.g. switch to the Tables tab). */
  onShowSources?: () => void;
  className?: string;
}) {
  const { data, error } = useModelSources(modelId);

  if (variant === 'notice') {
    if (!data || data.measures_outside_warehouse === 0) return null;
    const files = data.sources.filter((s) => s.class === 'file' && s.blocked_measures > 0);
    const shown = files.slice(0, 3);
    const hidden = files.length - shown.length;
    return (
      <div className={className}>
        <Callout
          tone="amber"
          icon={<AlertTriangle className="size-4" />}
          title={`${data.measures_outside_warehouse} of ${data.measures_total} measures can’t be recreated`}
          action={
            onShowSources ? (
              <button type="button" onClick={onShowSources} className="text-caption text-[var(--brand-a)] hover:underline">
                View all sources
              </button>
            ) : undefined
          }
        >
          <p className="text-caption">
            Their data comes from {files.length === 1 ? 'a source' : `${files.length} sources`} outside the warehouse, so there is
            no Databricks table to run them against.
          </p>
          {shown.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {shown.map((s) => (
                <NoticeSourceRow key={s.key} g={s} />
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <p className="mt-1.5 text-caption text-[var(--estate-text-muted)]">
              +{hidden} more source{hidden === 1 ? '' : 's'}
              {onShowSources ? (
                <>
                  {' · '}
                  <button type="button" onClick={onShowSources} className="text-[var(--brand-a)] hover:underline">
                    view all
                  </button>
                </>
              ) : null}
            </p>
          )}
          <div className="mt-2.5 text-caption">
            <span className="font-medium text-[var(--estate-ink)]">To fix</span>
            <ol className="mt-0.5 list-decimal space-y-0.5 pl-5 marker:text-[var(--estate-text-muted)]">
              <li>Load each file into a Databricks (Unity Catalog) table.</li>
              <li>Point the Power BI query at that table instead of the file.</li>
              <li>Run the pipeline again.</li>
            </ol>
          </div>
        </Callout>
      </div>
    );
  }

  if (error) {
    return <p className={cn('text-caption text-[var(--estate-text-muted)]', className)}>Could not load data sources ({error}).</p>;
  }
  if (!data) {
    return <p className={cn('text-caption text-[var(--estate-text-muted)]', className)}>Reading Power Query sources…</p>;
  }
  if (!data.sources.length) return null;

  const byClass = CLASS_ORDER.map((cls) => ({
    cls,
    sources: data.sources
      .filter((s) => s.class === cls)
      .sort((a, b) => b.blocked_measures - a.blocked_measures || (a.origin.object ?? a.title).localeCompare(b.origin.object ?? b.title)),
  })).filter((s) => s.sources.length > 0);

  return (
    <section
      className={cn('overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]', className)}
      aria-label="Data sources"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="text-ui font-medium text-[var(--estate-ink)]">Data sources</h3>
          <span className="text-caption text-[var(--estate-text-muted)]">
            {data.sources.length} source{data.sources.length === 1 ? '' : 's'}, traced through Power Query
            {data.helper_queries > 0 ? ` and ${data.helper_queries} helper queries` : ''}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {byClass.map(({ cls, sources }) => (
            <Tag key={cls} tone={CLASS_META[cls].tone} title={CLASS_META[cls].hint}>
              {CLASS_META[cls].label} · {sources.length}
            </Tag>
          ))}
        </div>
      </header>
      {byClass.map(({ cls, sources }) => (
        <ClassSection key={cls} cls={cls} sources={sources} />
      ))}
    </section>
  );
}
