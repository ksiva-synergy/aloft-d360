'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import { AlertTriangle, ArrowRight, Database, GitBranch, Info, LayoutDashboard, Ruler, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CatalogSearch } from '@/components/estate/EstateFilterBar';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { ApprovalDot, ApprovalPill, isApproved } from '@/components/estate/semantic-ui';
// ── Response shape (mirrors /api/inspector/semantic/lineage) ───────────────────
interface ResolvesTo { fullPath: string; column: string | null; expression: string | null; resultAlias: string }
interface EstateNode { id: string; kind: 'estate'; entityId: string; label: string; fullPath: string; status: string }
interface DefNode {
  id: string; kind: 'dimension' | 'measure'; defId: string; entityId: string; label: string; status: string;
  resolvesTo: ResolvesTo;
  classification: { synonyms: string[]; aiContext: string | null; description: string | null; dimensionType?: string; metricType?: string; aggregate?: string; unit?: string | null };
  compiledSql?: string; capped?: boolean; cappedBy?: string[];
}
interface ConsumerNode { id: string; kind: 'consumer'; dashboardId: string; label: string; visibility: string; modelGoverned: boolean }
type LineageNode = EstateNode | DefNode | ConsumerNode;
interface LineageEdge { from: string; to: string; kind: 'membership' | 'join' | 'consumes'; candidate?: boolean; joinKeys?: string }
interface FocusOption { id: string; label: string; kind: 'measure' | 'estate'; status: string }
interface Omission { field: string; reason: string }
interface FocusGraph { focusId: string; truncated: boolean; nodes: LineageNode[]; edges: LineageEdge[]; omissions: Omission[] }
type LineageResponse =
  | { status: 'no_governed_model' }
  | { status: 'ok'; model: { id: string; name: string }; focusOptions: { options: FocusOption[]; total: number; hasMore: boolean }; focus: FocusGraph | null; omissions: Omission[]; governance?: { total: number; governed: number; candidate: number; pctCandidate: number; note?: string } }
  | { error: string };

function NodeIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = cn('size-3.5 shrink-0', className);
  if (kind === 'estate') return <Database aria-hidden className={cn(cls, 'text-[var(--estate-text-muted)]')} />;
  if (kind === 'consumer') return <LayoutDashboard aria-hidden className={cn(cls, 'text-[var(--estate-text-muted)]')} />;
  if (kind === 'measure') return <Ruler aria-hidden className={cn(cls, 'text-[var(--brand-a-ink,var(--brand-a))]')} />;
  return <Tag aria-hidden className={cn(cls, 'text-[var(--estate-text-muted)]')} />;
}

const KIND_LABEL: Record<string, string> = { estate: 'Table', measure: 'Metric', dimension: 'Dimension', consumer: 'Dashboard' };

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2">
      <dt className="text-caption text-[var(--estate-text-muted)]">{label}</dt>
      <dd className="min-w-0 text-ui-regular text-[var(--estate-text-secondary)]">{children}</dd>
    </div>
  );
}

export default function LineagePage() {
  const [model, setModel] = useState<{ id: string; name: string } | null>(null);
  const [options, setOptions] = useState<{ options: FocusOption[]; total: number; hasMore: boolean } | null>(null);
  const [focus, setFocus] = useState<FocusGraph | null>(null);
  const [noModel, setNoModel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [governance, setGovernance] = useState<{ total: number; governed: number; candidate: number; pctCandidate: number; note?: string } | null>(null);
  const fetchGraph = React.useCallback(async (focusId: string | null, query: string) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (focusId) params.set('focus', focusId);
      if (query) params.set('q', query);
      const res = await fetch(`/api/inspector/semantic/lineage?${params.toString()}`);
      if (res.status === 401) { setErr('Sign in to view lineage.'); return; }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as LineageResponse;
      if ('error' in data) { setErr(data.error); return; }
      if (data.status === 'no_governed_model') { setNoModel(true); return; }
      setNoModel(false);
      setModel(data.model);
      setOptions(data.focusOptions);
      setFocus(data.focus);
      setSelected(data.focus?.focusId ?? null);
      setGovernance(data.governance ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load lineage');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — honor ?focus from the entities-page deep link.
  useEffect(() => {
    const urlFocus = new URLSearchParams(window.location.search).get('focus');
    void fetchGraph(urlFocus, '');
  }, [fetchGraph]);

  // Debounced option search — refresh the picker list only (keep current focus graph).
  useEffect(() => {
    if (loading && !model) return; // skip during first load
    const t = setTimeout(async () => {
      if (!model) return;
      const params = new URLSearchParams();
      if (focus?.focusId) params.set('focus', focus.focusId);
      if (q) params.set('q', q);
      const res = await fetch(`/api/inspector/semantic/lineage?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as LineageResponse;
      if ('status' in data && data.status === 'ok') setOptions(data.focusOptions);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const nodeById = useMemo(() => new Map((focus?.nodes ?? []).map((n) => [n.id, n])), [focus]);
  const cols = useMemo(() => ({
    estate: (focus?.nodes ?? []).filter((n) => n.kind === 'estate') as EstateNode[],
    defs: (focus?.nodes ?? []).filter((n) => n.kind === 'dimension' || n.kind === 'measure') as DefNode[],
    consumers: (focus?.nodes ?? []).filter((n) => n.kind === 'consumer') as ConsumerNode[],
  }), [focus]);

  const focusNode = focus ? nodeById.get(focus.focusId) : null;
  const detailNode = (selected && nodeById.get(selected)) || focusNode || null;

  const labelOf = (id: string) => nodeById.get(id)?.label ?? id.replace(/^\w+:/, '');
  const joins = (focus?.edges ?? []).filter((e) => e.kind === 'join');
  const metricOptions = (options?.options ?? []).filter((o) => o.kind === 'measure');
  const tableOptions = (options?.options ?? []).filter((o) => o.kind === 'estate');

  if (err) {
    return (
      <div className="h-full overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[1180px] rounded-card border border-dashed border-[var(--estate-border-gold)] bg-[var(--estate-raised)] p-6 text-ui-regular text-[var(--estate-text-secondary)]">{err}</div>
      </div>
    );
  }

  if (noModel) {
    return (
      <div className="flex h-full items-start justify-center overflow-y-auto px-6 py-12">
        <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-card border border-dashed border-[var(--estate-border-gold)] bg-[var(--estate-raised)] p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-card bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink,var(--brand-a))]">
            <GitBranch aria-hidden className="size-6" />
          </span>
          <h2 className="text-title-card text-[var(--estate-ink)]">No business model yet</h2>
          <p className="text-ui-regular text-[var(--estate-text-secondary)]">Lineage follows the approved business model. Approve metrics and entities to see how they connect.</p>
          <Link href="/agent-lab/estate/catalog" className={cn(CATALOG_BTN, 'mt-1 h-8')}>
            Open the Catalog <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  const OptionGroup = ({ title, items }: { title: string; items: FocusOption[] }) => (
    items.length === 0 ? null : (
      <div className="mb-3">
        <div className="px-3 pb-1 text-caption uppercase tracking-wide text-[var(--estate-text-muted)]">{title}</div>
        <ul className="flex flex-col gap-0.5">
          {items.map((f) => {
            const on = f.id === focus?.focusId;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => { void fetchGraph(f.id, ''); }}
                  aria-current={on ? 'true' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-ctl px-3 py-1.5 text-left transition-colors duration-hover',
                    on ? 'bg-[var(--estate-hover)]' : 'hover:bg-[var(--estate-hover)]',
                  )}
                >
                  {on && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--brand-a)]" />}
                  <NodeIcon kind={f.kind} />
                  <span className={cn('min-w-0 flex-1 truncate text-ui', on ? 'text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]')}>{f.label}</span>
                  <ApprovalDot status={f.status} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    )
  );

  const columns = [
    { key: 'estate' as const, title: 'Source tables', hint: 'Where the data comes from' },
    { key: 'defs' as const, title: 'Definitions', hint: 'Metrics and dimensions built on it' },
    { key: 'consumers' as const, title: 'Used by', hint: 'Dashboards that read it' },
  ];

  const renderNode = (n: LineageNode) => {
    const isFocus = n.id === focus?.focusId;
    const isSel = n.id === (selected ?? focus?.focusId);
    const def = (n.kind === 'dimension' || n.kind === 'measure') ? (n as DefNode) : null;
    const draft = def ? !isApproved(def.status) : false;
    const capped = n.kind === 'measure' && (n as DefNode).capped;
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => setSelected(n.id)}
        aria-pressed={isSel}
        className={cn(
          'w-full rounded-ctl border bg-[var(--estate-surface)] px-3 py-2 text-left transition-colors duration-hover hover:border-[var(--estate-text-muted)]',
          isSel ? 'border-[var(--brand-a)] shadow-[0_0_0_1px_var(--brand-a)]' : draft || capped ? 'border-dashed border-[color-mix(in_srgb,var(--warn)_55%,transparent)]' : 'border-[var(--estate-border)]',
        )}
      >
        <div className="flex items-center gap-2">
          <NodeIcon kind={n.kind} />
          <span className="min-w-0 flex-1 truncate text-ui text-[var(--estate-ink)]">{n.label}</span>
          {isFocus && <span className="rounded-full bg-[var(--estate-hover)] px-1.5 text-caption text-[var(--estate-text-muted)]">start</span>}
          {def && <ApprovalDot status={def.status} />}
        </div>
        <div className="mt-0.5 truncate pl-[22px] text-caption text-[var(--estate-text-muted)]">
          {n.kind === 'estate' && <span className="font-mono">{(n as EstateNode).fullPath}</span>}
          {def && <>{KIND_LABEL[def.kind]} {'\u00b7'} <span className="font-mono">{def.resolvesTo.column ?? 'expression'}</span>{capped ? ' \u00b7 depends on a draft' : ''}</>}
          {n.kind === 'consumer' && <>{(n as ConsumerNode).visibility === 'shared' ? 'Shared' : 'Private'}{(n as ConsumerNode).modelGoverned ? '' : ' \u00b7 model not approved'}</>}
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--estate-border)] px-6 py-2.5 text-ui-regular text-[var(--estate-text-secondary)]">
        {model && (
          <span className="inline-flex items-center gap-1.5">
            <GitBranch aria-hidden className="size-3.5 text-[var(--estate-text-muted)]" />
            <b className="font-medium text-[var(--estate-ink)]">{model.name}</b>
          </span>
        )}
        {governance && (
          <span className="tabular-nums">
            {governance.total.toLocaleString()} definitions {'\u00b7'}{' '}
            <span className={governance.candidate > 0 ? 'text-[var(--warn)]' : undefined}>{governance.candidate.toLocaleString()} drafts ({governance.pctCandidate}%)</span>
          </span>
        )}
        {governance?.note && (
          <span title={governance.note} aria-label={governance.note} className="inline-flex cursor-help text-[var(--estate-text-muted)]">
            <Info aria-hidden className="size-3.5" />
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--estate-border)]">
          <div className="p-3">
            <CatalogSearch value={q} onChange={setQ} placeholder={'Search metrics and tables\u2026'} />
          </div>
          <nav aria-label="Start from" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
            {loading && !options && (
              <div className="flex flex-col gap-1.5 px-1" aria-busy="true">
                {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-8 animate-pulse rounded-ctl bg-[var(--estate-hover)]" />)}
              </div>
            )}
            <OptionGroup title="Metrics" items={metricOptions} />
            <OptionGroup title="Tables" items={tableOptions} />
            {options && options.options.length === 0 && (
              <p className="px-3 py-6 text-center text-ui-regular text-[var(--estate-text-muted)]">Nothing matches {'\u201c'}{q}{'\u201d'}.</p>
            )}
            {options?.hasMore && (
              <p className="px-3 pt-1 text-caption text-[var(--estate-text-muted)]">
                +{(options.total - options.options.length).toLocaleString()} more {'\u2014'} search to narrow down
              </p>
            )}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          <div className="mx-auto flex max-w-[1040px] flex-col gap-4">
            {loading && !focus && <div className="h-[320px] animate-pulse rounded-card bg-[var(--estate-hover)]" aria-busy="true" />}

            {!loading && !focus && (
              <div className="rounded-card border border-dashed border-[var(--estate-border-gold)] p-10 text-center text-ui-regular text-[var(--estate-text-muted)]">
                Pick a metric to see what feeds it, or a table to see what uses it.
              </div>
            )}

            {focus && focusNode && (
              <>
                <header className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-ctl bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)]">
                    <NodeIcon kind={focusNode.kind} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-title-card text-[var(--estate-ink)]">{focusNode.label}</h2>
                      {'status' in focusNode && <ApprovalPill status={(focusNode as DefNode | EstateNode).status} />}
                    </div>
                    <p className="mt-0.5 text-caption text-[var(--estate-text-muted)]">
                      {KIND_LABEL[focusNode.kind]} {'\u00b7'} {cols.estate.length} source table{cols.estate.length === 1 ? '' : 's'} {'\u00b7'} {cols.defs.length} definition{cols.defs.length === 1 ? '' : 's'} {'\u00b7'} {cols.consumers.length} dashboard{cols.consumers.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </header>

                {focusNode.kind === 'measure' && (focusNode as DefNode).capped && (
                  <div className="flex items-start gap-2.5 rounded-card border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[var(--warn-bg)] px-4 py-2.5 text-ui-regular text-[var(--estate-text-secondary)]">
                    <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--warn)]" />
                    <span>
                      Depends on a draft{(focusNode as DefNode).cappedBy?.length ? <> ({(focusNode as DefNode).cappedBy!.map(labelOf).join(', ')})</> : null}. It still runs, but treat results as unverified until it{'\u2019'}s approved.
                    </span>
                  </div>
                )}

                {focus.truncated && (
                  <p className="text-caption text-[var(--estate-text-muted)]">Showing part of the graph {'\u2014'} this item has more connections than fit here.</p>
                )}

                <section aria-label="Lineage flow" className="rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)] p-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)] lg:gap-2">
                    {columns.map((c, i) => (
                      <React.Fragment key={c.key}>
                        {i > 0 && (
                          <div aria-hidden className="hidden items-center justify-center lg:flex">
                            <ArrowRight className="size-4 text-[var(--estate-text-dim)]" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
                            <span className="text-caption uppercase tracking-wide text-[var(--estate-text-muted)]" title={c.hint}>{c.title}</span>
                            <span className="text-caption tabular-nums text-[var(--estate-text-dim)]">{cols[c.key].length}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {cols[c.key].length === 0 && (
                              <div className="rounded-ctl border border-dashed border-[var(--estate-border)] px-3 py-3 text-center text-caption text-[var(--estate-text-dim)]">None</div>
                            )}
                            {(cols[c.key] as LineageNode[]).map(renderNode)}
                          </div>
                          {c.key === 'estate' && joins.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-0.5 px-0.5 text-caption text-[var(--estate-text-muted)]">
                              {joins.map((e, j) => (
                                <li key={j} className="truncate">
                                  Joins {labelOf(e.from)} {'\u2194'} {labelOf(e.to)} on <span className="font-mono text-[var(--estate-text-secondary)]">{e.joinKeys}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </section>

                {detailNode && (
                  <section aria-label="Details" className="rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)] px-5 py-4">
                    <div className="mb-1 flex items-center gap-2">
                      <NodeIcon kind={detailNode.kind} />
                      <h3 className="text-ui text-[var(--estate-ink)]">{detailNode.label}</h3>
                      <span className="text-caption text-[var(--estate-text-muted)]">{KIND_LABEL[detailNode.kind]}</span>
                    </div>
                    <dl className="divide-y divide-[var(--estate-border)]">
                      {detailNode.kind === 'estate' && (
                        <KV label="Table"><span className="font-mono">{(detailNode as EstateNode).fullPath}</span></KV>
                      )}

                      {(detailNode.kind === 'dimension' || detailNode.kind === 'measure') && (() => {
                        const d = detailNode as DefNode;
                        return (
                          <>
                            {d.classification.description && <KV label="Description">{d.classification.description}</KV>}
                            <KV label="Reads from"><span className="break-all font-mono"><span className="text-[var(--estate-text-secondary)]">{d.resolvesTo.fullPath}</span>{d.resolvesTo.column && <span className="text-[var(--estate-ink)]">.{d.resolvesTo.column}</span>}</span></KV>
                            {d.resolvesTo.expression && <KV label="Formula"><code className="font-mono text-[var(--estate-ink)]">{d.resolvesTo.expression}</code></KV>}
                            <KV label="Result column"><span className="font-mono text-[var(--estate-ink)]">{d.resolvesTo.resultAlias}</span> <span className="text-caption text-[var(--estate-text-muted)]">{'\u2014'} query results use this name</span></KV>
                            {d.classification.synonyms.length > 0 && <KV label="Also called">{d.classification.synonyms.join(', ')}</KV>}
                            <KV label="Status"><ApprovalPill status={d.status} /></KV>
                            {d.capped && <KV label="Depends on draft"><span className="text-[var(--warn)]">{d.cappedBy?.map(labelOf).join(', ')}</span></KV>}
                            {d.compiledSql && (
                              <div className="py-2">
                                <div className="mb-1.5 text-caption text-[var(--estate-text-muted)]">Generated SQL (read-only)</div>
                                <pre className="overflow-x-auto rounded-ctl bg-[var(--estate-hover)] p-3 font-mono text-ui-regular leading-relaxed text-[var(--estate-ink)] scrollbar-thin">{d.compiledSql}</pre>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {detailNode.kind === 'consumer' && (
                        <>
                          <KV label="Visibility">{(detailNode as ConsumerNode).visibility === 'shared' ? 'Shared' : 'Private'}</KV>
                          <KV label="Model">{(detailNode as ConsumerNode).modelGoverned ? 'Approved' : 'Not approved yet'}</KV>
                        </>
                      )}
                    </dl>
                  </section>
                )}

                {focus.omissions.length > 0 && (
                  <p className="text-caption text-[var(--estate-text-muted)]">Not shown: {focus.omissions.map((o) => `${o.field} \u2014 ${o.reason}`).join(' \u00b7 ')}</p>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}