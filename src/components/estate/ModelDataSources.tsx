'use client';

/**
 * Where a Power BI model's data comes from, traced through Power Query and its helper queries:
 * Excel / CSV files on SharePoint or OneDrive, web feeds, dataflows, databases, Databricks.
 * `variant="notice"` shows a warning only when measures cannot be recreated because their data
 * is not in the warehouse; the default variant lists every source with the tables that read it.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { AlertTriangle, Database, ExternalLink, FileSpreadsheet, FileText, Globe, Sigma, Workflow } from 'lucide-react';

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
  if (!/^https?:\/\//i.test(href)) return <span className="break-all font-mono text-[11px]">{href}</span>;
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

function SourceRow({ g }: { g: ModelSourceGroup }) {
  const meta = CLASS_META[g.class];
  const o = g.origin;
  const detail: { label: string; value: React.ReactNode }[] = [];
  if (o.file) detail.push({ label: 'File', value: <span className="font-medium text-[var(--estate-ink)]">{o.file}</span> });
  if (o.items.length) {
    detail.push({
      label: o.items.length > 1 ? 'Sheets / tables' : o.items[0]!.kind === 'Sheet' ? 'Sheet' : 'Table',
      value: o.items.map((i) => `${i.name}${i.kind ? ` (${i.kind.toLowerCase()})` : ''}`).join(', '),
    });
  }
  if (o.location) {
    const label =
      o.system === 'sharepoint' || o.system === 'onedrive'
        ? 'Site'
        : o.system === 'dataflow'
          ? 'Workspace'
          : g.class === 'database' || g.class === 'warehouse'
            ? 'Server'
            : 'Location';
    detail.push({ label, value: <LocationLink href={o.location} /> });
  }
  if (o.folder) detail.push({ label: 'Folder', value: <LocationLink href={o.folder} /> });
  if (o.database) detail.push({ label: o.system === 'dataflow' ? 'Dataflow' : 'Database', value: o.database });
  if (o.object) detail.push({ label: o.system === 'dataflow' ? 'Entity' : 'Object', value: <span className="font-mono text-[11px]">{o.object}</span> });
  if (o.query && !o.object) detail.push({ label: 'Query', value: <span className="font-mono text-[11px]">{o.query.slice(0, 160)}</span> });

  return (
    <li className="flex gap-3 px-4 py-3">
      <SourceIcon g={g} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui font-medium text-[var(--estate-ink)]">{g.title}</span>
          <Tag tone={meta.tone} title={meta.hint}>
            {meta.label}
          </Tag>
          {g.blocked_measures > 0 && (
            <span className="text-caption text-[var(--estate-status-warning-text,#B4801A)]">
              {g.blocked_measures} measure{g.blocked_measures === 1 ? '' : 's'} can’t be recreated
            </span>
          )}
        </div>
        {detail.length > 0 && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption text-[var(--estate-text-secondary)]">
            {detail.map((d) => (
              <React.Fragment key={d.label}>
                <dt className="text-[var(--estate-text-muted)]">{d.label}</dt>
                <dd className="min-w-0">{d.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption">
          <span className="text-[var(--estate-text-muted)]">Tables:</span>
          {g.tables.map((t) =>
            t.context_object_id ? (
              <Link
                key={t.name}
                href={`/agent-lab/estate/object/${t.context_object_id}`}
                title={t.uc_full_path ? `Bound to ${t.uc_full_path}` : undefined}
                className="inline-flex items-center gap-1 rounded bg-[var(--estate-raised)] px-1.5 py-0.5 text-[var(--brand-a)] hover:underline"
              >
                {t.name} → <span className="font-mono text-[11px]">{t.uc_full_path ?? 'catalog object'}</span>
              </Link>
            ) : (
              <span
                key={t.name}
                title={t.bind_status ? `Binding: ${t.bind_status}` : undefined}
                className="rounded bg-[var(--estate-raised)] px-1.5 py-0.5 text-[var(--estate-text-secondary)]"
              >
                {t.name}
                {t.uc_full_path && <span className="font-mono text-[11px]"> → {t.uc_full_path}</span>}
              </span>
            ),
          )}
        </div>
      </div>
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
    return (
      <div className={className}>
        <Callout
          tone="amber"
          icon={<AlertTriangle className="size-4" />}
          title={`${data.measures_outside_warehouse} of ${data.measures_total} measures can’t be recreated — their data is not in the warehouse`}
          action={
            onShowSources ? (
              <button type="button" onClick={onShowSources} className="text-caption text-[var(--brand-a)] hover:underline">
                View sources
              </button>
            ) : undefined
          }
        >
          <ul className="mt-0.5 space-y-0.5">
            {files.slice(0, 3).map((s) => (
              <li key={s.key} className="break-words">
                {s.description}
                <span className="text-[var(--estate-text-muted)]">
                  {' '}
                  · read by {s.tables.map((t) => t.name).join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[var(--estate-text-muted)]">
            Load this data into a Databricks (Unity Catalog) table and point the Power BI query at it, then run the pipeline again.
          </p>
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

  return (
    <section className={cn('rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]', className)} aria-label="Data sources">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--estate-border)] px-4 py-2">
        <h3 className="text-ui font-medium text-[var(--estate-ink)]">Data sources</h3>
        <span className="text-caption text-[var(--estate-text-muted)]">
          {data.sources.length} source{data.sources.length === 1 ? '' : 's'}, traced through Power Query
          {data.helper_queries > 0 ? ` and ${data.helper_queries} helper queries` : ''}
        </span>
      </header>
      <ul className="divide-y divide-[var(--estate-border)]">
        {data.sources.map((g) => (
          <SourceRow key={g.key} g={g} />
        ))}
      </ul>
    </section>
  );
}
