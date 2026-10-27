'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import dagre from 'dagre';
import { AlertTriangle, CheckCircle2, CircleSlash, Maximize2, Minus, Plus, ShieldCheck, Sparkles, XCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { draftEdges, reduceEdges, type FlowDiff } from '@/lib/flows/copilot';
import { STEP_TYPES, STEP_TYPE_LABEL, type Def, type Step } from '@/lib/flows/edit';
import { StepIcon, btn } from './ui';

// Read-only picture of the draft: trigger on top, steps laid out top-to-bottom by their dependencies
// (dagre), so there are no node positions to store. Each step is a real button, so the canvas works
// with a keyboard and a screen reader. Editing happens in the side panel and through "+".

export type StepRunStatus = 'succeeded' | 'failed' | 'skipped' | string;
export type StepFindings = { errors: number; warnings: number };

type Props = {
  def: Def;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddAfter?: (afterId: string | null, type: string) => void;
  runStatus?: Record<string, StepRunStatus>;
  findings?: Record<string, StepFindings>;
  /** Highlights a pending copilot proposal. */
  diff?: FlowDiff | null;
  /** Space kept clear at the top, e.g. under a banner. */
  topInset?: number;
};

const NODE_W = 272;
const NODE_H = 78;
const TRIGGER_ID = '__trigger';

function triggerText(def: Def): { title: string; detail: string } {
  const t = def.trigger ?? { type: 'manual' };
  if (t.type === 'schedule') return { title: 'On a schedule', detail: t.cron ? `${t.cron} (UTC)` : 'No schedule set' };
  if (t.type === 'webhook') return { title: 'On a webhook call', detail: t.name || 'No webhook name' };
  if (t.type === 'event') return { title: 'On an ALOFT event', detail: t.name || 'No event name' };
  return { title: 'When someone starts it', detail: 'Manual run' };
}


function layout(def: Def) {
  const steps = def.steps ?? [];
  const deps = draftEdges(def);
  const edges = reduceEdges(deps);
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 56, marginx: 48, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  g.setNode(TRIGGER_ID, { width: NODE_W, height: 64 });
  steps.forEach((s) => g.setNode(s.id, { width: NODE_W, height: NODE_H }));
  const hasParent = new Set(deps.map((e) => e.to));
  const all = [...steps.filter((s) => !hasParent.has(s.id)).map((s) => ({ from: TRIGGER_ID, to: s.id })), ...edges];
  all.forEach((e) => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const pos = (id: string) => g.node(id) as { x: number; y: number; width: number; height: number };
  const { width = NODE_W, height = 200 } = g.graph() as { width?: number; height?: number };
  return { pos, edges: all, width, height };
}

function RunBadge({ status }: { status?: StepRunStatus }) {
  if (!status) return null;
  if (status === 'succeeded') return <CheckCircle2 aria-label="Test passed" className="h-4 w-4 text-[var(--ok)]" />;
  if (status === 'failed') return <XCircle aria-label="Test failed" className="h-4 w-4 text-[var(--bad)]" />;
  return <CircleSlash aria-label={`Test ${status}`} className="h-4 w-4 text-[var(--ink-3)]" />;
}

function AddMenu({ onPick, label, className }: { onPick: (type: string) => void; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn('relative', className)} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-2)] bg-[var(--surface-1)] text-[var(--ink-3)] shadow-sm transition-colors hover:border-[var(--brand-a)] hover:text-[var(--brand-a)]"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute left-1/2 top-8 z-20 w-56 -translate-x-1/2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-1 shadow-lg">
          {STEP_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(t);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-size-ui text-[var(--ink-1)] hover:bg-[var(--surface-2)]"
            >
              <StepIcon type={t} size="sm" /> {STEP_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepNode({ step, selected, status, findings, mark, onSelect, onAdd }: { step: Step; selected: boolean; status?: StepRunStatus; findings?: StepFindings; mark?: 'added' | 'changed'; onSelect: () => void; onAdd?: (type: string) => void }) {
  const condition = step.when ? `If ${step.when.ref.replace(/[{}]/g, '').trim()} ${step.when.operator} ${String(step.when.value)}` : null;
  return (
    <div className="group relative h-full">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${step.name || step.id}, ${STEP_TYPE_LABEL[step.type] ?? step.type}`}
        className={cn(
          'flex h-full w-full items-start gap-3 rounded-xl border bg-[var(--surface-1)] p-3 text-left shadow-sm transition-[border-color,box-shadow] hover:shadow-md',
          selected ? 'border-[var(--brand-a)] ring-2 ring-[var(--brand-a-soft)]' : 'border-[var(--line-1)] hover:border-[var(--line-2)]',
          mark === 'added' && 'border-[var(--ok)] ring-2 ring-[var(--ok-bg)]',
          mark === 'changed' && 'border-[var(--warn)] ring-2 ring-[var(--warn-bg)]',
          status === 'failed' && !mark && 'border-[var(--bad)]',
        )}
      >
        <StepIcon type={step.type} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-size-ui font-semibold text-[var(--ink-1)]">{step.name || step.id}</span>
          </span>
          <span className="mt-0.5 block truncate text-size-caption text-[var(--ink-3)]">{condition ?? STEP_TYPE_LABEL[step.type] ?? step.type}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {mark && <span className={cn('rounded px-1.5 text-size-caption font-medium', mark === 'added' ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : 'bg-[var(--warn-bg)] text-[var(--warn)]')}>{mark === 'added' ? 'New' : 'Changed'}</span>}
            {step.type === 'approval' && (
              <span className="inline-flex items-center gap-0.5 text-size-caption text-[var(--warn)]">
                <ShieldCheck className="h-3 w-3" aria-hidden /> Gate
              </span>
            )}
            {step.type === 'agent' && (
              <span className="inline-flex items-center gap-0.5 text-size-caption text-[var(--brand-a-ink)]">
                <Sparkles className="h-3 w-3" aria-hidden /> AI
              </span>
            )}
            {findings && findings.errors > 0 && (
              <span className="inline-flex items-center gap-0.5 text-size-caption font-medium text-[var(--bad)]">
                <AlertTriangle className="h-3 w-3" aria-hidden /> {findings.errors} blocking
              </span>
            )}
            {findings && findings.errors === 0 && findings.warnings > 0 && (
              <span className="inline-flex items-center gap-0.5 text-size-caption text-[var(--warn)]">
                <AlertTriangle className="h-3 w-3" aria-hidden /> {findings.warnings} warning{findings.warnings > 1 ? 's' : ''}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0">
          <RunBadge status={status} />
        </span>
      </button>
      {onAdd && <AddMenu label={`Add a step after ${step.id}`} onPick={onAdd} className="absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" />}
    </div>
  );
}

export default function FlowCanvas({ def, selectedId, onSelect, onAddAfter, runStatus, findings, diff, topInset = 0 }: Props) {
  const steps = def.steps ?? [];
  const { pos, edges, width, height } = useMemo(() => layout(def), [def]);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const trig = triggerText(def);

  // Drag the background to pan.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,[role=menu]') || !scroller.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current || !scroller.current) return;
    scroller.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    scroller.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const endDrag = () => (drag.current = null);

  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    setZoom(Math.max(0.5, Math.min(1, (el.clientWidth - 32) / width, (el.clientHeight - 32) / height)));
  };

  // Bring the first added or changed step of a proposal into view.
  const focusId = diff?.added[0] ?? diff?.changed[0];
  useEffect(() => {
    if (!focusId) return;
    scroller.current?.querySelector(`[data-step-id="${focusId}"]`)?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, [focusId]);

  const mark = (id: string) => (diff?.added.includes(id) ? 'added' : diff?.changed.includes(id) ? 'changed' : undefined);

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scroller}
        role="region"
        aria-label="Workflow canvas"
        className="h-full overflow-auto [background-image:radial-gradient(var(--line-2)_1px,transparent_1px)] [background-size:20px_20px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={(e) => e.target === e.currentTarget && onSelect(null)}
      >
        {steps.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-size-body font-medium text-[var(--ink-1)]">This workflow has no steps yet</p>
            <p className="max-w-sm text-size-ui text-[var(--ink-3)]">Add the first step, or describe what you want in Copilot and it will propose the steps.</p>
            {onAddAfter && <AddMenu label="Add the first step" onPick={(t) => onAddAfter(null, t)} />}
          </div>
        ) : (
          <div className="mx-auto" style={{ width: width * zoom, height: height * zoom + topInset, paddingTop: topInset }} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
            <div className="relative origin-top-left" style={{ width, height, transform: `scale(${zoom})` }}>
              <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-2)" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = pos(e.from);
                  const b = pos(e.to);
                  const x1 = a.x;
                  const y1 = a.y + a.height / 2;
                  const x2 = b.x;
                  const y2 = b.y - b.height / 2 - 2;
                  const mid = (y1 + y2) / 2;
                  const failed = runStatus?.[e.from] === 'failed' || runStatus?.[e.to] === 'skipped';
                  return (
                    <path
                      key={`${e.from}-${e.to}`}
                      d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                      fill="none"
                      stroke={failed ? 'var(--line-1)' : 'var(--line-2)'}
                      strokeWidth={1.5}
                      strokeDasharray={failed ? '4 4' : undefined}
                      markerEnd="url(#flow-arrow)"
                    />
                  );
                })}
              </svg>

              {(() => {
                const p = pos(TRIGGER_ID);
                return (
                  <div className="absolute" style={{ left: p.x - p.width / 2, top: p.y - p.height / 2, width: p.width, height: p.height }}>
                    <button
                      type="button"
                      onClick={() => onSelect(null)}
                      aria-label={`Trigger: ${trig.title}`}
                      className="flex h-full w-full items-center gap-3 rounded-full border border-dashed border-[var(--line-2)] bg-[var(--surface-1)] px-4 text-left hover:border-[var(--brand-a)]"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a)] text-white">
                        <Zap className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-size-ui font-semibold text-[var(--ink-1)]">{trig.title}</span>
                        <span className="block truncate text-size-caption text-[var(--ink-3)]">{trig.detail}</span>
                      </span>
                    </button>
                  </div>
                );
              })()}

              {steps.map((s) => {
                const p = pos(s.id);
                return (
                  <div key={s.id} data-step-id={s.id} className="absolute" style={{ left: p.x - p.width / 2, top: p.y - p.height / 2, width: p.width, height: p.height }}>
                    <StepNode
                      step={s}
                      selected={selectedId === s.id}
                      status={runStatus?.[s.id]}
                      findings={findings?.[s.id]}
                      mark={mark(s.id)}
                      onSelect={() => onSelect(s.id)}
                      onAdd={onAddAfter ? (t) => onAddAfter(s.id, t) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] p-0.5 shadow-sm">
          <button type="button" aria-label="Zoom out" className={btn.icon} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center text-size-caption tabular-nums text-[var(--ink-3)]">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" className={btn.icon} onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))}>
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Fit to screen" className={btn.icon} onClick={fit}>
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
