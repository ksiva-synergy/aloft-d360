'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import { useRouter, useSearchParams } from '@/lib/navigation';
import { ArrowLeft, BarChart3, ChevronRight, Copy, Loader2, Search, Sigma, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATALOG_BTN, CATALOG_SELECT } from '@/components/estate/catalog-ui';
import type { SourceImpact, SourceTreeNode } from '@/lib/powerbi/source-impact';
import type { OriginClass } from '@/lib/powerbi/source-origin';
import { CLASS_COLOR, LaneCanvas, type Lane } from '@/components/estate/report-lineage/LaneCanvas';
import { OriginIcon } from '@/components/estate/report-lineage/ReportLineageView';
import { Chip, StatusPill, asLineageStatus, copyText } from '@/components/estate/report-lineage/lineage-bits';

type ImpactResponse = { tree: SourceTreeNode[]; total_sources: number; node: string | null; impact: SourceImpact | null; not_found: boolean };

const BASE = '/agent-lab/estate/powerbi/source-impact';
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function SystemIcon({ cls, system, size = 22 }: { cls: OriginClass; system: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[5px] text-white" style={{ width: size, height: size, background: CLASS_COLOR[cls] }}>
      <OriginIcon origin={{ system: system as never }} cls={cls} className={size > 30 ? 'size-5' : 'size-3'} />
    </span>
  );
}

/** Ancestor ids of a node, nearest first. */
function ancestors(byId: Map<string, SourceTreeNode>, id: string | null): string[] {
  const out: string[] = [];
  let current = id ? byId.get(id)?.parent ?? null : null;
  while (current) { out.push(current); current = byId.get(current)?.parent ?? null; }
  return out;
}

function SourceTree({ tree, selected, onSelect }: { tree: SourceTreeNode[]; selected: string | null; onSelect: (id: string) => void }) {
  const byId = useMemo(() => new Map(tree.map((node) => [node.id, node])), [tree]);
  const [filter, setFilter] = useState('');
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const q = filter.trim().toLowerCase();

  // While searching: show matches plus their ancestors, expanded. Otherwise the selection's path is open.
  const matches = useMemo(() => (q ? new Set(tree.filter((node) => node.label.toLowerCase().includes(q)).map((node) => node.id)) : null), [tree, q]);
  const forcedOpen = useMemo(() => {
    const open = new Set<string>(ancestors(byId, selected));
    if (matches) for (const id of matches) ancestors(byId, id).forEach((a) => open.add(a));
    return open;
  }, [byId, selected, matches]);
  const isOpen = (id: string) => toggled[id] ?? forcedOpen.has(id);
  const visible = tree.filter((node) => {
    if (matches && !matches.has(node.id) && !forcedOpen.has(node.id) && !ancestors(byId, node.id).some((a) => matches.has(a))) return false;
    return ancestors(byId, node.id).every((a) => isOpen(a));
  });

  return (
    <aside aria-label="Sources" className="overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)]">
      <div className="space-y-1.5 p-2.5 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search servers, catalogs, tables, files"
            aria-label="Search sources" className={cn(CATALOG_SELECT, 'h-8 w-full pl-8')} />
        </div>
        <p className="px-0.5 text-size-caption text-[var(--estate-text-muted)]">
          {matches ? `${matches.size} matching ${matches.size === 1 ? 'item' : 'items'}` : 'Systems › servers › databases › schemas › tables'}
        </p>
      </div>
      <ul role="tree" aria-label="Source hierarchy" className="flex max-h-[680px] flex-col overflow-auto p-1.5">
        {visible.map((node) => {
          const open = isOpen(node.id);
          const active = node.id === selected;
          return (
            <li key={node.id} role="treeitem" aria-level={node.depth + 1} aria-expanded={node.leaf ? undefined : open} aria-selected={active}
              className="flex min-w-0 items-center gap-1 rounded-md" style={{ paddingLeft: node.depth * 14 }}>
              {node.leaf ? <span className="w-5 shrink-0" /> : (
                <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
                  onClick={() => setToggled((prev) => ({ ...prev, [node.id]: !open }))}
                  className="grid size-5 shrink-0 place-items-center rounded text-[var(--estate-text-dim)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]">
                  <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
                </button>
              )}
              <button type="button" onClick={() => onSelect(node.id)} title={`${node.level}: ${node.label}`}
                className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md border px-1.5 py-1.5 text-left',
                  active ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-transparent hover:bg-[var(--estate-hover)]',
                  matches && !matches.has(node.id) && 'opacity-60')}>
                {node.depth === 0 && <SystemIcon cls={node.cls} system={node.system} />}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[var(--estate-ink)]', node.depth === 0 ? 'text-size-ui font-medium' : 'text-size-ui')}>{node.label}</span>
                  <span className="block truncate text-size-caption text-[var(--estate-text-muted)]">
                    {node.depth === 0 ? plural(node.sources, 'source') : node.level}
                  </span>
                </span>
                <Chip title={`${plural(node.reports, 'report')} · ${plural(node.models, 'model')} · ${plural(node.tables, 'model table')}`}>{node.reports} rpt</Chip>
              </button>
            </li>
          );
        })}
        {!visible.length && (
          <li className="px-2 py-6 text-center text-caption text-[var(--estate-text-muted)]">
            {tree.length ? 'Nothing matches.' : 'No traced sources yet. Run lineage for all reports first.'}
          </li>
        )}
      </ul>
    </aside>
  );
}

function SystemOverview({ tree, onSelect }: { tree: SourceTreeNode[]; onSelect: (id: string) => void }) {
  const systems = tree.filter((node) => node.depth === 0);
  if (!systems.length) return null;
  return (
    <section aria-label="Source systems" className="space-y-2.5">
      <p className="text-caption text-[var(--estate-text-muted)]">Start with a source system, then drill into its servers, databases, schemas and tables.</p>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {systems.map((system) => {
          const children = tree.filter((node) => node.parent === system.id);
          const level = children[0]?.level;
          return (
            <button key={system.id} type="button" onClick={() => onSelect(system.id)}
              className="flex items-start gap-3 rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3.5 text-left hover:border-[var(--brand-a)]">
              <SystemIcon cls={system.cls} system={system.system} size={36} />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-ui font-medium text-[var(--estate-ink)]">{system.label}</span>
                <span className="block text-caption text-[var(--estate-text-muted)]">
                  {level ? `${plural(children.length, level.toLowerCase())} · ` : ''}{plural(system.sources, 'source')}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Chip>{plural(system.reports, 'report')}</Chip>
                  <Chip>{plural(system.models, 'model')}</Chip>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function impactLanes(impact: SourceImpact): Lane[] {
  const box = 'flex w-full min-w-0 items-start gap-2 rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] px-2.5 py-[7px]';
  const icon = 'mt-px grid size-[22px] shrink-0 place-items-center rounded-[5px] [&>svg]:size-[13px]';
  return [
    {
      key: 'sources', label: impact.scope.leaf ? 'Source' : 'Sources', count: impact.sources.length + impact.hidden_sources,
      items: [
        ...impact.sources.map((source) => ({
          id: source.id,
          group: impact.scope.leaf ? undefined : source.group,
          content: (
            <div className={box} title={`${source.title} · ${source.group}`}>
              <SystemIcon cls={source.cls} system={source.system} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{source.title}</span>
                {source.subtitle && <span className="block truncate font-mono text-size-caption text-[var(--estate-text-muted)]">{source.subtitle}</span>}
              </span>
            </div>
          ),
        })),
        ...(impact.hidden_sources > 0 ? [{
          id: 'more-sources',
          content: <p className="px-1 text-caption text-[var(--estate-text-muted)]">+{impact.hidden_sources} more · open a narrower level to see them</p>,
        }] : []),
      ],
    },
    {
      key: 'tables', label: 'Model tables', count: impact.tables.length,
      items: impact.tables.map((table) => ({
        id: table.id,
        group: table.model_name ?? 'Unknown model',
        content: (
          <div className={box}>
            <span className={cn(icon, 'border border-[var(--estate-border)] bg-[var(--estate-active-bg)] text-[var(--estate-text-secondary)]')}><Table2 /></span>
            <span className="min-w-0 flex-1 truncate text-size-ui font-medium text-[var(--estate-ink)]" title={table.name}>{table.name}</span>
          </div>
        ),
      })),
    },
    {
      key: 'measures', label: 'Measures', count: impact.measures.length,
      empty: <p className="text-caption text-[var(--estate-text-muted)]">No detected report measure reads these tables.</p>,
      items: impact.measures.map((measure) => ({
        id: measure.id,
        content: (
          <div className={box}>
            <span className={cn(icon, 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]')}><Sigma /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]" title={measure.name}>{measure.name}</span>
              {measure.model_name && <span className="block truncate text-size-caption text-[var(--estate-text-muted)]">{measure.model_name}</span>}
            </span>
          </div>
        ),
      })),
    },
    {
      key: 'reports', label: 'Reports', count: impact.reports.length,
      items: impact.reports.map((report) => ({
        id: report.id,
        content: (
          <Link href={`/agent-lab/estate/powerbi/reports/${encodeURIComponent(report.id)}/lineage`} className={cn(box, 'hover:border-[var(--brand-a)]')}>
            <span className={cn(icon, 'bg-[var(--brand-a)] text-white')}><BarChart3 /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]" title={report.name}>{report.name}</span>
              <span className="mt-1 flex flex-wrap gap-1">
                <StatusPill status={asLineageStatus(report.status)} />
                <Chip>{report.measure_ids.length ? plural(report.measure_ids.length, 'measure') : 'model-wide only'}</Chip>
              </span>
            </span>
          </Link>
        ),
      })),
    },
  ];
}

function ImpactPanel({ impact, tree, onSelect }: { impact: SourceImpact; tree: SourceTreeNode[]; onSelect: (id: string) => void }) {
  const lanes = useMemo(() => impactLanes(impact), [impact]);
  const all = useMemo(() => impact.edges.map((_, i) => i), [impact]);
  const models = new Set(impact.tables.map((table) => table.model_id ?? table.model_name)).size;
  const children = tree.filter((node) => node.parent === impact.scope.id);
  const what = impact.scope.leaf
    ? <b className="break-all font-semibold">{impact.scope.label}</b>
    : <>anything in {impact.scope.level === 'System' ? '' : `${impact.scope.level.toLowerCase()} `}<b className="break-all font-semibold">{impact.scope.label}</b></>;
  return (
    <section aria-label="Impact" className="min-w-0 overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)]">
      <div className="space-y-3 border-b border-[var(--estate-border)] px-4 py-3.5">
        <nav aria-label="Source path" className="flex flex-wrap items-center gap-1 text-caption text-[var(--estate-text-muted)]">
          {impact.breadcrumb.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <ChevronRight className="size-3 text-[var(--estate-text-dim)]" aria-hidden />}
              {i === impact.breadcrumb.length - 1 ? (
                <span className="font-medium text-[var(--estate-ink)]" aria-current="page">{crumb.label}</span>
              ) : (
                <button type="button" title={crumb.level} onClick={() => onSelect(crumb.id)} className="rounded px-1 hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]">
                  {crumb.label}
                </button>
              )}
            </React.Fragment>
          ))}
          <span className="ml-1.5 rounded-[5px] bg-[var(--estate-active-bg)] px-1.5 text-size-caption">{impact.scope.level}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <SystemIcon cls={impact.scope.cls} system={impact.scope.system} size={40} />
          <p className="min-w-0 flex-[1_1_280px] text-size-body text-[var(--estate-ink)]">
            Changing {what} can affect <b className="font-semibold">{plural(impact.reports.length, 'report')}</b> through{' '}
            <b className="font-semibold">{plural(models, 'semantic model')}</b>.
          </p>
          <dl className="flex gap-5">
            {([['sources', impact.sources.length + impact.hidden_sources], ['model tables', impact.tables.length], ['measures', impact.measures.length], ['reports', impact.reports.length]] as const).map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="text-size-caption text-[var(--estate-text-muted)]">{label}</dt>
                <dd className="text-kpi-md tabular-nums text-[var(--estate-ink)]">{value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')}
            onClick={() => void copyText(impact.reports.map((report) => report.name).join('\n'), 'Report list')}>
            <Copy className="size-3.5" aria-hidden /> Copy report list
          </button>
        </div>
        {children.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-size-caption text-[var(--estate-text-muted)]">Inside: </span>
            {children.slice(0, 16).map((child) => (
              <button key={child.id} type="button" onClick={() => onSelect(child.id)} title={`${child.level} · ${plural(child.reports, 'report')}`}
                className="inline-flex items-center gap-1.5 rounded-[5px] border border-[var(--estate-border)] bg-[var(--estate-surface)] px-1.5 py-0.5 text-size-caption text-[var(--estate-ink)] hover:border-[var(--brand-a)]">
                {child.label}<span className="tabular-nums text-[var(--estate-text-muted)]">{child.reports}</span>
              </button>
            ))}
            {children.length > 16 && <span className="text-size-caption text-[var(--estate-text-muted)]">+{children.length - 16} more in the tree</span>}
          </div>
        )}
      </div>
      <LaneCanvas
        ariaLabel={`Everything that depends on ${impact.scope.label}`}
        lanes={lanes}
        edges={impact.edges}
        hotNodes={null}
        hotEdges={null}
        animateEdges={all}
        columns="minmax(210px,1fr) minmax(190px,1fr) minmax(190px,1fr) minmax(200px,1fr)"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--estate-border)] px-3.5 py-2.5 text-size-caption text-[var(--estate-text-muted)]">
        <span className="inline-flex items-center gap-1.5"><svg viewBox="0 0 26 8" className="h-2 w-[26px]" aria-hidden><path d="M1 4h24" stroke="var(--estate-text-secondary)" strokeWidth={2} /></svg>Detected use</span>
        <span className="inline-flex items-center gap-1.5"><svg viewBox="0 0 26 8" className="h-2 w-[26px]" aria-hidden><path d="M1 4h24" stroke="var(--estate-text-secondary)" strokeWidth={2} strokeDasharray="4 4" /></svg>Model-wide (possible, not proven)</span>
        <span className="sm:ml-auto">From the latest stored snapshot of each report</span>
      </div>
    </section>
  );
}

export default function PowerBiSourceImpactPage() {
  const router = useRouter();
  const params = useSearchParams();
  const nodeParam = params.get('node');
  const keyParam = params.get('key');
  const requestKey = nodeParam ? `node=${encodeURIComponent(nodeParam)}` : keyParam ? `key=${encodeURIComponent(keyParam)}` : '';
  // `request` the response belongs to; while it differs from the URL a new response is loading.
  const [loaded, setLoaded] = useState<{ request: string; error: string | null; data: ImpactResponse | null } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/agent-lab/powerbi/sources/impact${requestKey ? `?${requestKey}` : ''}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { message?: string; error?: string }).message ?? (json as { error?: string }).error ?? `HTTP ${res.status}`);
        return json as ImpactResponse;
      })
      .then((data) => alive && setLoaded({ request: requestKey, error: null, data }))
      .catch((err: unknown) => alive && setLoaded((prev) => ({ request: requestKey, error: err instanceof Error ? err.message : String(err), data: prev?.data ?? null })));
    return () => { alive = false; };
  }, [requestKey]);

  const loading = !loaded || loaded.request !== requestKey;
  const data = loaded?.data ?? null;
  const impact = loading ? null : data?.impact ?? null;
  const selected = nodeParam ?? data?.node ?? null;
  const select = (id: string) => router.replace(`${BASE}?node=${encodeURIComponent(id)}`, { scroll: false });

  return (
    <div className="mx-auto max-w-[1400px] space-y-3.5 px-4 py-4">
      <header className="space-y-1.5">
        <Link href="/agent-lab/estate/powerbi/report-lineage" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1 text-caption')}>
          <ArrowLeft className="size-3" aria-hidden /> Report lineage
        </Link>
        <h1 className="text-title-section text-[var(--estate-ink)]">Source impact</h1>
        <p className="max-w-[72ch] text-caption text-[var(--estate-text-muted)]">
          Browse your data sources the way they are organised (system, server, database, schema, table; or site, folder, file, sheet)
          and see every model table, measure and report that depends on any level before you change, move or retire it.
        </p>
      </header>

      <div className="grid items-start gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SourceTree tree={data?.tree ?? []} selected={selected} onSelect={select} />
        <div className="min-w-0 space-y-3">
          {loading && (
            <p className="flex items-center gap-1.5 text-caption text-[var(--estate-text-muted)]">
              <Loader2 className="size-3 animate-spin" aria-hidden /> {data ? 'Loading impact…' : 'Loading sources…'}
            </p>
          )}
          {loaded?.error && <p role="alert" className="text-caption text-[var(--estate-text-muted)]">Impact unavailable: {loaded.error}</p>}
          {impact && <ImpactPanel impact={impact} tree={data?.tree ?? []} onSelect={select} />}
          {data && !loading && !impact && (data.not_found ? (
            <div className="rounded-lg border border-dashed border-[var(--estate-border)] p-6 text-center text-caption text-[var(--estate-text-muted)]">
              That source is not in any stored report snapshot. It may have been renamed, or snapshots need a refresh.
            </div>
          ) : <SystemOverview tree={data.tree} onSelect={select} />)}
        </div>
      </div>
    </div>
  );
}
