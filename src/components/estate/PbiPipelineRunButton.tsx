'use client';

/**
 * One "Run pipeline" control per Power BI model: pick stages; stages that must run with them are
 * added and locked automatically (upstream prerequisites for an unparsed model, downstream stages
 * a change invalidates), with the reason on hover. Launches a sequential chain through the jobs
 * launch API, scoped to this model only (each chained stage keeps the model scope).
 */

import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from '@/lib/navigation/link';
import { ChevronDown, Loader2, Lock, Play } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';
import {
  PBI_STAGES,
  type ModelPipelineState,
  type PbiStageId,
  defaultStages,
  lockedStages,
  resolveStages,
  stageKinds,
} from '@/lib/powerbi/pipeline-stages';

const GROUPS: { label: string; stages: PbiStageId[] }[] = [
  { label: 'Harvest', stages: ['definitions', 'parse', 'catalog_link'] },
  { label: 'Recreate', stages: ['translate', 'oracle', 'parity'] },
  { label: 'Publish', stages: ['publish'] },
];

async function launch(body: Record<string, unknown>) {
  const res = await fetch('/api/agent-lab/context/jobs/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uiSurface: 'estate.powerbi.model.pipeline', ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; jobs_enqueued?: number };
  if (!res.ok) throw new Error(json.message ?? json.error ?? res.statusText);
  return json;
}

export function PbiPipelineRunButton({
  pbiModelId,
  reportPbiIds,
  parsed,
  hasDefinition = true,
  className,
  onQueued,
}: {
  /** Power BI dataset id (`pbi_model_id`), not the internal UUID. */
  pbiModelId: string;
  reportPbiIds: string[];
  /** Model already parsed (tables / measures in the estate). */
  parsed: boolean;
  /** A model definition (TMDL) is already on disk. */
  hasDefinition?: boolean;
  className?: string;
  onQueued?: () => void;
}) {
  const canRun = useCanRunEstatePipeline();
  const state: ModelPipelineState = useMemo(() => ({ parsed, hasDefinition }), [parsed, hasDefinition]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<PbiStageId[]>(() => defaultStages(state));
  const [forceTranslate, setForceTranslate] = useState(false);
  const [llm, setLlm] = useState(true);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The header toolbar scrolls horizontally (overflow clips absolute children): render the panel
  // in a portal at a fixed position under the button.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const { stages, reasons } = useMemo(() => resolveStages(chosen, state), [chosen, state]);
  const locked = useMemo(() => lockedStages(chosen, state), [chosen, state]);

  if (!canRun) {
    return (
      <Link href="/agent-lab/estate/jobs" className={cn(CATALOG_BTN, className)} title="Pipeline operator access required">
        Pipeline jobs
      </Link>
    );
  }

  const toggle = (id: PbiStageId) => {
    if (locked.has(id)) return;
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const run = async () => {
    if (busy || !stages.length) return;
    setBusy(true);
    try {
      const data = await launch({
        kinds: stageKinds(chosen, state),
        sequential: true,
        modelIds: [pbiModelId],
        ...(reportPbiIds.length ? { reportIds: reportPbiIds } : {}),
        pbiFetchModels: true,
        pbiFetchReports: true,
        oracleOnlyTranslated: true,
        llmTranslate: llm,
        maxLlmMeasures: 60,
        forceTranslate,
      });
      toast.success('Pipeline started', {
        description: `${stages.length} stage(s) for this model — the next stage starts when one finishes (${data.jobs_enqueued ?? 1} job queued). Track on Jobs.`,
      });
      setOpen(false);
      onQueued?.();
    } catch (e) {
      toast.error('Could not start the pipeline', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const meta = (id: PbiStageId) => PBI_STAGES.find((s) => s.id === id)!;

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        ref={buttonRef}
        onClick={() => {
          const r = buttonRef.current?.getBoundingClientRect();
          if (r) setAnchor({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
          setOpen((v) => !v);
        }}
        className={cn(CATALOG_BTN, 'inline-flex h-8 shrink-0 items-center gap-1 px-2.5 text-caption')}
        title="Run the recreation pipeline for this model"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5 opacity-70" aria-hidden />}
        Run pipeline
        <ChevronDown className={cn('size-3 opacity-60 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open &&
        anchor &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <button type="button" className="fixed inset-0 z-[400] cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
            <div
              role="dialog"
              aria-label="Run pipeline stages"
              style={{ top: anchor.top, right: anchor.right }}
              className="fixed z-[401] w-[min(100vw-1.5rem,19rem)] rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] p-2 text-caption shadow-[0_12px_32px_-8px_rgba(0,0,0,0.22)]"
            >
              {!parsed && (
                <p className="mb-1.5 rounded-md bg-[var(--estate-status-warning-bg)] px-2 py-1 text-size-eyebrow text-[var(--estate-status-warning-text)]">
                  Model not parsed yet — harvest stages are added automatically.
                </p>
              )}
              {GROUPS.map((g) => (
                <div key={g.label} className="mb-1">
                  <p className="px-1.5 pb-0.5 pt-1 text-size-eyebrow font-medium uppercase tracking-wide text-[var(--estate-text-dim)]">
                    {g.label}
                  </p>
                  {g.stages.map((id) => {
                    const s = meta(id);
                    const on = stages.includes(id);
                    const isLocked = locked.has(id);
                    return (
                      <label
                        key={id}
                        title={isLocked ? `${reasons[id]}\n\n${s.hint}` : s.hint}
                        className={cn(
                          'flex h-7 items-center gap-2 rounded px-1.5 hover:bg-[var(--estate-hover)]',
                          isLocked ? 'cursor-default' : 'cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 shrink-0"
                          checked={on}
                          disabled={isLocked}
                          onChange={() => toggle(id)}
                        />
                        <span className={cn('shrink-0 font-medium', on ? 'text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]')}>
                          {s.label}
                        </span>
                        {isLocked && (
                          <span className="flex min-w-0 items-center gap-1 text-size-eyebrow text-[var(--estate-text-muted)]">
                            <Lock className="size-2.5 shrink-0" aria-label="required" />
                            <span className="truncate">{reasons[id]?.startsWith('model not parsed') ? 'required first' : `with ${reasons[id]?.match(/^added with ([^:]+)/)?.[1] ?? 'selection'}`}</span>
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}

              {stages.includes('translate') && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-[var(--estate-border)] px-1.5 pt-1.5 text-size-eyebrow text-[var(--estate-text-secondary)]">
                  <label className="inline-flex items-center gap-1.5" title="Default: only measures whose inputs changed are recompiled">
                    <input type="checkbox" className="size-3" checked={forceTranslate} onChange={(e) => setForceTranslate(e.target.checked)} />
                    Recompile all
                  </label>
                  <label className="inline-flex items-center gap-1.5" title="LLM fallback for measures the compiler cannot translate">
                    <input type="checkbox" className="size-3" checked={llm} onChange={(e) => setLlm(e.target.checked)} />
                    LLM fallback
                  </label>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2 border-t border-[var(--estate-border)] px-1.5 pt-2">
                <Link
                  href="/agent-lab/estate/jobs"
                  className="shrink-0 text-size-eyebrow text-[var(--estate-text-muted)] underline-offset-2 hover:underline"
                >
                  Jobs
                </Link>
                <span
                  className="min-w-0 flex-1 truncate text-right text-size-eyebrow text-[var(--estate-text-muted)]"
                  title={stages.map((id) => meta(id).label).join(' → ')}
                >
                  {stages.map((id) => meta(id).label).join(' → ')}
                </span>
                <button
                  type="button"
                  disabled={busy || !stages.length}
                  onClick={() => void run()}
                  className={cn(CATALOG_BTN, 'inline-flex h-7 shrink-0 items-center gap-1 px-2.5 font-medium disabled:opacity-50')}
                >
                  {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Play className="size-3" aria-hidden />}
                  Run {stages.length}
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
