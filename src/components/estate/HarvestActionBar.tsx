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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface TierRow {
  tier: string;
  label: string;
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
  last_t0_at,
  last_t1_at,
  last_t2_at,
  last_t3_at,
  last_t4_at,
  onActionComplete,
}: HarvestActionBarProps) {
  const router = useRouter();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reharvestingAll, setReharvestingAll] = useState(false);
  const [reharvestStep, setReharvestStep] = useState<string | null>(null);

  const tiers: TierRow[] = [
    {
      tier: 'T0',
      label: 'Structural',
      lastAt: last_t0_at,
      canTrigger: true,
      triggerEndpoint: `/api/agent-lab/context/jobs/trigger`,
      jobKind: 't0_structural',
    },
    {
      tier: 'T1',
      label: 'Profile',
      lastAt: last_t1_at,
      canTrigger: true,
      triggerEndpoint: `/api/agent-lab/context/objects/${objectId}/refresh`,
    },
    {
      tier: 'T2',
      label: 'Semantic',
      lastAt: last_t2_at,
      canTrigger: true,
      triggerEndpoint: `/api/agent-lab/context/objects/${objectId}/enrich`,
    },
    {
      tier: 'T3',
      label: 'Usage',
      lastAt: last_t3_at,
      canTrigger: false, // source-wide — no object-level scoping exists in orchestrator
    },
    {
      tier: 'T4',
      label: 'Entity Model',
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
        ? JSON.stringify({ kind: row.jobKind, scope: { path: undefined } })
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
                style={{ color: '#FDB515', textDecoration: 'underline' }}
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
              <span style={{ opacity: 0.7 }}> · {debounced.map(t => t.key.toUpperCase()).join(', ')} already running</span>
            )}
            {deferred.length > 0 && (
              <span style={{ opacity: 0.7 }}> · T4 deferred — re-run after T2 completes</span>
            )}
            {errored.length > 0 && (
              <span style={{ color: '#F87171' }}> · {errored.map(t => t.key.toUpperCase()).join(', ')} failed</span>
            )}
            {linkJobId && (
              <>
                {' '}<Link href={`/agent-lab/estate/jobs?highlight=${linkJobId}`} style={{ color: '#FDB515', textDecoration: 'underline' }}>View jobs →</Link>
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
              <span style={{ opacity: 0.7 }}> · T4 deferred — re-run after T2 completes</span>
            )}
            {linkJobId && (
              <>
                {' '}<Link href={`/agent-lab/estate/jobs?highlight=${linkJobId}`} style={{ color: '#FDB515', textDecoration: 'underline' }}>View jobs →</Link>
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

  const btnBase: React.CSSProperties = {
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 3,
    border: '1px solid rgba(253,181,21,0.35)',
    background: 'transparent',
    color: '#FDB515',
    cursor: 'pointer',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    transition: 'background 0.12s ease, border-color 0.12s ease',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative' }}>

      {/* ── Reharvest All — T0 → T1 → T2 → T4 sequential ── */}
      <button
        type="button"
        onClick={handleReharvestAll}
        disabled={reharvestingAll || !!loadingTier}
        style={{
          ...btnBase,
          background: reharvestingAll ? 'rgba(253,181,21,0.10)' : 'rgba(253,181,21,0.06)',
          borderColor: reharvestingAll ? '#FDB515' : 'rgba(253,181,21,0.45)',
          opacity: loadingTier ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
        title="Queue T0 → T1 → T2 → T4 for this object sequentially (T3 is source-wide, excluded)"
      >
        {reharvestingAll ? (
          <>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 11 }}>↻</span>
            <span>{reharvestStep ?? 'queuing…'}</span>
          </>
        ) : (
          <>
            <span>⚡</span>
            <span>Reharvest All</span>
            <span
              style={{ opacity: 0.5, fontSize: 9 }}
              title={!last_t2_at ? 'T4 will be deferred until T2 completes — re-run Reharvest All after T2 succeeds' : undefined}
            >
              {last_t2_at ? 'T0→T1→T2→T4' : 'T0→T1→T2→T4*'}
            </span>
          </>
        )}
      </button>

      {/* Re-harvest dropdown trigger */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={btnBase}
          title="Per-tier re-harvest options"
        >
          ↻ Re-harvest {loadingTier ? `(${loadingTier}…)` : '▾'}
        </button>

        {open && (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 29 }}
              onClick={() => setOpen(false)}
            />
            {/* Dropdown */}
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                zIndex: 30,
                width: 240,
                background: 'var(--estate-raised, #111D2E)',
                border: '1px solid rgba(253,181,21,0.18)',
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              {tiers.map((row) => (
                <div
                  key={row.tier}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    cursor: row.canTrigger ? 'pointer' : 'default',
                    opacity: loadingTier && loadingTier !== row.tier ? 0.5 : 1,
                  }}
                  onClick={() => row.canTrigger && handleTrigger(row)}
                  title={
                    !row.canTrigger
                      ? `${row.label} re-harvest is source-wide — trigger from the Jobs page to avoid bulk re-harvest`
                      : undefined
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Tier chip */}
                    <span
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '2px 5px',
                        borderRadius: 3,
                        background: 'var(--estate-ink, #003262)',
                        color: '#fff',
                        letterSpacing: '0.04em',
                        flexShrink: 0,
                      }}
                    >
                      {row.tier}
                    </span>
                    <div>
                      <div
                        style={{
                          fontFamily: '"Inter Tight", sans-serif',
                          fontSize: 12,
                          fontWeight: 500,
                          color: row.canTrigger ? 'var(--estate-ink, #E8E6E1)' : 'var(--estate-text-muted, #8892A4)',
                        }}
                      >
                        {row.label}
                      </div>
                      <div
                        style={{
                          fontFamily: '"IBM Plex Mono", monospace',
                          fontSize: 9,
                          color: 'var(--estate-text-muted, #8892A4)',
                        }}
                      >
                        {row.lastAt ? formatRelativeTime(row.lastAt) : 'Never run'}
                      </div>
                    </div>
                  </div>
                  {row.canTrigger ? (
                    loadingTier === row.tier ? (
                      <span style={{ fontSize: 10, color: '#FDB515', fontFamily: '"IBM Plex Mono", monospace' }}>
                        queuing…
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 10,
                          color: '#FDB515',
                          fontFamily: '"IBM Plex Mono", monospace',
                          fontWeight: 600,
                        }}
                      >
                        ↻
                      </span>
                    )
                  ) : (
                    <Link
                      href="/agent-lab/estate/jobs"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 9,
                        color: 'rgba(253,181,21,0.5)',
                        fontFamily: '"IBM Plex Mono", monospace',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                      title="Source-wide only — go to Jobs"
                    >
                      source-wide →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Silo scan — single consolidated CTA */}
      <button
        type="button"
        onClick={() => router.push(`/agent-lab/estate/silo?objectId=${objectId}`)}
        style={btnBase}
        title="Find similar data across the estate"
      >
        ◎ Silo Scan
      </button>

    </div>
  );
}
