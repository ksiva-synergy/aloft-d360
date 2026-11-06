'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import { ArrowRight, Boxes, Database, Info, Ruler, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CatalogSearch } from '@/components/estate/EstateFilterBar';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { ApprovalDot, ApprovalPill, FieldRef, isApproved } from '@/components/estate/semantic-ui';
// ── Response shape (mirrors /api/inspector/semantic/entities-catalog) ──────────
interface DefConsumer { dashboardId: string; name: string; modelGoverned: boolean }
interface DimEntry {
  id: string; nodeId: string; label: string; status: string; dimensionType: string;
  resolvesTo: { fullPath: string; column: string | null };
  classification: { synonyms: string[]; aiContext: string | null; description: string | null };
  usedByMetrics: { measureId: string; label: string }[];
  consumers: DefConsumer[];
}
interface MeasEntry {
  id: string; nodeId: string; label: string; status: string; metricType: string;
  aggregate: string; unit: string | null;
  resolvesTo: { fullPath: string; column: string | null; expression: string | null };
  classification: { synonyms: string[]; aiContext: string | null; description: string | null };
  consumers: DefConsumer[];
}
interface EntityEntry {
  id: string; nodeId: string; label: string; fullPath: string; status: string;
  description: string | null; dimensions: DimEntry[]; measures: MeasEntry[];
}
type CatalogResponse =
  | { status: 'no_governed_model' }
  | { status: 'ok'; model: { id: string; name: string }; entities: EntityEntry[]; total: number; hasMore: boolean; dimensionTypes: string[]; omissions: { field: string; reason: string }[]; note: string }
  | { error: string };

const PAGE = 40;

function dashboardCount(e: EntityEntry): number {
  const ids = new Set<string>();
  for (const d of [...e.dimensions, ...e.measures]) for (const c of d.consumers) ids.add(c.dashboardId);
  return ids.size;
}

const TH = 'px-3 py-2 text-left text-caption font-normal uppercase tracking-wide text-[var(--estate-text-muted)]';
const TD = 'px-3 py-2.5 align-middle';

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon aria-hidden className="size-3.5 text-[var(--estate-text-muted)]" />
      <h3 className="text-ui text-[var(--estate-ink)]">{title}</h3>
      <span className="text-caption tabular-nums text-[var(--estate-text-muted)]">{count}</span>
    </div>
  );
}

function EntityDetail({ e }: { e: EntityEntry }) {
  const dashboards = dashboardCount(e);
  const drafts = [...e.dimensions, ...e.measures].filter((d) => !isApproved(d.status)).length;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-ctl bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink,var(--brand-a))]">
          <Database aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title-card text-[var(--estate-ink)]">{e.label}</h2>
            <ApprovalPill status={e.status} />
          </div>
          <div className="mt-0.5 truncate font-mono text-ui-regular text-[var(--estate-text-muted)]">{e.fullPath}</div>
          {e.description && <p className="mt-2 text-ui-regular text-[var(--estate-text-secondary)]">{e.description}</p>}
        </div>
        <Link href={`/agent-lab/estate/lineage?focus=${encodeURIComponent(e.nodeId)}`} className={cn(CATALOG_BTN, 'h-8 shrink-0')}>
          View lineage <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>

      <dl className="grid grid-cols-2 overflow-hidden rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)] sm:grid-cols-4 sm:divide-x sm:divide-[var(--estate-border)]">
        {[
          { label: 'Dimensions', value: e.dimensions.length },
          { label: 'Metrics', value: e.measures.length },
          { label: 'Dashboards', value: dashboards },
          { label: 'Drafts', value: drafts },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3">
            <dt className="text-caption text-[var(--estate-text-muted)]">{s.label}</dt>
            <dd className={cn('mt-0.5 text-kpi-sm tabular-nums', s.label === 'Drafts' && s.value > 0 ? 'text-[var(--warn)]' : 'text-[var(--estate-ink)]')}>{s.value}</dd>
          </div>
        ))}
      </dl>

      {e.dimensions.length === 0 && e.measures.length === 0 && (
        <p className="rounded-card border border-dashed border-[var(--estate-border-gold)] p-6 text-center text-ui-regular text-[var(--estate-text-muted)]">
          This table has no active dimensions or metrics yet.
        </p>
      )}

      {e.measures.length > 0 && (
        <section>
          <SectionHeader icon={Ruler} title="Metrics" count={e.measures.length} />
          <div className="overflow-hidden rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)]">
            <table className="w-full table-fixed">
              <colgroup><col className="w-[24%]" /><col className="w-[18%]" /><col /><col className="w-24" /><col className="w-24" /><col className="w-24" /></colgroup>
              <thead className="border-b border-[var(--estate-border)]">
                <tr><th className={TH}>Metric</th><th className={TH}>Calculation</th><th className={TH}>Source</th><th className={cn(TH, 'text-right')}>Dashboards</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Lineage</span></th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--estate-border)]">
                {e.measures.map((m) => (
                  <tr key={m.id} className="transition-colors duration-hover hover:bg-[var(--estate-hover)]">
                    <td className={TD}>
                      <div className="truncate text-ui text-[var(--estate-ink)]">{m.label}</div>
                      {m.classification.synonyms.length > 0 && <div className="truncate text-caption text-[var(--estate-text-muted)]">Also: {m.classification.synonyms.join(', ')}</div>}
                    </td>
                    <td className={cn(TD, 'text-ui-regular text-[var(--estate-text-secondary)]')}>
                      <span className="capitalize">{m.aggregate.replace(/_/g, ' ')}</span>{m.unit ? <span className="text-[var(--estate-text-muted)]"> {'\u00b7'} {m.unit}</span> : null}
                    </td>
                    <td className={TD}><FieldRef fullPath={m.resolvesTo.fullPath} column={m.resolvesTo.column} expression={m.resolvesTo.expression} /></td>
                    <td className={cn(TD, 'text-right text-ui-regular tabular-nums text-[var(--estate-text-secondary)]')}>{m.consumers.length || '\u2014'}</td>
                    <td className={TD}><ApprovalPill status={m.status} /></td>
                    <td className={cn(TD, 'text-right')}>
                      <Link href={`/agent-lab/estate/lineage?focus=${encodeURIComponent(m.nodeId)}`} className="inline-flex items-center gap-1 text-label text-[var(--brand-a-ink,var(--brand-a))] hover:underline">
                        Lineage <ArrowRight aria-hidden className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {e.dimensions.length > 0 && (
        <section>
          <SectionHeader icon={Tag} title="Dimensions" count={e.dimensions.length} />
          <div className="overflow-hidden rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)]">
            <table className="w-full table-fixed">
              <colgroup><col className="w-[24%]" /><col className="w-[18%]" /><col /><col className="w-24" /><col className="w-24" /><col className="w-24" /></colgroup>
              <thead className="border-b border-[var(--estate-border)]">
                <tr><th className={TH}>Dimension</th><th className={TH}>Type</th><th className={TH}>Source</th><th className={cn(TH, 'text-right')}>Dashboards</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Used by</span></th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--estate-border)]">
                {e.dimensions.map((d) => (
                  <tr key={d.id} className="transition-colors duration-hover hover:bg-[var(--estate-hover)]">
                    <td className={TD}>
                      <div className="truncate text-ui text-[var(--estate-ink)]">{d.label}</div>
                      {d.classification.synonyms.length > 0 && <div className="truncate text-caption text-[var(--estate-text-muted)]">Also: {d.classification.synonyms.join(', ')}</div>}
                    </td>
                    <td className={cn(TD, 'text-ui-regular capitalize text-[var(--estate-text-secondary)]')}>{d.dimensionType}</td>
                    <td className={TD}><FieldRef fullPath={d.resolvesTo.fullPath} column={d.resolvesTo.column} /></td>
                    <td className={cn(TD, 'text-right text-ui-regular tabular-nums text-[var(--estate-text-secondary)]')}>{d.consumers.length || '\u2014'}</td>
                    <td className={TD}><ApprovalPill status={d.status} /></td>
                    <td className={cn(TD, 'text-right text-caption text-[var(--estate-text-muted)]')}>
                      {d.usedByMetrics.length > 0 ? (
                        <span title={`Used in: ${d.usedByMetrics.map((x) => x.label).join(', ')}`}>
                          {d.usedByMetrics.length} metric{d.usedByMetrics.length > 1 ? 's' : ''}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function EntitiesPage() {
  const [meta, setMeta] = useState<{ status: string; model?: { id: string; name: string }; total?: number; hasMore?: boolean; note?: string; omissions?: { field: string; reason: string }[] } | null>(null);
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = React.useCallback(async (query: string, offset: number) => {
    const first = offset === 0;
    if (first) { setLoading(true); } else { setLoadingMore(true); }
    setErr(null);
    try {
      const res = await fetch(`/api/inspector/semantic/entities-catalog?q=${encodeURIComponent(query)}&offset=${offset}&limit=${PAGE}`);
      if (res.status === 401) { setErr('Sign in to view the entities catalog.'); return; }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as CatalogResponse;
      if ('error' in data) { setErr(data.error); return; }
      if (data.status === 'no_governed_model') { setMeta({ status: 'no_governed_model' }); setEntities([]); return; }
      setMeta({ status: 'ok', model: data.model, total: data.total, hasMore: data.hasMore, note: data.note, omissions: data.omissions });
      setEntities((prev) => (first ? data.entities : [...prev, ...data.entities]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load entities');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Debounced search (and initial load).
  useEffect(() => {
    const t = setTimeout(() => { void load(q, 0); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? entities[0] ?? null,
    [entities, selectedId],
  );

  const totals = useMemo(() => {
    let dims = 0, metrics = 0, drafts = 0;
    for (const e of entities) {
      dims += e.dimensions.length;
      metrics += e.measures.length;
      drafts += [...e.dimensions, ...e.measures].filter((d) => !isApproved(d.status)).length;
    }
    return { dims, metrics, drafts };
  }, [entities]);

  const infoTip = [
    meta?.note,
    ...(meta?.omissions ?? []).map((o) => `Not available yet: ${o.field} \u2014 ${o.reason}`),
  ].filter(Boolean).join('\n');

  if (!loading && err) {
    return (
      <div className="h-full overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[1180px] rounded-card border border-dashed border-[var(--estate-border-gold)] bg-[var(--estate-raised)] p-6 text-ui-regular text-[var(--estate-text-secondary)]">{err}</div>
      </div>
    );
  }

  if (!loading && meta?.status === 'no_governed_model') {
    return (
      <div className="flex h-full items-start justify-center overflow-y-auto px-6 py-12">
        <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-card border border-dashed border-[var(--estate-border-gold)] bg-[var(--estate-raised)] p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-card bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink,var(--brand-a))]">
            <Boxes aria-hidden className="size-6" />
          </span>
          <h2 className="text-title-card text-[var(--estate-ink)]">No business model yet</h2>
          <p className="text-ui-regular text-[var(--estate-text-secondary)]">
            Entities appear here once a business model is approved. Review and approve one to list its tables, dimensions and metrics.
          </p>
          <Link href="/agent-lab/estate/catalog" className={cn(CATALOG_BTN, 'mt-1 h-8')}>
            Open the Catalog <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--estate-border)] px-6 py-2.5 text-ui-regular text-[var(--estate-text-secondary)]">
        {meta?.model && (
          <span className="inline-flex items-center gap-1.5">
            <Boxes aria-hidden className="size-3.5 text-[var(--estate-text-muted)]" />
            <b className="font-medium text-[var(--estate-ink)]">{meta.model.name}</b>
          </span>
        )}
        {meta?.status === 'ok' && (
          <span className="tabular-nums">
            {(meta.total ?? entities.length).toLocaleString()} tables {'\u00b7'} {totals.dims} dimensions {'\u00b7'} {totals.metrics} metrics
            {totals.drafts > 0 && <> {'\u00b7'} <span className="text-[var(--warn)]">{totals.drafts} drafts</span></>}
          </span>
        )}
        {infoTip && (
          <span title={infoTip} aria-label={infoTip} className="inline-flex cursor-help text-[var(--estate-text-muted)]">
            <Info aria-hidden className="size-3.5" />
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--estate-border)]">
          <div className="p-3">
            <CatalogSearch value={q} onChange={setQ} placeholder={'Search tables\u2026'} />
          </div>
          <nav aria-label="Tables" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
            {loading && entities.length === 0 && (
              <div className="flex flex-col gap-1.5 px-1" aria-busy="true">
                {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 animate-pulse rounded-ctl bg-[var(--estate-hover)]" />)}
              </div>
            )}
            {!loading && entities.length === 0 && (
              <p className="px-3 py-6 text-center text-ui-regular text-[var(--estate-text-muted)]">No tables match {'\u201c'}{q}{'\u201d'}.</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {entities.map((e) => {
                const active = selected?.id === e.id;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'relative flex w-full items-center gap-2.5 rounded-ctl px-3 py-2 text-left transition-colors duration-hover',
                        active ? 'bg-[var(--estate-hover)]' : 'hover:bg-[var(--estate-hover)]',
                      )}
                    >
                      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--brand-a)]" />}
                      <ApprovalDot status={e.status} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-ui', active ? 'text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]')}>{e.label}</span>
                        <span className="block truncate font-mono text-caption text-[var(--estate-text-dim)]">{e.fullPath}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-caption tabular-nums text-[var(--estate-text-muted)]">
                        <span className="inline-flex items-center gap-0.5" title={`${e.measures.length} metrics`}><Ruler aria-hidden className="size-3" />{e.measures.length}</span>
                        <span className="inline-flex items-center gap-0.5" title={`${e.dimensions.length} dimensions`}><Tag aria-hidden className="size-3" />{e.dimensions.length}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {meta?.hasMore && (
              <button
                type="button"
                onClick={() => void load(q, entities.length)}
                disabled={loadingMore}
                className="mt-2 w-full rounded-ctl px-3 py-2 text-left text-label text-[var(--brand-a-ink,var(--brand-a))] hover:bg-[var(--estate-hover)] disabled:opacity-50"
              >
                {loadingMore ? 'Loading\u2026' : `Show ${Math.min(PAGE, (meta.total ?? 0) - entities.length)} more`}
              </button>
            )}
          </nav>
          <div className="flex items-center gap-3 border-t border-[var(--estate-border)] px-4 py-2.5 text-caption text-[var(--estate-text-muted)]">
            <span className="inline-flex items-center gap-1.5"><ApprovalDot status="governed" /> Approved</span>
            <span className="inline-flex items-center gap-1.5"><ApprovalDot status="candidate" /> Draft</span>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          <div className="mx-auto max-w-[960px]">
            {loading && entities.length === 0 ? (
              <div className="flex flex-col gap-4" aria-busy="true">
                <div className="h-14 animate-pulse rounded-card bg-[var(--estate-hover)]" />
                <div className="h-20 animate-pulse rounded-card bg-[var(--estate-hover)]" />
                <div className="h-48 animate-pulse rounded-card bg-[var(--estate-hover)]" />
              </div>
            ) : selected ? (
              <EntityDetail e={selected} />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}