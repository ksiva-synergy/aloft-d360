'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from '@/lib/navigation';
import { ObjectKnowledgePage } from '@/components/estate';
import { useBreadcrumbLabel } from '@/lib/breadcrumb-labels';

/** While a job for this object is queued or running, re-fetch on this cadence. */
const ACTIVE_JOB_POLL_MS = 15_000;

export default function EstateObjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<any>(null);

  const inkColor = 'var(--estate-ink)';
  const mutedColor = 'var(--estate-text-secondary)';
  const cardBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';

  // Shell breadcrumb shows the table name instead of the raw object UUID.
  useBreadcrumbLabel(id, data?.object?.object_name ?? data?.object?.full_path ?? null);

  /**
   * Load the object aggregate. State is only set after the request settles, so
   * the effect below never sets state synchronously. `silent` keeps the current
   * page on screen on failure (errors only logged) — used after harvest actions
   * and while polling.
   */
  const loadData = useCallback(async (silent = false) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/agent-lab/context/objects/${id}`);
      const json = await res.json().catch(() => ({} as { data?: unknown; error?: string }));
      if (res.status === 404) {
        if (!silent) setNotFound(true);
        return;
      }
      if (!res.ok) {
        const message =
          json?.error === 'DATABASE_UNAVAILABLE'
            ? 'Cannot reach the development database. Connect to VPN (or confirm your IP is allowed on the RDS security group), then retry.'
            : 'Failed to load object data';
        throw new Error(message);
      }

      if (!json.data) {
        if (!silent) setNotFound(true);
      } else {
        setData(json.data);
        setError(null);
        setNotFound(false);
      }
    } catch (err: any) {
      console.error(err);
      if (!silent) setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // Run in a callback so the effect body itself never sets state.
    const timer = setTimeout(() => { void loadData(); }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  // Keep the page current while a harvest job for this object is in flight, so
  // the hero, Recent Jobs, and tier timestamps update without a manual reload.
  const hasActiveJob = Array.isArray(data?.lastJobs)
    && data.lastJobs.some((j: { status?: string }) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = setInterval(() => { void loadData(true); }, ACTIVE_JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [hasActiveJob, loadData]);

  const refresh = useCallback(() => { void loadData(true); }, [loadData]);

  if (loading) {
    // Skeleton mirrors the page: header, section nav, fact strip, readiness card.
    const bar = 'rounded bg-[color:color-mix(in_srgb,var(--line-2)_22%,transparent)]';
    return (
      <div className="h-full overflow-y-auto scrollbar-thin animate-pulse" style={{ background: 'var(--estate-bg)' }} aria-busy="true" aria-label="Loading object">
        <div className="mx-auto max-w-[1320px] space-y-4 px-10 pt-7 pb-7">
          <div className={`${bar} h-3 w-56`} />
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-3 flex-1">
              <div className={`${bar} h-8 w-2/5`} />
              <div className={`${bar} h-3 w-1/3`} />
            </div>
            <div className="flex gap-2">
              <div className={`${bar} h-9 w-28`} />
              <div className={`${bar} h-9 w-36`} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className={`${bar} h-6 w-24`} />
            <div className={`${bar} h-6 w-36`} />
          </div>
          <div className={`${bar} h-4 w-3/5`} />
        </div>
        <div className="h-12 border-b" style={{ borderColor: 'var(--estate-border)' }} />
        <div className="mx-auto max-w-[1320px] space-y-4 px-10 pt-7">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border md:grid-cols-3 xl:grid-cols-6" style={{ borderColor: 'var(--estate-border)' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2 p-4" style={{ background: 'var(--estate-raised)' }}>
                <div className={`${bar} h-2.5 w-14`} />
                <div className={`${bar} h-5 w-20`} />
                <div className={`${bar} h-2.5 w-24`} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-8 rounded-xl border p-6" style={{ background: 'var(--estate-raised)', borderColor: 'var(--estate-border)' }}>
            <div className={`${bar} h-36 w-36 rounded-full`} />
            <div className="grid flex-1 grid-cols-2 gap-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className={`${bar} h-3 w-24`} />
                  <div className={`${bar} h-1.5 w-full`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center bg-[var(--background)]">
        <div
          className="max-w-md w-full border border-dashed rounded-lg p-10 flex flex-col items-center text-center gap-5 shadow-card"
          style={{
            backgroundColor: cardBg,
            borderColor: borderColor,
          }}
        >
          <span className="w-12 h-12 relative block" style={{ opacity: 0.7 }}>
            <span className="absolute inset-0 border-2 rotate-45" style={{ borderColor: 'var(--brand-a-ink)' }} />
            <span className="absolute inset-3.5 border-2 rotate-45 opacity-60" style={{ borderColor: 'var(--brand-a-ink)' }} />
          </span>

          <h2
            className="text-size-title-section font-semibold"
            style={{ color: inkColor, fontFamily: 'var(--font-sans)' }}
          >
            Object not found
          </h2>

          <p
            className="text-size-ui leading-relaxed"
            style={{ color: mutedColor, fontFamily: 'var(--font-sans)' }}
          >
            The object you are looking for does not exist in this data source or has been removed.
          </p>

          <button
            onClick={() => router.push('/agent-lab/estate/catalog')}
            className="font-mono text-size-ui text-[var(--brand-a-ink)] hover:underline cursor-pointer border-none bg-transparent"
          >
            &larr; back to catalog
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center bg-[var(--background)]">
        <div
          className="max-w-md w-full border border-dashed border-red-500/30 rounded-lg p-10 flex flex-col items-center text-center gap-5"
          style={{
            backgroundColor: cardBg,
          }}
        >
          <span className="text-red-500 font-semibold text-size-kpi-lg">⚠</span>
          <h2 className="text-size-title-section font-semibold" style={{ color: inkColor }}>
            Failed to load object
          </h2>
          <p className="text-size-ui" style={{ color: mutedColor }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              void loadData();
            }}
            className="rounded-ctl border px-4 py-2 text-size-ui font-medium transition-colors hover:border-[var(--line-2)]"
            style={{ borderColor: borderColor, color: inkColor, background: cardBg }}
          >
            Retry
          </button>
          <button
            onClick={() => router.push('/agent-lab/estate/catalog')}
            className="font-mono text-size-ui text-[var(--brand-a-ink)] hover:underline cursor-pointer border-none bg-transparent"
          >
            &larr; back to catalog
          </button>
        </div>
      </div>
    );
  }

  return <ObjectKnowledgePage data={data} onRefresh={refresh} />;
}
