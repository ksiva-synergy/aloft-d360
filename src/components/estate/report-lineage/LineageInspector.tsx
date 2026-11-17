'use client';

import React from 'react';
import Link from '@/lib/navigation/link';
import { AlertTriangle, Check, GitBranch, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { describeOrigin, systemLabel } from '@/lib/powerbi/source-origin';
import {
  ORIGIN_CLASS_LABEL,
  isShareableOrigin,
  type LineageGraph,
  type LineageNode,
  type ReadinessItem,
} from '@/lib/powerbi/report-lineage-graph';
import type { ReportLineagePayload } from '@/lib/powerbi/report-lineage-types';
import { ClassSwatch } from './LaneCanvas';
import { BINDING_TEXT, BindingChip, Chip, CopyButton, SectionLabel, ValueList } from './lineage-bits';

export function sourceImpactHref(key: string): string {
  return `/agent-lab/estate/powerbi/source-impact?key=${encodeURIComponent(key)}`;
}

export function measureGraphHref(modelId: string, measure: string): string {
  return `/agent-lab/estate/powerbi?model=${encodeURIComponent(modelId)}&measure=${encodeURIComponent(measure)}`;
}

function NodeLinks({ ids, graph, onSelect }: { ids: string[]; graph: LineageGraph; onSelect: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const node = graph.byId.get(id);
        if (!node) return null;
        return (
          <button key={id} type="button" onClick={() => onSelect(id)}
            className="rounded-[5px] border border-[var(--estate-border)] bg-[var(--estate-surface)] px-1.5 py-0.5 text-size-caption text-[var(--estate-ink)] hover:border-[var(--brand-a)] hover:text-[var(--brand-a-ink)]">
            {nodeLabel(node)}
          </button>
        );
      })}
    </div>
  );
}

export function nodeLabel(node: LineageNode, reportName = 'Report'): string {
  switch (node.kind) {
    case 'source': return node.title;
    case 'table': return node.name;
    case 'measure': return node.measure.name;
    default: return reportName;
  }
}

function CodeBox({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="relative">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--estate-border)] bg-[var(--estate-bg)] p-2.5 pr-7 font-mono text-size-caption text-[var(--estate-ink)]">{code}</pre>
        <CopyButton value={code} label={label} className="absolute right-1.5 top-1.5" />
      </div>
    </div>
  );
}

function NavigationSteps({ steps }: { steps: { query: string; fields: Record<string, string> }[] }) {
  if (!steps.length) return null;
  return (
    <div>
      <SectionLabel>Navigation path in Power Query</SectionLabel>
      <ol className="space-y-1 text-caption">
        {steps.map((step, index) => (
          <li key={`${step.query}:${index}`} className="grid grid-cols-[12px_minmax(0,1fr)] gap-2">
            <span aria-hidden className="mt-1.5 size-[7px] rounded-full border-[1.5px] border-[var(--brand-a)]" />
            <span className="min-w-0 break-all">
              <span className="text-[var(--estate-text-muted)]">{step.query}: </span>
              {Object.entries(step.fields).map(([key, value], i) => (
                <React.Fragment key={key}>
                  {i > 0 && <span className="text-[var(--estate-text-dim)]"> · </span>}
                  <code className="text-size-caption">{`${key}=${value}`}</code>
                </React.Fragment>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReadinessPanel({ items, warnings, connections, onMark }: {
  items: ReadinessItem[];
  warnings: string[];
  connections: ReportLineagePayload['source_connections'];
  onMark: (ids: string[]) => void;
}) {
  const open = items.filter((item) => item.tone !== 'ok').length;
  return (
    <>
      <div className="space-y-1 border-b border-[var(--estate-border)] p-3.5">
        <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">
          {open ? 'What needs attention' : 'Lineage readiness'}
        </p>
        <p className="text-caption text-[var(--estate-text-muted)]">
          {open ? <>Use <b className="font-medium text-[var(--estate-ink)]">Show</b> to light each item up in the flow.</> : 'Measures, tables and original sources are all traced.'}
        </p>
      </div>
      <div className="space-y-3.5 p-3.5">
        <ul className="space-y-0.5" aria-label="Readiness checklist">
          {items.map((item) => (
            <li key={item.id} className={cn('grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1.5 py-1.5 text-caption', item.tone !== 'ok' && 'bg-[var(--estate-bg)]')}>
              <span className={cn('mt-px grid size-4 place-items-center rounded-full',
                item.tone === 'ok' ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : item.tone === 'warn' ? 'bg-[var(--warn-bg)] text-[var(--warn)]' : 'bg-[var(--bad-bg)] text-[var(--bad)]')}>
                {item.tone === 'ok' ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden /> : <AlertTriangle className="size-2.5" strokeWidth={3} aria-hidden />}
              </span>
              <div className="min-w-0">
                <p className="text-[var(--estate-ink)]">{item.title}</p>
                {item.detail && <p className="mt-px break-words text-size-caption text-[var(--estate-text-muted)]">{item.detail}</p>}
              </div>
              {item.nodeIds.length > 0 && (
                <button type="button" className={cn(CATALOG_BTN, 'h-6 px-2 text-size-caption')} onClick={() => onMark(item.nodeIds)}>Show</button>
              )}
            </li>
          ))}
        </ul>
        {warnings.length > 0 && (
          <div>
            <SectionLabel>Resolver notes</SectionLabel>
            <ul className="list-inside list-disc space-y-0.5 text-size-caption text-[var(--estate-text-muted)]">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        {connections.length > 0 && <InventoryConnections connections={connections} />}
        <p className="border-l-2 border-[var(--estate-border)] pl-2 text-size-caption text-[var(--estate-text-muted)]">
          Ready means measures, model tables and original sources are traced. It does not yet cover each visual&apos;s columns and filters.
        </p>
      </div>
    </>
  );
}

function InventoryConnections({ connections }: { connections: ReportLineagePayload['source_connections'] }) {
  return (
    <div>
      <SectionLabel>Model connections (Power BI inventory)</SectionLabel>
      <ul className="space-y-2.5">
        {connections.map((connection, index) => (
          <li key={`${connection.datasource_id ?? connection.type}:${index}`} className="space-y-1">
            <p className="text-caption font-medium text-[var(--estate-ink)]">{connection.type ?? 'Unknown connector'}</p>
            <ValueList rows={[
              { label: 'Server', value: connection.server, copy: true },
              { label: 'Path', value: connection.path, copy: true },
              { label: 'Database', value: connection.database, copy: true },
              ...Object.entries(connection.details ?? {}).map(([label, value]) => ({ label, value })),
              { label: 'Gateway ID', value: connection.gateway_id },
              { label: 'Datasource ID', value: connection.datasource_id },
            ]} />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-size-caption text-[var(--estate-text-dim)]">Model-level; not tied to individual tables.</p>
    </div>
  );
}

export function NodeDetails({ node, graph, lineage, onSelect, onOpenMeasure }: {
  node: LineageNode;
  graph: LineageGraph;
  lineage: ReportLineagePayload;
  onSelect: (id: string) => void;
  onOpenMeasure?: (name: string) => void;
}) {
  let eyebrow: React.ReactNode;
  let title: string;
  let chips: React.ReactNode = null;
  let body: React.ReactNode;

  if (node.kind === 'source') {
    const origin = node.origin;
    const navigation = graph.tables.filter((table) => node.tableIds.includes(table.id)).flatMap((table) => table.source.navigation ?? []);
    eyebrow = <span className="inline-flex items-center gap-1.5"><ClassSwatch cls={node.cls} />{systemLabel(origin.system)} source</span>;
    title = node.title;
    body = (
      <>
        <p className="text-caption text-[var(--estate-text-secondary)] [overflow-wrap:anywhere]">{describeOrigin(origin)}</p>
        <ValueList rows={[
          { label: 'Connector', value: origin.connector },
          { label: 'Server / site', value: origin.location, copy: true },
          { label: 'Database', value: origin.database, copy: true },
          { label: 'Object', value: origin.object, copy: true },
          { label: 'Folder', value: origin.folder, copy: true },
          { label: 'File', value: origin.file, copy: true },
          { label: 'Format', value: origin.format },
          { label: 'Sheets / items', value: origin.items.map((item) => `${item.name}${item.kind ? ` (${item.kind})` : ''}`).join(', ') },
          { label: 'Helper queries', value: origin.via.join(' → ') },
        ]} />
        <NavigationSteps steps={navigation} />
        {origin.query && <CodeBox label="Native query" code={origin.query} />}
        <div><SectionLabel>Feeds model tables</SectionLabel><NodeLinks ids={node.tableIds} graph={graph} onSelect={onSelect} /></div>
        {isShareableOrigin(origin) && (
          <Link href={sourceImpactHref(node.key)} className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5 self-start')}>
            <Network className="size-3.5" aria-hidden /> Which other reports use this source?
          </Link>
        )}
      </>
    );
  } else if (node.kind === 'table') {
    const source = node.source;
    eyebrow = 'Model table';
    title = node.name;
    chips = (
      <div className="flex flex-wrap gap-1">
        {source.storage_mode && <Chip>{source.storage_mode}</Chip>}
        <BindingChip binding={node.binding} />
        {node.modelWide && <Chip>model-wide</Chip>}
      </div>
    );
    body = (
      <>
        <ValueList rows={[
          { label: 'UC table', value: source.uc_full_path, copy: true },
          { label: 'Binding', value: BINDING_TEXT[node.binding] },
          { label: 'Partition', value: source.partition_kind },
          { label: 'Storage mode', value: source.storage_mode },
          { label: 'Connector', value: source.connection?.connector },
          { label: 'Host', value: source.connection?.host, copy: true },
          { label: 'Bind status', value: source.connection?.bind_status },
        ]} />
        {node.modelWide && (
          <p className="border-l-2 border-[var(--estate-border)] pl-2 text-size-caption text-[var(--estate-text-muted)]">
            No detected report measure reads this table. It is part of the model, so a visual may still use its columns.
          </p>
        )}
        <NavigationSteps steps={source.navigation ?? []} />
        {source.connection?.native_query && <CodeBox label="Native query (binding)" code={source.connection.native_query} />}
        <div><SectionLabel>Reads from</SectionLabel><NodeLinks ids={node.sourceIds} graph={graph} onSelect={onSelect} /></div>
        {node.measureIds.length > 0 && <div><SectionLabel>Used by measures</SectionLabel><NodeLinks ids={node.measureIds} graph={graph} onSelect={onSelect} /></div>}
      </>
    );
  } else if (node.kind === 'measure') {
    const measure = node.measure;
    eyebrow = 'Measure';
    title = measure.name;
    chips = measure.found_in_model ? null : <div><Chip tone="bad">Not found on model</Chip></div>;
    body = measure.found_in_model ? (
      <>
        <ValueList rows={[
          { label: 'Home table', value: measure.measure_table },
          { label: 'Tables (DAX)', value: measure.tables_involved.join(', ') },
          { label: 'UC paths', value: measure.uc_paths.join('\n'), copy: measure.uc_paths.length > 0 },
          { label: 'Reads from', value: node.classes.map((cls) => ORIGIN_CLASS_LABEL[cls]).join(', ') },
        ]} />
        {node.tableIds.length > 0 && <div><SectionLabel>Depends on tables</SectionLabel><NodeLinks ids={node.tableIds} graph={graph} onSelect={onSelect} /></div>}
        {onOpenMeasure ? (
          <button type="button" className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5 self-start')} onClick={() => onOpenMeasure(measure.name)}>
            <GitBranch className="size-3.5" aria-hidden /> Open DAX dependency graph
          </button>
        ) : (
          <Link href={measureGraphHref(lineage.report.model_id, measure.name)} className={cn(CATALOG_BTN, 'inline-flex items-center gap-1.5 self-start')}>
            <GitBranch className="size-3.5" aria-hidden /> Open DAX dependency graph
          </Link>
        )}
      </>
    ) : (
      <p className="border-l-2 border-[var(--bad)] pl-2 text-size-caption text-[var(--estate-text-muted)]">
        A visual names this measure, but the semantic model has no measure with that name. It may have been renamed or removed,
        or it may be a report-level measure.
      </p>
    );
  } else {
    eyebrow = 'Report';
    title = lineage.report.name;
    body = (
      <>
        <ValueList rows={[
          { label: 'Report ID', value: lineage.report.id, copy: true },
          { label: 'Power BI ID', value: lineage.report.pbi_report_id, copy: true },
          { label: 'Model', value: lineage.report.model_name },
          { label: 'Pages', value: lineage.harvest.page_count != null ? String(lineage.harvest.page_count) : null },
          { label: 'Measures', value: `${lineage.harvest.from_props_count} from parse · ${lineage.harvest.from_disk_count} from disk` },
          { label: 'Definition', value: lineage.harvest.has_definition_on_disk ? 'Harvested on disk' : 'Missing on disk' },
        ]} />
        {(lineage.source_connections ?? []).length > 0 && <InventoryConnections connections={lineage.source_connections} />}
      </>
    );
  }

  return (
    <>
      <div className="space-y-1.5 border-b border-[var(--estate-border)] p-3.5">
        <p className="text-eyebrow uppercase text-[var(--estate-text-muted)]">{eyebrow}</p>
        <h2 className="break-all text-ui font-semibold text-[var(--estate-ink)]">{title}</h2>
        {chips}
      </div>
      <div className="flex flex-col gap-3.5 p-3.5">{body}</div>
    </>
  );
}
