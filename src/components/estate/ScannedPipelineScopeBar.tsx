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

interface ScopeChangeCheck {
  listed: number;
  unchanged: number;
  changed: string[];
  added: string[];
  dropped: string[];
  unknown: string[];
}

interface ContinuePlan {
  intent: {
    humanSummary?: string;
    blockers?: PipelineIntentBlocker[];
    changeCheck?: ScopeChangeCheck | null;
    stagePlan?: Array<{ kind: string; upTo: number }>;
  } | null;
  launchPayload: { kinds: string[]; [k: string]: unknown } | null;
}

interface ScannedPipelineScopeBarProps {
  catalog?: string;
  schema?: string;
  /** When set, overrides catalog/schema-derived patterns (multi-schema or table selection). */
  includePatterns?: string[];
  scopeLabel?: string;
  sourceId?: string;
  canRunPipeline?: boolean;
  onLaunched?: () => void;
}

export default function ScannedPipelineScopeBar({
  catalog,
  schema,
  includePatterns = [],
  scopeLabel: scopeLabelProp,
  sourceId,
  canRunPipeline = false,
  onLaunched,
}: ScannedPipelineScopeBarProps) {
  const [health, setHealth] = useState<PipelineIntentHealth | null>(null);
  const [summary, setSummary] = useState('');
  const [recommendedKinds, setRecommendedKinds] = useState<string[]>([]);
  const [blockers, setBlockers] = useState<PipelineIntentBlocker[]>([]);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [plan, setPlan] = useState<ContinuePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [scannedOnly, setScannedOnly] = useState(false);
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
    const payload = plan?.launchPayload;
    if (!payload?.kinds?.length) return;
    setLaunching(true);
    try {
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
        description: `${payload.kinds.map(k => STAGE_LABEL[k] ?? k).join(' → ')} · ${scopeLabel}`,
      });
      setConfirmOpen(false);
      setPlan(null);
      onLaunched?.();
      loadIntent();
    } catch {
      toast.error('Network error');
    } finally {
      setLaunching(false);
    }
  }

  async function runChangeCheck(scopedToScanned: boolean = scannedOnly) {
    setChecking(true);
    setPlan(null);
    setPlanError(null);
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
          scannedOnly: scopedToScanned,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setPlan({ intent: json.intent ?? null, launchPayload: json.launchPayload ?? null });
      } else if (json.error === 'NOTHING_TO_RUN') {
        setPlan({ intent: json.intent ?? null, launchPayload: null });
      } else {
        setPlanError(json.message ?? json.error ?? 'Unknown error');
      }
    } catch {
      setPlanError('Network error');
    } finally {
      setChecking(false);
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
    void runChangeCheck(scannedOnly);
  }

  if (!scopeLabel) return null;

  const needsProfile = health?.needs_profile ?? 0;
  const overlap = blockers.find(b => b.code === 'ACTIVE_JOB_OVERLAP');
  // Source may have changed even when nothing looks stale locally — the check decides.
  const canContinue = !overlap && (health?.scanned_objects ?? 0) > 0;

  const check = plan?.intent?.changeCheck ?? null;
  const stagePlan = plan?.intent?.stagePlan ?? [];
  const planBlocker = plan?.intent?.blockers?.find(b => b.code === 'ACTIVE_JOB_OVERLAP' || b.code === 'IDLE');
  const canRun = Boolean(plan?.launchPayload?.kinds?.length) && !launching && !checking
    && !plan?.intent?.blockers?.some(b => b.code === 'ACTIVE_JOB_OVERLAP');

  return (
    <>
      {overlap && (
        <div className="mx-6 mb-2 rounded-card border border-[color:color-mix(in_srgb,var(--bad)_35%,transparent)] bg-[var(--bad-bg)] px-3 py-2 text-caption text-[var(--bad)]">
          {overlap.message}
          {overlap.jobId && (
            <>
              {' '}
              <Link href={`/agent-lab/estate/jobs/${overlap.jobId}`} className="font-medium underline">
                View job
              </Link>
            </>
          )}
        </div>
      )}
      <div className="mx-6 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-ui text-[var(--estate-ink)]">{scopeLabel}</span>
            <span className="text-ui-regular text-[var(--estate-text-muted)]">
              {loading ? 'Checking what is left\u2026' : summary || 'Pick a catalog or schema to see what is left.'}
            </span>
          </div>
          {health && !loading && (needsProfile > 0 || health.needs_enrich > 0 || health.needs_embed > 0) && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-caption text-[var(--estate-text-muted)]">
              <span>{health.scanned_objects.toLocaleString()} scanned</span>
              {needsProfile > 0 && <span>{needsProfile.toLocaleString()} need profiling</span>}
              {health.needs_enrich > 0 && <span>{health.needs_enrich.toLocaleString()} need a description</span>}
              {health.needs_embed > 0 && <span>{health.needs_embed.toLocaleString()} not searchable yet</span>}
            </div>
          )}
        </div>
        {canRunPipeline && (
          <button
            type="button"
            disabled={!canContinue || launching || loading}
            onClick={openConfirm}
            title={canContinue ? 'Check the source for changes, then run what is left for this scope' : 'Nothing scanned in this scope yet'}
            className="inline-flex h-8 items-center whitespace-nowrap rounded-ctl bg-[var(--brand-a)] px-3 text-label text-[var(--on-brand)] shadow-xs transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {launching ? 'Launching\u2026' : 'Continue pipeline'}
          </button>
        )}
      </div>
      {canRunPipeline && confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => !launching && !checking && setConfirmOpen(false)}
        >
          <div
            className="max-w-md w-full rounded-xl border p-5 shadow-xl"
            style={{ background: 'var(--estate-raised)', borderColor: 'var(--estate-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-size-ui font-semibold" style={{ color: 'var(--estate-ink)' }}>
              Continue pipeline
            </h3>
            <p className="text-caption mt-1 font-mono truncate" style={{ color: 'var(--estate-text-muted)' }} title={effectivePatterns.join(', ')}>
              {effectivePatterns.length === 1 ? effectivePatterns[0] : `${effectivePatterns.length} patterns`}
            </p>

            {checking && (
              <p className="text-caption mt-3" style={{ color: 'var(--estate-text-secondary)' }}>
                Checking Databricks for changes since the last scan…
              </p>
            )}

            <label className="mb-3 flex items-start gap-2 text-caption" style={{ color: 'var(--estate-ink)' }}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={scannedOnly}
                disabled={checking || launching}
                onChange={e => {
                  setScannedOnly(e.target.checked);
                  void runChangeCheck(e.target.checked);
                }}
              />
              <span>
                Scanned tables only
                <span className="block" style={{ color: 'var(--estate-text-muted)' }}>
                  Skips tables in this scope that were never scanned (discovery only).
                </span>
              </span>
            </label>
            {planError && !checking && (
              <p className="text-caption mt-3" style={{ color: 'var(--bad)' }}>
                {planError}
              </p>
            )}

            {check && !checking && (
              <div className="mt-3">
                <div className="text-caption font-medium" style={{ color: 'var(--estate-ink)' }}>
                  Source check
                </div>
                <p className="text-caption mt-0.5" style={{ color: 'var(--estate-text-secondary)' }}>
                  {describeCheck(check)}
                </p>
              </div>
            )}

            {plan && !checking && (
              <div className="mt-3">
                <div className="text-caption font-medium" style={{ color: 'var(--estate-ink)' }}>
                  Will run
                </div>
                {stagePlan.length > 0 ? (
                  <ol className="mt-1 space-y-0.5">
                    {stagePlan.map((s, i) => (
                      <li key={s.kind} className="text-caption flex justify-between" style={{ color: 'var(--estate-text-secondary)' }}>
                        <span>{i + 1}. {STAGE_LABEL[s.kind] ?? s.kind}</span>
                        <span className="font-mono">up to {s.upTo.toLocaleString()}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-caption mt-0.5" style={{ color: 'var(--estate-text-secondary)' }}>
                    {planBlocker?.message ?? plan.intent?.humanSummary ?? 'Nothing to run.'}
                  </p>
                )}
                {stagePlan.length > 1 && (
                  <p className="text-caption mt-1.5" style={{ color: 'var(--estate-text-muted)' }}>
                    Each step only processes tables that are still out of date when it starts.
                  </p>
                )}
                {planBlocker?.code === 'ACTIVE_JOB_OVERLAP' && (
                  <p className="text-caption mt-1.5" style={{ color: 'var(--bad)' }}>{planBlocker.message}</p>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={launching}
                onClick={() => setConfirmOpen(false)}
                className="text-label px-3 py-1.5 rounded border"
                style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
              >
                {canRun ? 'Cancel' : 'Close'}
              </button>
              {planError && !checking && (
                <button
                  type="button"
                  onClick={() => void runChangeCheck()}
                  className="text-label px-3 py-1.5 rounded border"
                  style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
                >
                  Retry check
                </button>
              )}
              <button
                type="button"
                disabled={!canRun}
                onClick={() => void runLaunch()}
                className="text-label px-4 py-1.5 rounded border-none disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--brand-a)', color: 'var(--estate-bg)' }}
              >
                {launching ? 'Launching…' : checking ? 'Checking…' : 'Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const STAGE_LABEL: Record<string, string> = {
  t0_structural: 'Scan structure',
  t1_profile: 'Profile',
  t2_semantic: 'Describe',
  embed: 'Embed (make searchable)',
};

function describeCheck(c: ScopeChangeCheck): string {
  const parts: string[] = [];
  if (c.changed.length) parts.push(`${c.changed.length} changed`);
  if (c.added.length) parts.push(`${c.added.length} new`);
  if (c.dropped.length) parts.push(`${c.dropped.length} removed`);
  if (c.unknown.length) parts.push(`${c.unknown.length} without change time (rescan)`);
  if (parts.length === 0) return `No changes in Databricks since the last scan (${c.unchanged.toLocaleString()} tables checked).`;
  return `${parts.join(' · ')} · ${c.unchanged.toLocaleString()} unchanged`;
}
