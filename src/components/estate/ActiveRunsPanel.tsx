'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { toast } from 'sonner';
import { canCancelJob } from '@/lib/estate/job-ui';
import { inkOf } from '@/lib/typography/tokens';

interface ActiveJobRow {
  id: string;
  job_kind: string;
  status: string;
  source_name: string | null;
  scope_summary: string;
  chain: string[];
  scope: unknown;
  is_stale: boolean;
  updated_at: string | null;
  child_counts: {
    running: number;
    queued: number;
    succeeded: number;
    failed: number;
  } | null;
}

interface RecentFailedRow {
  id: string;
  job_kind: string;
  status: string;
  source_id: string | null;
  scope: unknown;
  finished_at: string | null;
  error: string | null;
}

type ViewMode = 'active' | 'failed24h' | 'partial24h';

const HARVEST_KINDS = [
  't0_structural',
  't1_profile',
  't2_semantic',
  'embed',
  'estate_inventory',
  't3_usage',
  'change_detect',
] as const;

interface ActiveRunsPanelProps {
  onSelectJob?: (job: { id: string; job_kind: string; status: string; scope?: unknown }) => void;
  refreshKey?: number;
  /** When true, show only queued rows (from L1 queued strip link). */
  queuedOnly?: boolean;
  canRunPipeline?: boolean;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return '#FDB515';
    case 'orchestrating':
      return '#93C5FD';
    case 'queued':
      return '#8892A4';
    case 'failed':
    case 'partial':
      return '#EF4444';
    default:
      return '#8892A4';
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function scopeTaskId(scope: unknown): string | null {
  if (!scope || typeof scope !== 'object') return null;
  const id = (scope as Record<string, unknown>).fargate_task_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export default function ActiveRunsPanel({
  onSelectJob,
  refreshKey = 0,
  queuedOnly = false,
  canRunPipeline = false,
}: ActiveRunsPanelProps) {
  const [view, setView] = useState<ViewMode>('active');
  const [kindFilter, setKindFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sources, setSources] = useState<Array<{ id: string; display_name: string | null }>>([]);
  const [items, setItems] = useState<ActiveJobRow[]>([]);
  const [failedItems, setFailedItems] = useState<RecentFailedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kickingOrphans, setKickingOrphans] = useState(false);

  const loadActive = useCallback(async () => {
    const params = new URLSearchParams();
    if (kindFilter) params.set('kind', kindFilter);
    if (sourceFilter) params.set('sourceId', sourceFilter);
    const res = await fetch(`/api/agent-lab/context/jobs/active?${params}`);
    if (res.ok) {
      const json = await res.json();
      let rows: ActiveJobRow[] = json.data ?? [];
      if (queuedOnly) rows = rows.filter(r => r.status === 'queued');
      setItems(rows);
    }
  }, [kindFilter, sourceFilter, queuedOnly]);

  useEffect(() => {
    fetch('/api/agent-lab/context/sources')
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        const list = json?.sources ?? [];
        setSources(list.map((s: { id: string; display_name: string | null }) => ({ id: s.id, display_name: s.display_name })));
      })
      .catch(() => {});
  }, []);

  const loadPartial = useCallback(async () => {
    const after = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ status: 'partial', after, pageSize: '50' });
    const res = await fetch(`/api/agent-lab/context/jobs?${params}`);
    if (res.ok) {
      const json = await res.json();
      setFailedItems(json.data?.items ?? []);
    }
  }, []);

  const loadFailed = useCallback(async () => {
    const after = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ status: 'failed', after, pageSize: '50' });
    const res = await fetch(`/api/agent-lab/context/jobs?${params}`);
    if (res.ok) {
      const json = await res.json();
      setFailedItems(json.data?.items ?? []);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'active') await loadActive();
      else if (view === 'partial24h') await loadPartial();
      else await loadFailed();
    } finally {
      setLoading(false);
    }
  }, [view, loadActive, loadFailed, loadPartial]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  async function kick(jobId: string) {
    const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/kick`, { method: 'POST' });
    if (res.ok) {
      toast.success('Worker launch requested');
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error('Kick failed', { description: err.message ?? err.error });
    }
  }

  async function retryFailed(jobId: string) {
    const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/retry-failed`, { method: 'POST' });
    if (res.ok) {
      toast.success('Retry failed chunks queued');
      load();
    } else {
      toast.error('Retry failed', { description: (await res.json().catch(() => ({}))).error });
    }
  }

  async function cancel(jobId: string) {
    const res = await fetch(`/api/agent-lab/context/jobs/${jobId}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Job cancelled');
      load();
    } else {
      toast.error('Cancel failed');
    }
  }

  async function startWaitingJobs() {
    setKickingOrphans(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/kick-queued', { method: 'POST' });
      if (res.ok) {
        toast.success('Orphan kick requested');
        load();
      } else {
        toast.error('Could not start waiting jobs');
      }
    } finally {
      setKickingOrphans(false);
    }
  }

  const hasStale = items.some(i => i.is_stale);
  const showEmpty = !loading && (view === 'active' ? items.length === 0 : failedItems.length === 0);
  const failedView = view === 'failed24h' || view === 'partial24h';

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-size-ui font-semibold" style={{ color: 'var(--estate-ink)' }}>
            Active runs
          </h2>
          <p className="text-caption mt-0.5" style={{ color: 'var(--estate-text-muted)' }}>
            Queued, running, and orchestrating harvest jobs (including child chunks).
          </p>
          {hasStale && view === 'active' && (
            <p className="text-caption mt-1" style={{ color: '#EF4444' }}>
              Stuck running job detected — check CloudWatch for the task id, then see{' '}
              <code className="text-caption font-mono">docs/jobs/phase-0-chain-deploy.md</code> §0.4 in the repo.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded border overflow-hidden"
            style={{ borderColor: 'var(--estate-border)' }}
          >
            {(['active', 'failed24h', 'partial24h'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className="text-label px-3 py-1.5"
                style={{
                  background: view === mode ? 'color-mix(in srgb, var(--brand-a) 12%, transparent)' : 'transparent',
                  color: view === mode ? 'var(--brand-a-ink)' : 'var(--estate-text-secondary)',
                }}
              >
                {mode === 'active' ? 'Active' : mode === 'failed24h' ? 'Failed (24h)' : 'Partial (24h)'}
              </button>
            ))}
          </div>
          {view === 'active' && (
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="text-label px-2 py-1.5 rounded border max-w-[140px]"
              style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
            >
              <option value="">All sources</option>
              {sources.map(s => (
                <option key={s.id} value={s.id}>{s.display_name ?? s.id.slice(0, 8)}</option>
              ))}
            </select>
          )}
          {view === 'active' && (
            <select
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value)}
              className="text-label px-2 py-1.5 rounded border"
              style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
            >
              <option value="">All kinds</option>
              {HARVEST_KINDS.map(k => (
                <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
              ))}
            </select>
          )}
          {view === 'active' && canRunPipeline && (
            <button
              type="button"
              disabled={kickingOrphans}
              onClick={startWaitingJobs}
              className="text-label px-3 py-1.5 rounded border"
              style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
            >
              {kickingOrphans ? 'Starting…' : 'Start waiting jobs'}
            </button>
          )}
          <button
            type="button"
            onClick={() => load()}
            className="text-label px-3 py-1.5 rounded border"
            style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-secondary)' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && showEmpty ? (
        <p className="text-size-ui font-sans" style={{ color: 'var(--estate-text-muted)' }}>Loading…</p>
      ) : showEmpty ? (
        <div
          className="rounded-xl border px-6 py-10 text-center"
          style={{ borderColor: 'var(--estate-border)', background: 'var(--estate-raised)' }}
        >
          <p className="text-size-ui" style={{ color: 'var(--estate-text-secondary)' }}>
            {view === 'active' ? 'No active harvest jobs right now.' : view === 'failed24h' ? 'No failed jobs in the last 24 hours.' : 'No partial jobs in the last 24 hours.'}
          </p>
        </div>
      ) : failedView ? (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--estate-border)' }}>
          <table className="w-full text-left text-size-ui">
            <thead style={{ background: 'var(--estate-surface)' }}>
              <tr>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Status</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Kind</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Error</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Finished</th>
                <th className="p-3 text-label text-right" style={{ color: 'var(--estate-text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {failedItems.map(row => (
                <tr key={row.id} className="border-t" style={{ borderColor: 'var(--estate-border)' }}>
                  <td className="p-3 font-mono text-caption uppercase">{row.status}</td>
                  <td className="p-3 font-mono text-caption">{row.job_kind.replace(/_/g, ' ')}</td>
                  <td className="p-3 text-caption max-w-md truncate" title={row.error ?? undefined}>
                    {row.error ?? '—'}
                  </td>
                  <td className="p-3 text-caption">{relativeTime(row.finished_at)}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                    {canRunPipeline && row.status === 'partial' && (
                      <button
                        type="button"
                        onClick={() => retryFailed(row.id)}
                        className="text-label mr-2"
                        style={{ color: 'var(--brand-a-ink)' }}
                      >
                        Retry failed
                      </button>
                    )}
                    <Link href={`/agent-lab/estate/jobs/${row.id}`} className="text-label" style={{ color: 'var(--brand-a-ink)' }}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--estate-border)' }}>
          <table className="w-full text-left text-size-ui min-w-[720px]">
            <thead style={{ background: 'var(--estate-surface)' }}>
              <tr>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Status</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Kind</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Source</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Scope</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Progress</th>
                <th className="p-3 text-label" style={{ color: 'var(--estate-text-muted)' }}>Updated</th>
                <th className="p-3 text-label text-right" style={{ color: 'var(--estate-text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(row => {
                const taskId = scopeTaskId(row.scope);
                return (
                  <tr key={row.id} className="border-t" style={{ borderColor: 'var(--estate-border)' }}>
                    <td className="p-3">
                      <span
                        className="text-label font-mono uppercase"
                        style={{ color: inkOf(statusColor(row.status)) }}
                      >
                        {row.status}
                        {row.is_stale && (
                          <span className="ml-1 normal-case" style={{ color: '#EF4444' }} title="Running >30m without heartbeat">
                            stale?
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-caption">{row.job_kind.replace(/_/g, ' ')}</td>
                    <td className="p-3 text-caption max-w-[120px] truncate" title={row.source_name ?? undefined}>
                      {row.source_name ?? '—'}
                    </td>
                    <td className="p-3 text-caption max-w-[200px] truncate" title={row.scope_summary}>
                      {row.scope_summary}
                      {row.chain.length > 0 && (
                        <span className="block text-caption font-mono mt-0.5" style={{ color: 'var(--estate-text-muted)' }}>
                          then {row.chain.join(' → ')}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-caption font-mono">
                      {row.child_counts ? (
                        <>
                          {row.child_counts.running} run · {row.child_counts.queued} q · {row.child_counts.succeeded} ok
                          {row.child_counts.failed > 0 && (
                            <span style={{ color: '#EF4444' }}> · {row.child_counts.failed} fail</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3 text-caption">{relativeTime(row.updated_at)}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {canRunPipeline && row.status === 'orchestrating' && (row.child_counts?.failed ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => retryFailed(row.id)}
                          className="text-label mr-2 px-2 py-1 rounded border"
                          style={{ borderColor: 'color-mix(in srgb, #EF4444 35%, transparent)', color: '#FCA5A5' }}
                        >
                          Retry failed
                        </button>
                      )}
                      {canRunPipeline && canCancelJob({ status: row.status, scope: row.scope }) && (
                        <>
                          {row.status === 'queued' && (
                            <button
                              type="button"
                              onClick={() => kick(row.id)}
                              className="text-label mr-2 px-2 py-1 rounded border"
                              style={{
                                borderColor: 'color-mix(in srgb, var(--brand-a) 40%, transparent)',
                                color: 'var(--brand-a-ink)',
                              }}
                            >
                              Kick
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => cancel(row.id)}
                            className="text-label mr-2 px-2 py-1 rounded border"
                            style={{ borderColor: 'var(--estate-border)', color: 'var(--estate-text-muted)' }}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {taskId && (
                        <Link
                          href={`/agent-lab/estate/jobs/${row.id}?logs=1`}
                          className="text-label mr-2"
                          style={{ color: 'var(--estate-text-secondary)' }}
                        >
                          Logs
                        </Link>
                      )}
                      <Link
                        href={`/agent-lab/estate/jobs/${row.id}`}
                        className="text-label mr-2"
                        style={{ color: 'var(--brand-a-ink)' }}
                      >
                        Open
                      </Link>
                      {onSelectJob && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectJob({
                              id: row.id,
                              job_kind: row.job_kind,
                              status: row.status,
                              scope: row.scope,
                            })
                          }
                          className="text-label"
                          style={{ color: 'var(--estate-text-secondary)' }}
                        >
                          Drawer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
