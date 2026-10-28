'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isJobsLaunchWizardEnabled } from '@/lib/estate/job-ui';
import { inkOf } from '@/lib/typography/tokens';

interface PipelineHealth {
  discovery_objects: number;
  scanned_objects: number;
  profiled_objects: number;
  enriched_objects: number;
  embedded_objects: number;
  discovery_not_scanned: number;
}

interface Recommendation {
  title: string;
  detail: string;
  kinds: string[];
  sequential: boolean;
  includePatterns: string[];
  estimatedTables: number;
}

interface CockpitResponse {
  health: PipelineHealth;
  recommendation: Recommendation | null;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function JobsCockpitPanel({
  sourceId,
  onLaunched,
  onOpenWizard,
}: {
  sourceId?: string | null;
  onLaunched?: () => void;
  onOpenWizard?: () => void;
}) {
  const [data, setData] = useState<CockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : '';
      const res = await fetch(`/api/agent-lab/context/jobs/cockpit${q}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runRecommended() {
    const rec = data?.recommendation;
    if (!rec) return;
    setLaunching(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: rec.kinds,
          includePatterns: rec.includePatterns,
          excludeSchemas: [],
          sequential: rec.sequential,
          ...(sourceId ? { sourceId } : {}),
        }),
      });
      if (res.ok) {
        toast.success('Launched recommended step', { description: rec.title });
        onLaunched?.();
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('Launch failed', { description: err.message ?? err.error ?? 'Unknown error' });
      }
    } catch {
      toast.error('Network error');
    } finally {
      setLaunching(false);
    }
  }

  const h = data?.health;
  const rec = data?.recommendation;

  return (
    <div
      className="mb-5 rounded-xl border p-4 space-y-4"
      style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 22%, transparent)', backgroundColor: 'var(--estate-raised)' }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-label" style={{ color: 'var(--estate-text-secondary)' }}>Pipeline health</div>
          <div className="text-caption mt-0.5" style={{ color: 'var(--estate-text-muted)' }}>
            Discovery → Scanned → Profiled → Enriched → Embedded
          </div>
        </div>
        {loading && <span className="text-size-ui font-mono" style={{ color: 'var(--estate-text-muted)' }}>Loading…</span>}
      </div>

      {h && (
        <div className="flex flex-wrap gap-2 text-size-ui font-mono">
          {[
            { label: 'Discovery', value: h.discovery_objects, gap: h.discovery_not_scanned },
            { label: 'Scanned', value: h.scanned_objects },
            { label: 'Profiled', value: h.profiled_objects },
            { label: 'Enriched', value: h.enriched_objects },
            { label: 'Embedded', value: h.embedded_objects },
          ].map(step => (
            <span
              key={step.label}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
              style={{ borderColor: 'var(--line-1)', backgroundColor: 'var(--background)' }}
            >
              <span style={{ color: 'var(--estate-text-muted)' }}>{step.label}</span>
              <span style={{ color: 'var(--estate-ink)' }}>{fmt(step.value)}</span>
              {step.gap != null && step.gap > 0 && (
                <span style={{ color: inkOf('#FDB515') }}>({fmt(step.gap)} not scanned)</span>
              )}
            </span>
          ))}
        </div>
      )}

      {rec && (
        <div
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 5%, transparent)' }}
        >
          <div className="min-w-0">
            <div className="text-label" style={{ color: 'var(--brand-a-ink)' }}>Recommended next step</div>
            <div className="text-size-ui font-semibold mt-0.5" style={{ color: 'var(--estate-ink)' }}>{rec.title}</div>
            <div className="text-caption mt-1" style={{ color: 'var(--estate-text-secondary)' }}>{rec.detail}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            {isJobsLaunchWizardEnabled() && onOpenWizard && (
              <button
                type="button"
                onClick={onOpenWizard}
                className="px-4 py-2 rounded-lg text-size-ui font-semibold border"
                style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
              >
                Guided launch
              </button>
            )}
            <button
            type="button"
            disabled={launching || loading}
            onClick={runRecommended}
            className="shrink-0 px-4 py-2 rounded-lg text-size-ui font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand-a)', color: 'var(--brand-a-contrast, #0b1220)' }}
          >
            {launching ? 'Launching…' : 'Run on Fargate'}
          </button>
          </div>
        </div>
      )}
    </div>
  );
}
