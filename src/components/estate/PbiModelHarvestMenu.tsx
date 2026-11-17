'use client';

import React, { useRef, useState } from 'react';
import Link from '@/lib/navigation/link';
import { ChevronDown, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';

type HarvestKind =
  | 'pbi_inventory'
  | 'pbi_definitions'
  | 'pbi_parse'
  | 'pbi_definitions_parse';

async function postLaunch(body: Record<string, unknown>) {
  const res = await fetch('/api/agent-lab/context/jobs/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uiSurface: 'estate.powerbi.model', ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    jobs_enqueued?: number;
  };
  if (!res.ok) {
    throw new Error(json.message ?? json.error ?? res.statusText);
  }
  return json;
}

export function PbiModelHarvestMenu({
  pbiModelId,
  reportPbiIds,
  className,
  compact,
  onQueued,
}: {
  /** Power BI dataset id (`pbi_model_id`), not internal UUID. */
  pbiModelId: string;
  reportPbiIds: string[];
  className?: string;
  compact?: boolean;
  onQueued?: () => void;
}) {
  const canRun = useCanRunEstatePipeline();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  if (!canRun) {
    return (
      <Link href="/agent-lab/estate/jobs" className={cn(CATALOG_BTN, className)} title="Pipeline operator access required to run harvest">
        Harvest jobs
      </Link>
    );
  }

  const run = async (key: string, body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      const data = await postLaunch(body);
      toast.success('Harvest queued', {
        description: `${data.jobs_enqueued ?? 1} job(s) enqueued — track on Jobs; refresh this page after the run succeeds.`,
      });
      setOpen(false);
      onQueued?.();
    } catch (e) {
      toast.error('Could not start harvest', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const scopedReports = reportPbiIds.length > 0 ? { reportIds: reportPbiIds } : {};
  const scopedModel = { modelIds: [pbiModelId], ...scopedReports };

  const items: { id: HarvestKind; label: string; hint: string; body: Record<string, unknown> }[] = [
    {
      id: 'pbi_inventory',
      label: 'Refresh PBI inventory',
      hint: 'Re-list workspaces, models, reports (fills web URLs from Power BI)',
      body: { kinds: ['pbi_inventory'] },
    },
    {
      id: 'pbi_definitions',
      label: 'Harvest report definitions',
      hint: 'Fetch PBIR for this model’s reports only',
      body: {
        kinds: ['pbi_definitions'],
        ...scopedModel,
        pbiFetchModels: false,
        pbiFetchReports: true,
      },
    },
    {
      id: 'pbi_parse',
      label: 'Parse model + reports',
      hint: 'Load measures/tables and report metadata into the estate DB',
      body: { kinds: ['pbi_parse'], ...scopedModel },
    },
    {
      id: 'pbi_definitions_parse',
      label: 'Definitions → parse',
      hint: 'Harvest PBIR then parse (sequential)',
      body: {
        kinds: ['pbi_definitions', 'pbi_parse'],
        sequential: true,
        ...scopedModel,
        pbiFetchModels: true,
        pbiFetchReports: true,
      },
    },
  ];

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          CATALOG_BTN,
          'inline-flex h-8 items-center gap-1 px-2.5 text-caption',
          compact && 'h-8',
        )}
        title="Run Power BI harvest jobs for this model"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5 opacity-70" aria-hidden />}
        Harvest
        <ChevronDown className={cn('size-3 opacity-60 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[40] cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <ul
            role="menu"
            className="absolute right-0 z-[50] mt-1 w-[min(100vw-1.5rem,18rem)] overflow-hidden rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] py-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.22)]"
          >
            {items.map((item) => (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={Boolean(busy)}
                  onClick={() => void run(item.id, item.body)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[var(--estate-hover)] disabled:opacity-50"
                >
                  <span className="text-caption font-medium text-[var(--estate-ink)]">{item.label}</span>
                  <span className="text-size-eyebrow leading-snug text-[var(--estate-text-muted)]">{item.hint}</span>
                </button>
              </li>
            ))}
            <li role="separator" className="my-1 border-t border-[var(--estate-border)]" />
            <li role="none">
              <Link
                href="/agent-lab/estate/jobs"
                role="menuitem"
                className="block px-3 py-2 text-caption text-[var(--estate-text-secondary)] hover:bg-[var(--estate-hover)]"
                onClick={() => setOpen(false)}
              >
                All harvest jobs…
              </Link>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

/** Single-report harvest: definitions + parse for one report id. */
export function PbiReportHarvestButton({
  pbiModelId,
  pbiReportId,
  reportName,
}: {
  pbiModelId: string;
  pbiReportId: string;
  reportName: string;
}) {
  const canRun = useCanRunEstatePipeline();
  const [busy, setBusy] = useState(false);

  if (!canRun) return null;

  return (
    <button
      type="button"
      disabled={busy}
      title={`Harvest definition and parse metadata for “${reportName}”`}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void postLaunch({
          kinds: ['pbi_definitions', 'pbi_parse'],
          sequential: true,
          modelIds: [pbiModelId],
          reportIds: [pbiReportId],
          pbiFetchModels: false,
          pbiFetchReports: true,
        })
          .then((data) => {
            toast.success('Report harvest queued', {
              description: `${data.jobs_enqueued ?? 1} job(s) — see Jobs for status.`,
            });
          })
          .catch((e) => {
            toast.error('Could not start harvest', { description: e instanceof Error ? e.message : String(e) });
          })
          .finally(() => setBusy(false));
      }}
      className={cn(CATALOG_BTN, 'shrink-0')}
    >
      {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Play className="size-3 opacity-70" aria-hidden />}
      Harvest
    </button>
  );
}