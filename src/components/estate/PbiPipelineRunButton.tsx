'use client';

/**
 * One "Run pipeline" control per Power BI model: pick stages; stages that must run together are
 * added and locked automatically (with the reason). Launches a sequential chain through the jobs
 * launch API, scoped to this model only (each chained stage keeps the model scope).
 */

import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from '@/lib/navigation/link';
import { ArrowRight, ChevronDown, Loader2, Lock, Play } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';
import { PBI_STAGES, type PbiStageId, lockedStages, resolveStages, stageKinds } from '@/lib/powerbi/pipeline-stages';

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
  className,
  onQueued,
}: {
  /** Power BI dataset id (`pbi_model_id`), not the internal UUID. */
  pbiModelId: string;
  reportPbiIds: string[];
  /** Model already parsed: default to a recreation run; otherwise to a full harvest + run. */
  parsed: boolean;
  className?: string;
  onQueued?: () => void;
}) {
  const canRun = useCanRunEstatePipeline();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<PbiStageId[]>(parsed ? ['translate', 'publish'] : ['definitions']);
  const [forceTranslate, setForceTranslate] = useState(false);
  const [llm, setLlm] = useState(true);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The header toolbar scrolls horizontally (overflow clips absolute children), so the panel is
  // rendered in a portal at a fixed position under the button.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const { stages, reasons } = useMemo(() => resolveStages(chosen), [chosen]);
  const locked = useMemo(() => lockedStages(chosen), [chosen]);

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
        kinds: stageKinds(chosen),
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
        description: `${stages.length} stage(s) for this model — ${data.jobs_enqueued ?? 1} job(s) queued; the next stage starts when one finishes. Track on Jobs.`,
      });
      setOpen(false);
      onQueued?.();
    } catch (e) {
      toast.error('Could not start the pipeline', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const label = (id: PbiStageId) => PBI_STAGES.find((s) => s.id === id)!.label;

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
      {open && anchor && typeof document !== 'undefined' && createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[400] cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Run pipeline stages"
            style={{ top: anchor.top, right: anchor.right }}
            className="fixed z-[401] max-h-[min(80vh,40rem)] w-[min(100vw-1.5rem,24rem)] overflow-y-auto rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.22)]"
          >
            <p className="mb-2 text-caption font-medium text-[var(--estate-ink)]">Stages to run for this model</p>
            <ul className="space-y-1">
              {PBI_STAGES.map((s) => {
                const on = stages.includes(s.id);
                const isLocked = locked.has(s.id);
                return (
                  <li key={s.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--estate-hover)]',
                        isLocked && 'cursor-default',
                      )}
                      title={isLocked ? reasons[s.id] : s.hint}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={on}
                        disabled={isLocked}
                        onChange={() => toggle(s.id)}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-caption font-medium text-[var(--estate-ink)]">
                          {s.label}
                          {isLocked && <Lock className="size-3 opacity-60" aria-label="required" />}
                        </span>
                        <span className="block text-[11px] leading-snug text-[var(--estate-text-muted)]">
                          {isLocked ? reasons[s.id] : s.hint}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="mt-2 space-y-1 border-t border-[var(--estate-border)] pt-2 text-[11px] text-[var(--estate-text-secondary)]">
              {stages.includes('translate') && (
                <>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={forceTranslate} onChange={(e) => setForceTranslate(e.target.checked)} />
                    Recompile all measures (default: only measures whose inputs changed)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} />
                    LLM fallback for measures the compiler cannot translate
                  </label>
                </>
              )}
            </div>

            <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-[var(--estate-text-muted)]">
              {stages.length ? (
                stages.map((id, i) => (
                  <React.Fragment key={id}>
                    {i > 0 && <ArrowRight className="size-3 opacity-60" aria-hidden />}
                    <span className="text-[var(--estate-ink)]">{label(id)}</span>
                  </React.Fragment>
                ))
              ) : (
                'Select at least one stage'
              )}
            </p>

            <div className="mt-3 flex items-center justify-between gap-2">
              <Link href="/agent-lab/estate/jobs" className="text-[11px] text-[var(--estate-text-muted)] underline-offset-2 hover:underline">
                All jobs…
              </Link>
              <button
                type="button"
                disabled={busy || !stages.length}
                onClick={() => void run()}
                className={cn(CATALOG_BTN, 'inline-flex h-8 items-center gap-1 px-3 text-caption font-medium disabled:opacity-50')}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                Run {stages.length} stage{stages.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
