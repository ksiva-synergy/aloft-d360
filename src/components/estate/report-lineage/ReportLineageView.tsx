'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/lib/navigation/link';
import {
  ArrowLeft, BarChart3, Braces, Calculator, Code2, Copy, Database, FileText, Globe, HelpCircle, Search, Sigma, Table2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATALOG_BTN, CATALOG_SELECT, formatFull, formatRelative } from '@/components/estate/catalog-ui';
import type { OriginClass, SourceOrigin } from '@/lib/powerbi/source-origin';
import type { ReportLineagePayload } from '@/lib/powerbi/report-lineage-types';
import {
  ORIGIN_CLASS_LABEL,
  ORIGIN_CLASS_ORDER,
  REPORT_NODE_ID,
  buildLineageGraph,
  classMix,
  lineageReadiness,
  lineageRows,
  lineageRowsToTsv,
  liveLineageStatus,
  traceRelated,
  type LineageGraph,
  type LineageNode,
} from '@/lib/powerbi/report-lineage-graph';
import { CLASS_COLOR, ClassMixBar, ClassSwatch, LaneCanvas, type Lane } from './LaneCanvas';
import { NodeDetails, ReadinessPanel, nodeLabel } from './LineageInspector';
import { BindingChip, Chip, STATUS_COLOR, StatusPill, asLineageStatus, copyText } from './lineage-bits';

export type ReportLineageSnapshot = { status: string; generated_at: string; run_id: string | null } | null;

type Lens = 'flow' | 'table';

const LENS_KEY = 'aloft.reportLineage.lens';
const WIDE_KEY = 'aloft.reportLineage.showModelWide';

function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* preference only */ }
}

export function OriginIcon({ origin, cls, className }: { origin?: Pick<SourceOrigin, 'system'>; cls: OriginClass; className?: string }) {
  const Icon = cls === 'warehouse' || cls === 'database' ? Database
    : cls === 'file' ? (origin && ['web', 'odata'].includes(origin.system) ? Globe : FileText)
      : cls === 'model' ? Calculator : HelpCircle;
  return <Icon className={className} aria-hidden />;
}

const NODE_BTN = 'flex w-full min-w-0 items-start gap-2 rounded-lg border bg-[var(--estate-surface)] px-2.5 py-[7px] text-left transition-colors hover:border-[var(--brand-a)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-a)]';

function NodeIcon({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return <span className={cn('mt-px grid size-[22px] shrink-0 place-items-center rounded-[5px] [&>svg]:size-[13px]', className)} style={style}>{children}</span>;
}

function buildLanes(graph: LineageGraph, lineage: ReportLineagePayload, selected: string | null, onSelect: (id: string) => void): Lane[] {
  const nodeBtn = (id: string, extra: string, children: React.ReactNode, title: string) => (
    <button type="button" data-node-id={id} aria-pressed={selected === id} title={title} onClick={() => onSelect(id)}
      className={cn(NODE_BTN, selected === id ? 'border-[var(--brand-a)]' : 'border-[var(--estate-border)]', extra)}>
      {children}
    </button>
  );
  const allClasses = graph.sources.map((source) => source.cls);
  return [
    {
      key: 'sources', label: 'Original sources', count: graph.sources.length,
      empty: <p className="text-caption text-[var(--estate-text-muted)]">No parsed table-source details available.</p>,
      items: graph.sources.map((source) => ({
        id: source.id,
        group: source.group,
        groupTitle: <><ClassSwatch cls={source.cls} /><span className="truncate">{source.group}</span></>,
        content: nodeBtn(source.id, source.cls === 'unknown' ? 'border-dashed !border-[var(--lineage-unknown)]' : '', (
          <>
            <NodeIcon className={source.cls === 'unknown' ? 'text-[var(--estate-text-secondary)]' : 'text-white'}
              style={{ background: source.cls === 'unknown' ? 'var(--estate-active-bg)' : CLASS_COLOR[source.cls] }}>
              <OriginIcon origin={source.origin} cls={source.cls} />
            </NodeIcon>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{source.title}</span>
              {source.subtitle && <span className="block truncate font-mono text-size-caption text-[var(--estate-text-muted)]">{source.subtitle}</span>}
            </span>
          </>
        ), `${source.title} · ${source.group}`),
      })),
    },
    {
      key: 'tables', label: 'Model tables', count: graph.tables.length,
      items: graph.tables.map((table) => ({
        id: table.id,
        content: nodeBtn(table.id, table.modelWide ? 'bg-[var(--estate-bg)]' : '', (
          <>
            <NodeIcon className="border border-[var(--estate-border)] bg-[var(--estate-active-bg)] text-[var(--estate-text-secondary)]"><Table2 /></NodeIcon>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{table.name}</span>
              <span className="mt-1 flex flex-wrap gap-1">
                {table.source.storage_mode && <Chip>{table.source.storage_mode}</Chip>}
                <BindingChip binding={table.binding} />
                {table.modelWide && <Chip title="No detected report measure reads this table">model-wide</Chip>}
              </span>
            </span>
          </>
        ), table.name),
      })),
    },
    {
      key: 'measures', label: 'Measures on report', count: graph.measures.length,
      empty: <p className="text-caption text-[var(--estate-text-muted)]">No explicit measure references detected.</p>,
      items: graph.measures.map((node) => ({
        id: node.id,
        content: nodeBtn(node.id, node.measure.found_in_model ? '' : 'border-dashed !border-[var(--bad)]', (
          <>
            <NodeIcon className="bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]"><Sigma /></NodeIcon>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{node.measure.name}</span>
              <span className={cn('block truncate font-mono text-size-caption', node.measure.found_in_model ? 'text-[var(--estate-text-muted)]' : 'text-[var(--bad)]')}>
                {node.measure.found_in_model ? node.measure.measure_table ?? '—' : 'not found on model'}
              </span>
            </span>
            {node.classes.length > 0 && (
              <span className="flex shrink-0 gap-[3px] self-center" title={`Reads from: ${node.classes.map((cls) => ORIGIN_CLASS_LABEL[cls]).join(', ')}`}>
                {node.classes.map((cls) => <ClassSwatch key={cls} cls={cls} round />)}
              </span>
            )}
          </>
        ), node.measure.name),
      })),
    },
    {
      key: 'report', label: 'Report',
      items: [{
        id: REPORT_NODE_ID, grow: true,
        content: nodeBtn(REPORT_NODE_ID, 'flex-1 flex-col items-stretch gap-2.5 p-3', (
          <>
            <span className="flex items-center gap-2">
              <NodeIcon className="bg-[var(--brand-a)] text-white"><BarChart3 /></NodeIcon>
              <span className="min-w-0 text-size-ui font-medium text-[var(--estate-ink)]">{lineage.report.name}</span>
            </span>
            {lineage.harvest.page_count != null && lineage.harvest.page_count > 0 && (
              <span className="grid grid-cols-3 gap-[5px]" title={`${lineage.harvest.page_count} pages`}>
                {Array.from({ length: Math.min(lineage.harvest.page_count, 12) }, (_, i) => (
                  <i key={i} className="block aspect-[16/10] rounded-[3px] border border-[var(--estate-border)] bg-[var(--estate-bg)]" />
                ))}
              </span>
            )}
            <span className="space-y-1 text-size-caption text-[var(--estate-text-muted)]">
              <span className="flex justify-between"><span>Pages</span><b className="font-medium tabular-nums text-[var(--estate-ink)]">{lineage.harvest.page_count ?? '—'}</b></span>
              <span className="flex justify-between"><span>Measures</span><b className="font-medium tabular-nums text-[var(--estate-ink)]">{graph.measures.length}</b></span>
            </span>
            {allClasses.length > 0 && (
              <span className="space-y-1 text-size-caption text-[var(--estate-text-muted)]">
                <span className="block text-eyebrow uppercase">Fed by</span>
                <ClassMixBar mix={classMix(allClasses)} />
                {classMix(allClasses).map((entry) => (
                  <span key={entry.cls} className="flex items-center gap-1.5">
                    <ClassSwatch cls={entry.cls} />{ORIGIN_CLASS_LABEL[entry.cls]}
                    <b className="ml-auto font-medium tabular-nums text-[var(--estate-ink)]">{entry.count}</b>
                  </span>
                ))}
              </span>
            )}
          </>
        ), lineage.report.name),
      }],
    },
  ];
}

function TraceBar({ graph, focusId, marked, hotNodes, query, reportName }: {
  graph: LineageGraph; focusId: string | null; marked: string[] | null; hotNodes: Set<string> | null; query: string; reportName: string;
}) {
  let content: React.ReactNode;
  if (marked) {
    content = <><Seg me>{marked.length} {marked.length === 1 ? 'item' : 'items'} from the checklist</Seg><span>and everything connected · press Esc to clear</span></>;
  } else if (focusId && hotNodes) {
    const focus = graph.byId.get(focusId);
    const layers: Array<{ kind: LineageNode['kind']; many: string }> = [
      { kind: 'source', many: 'sources' }, { kind: 'table', many: 'tables' }, { kind: 'measure', many: 'measures' }, { kind: 'report', many: 'reports' },
    ];
    const segs = layers.map(({ kind, many }) => {
      if (focus?.kind === kind) return <Seg key={kind} me>{nodeLabel(focus, reportName)}</Seg>;
      const nodes = [...hotNodes].map((id) => graph.byId.get(id)).filter((node): node is LineageNode => node?.kind === kind);
      if (!nodes.length) return null;
      const classes = [...new Set(nodes.flatMap((node) => node.kind === 'source' || node.kind === 'table' ? [node.cls] : []))];
      return (
        <Seg key={kind}>
          {classes.map((cls) => <ClassSwatch key={cls} cls={cls} round title={ORIGIN_CLASS_LABEL[cls]} />)}
          {nodes.length === 1 ? nodeLabel(nodes[0]!, reportName) : `${nodes.length} ${many}`}
        </Seg>
      );
    }).filter(Boolean);
    content = (
      <>
        <span>Tracing</span>
        {segs.map((seg, i) => <React.Fragment key={i}>{i > 0 && <span aria-hidden className="text-[var(--estate-text-dim)]">→</span>}{seg}</React.Fragment>)}
      </>
    );
  } else if (query) {
    content = <span>{hotNodes?.size ?? 0} {hotNodes?.size === 1 ? 'match' : 'matches'} for “{query}”</span>;
  } else {
    content = <span>Click any box to trace where its data comes from and where it goes. Line colour shows the kind of source each line carries.</span>;
  }
  return (
    <div aria-live="polite" className="flex min-h-[46px] flex-wrap items-center gap-2 border-b border-[var(--estate-border)] bg-[var(--estate-bg)] px-3.5 py-2 text-caption text-[var(--estate-text-muted)]">
      {content}
    </div>
  );
}

function Seg({ me, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5',
      me ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)] font-semibold text-[var(--brand-a-ink)]' : 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-secondary)]')}>
      {children}
    </span>
  );
}

function Legend() {
  const line = (dash?: string, color = 'var(--estate-text-secondary)') => (
    <svg viewBox="0 0 26 8" className="h-2 w-[26px]" aria-hidden><path d="M1 4h24" stroke={color} strokeWidth={2} strokeDasharray={dash} /></svg>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--estate-border)] px-3.5 py-2.5 text-size-caption text-[var(--estate-text-muted)]">
      <span className="inline-flex items-center gap-1.5">{line()}Detected use</span>
      <span className="inline-flex items-center gap-1.5">{line('4 4')}Model-wide (possible, not proven)</span>
      <span className="inline-flex items-center gap-1.5">{line('2 3', 'var(--bad)')}Unresolved</span>
      <span className="sm:ml-auto">Line colour:</span>
      {ORIGIN_CLASS_ORDER.map((cls) => <span key={cls} className="inline-flex items-center gap-1.5"><ClassSwatch cls={cls} />{ORIGIN_CLASS_LABEL[cls]}</span>)}
    </div>
  );
}

function TableLens({ graph, selected, onSelect }: { graph: LineageGraph; selected: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => lineageRows(graph), [graph]);
  const q = filter.trim().toLowerCase();
  const visible = q ? rows.filter((row) => [row.measure, row.table, row.storage, row.system, row.location, row.database, row.object, row.uc]
    .some((value) => value?.toLowerCase().includes(q))) : rows;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--estate-border)] px-3 py-2.5">
        <div className="relative min-w-0 flex-[1_1_220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter rows (any column)"
            aria-label="Filter lineage rows" className={cn(CATALOG_SELECT, 'h-8 w-full pl-8')} />
        </div>
        <span className="text-caption tabular-nums text-[var(--estate-text-muted)]">{visible.length} of {rows.length} rows</span>
        <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')} onClick={() => void copyText(lineageRowsToTsv(visible), 'Rows')}>
          <Copy className="size-3.5" aria-hidden /> Copy as TSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-caption">
          <thead className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)] text-size-caption text-[var(--estate-text-muted)]">
            <tr>{['Measure', 'Model table', 'Storage', 'Source', 'Server / site / path', 'Database / folder', 'Object / file', 'Unity Catalog'].map((h) => (
              <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--estate-border)]">
            {visible.map((row, index) => (
              <tr key={index} onClick={() => onSelect(row.nodeIds[row.nodeIds.length - 1] ?? REPORT_NODE_ID)}
                className={cn('cursor-pointer hover:bg-[var(--brand-a-soft)]', selected && row.nodeIds.includes(selected) && 'bg-[var(--brand-a-soft)]')}>
                <td className="px-2.5 py-1.5 text-[var(--estate-ink)]">
                  {row.measure ?? <span className="text-[var(--estate-text-dim)]">(model-wide)</span>}
                  {!row.measureFound && <> <Chip tone="bad">not on model</Chip></>}
                </td>
                <td className="px-2.5 py-1.5 font-mono text-size-caption">{row.table ?? '—'}</td>
                <td className="px-2.5 py-1.5">{row.storage ?? '—'}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5">{row.cls ? <span className="inline-flex items-center gap-1.5"><ClassSwatch cls={row.cls} />{row.system}</span> : '—'}</td>
                <td className="max-w-[240px] break-all px-2.5 py-1.5 font-mono text-size-caption">{row.location ?? '—'}</td>
                <td className="break-all px-2.5 py-1.5 font-mono text-size-caption">{row.database ?? '—'}</td>
                <td className="break-all px-2.5 py-1.5 font-mono text-size-caption">{row.object ?? '—'}</td>
                <td className="px-2.5 py-1.5">{row.uc ? <code className="break-all text-size-caption">{row.uc}</code> : row.binding ? <BindingChip binding={row.binding} /> : '—'}</td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--estate-text-muted)]">No rows match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatTile({ label, value, children, sub }: { label: string; value: React.ReactNode; children?: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-r border-[var(--estate-border)] px-3.5 py-2.5 last:border-r-0 sm:border-b-0">
      <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">{label}</p>
      <p className="mt-px text-kpi-md font-semibold tabular-nums text-[var(--estate-ink)]">{value}</p>
      <div className="mt-2">{children}</div>
      <p className="mt-1 truncate text-size-caption text-[var(--estate-text-muted)]">{sub}</p>
    </div>
  );
}

function Meter({ parts }: { parts: { value: number; color: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="flex h-1 gap-px overflow-hidden rounded-sm bg-[var(--estate-active-bg)]">
      {total > 0 && parts.map((part, i) => part.value > 0 && <i key={i} className="block h-full" style={{ width: `${(part.value / total) * 100}%`, background: part.color }} />)}
    </div>
  );
}

export function snapshotSql(reportId: string): string {
  return [
    'SELECT r.name AS report_name, l.status, l.measure_count, l.uc_paths, l.warnings, l.run_id, l.generated_at',
    'FROM pbi_report_lineage l',
    'JOIN pbi_reports r ON r.id = l.report_id AND r.org_id = l.org_id',
    `WHERE l.report_id = '${reportId.replace(/'/g, "''")}';`,
  ].join('\n');
}

export function ReportLineageView({ lineage, snapshot, onOpenMeasure }: {
  lineage: ReportLineagePayload;
  snapshot: ReportLineageSnapshot;
  onOpenMeasure?: (name: string) => void;
}) {
  const [lens, setLens] = useState<Lens>(() => (typeof window !== 'undefined' && readPref(LENS_KEY) === 'table' ? 'table' : 'flow'));
  const [showWide, setShowWide] = useState(() => (typeof window === 'undefined' ? true : readPref(WIDE_KEY) !== 'false'));
  const [selected, setSelected] = useState<string | null>(null);
  const [marked, setMarked] = useState<string[] | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const findRef = useRef<HTMLInputElement>(null);

  const fullGraph = useMemo(() => buildLineageGraph(lineage, { showModelWide: true }), [lineage]);
  const graph = useMemo(() => (showWide ? fullGraph : buildLineageGraph(lineage, { showModelWide: false })), [fullGraph, lineage, showWide]);
  const readiness = useMemo(() => lineageReadiness(lineage, fullGraph), [lineage, fullGraph]);
  const live = liveLineageStatus(readiness);

  const select = useCallback((id: string | null) => { setSelected(id); setMarked(null); setHovered(null); }, []);
  const mark = useCallback((ids: string[]) => {
    setSelected(null);
    setLens('flow');
    setShowWide(true);
    setMarked(ids);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((event.target as HTMLElement)?.tagName ?? '');
      if (event.key === 'Escape') { setSelected(null); setMarked(null); }
      if (event.key === '/' && !typing) { event.preventDefault(); findRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const focusId = marked ? null : selected ?? hovered;
  const trace = useMemo(() => {
    if (marked) return traceRelated(graph.edges, marked.filter((id) => graph.byId.has(id)));
    if (focusId && graph.byId.has(focusId)) return traceRelated(graph.edges, [focusId]);
    if (q) {
      const nodes = new Set([...graph.byId.values()].filter((node) => {
        const text = node.kind === 'source' ? `${node.title} ${node.subtitle ?? ''} ${node.group}`
          : node.kind === 'table' ? `${node.name} ${node.source.uc_full_path ?? ''}` : node.kind === 'measure' ? node.measure.name : '';
        return text.toLowerCase().includes(q);
      }).map((node) => node.id));
      return { nodes, edges: new Set<number>() };
    }
    return null;
  }, [graph, marked, focusId, q]);

  const lanes = useMemo(() => buildLanes(graph, lineage, selected, select), [graph, lineage, selected, select]);
  const selectedNode = selected ? fullGraph.byId.get(selected) ?? null : null;
  const issues = readiness.filter((item) => item.tone !== 'ok');
  const ucBound = fullGraph.tables.filter((table) => table.binding === 'bound').length;
  const ucCandidates = ucBound + fullGraph.tables.filter((table) => table.binding === 'unbound').length;
  const missing = fullGraph.measures.filter((node) => !node.measure.found_in_model).length;
  const systems = new Set(fullGraph.sources.map((source) => source.origin.system)).size;
  const snapStatus = snapshot ? asLineageStatus(snapshot.status) : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-3.5">
      <header className="grid gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/agent-lab/estate/powerbi/report-lineage" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1 text-caption')}>
              <ArrowLeft className="size-3" aria-hidden /> All reports
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-title-section text-[var(--estate-ink)]">{lineage.report.name}</h1>
            <StatusPill status={live} title="Computed from the current harvest" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-caption text-[var(--estate-text-muted)]">
            <span>Model{' '}
              <Link href={`/agent-lab/estate/powerbi?model=${encodeURIComponent(lineage.report.model_id)}`} className="font-medium text-[var(--estate-ink)] underline-offset-2 hover:underline">
                {lineage.report.model_name}
              </Link>
            </span>
            {snapshot ? (
              <span title={formatFull(snapshot.generated_at)}>
                Stored snapshot{' '}{snapStatus && <span className="font-medium text-[var(--estate-ink)]">{snapStatus}</span>}
                {' · '}{formatRelative(snapshot.generated_at)}
                {snapshot.run_id && <> · run <code className="font-mono text-size-caption">{snapshot.run_id}</code></>}
              </span>
            ) : <span>No stored snapshot yet · run lineage from All reports</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
          <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')}
            onClick={() => void copyText(`GET /api/agent-lab/powerbi/reports/${lineage.report.id}/lineage`, 'API request')}>
            <Code2 className="size-3.5" aria-hidden /> Copy API
          </button>
          <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')} onClick={() => void copyText(snapshotSql(lineage.report.id), 'SQL')}>
            <Copy className="size-3.5" aria-hidden /> Copy SQL
          </button>
          <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5')} onClick={() => void copyText(JSON.stringify(lineage, null, 2), 'JSON')}>
            <Braces className="size-3.5" aria-hidden /> Copy JSON
          </button>
        </div>
      </header>

      <section aria-label="Lineage summary" className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] sm:grid-cols-5">
        <StatTile label="Measures used" value={fullGraph.measures.length} sub={`${fullGraph.measures.length - missing} resolved · ${missing} not on model`}>
          <Meter parts={[{ value: fullGraph.measures.length - missing, color: 'var(--ok)' }, { value: missing, color: 'var(--bad)' }]} />
        </StatTile>
        <StatTile label="Model tables" value={fullGraph.tables.length} sub={`${fullGraph.tables.filter((t) => t.modelWide).length} model-wide only`}>
          <ClassMixBar mix={classMix(fullGraph.tables.map((table) => table.cls))} />
        </StatTile>
        <StatTile label="Original sources" value={fullGraph.sources.length} sub={`${systems} ${systems === 1 ? 'system' : 'systems'}`}>
          <ClassMixBar mix={classMix(fullGraph.sources.map((source) => source.cls))} />
        </StatTile>
        <StatTile
          label="Unity Catalog"
          value={ucCandidates ? <>{ucBound} <span className="text-size-caption font-medium text-[var(--estate-text-muted)]">/ {ucCandidates}</span></> : '—'}
          sub={ucCandidates ? 'warehouse tables mapped' : 'no warehouse tables'}
        >
          <Meter parts={[{ value: ucBound, color: 'var(--lineage-warehouse)' }, { value: ucCandidates - ucBound, color: 'transparent' }]} />
        </StatTile>
        <StatTile label="To fix" value={<span style={{ color: issues.length ? STATUS_COLOR[issues.some((i) => i.tone === 'bad') ? 'blocked' : 'partial'] : 'var(--ok)' }}>{issues.length}</span>}
          sub={issues.length ? 'see the checklist' : 'nothing open'}>
          <div className="flex gap-1">{issues.map((item) => <i key={item.id} className="block h-1 w-2 rounded-sm" style={{ background: item.tone === 'bad' ? 'var(--bad)' : 'var(--warn)' }} />)}</div>
        </StatTile>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-2.5">
          <div role="tablist" aria-label="Lineage view" className="flex gap-0.5 rounded-[9px] border border-[var(--estate-border)] bg-[var(--estate-active-bg)] p-[3px]">
            {(['flow', 'table'] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={lens === value}
                onClick={() => { setLens(value); writePref(LENS_KEY, value); }}
                className={cn('rounded-[7px] px-3 py-1 text-caption font-medium', lens === value ? 'bg-[var(--estate-surface)] text-[var(--estate-ink)] shadow-sm' : 'text-[var(--estate-text-secondary)]')}>
                {value === 'flow' ? 'Flow' : 'Table'}
              </button>
            ))}
          </div>
          {lens === 'flow' && (
            <>
              <div className="relative min-w-0 max-w-[300px] flex-[1_1_200px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
                <input ref={findRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a measure, table or source" aria-label="Find in lineage" className={cn(CATALOG_SELECT, 'h-8 w-full pl-8')} />
              </div>
              <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-caption text-[var(--estate-text-secondary)]">
                <input type="checkbox" checked={showWide} className="size-3.5 accent-[var(--brand-a)]"
                  onChange={(event) => {
                    setShowWide(event.target.checked);
                    writePref(WIDE_KEY, String(event.target.checked));
                    if (!event.target.checked) { setSelected(null); setMarked(null); }
                  }} />
                Show model-wide tables
              </label>
            </>
          )}
        </div>
        <span className="hidden text-caption text-[var(--estate-text-muted)] sm:inline">
          {lens === 'flow' ? 'Press / to find · Esc clears' : 'One row per measure, table and source'}
        </span>
      </div>

      <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label={lens === 'flow' ? 'Lineage flow' : 'Lineage rows'} className="min-w-0 overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)]">
          {lens === 'flow' ? (
            <>
              <TraceBar graph={graph} focusId={focusId} marked={marked} hotNodes={trace?.nodes ?? null} query={query.trim()} reportName={lineage.report.name} />
              <div onClick={(event) => { if (marked && !(event.target as HTMLElement).closest('[data-lane-node]')) setMarked(null); }}>
                <LaneCanvas
                  ariaLabel="Lineage from original sources to the report"
                  lanes={lanes}
                  edges={graph.edges}
                  hotNodes={trace?.nodes ?? null}
                  hotEdges={trace?.edges ?? null}
                  selectedId={selected}
                  markedIds={marked}
                  animateEdges={trace && trace.edges.size ? [...trace.edges] : null}
                  onHover={selected || marked ? undefined : setHovered}
                />
              </div>
              <Legend />
            </>
          ) : (
            <TableLens graph={fullGraph} selected={selected} onSelect={select} />
          )}
        </section>
        <aside aria-label="Lineage details" className="min-w-0 overflow-hidden rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] xl:sticky xl:top-3 xl:max-h-[calc(100vh-24px)] xl:overflow-auto">
          {selectedNode ? (
            <>
              <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
                <span className="text-size-caption text-[var(--estate-text-dim)]">Selected</span>
                <button type="button" className={cn(CATALOG_BTN, 'h-6 px-2 text-size-caption')} onClick={() => select(null)}>Back to readiness</button>
              </div>
              <NodeDetails node={selectedNode} graph={fullGraph} lineage={lineage} onSelect={select} onOpenMeasure={onOpenMeasure} />
            </>
          ) : (
            <ReadinessPanel items={readiness} warnings={lineage.warnings ?? []} connections={lineage.source_connections ?? []} onMark={mark} />
          )}
        </aside>
      </div>
      <p className="text-caption text-[var(--estate-text-dim)]">
        API: <code className="font-mono">GET /api/agent-lab/powerbi/reports/{lineage.report.id}/lineage</code>
      </p>
    </div>
  );
}
