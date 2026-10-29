'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { toast } from 'sonner';
import { schemaIncludePattern } from '@/lib/estate/catalog-pipeline';

export const MAX_CONTINUE_SCHEMAS = 12;
export const MAX_CONTINUE_TABLES = 50;

interface PipelineIntentHealth {
  scanned_objects: number;
  needs_profile: number;
  needs_enrich: number;
  needs_embed: number;
  discovery_not_scanned: number;
}

interface PipelineIntentBlocker {
  code: string;
  message: string;
  jobId?: string;
}

interface ScannedPipelineScopeBarProps {
  catalog?: string;
  schema?: string;
  /** When set, overrides catalog/schema-derived patterns (multi-schema or table selection). */
  includePatterns?: string[];
  scopeLabel?: string;
  sourceId?: string;
  onLaunched?: () => void;
}

export default function ScannedPipelineScopeBar({
  catalog,
  schema,
  includePatterns = [],
  scopeLabel: scopeLabelProp,
  sourceId,
  onLaunched,
}: ScannedPipelineScopeBarProps) {
  const [health, setHealth] = useState<PipelineIntentHealth | null>(null);
  const [summary, setSummary] = useState('');
  const [recommendedKinds, setRecommendedKinds] = useState<string[]>([]);
  const [blockers, setBlockers] = useState<PipelineIntentBlocker[]>([]);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const effectivePatterns =
    includePatterns.length > 0
      ? includePatterns
      : catalog && schema
        ? [schemaIncludePattern(catalog, schema)]
        : catalog
          ? [`${catalog}.*`]
          : [];

  const scopeLabel =
    scopeLabelProp ??
    (effectivePatterns.length === 1
      ? effectivePatterns[0].replace(/\.\*$/, '')
      : effectivePatterns.length > 1
        ? `${effectivePatterns.length} patterns`
        : catalog && schema
          ? `${catalog}.${schema}`
          : catalog ?? null);

  const hasScope = effectivePatterns.length > 0 || Boolean(catalog);

  const loadIntent = useCallback(async () => {
    if (!hasScope) {
      setHealth(null);
      setSummary('');
      setBlockers([]);
      setRecommendedKinds([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceId) params.set('sourceId', sourceId);
      if (catalog) params.set('catalog', catalog);
      if (schema && includePatterns.length === 0) params.set('schema', schema);
      for (const pat of effectivePatterns) params.append('includePatterns', pat);
      params.set('through', 'embed');
      const res = await fetch(`/api/agent-lab/context/pipeline/intent?${params}`);
      if (!res.ok) return;
      const json = await res.json();
      setHealth(json.data?.health ?? null);
      setSummary(json.data?.humanSummary ?? '');
      setBlockers(json.data?.blockers ?? []);
      setRecommendedKinds(json.data?.recommendedKinds ?? []);
    } finally {
      setLoading(false);
    }
  }, [hasScope, sourceId, catalog, schema, includePatterns.length, effectivePatterns.join('|')]);

  useEffect(() => {
    loadIntent();
  }, [loadIntent]);

  async function runLaunch() {
    setLaunching(true);
    try {
      const res = await fetch('/api/agent-lab/context/pipeline/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalog,
          schema: includePatterns.length > 0 ? undefined : schema,
          includePatterns: effectivePatterns,
          sourceId,
          through: 'embed',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Continue pipeline failed', {
          description: json.message ?? json.error ?? 'Unknown error',
        });
        return;
      }
      const payload = json.launchPayload;
      if (!payload?.kinds?.length) {
        toast.message('Nothing to run', { description: json.intent?.humanSummary });
        return;
      }
      const launchRes = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, uiSurface: 'scanned_continue' }),
      });
      const launchJson = await launchRes.json().catch(() => ({}));
      if (!launchRes.ok) {
        const msg =
          launchJson.error === 'ACTIVE_JOB_OVERLAP'
            ? `${launchJson.message ?? 'Overlapping job already active'}${launchJson.jobId ? ` (${launchJson.jobId.slice(0, 8)}…)` : ''}`
            : launchJson.message ?? launchJson.error;
        toast.error('Launch failed', { description: msg });
        return;
      }
      toast.success('Pipeline started', {
        description: `${payload.kinds.join(' → ')} · ${scopeLabel}`,
      });
      setConfirmOpen(false);
      onLaunched?.();
      loadIntent();
    } catch {
      toast.error('Network error');
    } finally {
      setLaunching(false);
    }
  }

  function openConfirm() {
    if (effectivePatterns.length > MAX_CONTINUE_SCHEMAS && effectivePatterns.every(p => p.endsWith('.*'))) {
      toast.error('Too many schemas', {
        description: `Select at most ${MAX_CONTINUE_SCHEMAS} schemas for one Continue run.`,
      });
      return;
    }
    if (effectivePatterns.length > MAX_CONTINUE_TABLES && !effectivePatterns.every(p => p.endsWith('.*'))) {
      toast.error('Too many tables', {
        description: `Select at most ${MAX_CONTINUE_TABLES} tables for one Continue run.`,
      });
      return;
    }
    setConfirmOpen(true);
  }

  if (!scopeLabel) return null;

  const needsProfile = health?.needs_profile ?? 0;
  const overlap = blockers.find(b => b.code === 'ACTIVE_JOB_OVERLAP');
  const canContinue =
    !overlap &&
    (needsProfile > 0 || (health?.needs_enrich ?? 0) > 0 || (health?.needs_embed ?? 0) > 0);

  const kindsPreview =
    recommendedKinds.length > 0 ? recommendedKinds.join(' → ') : 't1_profile → … → embed';

  return (
    <>
      {overlap && (
        <div
          className="mx-6 mt-2 px-4 py-2 rounded-lg border text-caption"
          style={{
            borderColor: 'color-mix(in srgb, #EF4444 35%, transparent)',
            background: 'color-mix(in srgb, #EF4444 6%, transparent)',
            color: '#FCA5A5',
          }}
        >
          {overlap.message}
          {overlap.jobId && (
            <>
              {' '}
              <Link href={`/agent-lab/estate/jobs/${overlap.jobId}`} className="underline" style={{ color: '#F87171' }}>
                View job
              </Link>
            </>
          )}
        </div>
      )}
      <div
        className="mx-6 mt-2 mb-1 px-4 py-3 rounded-lg border flex flex-wrap items-center gap-3"
        style={{
          borderColor: 'color-mix(in srgb, var(--brand-a) 28%, transparent)',
          background: 'color-mix(in srgb, var(--brand-a) 5%, transparent)',
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-label font-mono" style={{ color: 'var(--brand-a-ink)' }}>
            Scope: {scopeLabel}
          </div>
          <div className="text-caption mt-0.5" style={{ color: 'var(--estate-text-secondary)' }}>
            {loading ? 'Loading pipeline gaps…' : summary || 'Select scope to see what is left.'}
          </div>
          {health && !loading && (
            <div className="text-caption font-mono mt-1 flex flex-wrap gap-3" style={{ color: 'var(--estate-text-muted)' }}>
              <span>{health.scanned_objects} scanned</span>
              {needsProfile > 0 && <span style={{ color: '#86EFAC' }}>{needsProfile} need profile</span>}
              {health.needs_enrich > 0 && <span style={{ color: '#C084FC' }}>{health.needs_enrich} need enrich</span>}
              {health.needs_embed > 0 && <span>{health.needs_embed} need embed</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={!canContinue || launching || loading}
          onClick={openConfirm}
          className="text-label px-4 py-2 rounded-md border-none cursor-pointer disabled:opacity-50"
          style={{ background: 'var(--brand-a)', color: 'var(--estate-bg)' }}
        >
          {launching ? 'Launching…' : 'Continue pipeline'}
        </button>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => !launching && setConfirmOpen(false)}
        >
          <div
            className="max-w-md w-full rounded-xl border p-5 shadow-xl"
            style={{ background: 'var(--estate-raised)', borderColor: 'var(--estate-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-size-ui font-semibold" style={{ color: 'var(--estate-ink)' }}>
              Continue pipeline
            </h3>
            <p className="text-caption mt-2" style={{ color: 'var(--estate-text-secondary)' }}>
              {summary}
            </p>
            <p className="text-caption mt-2 font-mono" style={{ color: 'var(--brand-a-ink)' }}>
              Tiers: {kindsPreview}
            </p>
            <p className="text-caption mt-2 font-mono truncate" style={{ color: 'var(--estate-text-muted)' }} title={effectivePatterns.join(', ')}>
              Limit: {effectivePatterns.length === 1 ? effectivePatterns[0] : `${effectivePatterns.length} patterns`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={launching}
                onClick={() => setConfirmOpen(false)}
                className="text-label px-3 py-1.5 rounded border"
                style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={launching}
                onClick={() => void runLaunch()}
                className="text-label px-4 py-1.5 rounded border-none"
                style={{ background: 'var(--brand-a)', color: 'var(--estate-bg)' }}
              >
                {launching ? 'Launching…' : 'Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
