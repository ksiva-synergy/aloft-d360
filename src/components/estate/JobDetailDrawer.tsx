'use client';

import React, { useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import LogStreamPanel from './LogStreamPanel';
import ChildJobsPanel from './ChildJobsPanel';
import { mapJobStatus, isKickableJob, isOrchestratingParent } from '@/lib/estate/job-ui';
import { type, inkOf } from '@/lib/typography/tokens';

export { mapJobStatus };

export interface JobItem {
  id: string;
  org_id: string;
  source_id: string | null;
  job_kind: string;
  trigger: string | null;
  scope: any;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  stats: any;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface JobDetailDrawerProps {
  job: JobItem | null;
  onClose: () => void;
}

function getKindStyle(kind: string) {
  switch (kind) {
    case 't0_structural':
      return { borderColor: 'rgba(96, 165, 250, 0.3)', color: '#60A5FA', backgroundColor: 'var(--estate-kind-bg)' };
    case 't1_profile':
      return { borderColor: 'rgba(134, 239, 172, 0.3)', color: '#86EFAC', backgroundColor: 'rgba(134, 239, 172, 0.08)' };
    case 't2_semantic':
      return { borderColor: 'rgba(192, 132, 252, 0.3)', color: '#C084FC', backgroundColor: 'rgba(192, 132, 252, 0.08)' };
    case 'embed':
      return { borderColor: 'rgba(129, 140, 248, 0.3)', color: '#818CF8', backgroundColor: 'rgba(129, 140, 248, 0.08)' };
    case 'mapping':
      return { borderColor: 'color-mix(in srgb, var(--brand-a) 30%, transparent)', color: 'var(--brand-a-ink)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 8%, transparent)' };
    case 'silo_scan':
      return { borderColor: 'rgba(45, 212, 180, 0.3)', color: '#2DD4B4', backgroundColor: 'rgba(45, 212, 180, 0.08)' };
    default:
      return { borderColor: 'rgba(136, 146, 164, 0.3)', color: 'var(--ink-3)', backgroundColor: 'rgba(136, 146, 164, 0.08)' };
  }
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-[var(--ink-3)] italic">null</span>;
  if (typeof value === 'boolean') return <span className="text-amber-400">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-emerald-400">{value.toLocaleString()}</span>;
  if (typeof value === 'string') return <span className="text-sky-300 break-all">{value}</span>;
  return null;
}

function EmbedJobStatsNote({ stats }: { stats: Record<string, unknown> }) {
  const objects = stats.objects_embedded;
  const columns = stats.columns_embedded;
  const skipped = stats.skipped;
  if (objects === undefined && columns === undefined) return null;
  return (
    <p className="font-mono text-[length:var(--type-caption-size)] leading-relaxed px-1 text-[var(--text-muted)]">
      Counts below are for this run only (new or changed vectors). Unchanged rows are in{' '}
      <span style={{ color: inkOf('#93C5FD') }}>skipped</span>
      {typeof skipped === 'number' ? ` (${skipped.toLocaleString()})` : ''}. Estate totals are on
      Catalog → Scanned &amp; Beyond (Embed tier).
      {typeof objects === 'number' || typeof columns === 'number' ? (
        <>
          {' '}
          This run:{' '}
          {typeof objects === 'number' ? `${objects.toLocaleString()} tables` : ''}
          {typeof objects === 'number' && typeof columns === 'number' ? ', ' : ''}
          {typeof columns === 'number' ? `${columns.toLocaleString()} columns` : ''}.
        </>
      ) : null}
    </p>
  );
}

function JsonDisplay({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;

  if (Array.isArray(data) && data.length > 0 && data.every(v => typeof v !== 'object' || v === null)) {
    return (
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--line-1)', backgroundColor: 'var(--estate-raised, #131d2a)' }}>
        <div className="flex flex-wrap gap-1.5 p-3">
          {data.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center px-2 py-1 rounded text-size-ui font-mono border"
              style={{ color: '#93C5FD', backgroundColor: 'rgba(147,197,253,0.06)', borderColor: 'rgba(147,197,253,0.2)' }}
            >
              {String(item)}
            </span>
          ))}
        </div>
        <div className="px-3 py-1.5 border-t text-size-ui font-mono" style={{ borderColor: 'var(--line-1)', color: 'var(--ink-3)' }}>
          {data.length} item{data.length !== 1 ? 's' : ''}
        </div>
      </div>
    );
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    return (
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--line-1)', backgroundColor: 'var(--estate-raised, #131d2a)' }}>
        {entries.map(([key, val], idx) => (
          <div
            key={key}
            className="flex gap-3 px-4 py-2.5 items-start"
            style={{ borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.06)' : undefined }}
          >
            <span className="font-mono text-size-ui font-semibold shrink-0 pt-0.5 min-w-[100px]" style={{ color: 'var(--brand-a-ink)' }}>
              {key}
            </span>
            <div className="flex-1 min-w-0 font-mono text-size-ui leading-relaxed">
              {Array.isArray(val) ? (
                <div className="flex flex-wrap gap-1.5">
                  {(val as unknown[]).map((item, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2 py-0.5 rounded text-size-ui font-mono border"
                      style={{ color: '#93C5FD', backgroundColor: 'rgba(147,197,253,0.06)', borderColor: 'rgba(147,197,253,0.15)' }}
                    >
                      {typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)}
                    </span>
                  ))}
                  <span className="text-size-ui self-center" style={{ color: 'var(--ink-3)' }}>
                    ({(val as unknown[]).length})
                  </span>
                </div>
              ) : typeof val === 'object' && val !== null ? (
                <pre className="text-size-ui leading-relaxed whitespace-pre-wrap break-all" style={{ color: '#b0b8c4' }}>
                  {JSON.stringify(val, null, 2)}
                </pre>
              ) : (
                <JsonValue value={val} />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 font-mono text-size-ui" style={{ borderColor: 'var(--line-1)', backgroundColor: 'var(--estate-raised, #131d2a)', color: '#b0b8c4' }}>
      <JsonValue value={data} />
    </div>
  );
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 32 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
  return (
    <span
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="font-mono text-size-ui cursor-pointer hover:underline relative"
      style={{ color: '#93C5FD' }}
      title={`Click to copy: ${value}`}
    >
      {short}
      {copied && (
        <span className="absolute -top-6 left-0 bg-black/85 text-size-ui text-white px-2 py-1 rounded shadow-sm z-10 whitespace-nowrap">
          Copied!
        </span>
      )}
    </span>
  );
}

export default function JobDetailDrawer({ job, onClose }: JobDetailDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeJob, setActiveJob] = useState<JobItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [kicking, setKicking] = useState(false);

  useEffect(() => {
    if (job) {
      setActiveJob(job);
      const timer = setTimeout(() => setIsOpen(true), 20);
      return () => clearTimeout(timer);
    } else {
      setIsOpen(false);
      const timer = setTimeout(() => setActiveJob(null), 200);
      return () => clearTimeout(timer);
    }
  }, [job]);

  useEffect(() => {
    if (!activeJob) return;
    const s = activeJob.status.toLowerCase();
    if (!['queued', 'running', 'orchestrating'].includes(s)) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent-lab/context/jobs/${activeJob.id}`);
        if (!res.ok) return;
        const { data } = await res.json();
        if (data) setActiveJob((prev) => (prev ? { ...prev, ...data } : prev));
      } catch { /* ignore */ }
    }, 10_000);
    return () => clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!activeJob) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeJob.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKick = async () => {
    if (kicking) return;
    setKicking(true);
    try {
      const res = await fetch(`/api/agent-lab/context/jobs/${activeJob.id}/kick`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.launched) {
        toast.success(
          <span>
            Fargate container launched.{' '}
            <span className="font-mono text-size-ui opacity-70">{json.task_id?.slice(0, 12)}</span>
          </span>
        );
        // Optimistically update status so button disappears
        setActiveJob((prev) => prev ? { ...prev, status: 'running' } : prev);
      } else {
        toast.error(json.message ?? json.error ?? 'Failed to launch container');
      }
    } catch {
      toast.error('Network error — could not launch container');
    } finally {
      setKicking(false);
    }
  };

  const getQueueDuration = (created: string, started: string | null) => {
    if (!started) return null;
    const diff = new Date(started).getTime() - new Date(created).getTime();
    return diff >= 0 ? `${(diff / 1000).toFixed(1)}s` : '0.0s';
  };

  const getRunDuration = (started: string | null, finished: string | null) => {
    if (!started || !finished) return null;
    const diff = new Date(finished).getTime() - new Date(started).getTime();
    return diff >= 0 ? `${(diff / 1000).toFixed(1)}s` : '0.0s';
  };

  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';

  const getKindLabelAndStyle = (k: string) => {
    const styles = getKindStyle(k);
    return (
      <span
    className="px-2 py-1 rounded border text-label "
        style={styles}
      >
        {k.replace(/_/g, ' ')}
      </span>
    );
  };

  const renderStatusChip = (s: string) => {
    const mapped = mapJobStatus(s);
    if (mapped === 'orchestrating') {
      return (
        <span
     className="inline-flex items-center gap-2 px-2 py-1 rounded text-label border"
          style={{
            borderColor: 'rgba(147, 197, 253, 0.35)',
            color: inkOf('#93C5FD'),
            backgroundColor: 'rgba(147, 197, 253, 0.08)',
          }}
        >
          orchestrating
        </span>
      );
    }
    switch (mapped) {
      case 'queued':
        return (
          <span
      className="inline-flex items-center px-2 py-1 rounded text-label border"
            style={{
              borderColor: 'var(--estate-status-default-border)',
              color: 'var(--estate-status-default-text)',
              backgroundColor: 'var(--estate-status-default-bg)',
            }}
          >
            queued
          </span>
        );
      case 'running':
        return (
          <span
      className="inline-flex items-center gap-2 px-2 py-1 rounded text-label border"
            style={{
              borderColor: 'color-mix(in srgb, var(--brand-a) 30%, transparent)',
              color: 'var(--brand-a-ink)',
              backgroundColor: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--brand-a)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--brand-a)]"></span>
            </span>
            running
          </span>
        );
      case 'done':
        return (
          <span
      className="inline-flex items-center px-2 py-1 rounded text-label border"
            style={{
              borderColor: 'var(--estate-status-success-border)',
              color: 'var(--estate-status-success-text)',
              backgroundColor: 'var(--estate-status-success-bg)',
            }}
          >
            done
          </span>
        );
      case 'failed':
        return (
          <span
      className="inline-flex items-center px-2 py-1 rounded text-label border"
            style={{
              borderColor: 'var(--estate-status-error-border)',
              color: 'var(--estate-status-error-text)',
              backgroundColor: 'var(--estate-status-error-bg)',
            }}
          >
            failed
          </span>
        );
    }
  };

  const createdDate = new Date(activeJob.created_at);
  const startedDate = activeJob.started_at ? new Date(activeJob.started_at) : null;
  const finishedDate = activeJob.finished_at ? new Date(activeJob.finished_at) : null;

  return (
    <div className={`fixed inset-0 z-50 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 transition-opacity duration-200"
        style={{
          opacity: isOpen ? 1 : 0,
          backdropFilter: 'blur(4px)',
        }}
      />
      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 w-[540px] border-l shadow-2xl transition-transform duration-200 ease-out flex flex-col"
        style={{
          backgroundColor: 'var(--card, #1c2128)',
          borderColor: 'var(--border-default, #1E3A5F)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b shrink-0" style={{ borderColor: 'var(--line-1)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-size-title-section font-semibold" style={{ color: inkColor, fontFamily: 'var(--font-sans)' }}>
              Job Details
            </h3>
            {/* Copyable ID */}
            <div className="relative select-none">
              <span
                onClick={handleCopy}
                className="font-mono text-size-ui text-[var(--text-muted)] cursor-pointer hover:underline"
                title="Click to copy full ID"
              >
                ID: {activeJob.id.slice(0, 8)}...
              </span>
              {copied && (
                <span className="absolute -top-6 left-0 bg-black/85 text-size-ui text-white px-2 py-1 rounded font-mono shadow-sm z-10">
                  Copied!
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {getKindLabelAndStyle(activeJob.job_kind)}
                {renderStatusChip(activeJob.status)}
              </div>
              <span className="font-mono text-size-ui text-[var(--text-muted)] lowercase">
                trigger: {activeJob.trigger || '—'}
              </span>
            </div>

            {/* Launch button — only for queued jobs with no Fargate task */}
            {isKickableJob(activeJob) && !(activeJob.scope as any)?.fargate_task_id && (
              <button
                type="button"
                onClick={handleKick}
                disabled={kicking}
                style={{
                  ...type.label,
                  padding: '5px 10px',
                  borderRadius: 3,
                  border: '1px solid color-mix(in srgb, var(--brand-a) 50%, transparent)',
                  background: kicking ? 'color-mix(in srgb, var(--brand-a) 12%, transparent)' : 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
                  color: 'var(--brand-a-ink)',
                  cursor: kicking ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  opacity: kicking ? 0.7 : 1,
                  transition: 'background 0.12s',
                }}
                title="Launch a Fargate container to execute this queued job"
              >
                {kicking ? (
                  <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>↻</span>
                ) : (
                  <span>▶</span>
                )}
                {kicking ? 'Launching…' : 'Launch'}
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150 ml-3 text-size-kpi-lg font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Close drawer"
            >
              &times;
            </button>
          </div>
        </div>

        {/* View Full Details link */}
        <div className="px-7 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--line-1)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 4%, transparent)' }}>
          <Link
            href={`/agent-lab/estate/jobs/${activeJob.id}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 font-mono text-size-ui font-semibold transition-colors hover:underline"
            style={{ color: 'var(--brand-a-ink)' }}
          >
            <ExternalLink size={11} />
            View full details &amp; logs
          </Link>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-7 space-y-8">
          
          {/* Timing Section */}
          <div className="space-y-4">
      <h4 className="text-label " style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}>Timings</h4>
            <div className="flex flex-col gap-2.5 font-mono text-size-body select-none">
              {/* Created Step */}
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-emerald-500 bg-[var(--card,#1c2128)] flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <div>
                  <span className="font-semibold uppercase tracking-wide text-emerald-500">Created</span>
                  <span className="mx-2 text-[var(--text-muted)]">|</span>
                  <span style={{ color: inkColor }}>{createdDate.toLocaleString()}</span>
                </div>
              </div>

              {/* Connector 1 */}
              <div className="flex items-stretch gap-3 min-h-[44px] pl-[9px]">
                <div className="w-[2px] bg-emerald-500/30 dark:bg-emerald-500/20 shrink-0" />
                <div className="pl-4 py-1 flex items-center">
                  {startedDate ? (
                    <span className="text-size-ui text-[var(--text-secondary)]">
                      Queued for <span className="font-semibold text-[var(--text-primary)]">{getQueueDuration(activeJob.created_at, activeJob.started_at)}</span>
                    </span>
                  ) : (
                    <span className="text-size-ui text-[var(--text-muted)] italic">Not yet started</span>
                  )}
                </div>
              </div>

              {/* Started Step */}
              <div className="flex items-center gap-3">
                {startedDate ? (
                  <>
                    <div className="w-5 h-5 rounded-full border-2 border-sky-500 bg-[var(--card,#1c2128)] flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-sky-500" />
                    </div>
                    <div>
                      <span className="font-semibold uppercase tracking-wide text-sky-500">Started</span>
                      <span className="mx-2 text-[var(--text-muted)]">|</span>
                      <span style={{ color: inkColor }}>{startedDate.toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 rounded-full border-2 border-dashed border-[var(--border-default)] bg-[var(--card,#1c2128)] shrink-0" />
                    <span className="text-[var(--text-muted)] italic uppercase">Started &mdash;</span>
                  </>
                )}
              </div>

              {/* Connector 2 */}
              {startedDate && (
                <div className="flex items-stretch gap-3 min-h-[44px] pl-[9px]">
                  <div className="w-[2px] bg-sky-500/30 dark:bg-sky-500/20 shrink-0" />
                  <div className="pl-4 py-1 flex items-center">
                    {finishedDate ? (
                      <span className="text-size-ui text-[var(--text-secondary)]">
                        Ran for <span className="font-semibold text-[var(--text-primary)]">{getRunDuration(activeJob.started_at, activeJob.finished_at)}</span>
                      </span>
                    ) : (
                      <span className="text-size-ui text-amber-500 flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                        In progress...
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Finished Step */}
              {startedDate && (
                <div className="flex items-center gap-3">
                  {finishedDate ? (
                    <>
                      <div className="w-5 h-5 rounded-full border-2 border-[color:var(--brand-a)] bg-[var(--card,#1c2128)] flex items-center justify-center shrink-0">
                        <div className="w-2 h-2 rounded-full bg-[color:var(--brand-a)]" />
                      </div>
                      <div>
                        <span className="font-semibold uppercase tracking-wide text-[color:var(--brand-a-ink)]">Finished</span>
                        <span className="mx-2 text-[var(--text-muted)]">|</span>
                        <span style={{ color: inkColor }}>{finishedDate.toLocaleString()}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-5 h-5 rounded-full border-2 border-dashed border-[var(--border-default)] bg-[var(--card,#1c2128)] shrink-0" />
                      <span className="text-[var(--text-muted)] italic uppercase">Finished &mdash;</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Execution Section — Fargate ID + scan window */}
          {(() => {
            const scope = activeJob.scope as Record<string, unknown> | null;
            const fargateTaskId = scope?.fargate_task_id as string | undefined;
            const since = scope?.since as string | undefined;
            const until = scope?.until as string | undefined;
            if (!fargateTaskId && !since && !until) return null;

            const fmtWindow = (d: string) => {
              try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
              catch { return d; }
            };

            return (
              <div className="space-y-3">
        <h4 className="text-label " style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}>Execution</h4>
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--line-1)', backgroundColor: 'var(--estate-raised, #131d2a)' }}>
                  {fargateTaskId && (
                    <div className="flex gap-3 px-4 py-2.5 items-center" style={{ borderBottom: (since || until) ? '1px solid rgba(255,255,255,0.06)' : undefined }}>
                      <span className="font-mono text-size-ui font-semibold shrink-0 min-w-[100px]" style={{ color: 'var(--brand-a-ink)' }}>fargate_task</span>
                      <CopyableId value={fargateTaskId} />
                    </div>
                  )}
                  {(since || until) && (
                    <div className="flex gap-3 px-4 py-2.5 items-center">
                      <span className="font-sans text-size-ui font-semibold shrink-0 min-w-[100px]" style={{ color: 'var(--brand-a-ink)' }}>scan window</span>
                      <span className="font-mono text-size-ui" style={{ color: '#93C5FD' }}>
                        {since ? fmtWindow(since) : '—'}
                        <span className="mx-1.5 opacity-40">→</span>
                        {until ? fmtWindow(until) : 'now'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {isOrchestratingParent(activeJob) && (
            <div className="space-y-3">
       <h4 className="text-label text-[length:var(--type-caption-size)] " style={{ color: inkOf('#8892A4'), letterSpacing: '0.08em' }}>
                Child chunks
              </h4>
              <p className="text-[length:var(--type-caption-size)] font-sans" style={{ color: inkOf('#8892A4') }}>
                This parent coordinates Fargate workers — logs live on each child row below.
              </p>
              <ChildJobsPanel jobId={activeJob.id} />
            </div>
          )}

          {/* Logs Section */}
          {(() => {
            if (isOrchestratingParent(activeJob)) return null;
            const mapped = mapJobStatus(activeJob.status);
            const scope = activeJob.scope as Record<string, unknown> | null;
            const hasFargateTask = Boolean(scope?.fargate_task_id);
            const isLive = mapped === 'queued' || mapped === 'running' || mapped === 'orchestrating';
            if (!isLive && !hasFargateTask) return null;
            return (
              <LogStreamPanel
                jobId={activeJob.id}
                isLive={isLive}
                defaultCollapsed={!isLive}
              />
            );
          })()}

          {/* Error Section (if failed) */}
          {mapJobStatus(activeJob.status) === 'failed' && (
            <div className="border rounded-lg p-4 flex flex-col gap-2" style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
       <h4 className="text-label text-red-500 ">Error</h4>
              <div className="font-mono text-size-ui text-red-400 select-text break-words whitespace-pre-wrap leading-relaxed">
                {activeJob.error || 'No error details recorded'}
              </div>
            </div>
          )}

          {/* Scope Section */}
          <div className="flex flex-col gap-3">
      <h4 className="text-label " style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}>
              Scope
            </h4>
            {activeJob.scope ? (
              <JsonDisplay data={activeJob.scope} />
            ) : (
              <div className="font-sans text-size-body italic text-[var(--text-muted)] p-4 border border-dashed rounded-lg" style={{ borderColor: 'var(--border-default)' }}>
                No scope defined
              </div>
            )}
          </div>

          {/* Stats Section */}
          <div className="flex flex-col gap-3">
      <h4 className="text-label " style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}>
              Stats
            </h4>
            {activeJob.stats ? (
              <>
                {activeJob.job_kind === 'embed' && typeof activeJob.stats === 'object' && activeJob.stats !== null ? (
                  <EmbedJobStatsNote stats={activeJob.stats as Record<string, unknown>} />
                ) : null}
                <JsonDisplay data={activeJob.stats} />
              </>
            ) : (
              <div className="font-sans text-size-body italic text-[var(--text-muted)] p-4 border border-dashed rounded-lg" style={{ borderColor: 'var(--border-default)' }}>
                No stats recorded
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
