'use client';

// HarvestActionBar — per-tier re-harvest controls for the Estate hero.
//
// T1/T2 re-harvest: single-object scoped via existing /refresh and /enrich endpoints.
// T3/T4 re-harvest: SOURCE-WIDE operations only (orchestrator reads no path scope for
//   t3_usage or t4_scan). These are shown as read-only status rows with a link to the
//   Jobs page to trigger a source-wide re-harvest — never as one-click buttons from this
//   page, to prevent a steward clicking "Re-harvest T3 usage" on one table and accidentally
//   triggering a full source harvest across potentially hundreds of tables.
//
// Silo scan: navigates to /agent-lab/estate/silo?objectId=... (existing page, one action).
//
// Reharvest All: sequences T0 → T1 → T2 → T4 for this specific object via
//   /api/agent-lab/context/objects/[id]/reharvest-all. T3 is always source-wide/meta.

import React, { useState } from 'react';
import Link from '@/lib/navigation/link';
import { useRouter } from '@/lib/navigation';
import { toast } from 'sonner';
import { inkOf } from '@/lib/typography/tokens';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';

interface TierRow {
  tier: string;
  label: string;
  hint: string;
  lastAt: string | null;
  canTrigger: boolean;
  triggerEndpoint?: string;
  jobKind?: string;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface HarvestActionBarProps {
  objectId: string;
  sourceId: string;
  fullPath: string;
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_t2_at: string | null;
  last_t3_at: string | null;
  last_t4_at: string | null;
  onActionComplete?: () => void;
}

export default function HarvestActionBar({
  objectId,
  sourceId: _sourceId,
  fullPath,
  last_t0_at,
  last_t1_at,
  last_t2_at,
  last_t3_at,
  last_t4_at,
  onActionComplete,
}: HarvestActionBarProps) {
  const canAct = useCanRunEstatePipeline();
  const router = useRouter();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reharvestingAll, setReharvestingAll] = useState(false);
  const [reharvestStep, setReharvestStep] = useState<string | null>(null);

  const tiers: TierRow[] = [
    {
      tier: 'T0',
      label: 'Structural',
      hint: 'Columns, types and comments',
      lastAt: last_t0_at,
      canTrigger: true,
      triggerEndpoint: `/api/agent-lab/context/jobs/trigger`,
      jobKind: 't0_structural',
    },
    {
      tier: 'T1',
      label: 'Profile',
      hint: 'Row counts, nulls, value ranges',
      lastAt: last_t1_at,
      canTrigger: true,
      triggerEndpoint: `/api/agent-lab/context/objects/${objectId}/refresh`,
    },
    {
      tier: 'T2',
      label: 'Semantic',
      hint: 'AI summary, grain, key columns',
      lastAt: last_t2_at,
      canTrigger: true,
      triggerEndpoint: `/api/agent-lab/context/objects/${objectId}/enrich`,
    },
    {
      tier: 'T3',
      label: 'Usage',
      hint: 'Who queries it and how — whole source',
      lastAt: last_t3_at,
      canTrigger: false, // source-wide — no object-level scoping exists in orchestrator
    },
    {
      tier: 'T4',
      label: 'Entity Model',
      hint: 'Entities and measures — whole source',
      lastAt: last_t4_at,
      canTrigger: false, // source-wide — t4_scan reads no path scope
    },
  ];

  const handleTrigger = async (row: TierRow) => {
    if (!row.canTrigger || !row.triggerEndpoint || loadingTier) return;
    setLoadingTier(row.tier);
    setOpen(false);
    try {
      const body = row.jobKind
        ? JSON.stringify({
            kind: row.jobKind,
            scope: { includePatterns: [fullPath] },
          })
        : undefined;
      const res = await fetch(row.triggerEndpoint, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body,
      });
      if (res.ok) {
        const json = await res.json();
        const jobId = json.data?.jobId ?? json.job_id;
        toast.success(
          jobId ? (
            <span>
              {row.label} re-harvest queued.{' '}
              <Link
                href={`/agent-lab/estate/jobs?highlight=${jobId}`}
                style={{ color: 'var(--brand-a-ink)', textDecoration: 'underline' }}
              >
                View job →
              </Link>
            </span>
          ) : `${row.label} re-harvest queued`
        );
        onActionComplete?.();
      } else {
        toast.error(`Failed to queue ${row.label} re-harvest`);
      }
    } catch {
      toast.error(`Failed to queue ${row.label} re-harvest`);
    } finally {
      setLoadingTier(null);
    }
  };

  const handleReharvestAll = async () => {
    if (reharvestingAll || loadingTier) return;
    setReharvestingAll(true);
    setReharvestStep('queuing…');
    setOpen(false);

    try {
      const res = await fetch(`/api/agent-lab/context/objects/${objectId}/reharvest-all`, {
        method: 'POST',
      });

      if (!res.ok) {
        toast.error('Reharvest All failed — could not contact the server');
        return;
      }

      const json = await res.json();
      const results = json.data?.results as Record<string, { jobId: string | null; queued: boolean; reason?: string }> | undefined;

      if (!results) {
        toast.error('Reharvest All: unexpected response');
        return;
      }

      const tiers = [
        { key: 't0', label: 'T0 Structural' },
        { key: 't1', label: 'T1 Profile' },
        { key: 't2', label: 'T2 Semantic' },
        { key: 't4', label: 'T4 Entity Model' },
      ];

      const queued = tiers.filter(t => results[t.key]?.queued);
      const kicked = tiers.filter(t => results[t.key]?.reason === 'kicked');
      const debounced = tiers.filter(t => results[t.key]?.reason === 'running');
      const deferred = tiers.filter(t => results[t.key]?.reason === 'deferred');
      const errored = tiers.filter(t => results[t.key]?.reason === 'error');

      // First queued job to link to
      const firstJobId = tiers.find(t => results[t.key]?.jobId)?.key;
      const linkJobId = firstJobId ? results[firstJobId]?.jobId : null;

      const freshlyLaunched = [...queued, ...kicked];

      if (freshlyLaunched.length > 0) {
        toast.success(
          <span>
            {queued.length > 0 && (
              <>Queued: <strong>{queued.map(t => t.key.toUpperCase()).join(' → ')}</strong></>
            )}
            {kicked.length > 0 && (
              <>{queued.length > 0 ? ' · ' : ''}Kicked stuck: <strong>{kicked.map(t => t.key.toUpperCase()).join(', ')}</strong></>
            )}
            {debounced.length > 0 && (
              <span style={{  }}> · {debounced.map(t => t.key.toUpperCase()).join(', ')} already running</span>
            )}
            {deferred.length > 0 && (
              <span style={{  }}> · T4 deferred — re-run after T2 completes</span>
            )}
            {errored.length > 0 && (
              <span style={{ color: inkOf('#F87171') }}> · {errored.map(t => t.key.toUpperCase()).join(', ')} failed</span>
            )}
            {linkJobId && (
              <>
                {' '}<Link href={`/agent-lab/estate/jobs?highlight=${linkJobId}`} style={{ color: 'var(--brand-a-ink)', textDecoration: 'underline' }}>View jobs →</Link>
              </>
            )}
          </span>,
          { duration: 8000 }
        );
      } else if (debounced.length > 0) {
        toast.info(
          <span>
            All tiers already running — {debounced.map(t => t.key.toUpperCase()).join(', ')} in progress
            {deferred.length > 0 && (
              <span style={{  }}> · T4 deferred — re-run after T2 completes</span>
            )}
            {linkJobId && (
              <>
                {' '}<Link href={`/agent-lab/estate/jobs?highlight=${linkJobId}`} style={{ color: 'var(--brand-a-ink)', textDecoration: 'underline' }}>View jobs →</Link>
              </>
            )}
          </span>
        );
      } else {
        toast.error('Reharvest All: all tiers failed to queue');
      }

      onActionComplete?.();
    } catch {
      toast.error('Reharvest All failed — network error');
    } finally {
      setReharvestingAll(false);
      setReharvestStep(null);
    }
  };

  const busy = reharvestingAll || !!loadingTier;

  // Harvest actions are platform-admin only (section access: estate.catalog).
  if (!canAct) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ position: 'relative' }}>

      {/* Primary — refresh everything for this object (T0 → T1 → T2 → T4) */}
      <button
        type="button"
        onClick={handleReharvestAll}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-size-ui font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: 'var(--brand-a)', border: 'none', cursor: busy ? 'not-allowed' : 'pointer' }}
        title={
          last_t2_at
            ? 'Re-scan structure, profile, description and business model for this table (usage is source-wide and not included)'
            : 'Re-scan structure, profile and description. The business model step waits until a description exists.'
        }
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={reharvestingAll ? 'animate-spin' : undefined}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
        </svg>
        {reharvestingAll ? (reharvestStep ?? 'Queuing…') : <>Reharvest All <span style={{ opacity: 0.75, fontWeight: 400 }}>T0→T1→T2→T4</span></>}
      </button>

      {/* Secondary — refresh one step */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={reharvestingAll}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-size-ui font-medium transition-colors hover:bg-[var(--estate-active-bg)] disabled:opacity-60"
          style={{ borderColor: 'var(--estate-btn-border)', background: 'var(--estate-raised)', color: 'var(--estate-ink)', cursor: 'pointer' }}
          title="Re-run one tier for this table"
        >
          {loadingTier ? `Queuing ${loadingTier}…` : 'Rescan tier'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <>
            {/* Backdrop */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setOpen(false)} />
            <div
              role="menu"
              className="rounded-xl border shadow-lg"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 30,
                width: 300,
                maxWidth: 'calc(100vw - 32px)',
                background: 'var(--estate-raised)',
                borderColor: 'var(--estate-border)',
                padding: 6,
              }}
            >
              {tiers.map((row) => {
                const content = (
                  <>
                    <span
                      className="font-mono text-size-caption"
                      style={{
                        flexShrink: 0,
                        width: 26,
                        textAlign: 'center',
                        borderRadius: 6,
                        padding: '2px 0',
                        background: 'var(--estate-active-bg)',
                        color: 'var(--estate-text-secondary)',
                      }}
                    >
                      {row.tier}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span className="text-size-ui font-medium" style={{ color: row.canTrigger ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }}>
                        {row.label}
                      </span>
                      <span className="text-size-caption" style={{ color: 'var(--estate-text-muted)' }}>
                        {row.hint} · {row.lastAt ? `last ${formatRelativeTime(row.lastAt).toLowerCase()}` : 'never run'}
                      </span>
                    </span>
                    <span className="text-size-caption" style={{ color: 'var(--brand-a-ink)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {row.canTrigger ? (loadingTier === row.tier ? 'Queuing…' : 'Run') : 'Jobs →'}
                    </span>
                  </>
                );
                const itemClass = 'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--estate-active-bg)]';
                return row.canTrigger ? (
                  <button
                    key={row.tier}
                    type="button"
                    role="menuitem"
                    className={itemClass}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', opacity: loadingTier && loadingTier !== row.tier ? 0.5 : 1 }}
                    onClick={() => handleTrigger(row)}
                  >
                    {content}
                  </button>
                ) : (
                  <Link
                    key={row.tier}
                    role="menuitem"
                    href="/agent-lab/estate/jobs"
                    className={itemClass}
                    style={{ textDecoration: 'none' }}
                    title={`${row.label} runs for the whole source — start it from the Jobs page`}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Tertiary — find similar data across the estate */}
      <button
        type="button"
        onClick={() => router.push(`/agent-lab/estate/silo?objectId=${objectId}`)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-size-ui font-medium transition-colors hover:bg-[var(--estate-active-bg)]"
        style={{ border: 'none', background: 'transparent', color: 'var(--brand-a-ink)', cursor: 'pointer' }}
        title="Find tables with similar data across the estate (silo scan)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        Silo Scan
      </button>
    </div>
  );
}
