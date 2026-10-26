'use client';

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';

export interface ChildJob {
  id: string;
  job_kind: string;
  status: string;
  child_index: number | null;
  scope: unknown;
  stats: unknown;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ChildCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  partial: number;
}

const statusColor: Record<string, string> = {
  queued: '#8892A4',
  running: '#FDB515',
  succeeded: '#2DD4A0',
  failed: '#EF4444',
  partial: '#F59E0B',
};

export default function ChildJobsPanel({ jobId }: { jobId: string; orgId?: string }) {
  const [children, setChildren] = useState<ChildJob[]>([]);
  const [counts, setCounts] = useState<ChildCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  async function loadChildren() {
    const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/children`);
    if (res.ok) {
      const data = await res.json();
      setChildren(data.children ?? []);
      setCounts(data.counts ?? null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadChildren();
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const interval = setInterval(() => {
      loadChildren().catch(() => {});
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  async function retryFailed() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/retry-failed`, { method: 'POST' });
      if (res.ok) await loadChildren();
    } catch {
      /* ignore */
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4">
        <span
          className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin shrink-0"
          style={{ borderColor: '#FDB515', borderTopColor: 'transparent' }}
        />
        <span className="text-[length:var(--type-caption-size)] font-sans" style={{ color: '#8892A4' }}>Loading child jobs...</span>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="text-[length:var(--type-caption-size)] font-sans py-3 px-4" style={{ color: '#8892A4' }}>
        No child jobs found.
      </div>
    );
  }

  const failedCount = counts?.failed ?? 0;

  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'rgba(253,181,21,0.2)' }}>
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'rgba(253,181,21,0.15)', backgroundColor: 'rgba(253,181,21,0.04)' }}
      >
        <div className="flex items-center gap-3 text-[length:var(--type-caption-size)] font-mono">
          <span className="font-semibold" style={{ color: '#FDB515' }}>{counts?.total ?? children.length} chunks</span>
          {counts && (
            <>
              {counts.running > 0 && <span style={{ color: '#FDB515' }}>{counts.running} running</span>}
              {counts.queued > 0 && <span style={{ color: '#8892A4' }}>{counts.queued} queued</span>}
              {counts.succeeded > 0 && <span style={{ color: '#2DD4A0' }}>{counts.succeeded} done</span>}
              {counts.failed > 0 && <span style={{ color: '#EF4444' }}>{counts.failed} failed</span>}
            </>
          )}
        </div>
        {failedCount > 0 && (
          <button
            type="button"
            onClick={retryFailed}
            disabled={retrying}
      className="text-label inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[length:var(--type-caption-size)] transition-colors disabled:opacity-50"
            style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#EF4444', backgroundColor: 'rgba(239,68,68,0.08)' }}
          >
            Retry {failedCount} failed
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        {children.map(child => {
          const scope = (child.scope ?? {}) as Record<string, unknown>;
          const partition = scope.partition_schema
            ? `${scope.partition_catalog ?? ''}.${scope.partition_schema}${
                scope.partition_objects ? ` [${(scope.partition_objects as string[]).length}]` : ''
              }`
            : `chunk ${(child.child_index ?? 0) + 1}`;

          const duration =
            child.started_at && child.finished_at
              ? Math.round((new Date(child.finished_at).getTime() - new Date(child.started_at).getTime()) / 1000)
              : null;

          return (
            <div key={child.id} className="flex items-center gap-3 px-4 py-2 text-[length:var(--type-caption-size)] font-mono">
              <span className="shrink-0 font-semibold tabular-nums w-6 text-right" style={{ color: '#8892A4' }}>
                {(child.child_index ?? 0) + 1}
              </span>
              <Link
                href={`/agent-lab/estate/jobs/${child.id}`}
                className="flex-1 truncate hover:underline"
                style={{ color: statusColor[child.status] ?? '#8892A4' }}
                title="Open chunk logs"
              >
                {partition}
              </Link>
              <span className="shrink-0 uppercase font-semibold" style={{ color: statusColor[child.status] ?? '#8892A4' }}>
                {child.status}
              </span>
              {duration !== null && (
                <span className="shrink-0 tabular-nums" style={{ color: '#8892A4' }}>{duration}s</span>
              )}
              {child.error && (
                <span className="shrink-0 max-w-[160px] truncate" style={{ color: '#EF4444' }} title={child.error}>
                  {child.error.split('\n')[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
