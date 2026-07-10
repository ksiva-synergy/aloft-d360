'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Copy, Check, RefreshCw, Terminal, Database,
  Activity, Settings, ChevronDown, Download, Search, X,
  AlertTriangle, CheckCircle2, Clock, Loader2, ExternalLink,
  BarChart3, Zap, Eye, GitBranch, Play
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface TouchedObject {
  id: string;
  full_path: string;
  object_kind: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  tiers_touched: string[];
  last_touched_at: string;
}

interface LogLine {
  ts: number;
  message: string;
}

type TabId = 'overview' | 'logs' | 'objects' | 'config';

// ── Helpers ────────────────────────────────────────────────────────────────────

export function mapJobStatus(status: string): 'queued' | 'running' | 'done' | 'failed' {
  const s = status.toLowerCase();
  if (s === 'running') return 'running';
  if (['succeeded', 'partial', 'completed', 'success', 'done'].includes(s)) return 'done';
  if (['failed', 'error'].includes(s)) return 'failed';
  return 'queued';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatTs(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isErrorLine(msg: string) {
  return /\b(ERROR|FATAL|CRITICAL|Exception|Traceback)\b/.test(msg);
}

function isWarnLine(msg: string) {
  return /\b(WARN|WARNING)\b/.test(msg);
}

const KIND_COLORS: Record<string, { color: string; bg: string; border: string; label: string }> = {
  t0_structural: { color: '#60A5FA', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.3)', label: 'T0 Structural' },
  t1_profile:   { color: '#86EFAC', bg: 'rgba(134,239,172,0.08)', border: 'rgba(134,239,172,0.3)', label: 'T1 Profile' },
  t2_semantic:  { color: '#C084FC', bg: 'rgba(192,132,252,0.08)', border: 'rgba(192,132,252,0.3)', label: 'T2 Semantic' },
  embed:        { color: '#818CF8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.3)', label: 'Embed' },
  mapping:      { color: '#FDB515', bg: 'rgba(253,181,21,0.08)',  border: 'rgba(253,181,21,0.3)',  label: 'Mapping' },
  silo_scan:    { color: '#2DD4B4', bg: 'rgba(45,212,180,0.08)',  border: 'rgba(45,212,180,0.3)',  label: 'Silo Scan' },
  recompute_entity_tags: { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', label: 'Entity Tags' },
  estate_inventory:      { color: '#34D399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.3)',  label: 'Inventory' },
  knowledge_sync:        { color: '#93C5FD', bg: 'rgba(147,197,253,0.08)', border: 'rgba(147,197,253,0.3)', label: 'Knowledge Sync' },
};

function getKindStyle(kind: string) {
  return KIND_COLORS[kind] ?? { color: '#8892A4', bg: 'rgba(136,146,164,0.08)', border: 'rgba(136,146,164,0.3)', label: kind.replace(/_/g, ' ') };
}

const TIER_COLORS: Record<string, { color: string; bg: string }> = {
  t0_structural: { color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
  t1_profile:    { color: '#86EFAC', bg: 'rgba(134,239,172,0.12)' },
  t2_semantic:   { color: '#C084FC', bg: 'rgba(192,132,252,0.12)' },
  knowledge_sync: { color: '#93C5FD', bg: 'rgba(147,197,253,0.12)' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: string }) {
  const s = getKindStyle(kind);
  return (
    <span
      className="px-2.5 py-1 rounded border text-xs font-mono font-semibold uppercase tracking-wider"
      style={{ color: s.color, backgroundColor: s.bg, borderColor: s.border }}
    >
      {s.label}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const mapped = mapJobStatus(status);
  if (mapped === 'running') return (
    <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider border"
      style={{ borderColor: 'rgba(253,181,21,0.3)', color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.08)' }}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FDB515] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FDB515]" />
      </span>
      running
    </span>
  );
  if (mapped === 'done') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider border"
      style={{ borderColor: 'rgba(134,239,172,0.3)', color: '#86EFAC', backgroundColor: 'rgba(134,239,172,0.08)' }}>
      <CheckCircle2 size={11} />done
    </span>
  );
  if (mapped === 'failed') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider border"
      style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5', backgroundColor: 'rgba(239,68,68,0.08)' }}>
      <AlertTriangle size={11} />failed
    </span>
  );
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider border"
      style={{ borderColor: 'rgba(136,146,164,0.3)', color: '#8892A4', backgroundColor: 'rgba(136,146,164,0.08)' }}>
      queued
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded animate-pulse ${className ?? ''}`}
      style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────────────

function OverviewTab({ job, onTabChange }: { job: JobItem; onTabChange: (t: TabId) => void }) {
  const mapped = mapJobStatus(job.status);
  const createdDate = new Date(job.created_at);
  const startedDate = job.started_at ? new Date(job.started_at) : null;
  const finishedDate = job.finished_at ? new Date(job.finished_at) : null;
  const queueMs = startedDate ? startedDate.getTime() - createdDate.getTime() : null;
  const runMs = startedDate && finishedDate ? finishedDate.getTime() - startedDate.getTime() : null;
  const stats = job.stats as Record<string, unknown> | null;

  const statCards = stats ? Object.entries(stats).filter(([, v]) => typeof v === 'number') : [];
  const allStatsZero = statCards.length > 0 && statCards.every(([, v]) => (v as number) === 0);

  const scope = job.scope as Record<string, unknown> | null;
  const taskId = scope?.fargate_task_id as string | undefined;

  const [errorCopied, setErrorCopied] = useState(false);
  const copyError = () => {
    if (job.error) { navigator.clipboard.writeText(job.error); setErrorCopied(true); setTimeout(() => setErrorCopied(false), 2000); }
  };

  const isCanceled = job.error?.includes('CANCEL') || job.error?.includes('cancel');

  return (
    <div className="p-8 space-y-10">
      {/* Execution Timeline */}
      <section>
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest mb-5"
          style={{ color: '#8892A4' }}>
          Execution Timeline
        </h3>
        <div className="flex flex-col gap-0">
          <TimelineStep
            color="#22C55E" label="Created"
            time={createdDate.toLocaleString()}
            connector={queueMs !== null ? `Queued for ${formatDuration(Math.max(0, queueMs))}` : undefined}
            connectorColor="#22C55E"
            active
          />
          <TimelineStep
            color={startedDate ? '#38BDF8' : undefined}
            label="Started"
            time={startedDate?.toLocaleString()}
            connector={startedDate && !finishedDate ? undefined : runMs !== null ? `Ran for ${formatDuration(runMs)}` : undefined}
            connectorColor="#38BDF8"
            active={!!startedDate}
            running={!finishedDate && !!startedDate}
          />
          {startedDate && (
            <TimelineStep
              color={finishedDate ? (mapped === 'failed' ? '#EF4444' : '#6366F1') : undefined}
              label={finishedDate ? 'Finished' : 'Running…'}
              time={finishedDate?.toLocaleString()}
              active={!!finishedDate}
              running={!finishedDate}
              last
            />
          )}
        </div>
      </section>

      {/* Stats Grid */}
      {statCards.length > 0 && (
        <section>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest mb-5"
            style={{ color: '#8892A4' }}>
            Run Statistics
          </h3>
          {allStatsZero && mapped === 'failed' && (
            <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg border font-mono text-xs"
              style={{ color: '#8892A4', backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }}>
              <AlertTriangle size={12} className="shrink-0" style={{ color: '#6b7280' }} />
              Job failed before producing any results — all counters are zero.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {statCards.map(([key, val]) => (
              <StatCard key={key} label={key} value={val as number} muted={allStatsZero && mapped === 'failed'} />
            ))}
          </div>
        </section>
      )}

      {/* Enhanced Error Panel */}
      {mapped === 'failed' && (
        <section>
          <div className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.25)' }}>
            {/* Header row */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.15)' }}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-400 shrink-0" />
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-red-400">Error</h3>
                {finishedDate && (
                  <span className="font-mono text-[10px]" style={{ color: '#9ca3af' }}>
                    · {finishedDate.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onTabChange('logs')}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-mono transition-colors"
                  style={{ color: '#93C5FD', borderColor: 'rgba(147,197,253,0.25)', backgroundColor: 'transparent' }}>
                  <Terminal size={10} /> View Logs
                </button>
                <button onClick={copyError}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-mono transition-colors"
                  style={{ color: errorCopied ? '#86EFAC' : '#8892A4', borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'transparent' }}>
                  {errorCopied ? <Check size={10} /> : <Copy size={10} />}
                  {errorCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Error body */}
            <div className="p-5 space-y-4">
              <pre className="font-mono text-[12px] text-red-300 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto p-3 rounded border"
                style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderColor: 'rgba(239,68,68,0.12)' }}>
                {job.error || 'No error details recorded.'}
              </pre>

              {/* Contextual help for CANCELED errors */}
              {isCanceled && (
                <div className="flex gap-2 px-3 py-2.5 rounded border font-mono text-[11px]"
                  style={{ color: '#9ca3af', backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }}>
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" style={{ color: '#d97706' }} />
                  <span>
                    <span style={{ color: '#fbbf24' }}>Query CANCELED</span> typically means the ECS task was stopped externally,
                    the Fargate task ran out of memory, or an upstream timeout killed the database query.
                    Check the Logs tab and CloudWatch for the full trace.
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Quick Debug Panel — for failed jobs */}
      {mapped === 'failed' && (
        <section>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest mb-4"
            style={{ color: '#8892A4' }}>
            Quick Debug
          </h3>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            {[
              { label: 'Job ID', value: job.id, copy: true },
              { label: 'Fargate Task ID', value: taskId ?? '—', copy: !!taskId },
              { label: 'Trigger', value: job.trigger ?? '—' },
              ...(startedDate ? [{ label: 'Started', value: startedDate.toLocaleString() }] : []),
              ...(finishedDate ? [{ label: 'Finished', value: finishedDate.toLocaleString() }] : []),
              ...(runMs !== null ? [{ label: 'Duration', value: formatDuration(runMs) }] : []),
            ].map(({ label, value, copy }, idx) => (
              <DebugRow key={label} label={label} value={value} copy={copy} hasBorder={idx > 0} />
            ))}
            {taskId && (
              <div className="flex gap-4 px-5 py-3 items-center border-t"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <span className="font-mono text-[10px] uppercase tracking-wider shrink-0 min-w-[120px]" style={{ color: '#8892A4' }}>CloudWatch</span>
                <a
                  href={`https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#logsV2:log-groups/log-group/%2Fecs%2Faloft-context-harvester/log-events/harvester%252Fcontext-harvester%252F${taskId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
                  style={{ color: '#93C5FD' }}>
                  <ExternalLink size={11} /> Open log stream
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Scope Summary (collapsed) */}
      <CollapsibleSection title="Scope Configuration">
        <StructuredJson data={job.scope} />
      </CollapsibleSection>
    </div>
  );
}

function DebugRow({ label, value, copy, hasBorder }: { label: string; value: string; copy?: boolean; hasBorder?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (copy) { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };
  return (
    <div className="flex gap-4 px-5 py-3 items-start"
      style={{ borderTop: hasBorder ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
      <span className="font-mono text-[10px] uppercase tracking-wider shrink-0 pt-0.5 min-w-[120px]" style={{ color: '#8892A4' }}>{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="font-mono text-xs break-all" style={{ color: '#c9d1d9' }}>{value}</span>
        {copy && value !== '—' && (
          <button onClick={handleCopy} className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" style={{ color: copied ? '#86EFAC' : '#4a5568' }}>
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        )}
      </div>
    </div>
  );
}

function TimelineStep({
  color, label, time, connector, connectorColor, active, running, last
}: {
  color?: string; label: string; time?: string; connector?: string;
  connectorColor?: string; active?: boolean; running?: boolean; last?: boolean;
}) {
  const dotColor = color ?? '#374151';
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300"
          style={{
            borderColor: dotColor,
            backgroundColor: active ? dotColor + '22' : 'var(--card,#1c2128)',
          }}>
          {running ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: dotColor }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: dotColor }} />
            </span>
          ) : active ? (
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
          ) : (
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#374151' }} />
          )}
        </div>
        {!last && (
          <div className="w-0.5 flex-1 min-h-[40px]"
            style={{ backgroundColor: active ? (connectorColor ?? dotColor) + '40' : 'rgba(255,255,255,0.06)' }} />
        )}
      </div>
      <div className="pb-8 flex-1">
        <div className="flex items-center gap-3 mt-0.5">
          <span className="font-mono text-sm font-bold uppercase tracking-wider"
            style={{ color: active ? dotColor : '#374151' }}>
            {label}
          </span>
          {time && (
            <span className="font-mono text-xs" style={{ color: 'var(--estate-ink,#e2e8f0)' }}>
              {time}
            </span>
          )}
        </div>
        {connector && (
          <div className="mt-1.5 font-mono text-xs" style={{ color: '#8892A4' }}>
            {connector}
          </div>
        )}
        {running && !connector && (
          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-amber-400">
            <Loader2 size={11} className="animate-spin" />
            In progress…
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  const icons: Record<string, React.ReactNode> = {
    objects_swept:    <Eye size={14} />,
    objects_profiled: <BarChart3 size={14} />,
    objects_enriched: <Zap size={14} />,
    objects_skipped:  <GitBranch size={14} />,
    queries_issued:   <Activity size={14} />,
    error_count:      <AlertTriangle size={14} />,
    columns_enriched: <Database size={14} />,
    inserted:         <CheckCircle2 size={14} />,
  };

  const isError = label.includes('error');
  const accentColor = muted ? '#374151' : isError ? '#EF4444' : '#FDB515';
  const icon = icons[label] ?? <BarChart3 size={14} />;

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2 group transition-all duration-150 hover:scale-[1.02]"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(253,181,21,0.15)',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = accentColor + '50')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(253,181,21,0.15)')}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: '#8892A4' }}>{icon}</span>
        <span className="font-mono text-2xl font-bold" style={{ color: accentColor }}>
          {typeof value === 'number' && !isNaN(value)
            ? value % 1 === 0 ? value.toLocaleString() : value.toFixed(4)
            : String(value)}
        </span>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#8892A4' }}>
        {label.replace(/_/g, ' ')}
      </span>
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-white/5"
        style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
      >
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: '#8892A4' }}>
          {title}
        </span>
        <ChevronDown
          size={14}
          style={{ color: '#8892A4', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}
        />
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function StructuredJson({ data }: { data: unknown }) {
  if (!data) return <p className="font-mono text-sm italic" style={{ color: '#8892A4' }}>No data</p>;
  if (typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    return (
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-3 items-start font-mono text-xs">
            <span className="min-w-[140px] shrink-0 font-semibold" style={{ color: '#FDB515' }}>{k}</span>
            <span className="break-all" style={{ color: '#c9d1d9' }}>
              {Array.isArray(v) ? (
                <span className="flex flex-wrap gap-1">
                  {(v as unknown[]).map((item, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] border"
                      style={{ color: '#93C5FD', borderColor: 'rgba(147,197,253,0.2)', backgroundColor: 'rgba(147,197,253,0.06)' }}>
                      {String(item)}
                    </span>
                  ))}
                  <span style={{ color: '#8892A4' }}>({(v as unknown[]).length})</span>
                </span>
              ) : typeof v === 'object' && v !== null ? (
                <pre className="text-[10px] whitespace-pre-wrap" style={{ color: '#8892A4' }}>
                  {JSON.stringify(v, null, 2)}
                </pre>
              ) : (
                <span style={{ color: typeof v === 'number' ? '#86EFAC' : typeof v === 'boolean' ? '#F59E0B' : '#93C5FD' }}>
                  {String(v)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <pre className="font-mono text-xs whitespace-pre-wrap" style={{ color: '#8892A4' }}>{JSON.stringify(data, null, 2)}</pre>;
}
// ── Logs Tab ───────────────────────────────────────────────────────────────────

function LogsTab({ jobId, isLive }: { jobId: string; isLive: boolean }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filteredLines, setFilteredLines] = useState<LogLine[]>([]);
  const [meta, setMeta] = useState<{ logGroup: string; logStream: string; taskId: string } | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  useEffect(() => {
    let result = lines;
    if (levelFilter === 'error') result = result.filter(l => isErrorLine(l.message));
    else if (levelFilter === 'warn') result = result.filter(l => isWarnLine(l.message));
    else if (levelFilter === 'info') result = result.filter(l => !isErrorLine(l.message) && !isWarnLine(l.message));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l => l.message.toLowerCase().includes(q));
    }
    setFilteredLines(result);
  }, [lines, search, levelFilter]);

  const loadLogs = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLines([]); setMeta(null); setIsDone(false); setErrorMsg(null); setIsLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/logs`, { signal: controller.signal });
        if (!res.ok) { setErrorMsg(`HTTP ${res.status}`); setIsLoading(false); return; }
        const ct = res.headers.get('content-type') ?? '';

        if (ct.includes('application/json')) {
          const json = await res.json();
          if (json.error) {
            setErrorMsg(json.message ?? json.error ?? 'Unknown error');
            setIsLoading(false);
            return;
          }
          setLines((json.lines as LogLine[]) ?? []);
          setMeta({ logGroup: json.logGroup, logStream: json.logStream ?? '', taskId: json.taskId ?? '' });
          if (json.note) setErrorMsg(null); // clear any previous error; note shown via empty state
          setIsDone(true); setIsLoading(false); return;
        }

        if (!res.body) { setErrorMsg('No response body'); setIsLoading(false); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        setIsLoading(false);

        const processChunk = (chunk: string) => {
          bufferRef.current += chunk;
          const parts = bufferRef.current.split('\n\n');
          bufferRef.current = parts.pop() ?? '';
          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            let eventType = 'message', dataStr = '';
            for (const line of trimmed.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7).trim();
              else if (line.startsWith('data: ')) dataStr = line.slice(6);
            }
            if (!dataStr) continue;
            try {
              const payload = JSON.parse(dataStr);
              if (eventType === 'done') { setIsDone(true); return; }
              if (eventType === 'error') { setErrorMsg(payload.message ?? 'Unknown error'); return; }
              if (payload.type === 'meta') setMeta({ logGroup: payload.logGroup, logStream: payload.logStream, taskId: payload.taskId });
              else if (payload.type === 'lines') setLines(prev => [...prev, ...(payload.lines as LogLine[])]);
              else if (payload.type === 'error') setErrorMsg(payload.message);
            } catch { /* skip malformed */ }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) { setIsDone(true); break; }
          processChunk(decoder.decode(value, { stream: true }));
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          setErrorMsg((err as Error)?.message ?? 'Stream error');
          setIsLoading(false);
        }
      }
    })();
  }, [jobId]);

  useEffect(() => { loadLogs(); return () => abortRef.current?.abort(); }, [loadLogs]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  const downloadLogs = () => {
    const text = lines.map(l => `${new Date(l.ts).toISOString()}  ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `job-${jobId.slice(0,8)}-logs.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const errorCount = lines.filter(l => isErrorLine(l.message)).length;
  const warnCount = lines.filter(l => isWarnLine(l.message)).length;

  const logBody = (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto" style={{ backgroundColor: '#0d1117', minHeight: 0, fontFamily: 'IBM Plex Mono, monospace' }}>
      {isLoading && (
        <div className="flex items-center gap-2 px-5 py-4" style={{ color: '#8892A4', fontSize: 12 }}>
          <Loader2 size={12} className="animate-spin" /> Loading logs…
        </div>
      )}
      {!isLoading && errorMsg && (
        <div className="m-5 rounded-xl border p-5 space-y-4" style={{ backgroundColor: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.25)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-red-400">Failed to load logs</span>
            </div>
            <button onClick={loadLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono shrink-0 transition-colors"
              style={{ color: '#FDB515', borderColor: 'rgba(253,181,21,0.4)', backgroundColor: 'rgba(253,181,21,0.08)' }}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
          <pre className="font-mono text-[11px] text-red-300 whitespace-pre-wrap break-words leading-relaxed p-3 rounded border" style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'rgba(239,68,68,0.15)' }}>
            {errorMsg}
          </pre>
          <div className="space-y-2 font-mono text-[11px]" style={{ color: '#8892A4' }}>
            <p>Possible causes:</p>
            <ul className="list-disc list-inside space-y-1 ml-2" style={{ color: '#6b7280' }}>
              <li>The database is temporarily unavailable — retry in a moment</li>
              <li>The container never launched, so no logs were written</li>
              <li>CloudWatch log retention may have expired for older jobs</li>
            </ul>
          </div>
          {meta?.taskId && (
            <a
              href={`https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#logsV2:log-groups/log-group/%2Fecs%2Faloft-context-harvester/log-events/harvester%252Fcontext-harvester%252F${meta.taskId}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono transition-colors"
              style={{ color: '#93C5FD' }}>
              <ExternalLink size={11} /> Open in CloudWatch console
            </a>
          )}
        </div>
      )}
      {!isLoading && !errorMsg && filteredLines.length === 0 && (
        <div className="px-5 py-8 space-y-2">
          {lines.length > 0 ? (
            <p className="text-xs font-mono" style={{ color: '#8892A4' }}>No lines match the current filter.</p>
          ) : isLive ? (
            <div className="flex items-center gap-1.5 text-xs font-mono" style={{ color: '#8892A4' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FDB515' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FDB515' }} />
              </span>
              Waiting for log events — the container may still be starting…
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-mono" style={{ color: '#8892A4' }}>No logs found for this job.</p>
              <p className="text-[11px] font-mono" style={{ color: '#4a5568' }}>
                This can happen when the Fargate container never started, or when CloudWatch log retention has expired.
              </p>
              <button onClick={loadLogs} className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded border transition-colors mt-1"
                style={{ color: '#FDB515', borderColor: 'rgba(253,181,21,0.3)', backgroundColor: 'rgba(253,181,21,0.06)' }}>
                <RefreshCw size={10} /> Try again
              </button>
            </div>
          )}
        </div>
      )}
      {filteredLines.map((line, i) => {
        const isErr = isErrorLine(line.message);
        const isWarn = isWarnLine(line.message);
        return (
          <div key={i} className="flex gap-3 px-4 py-0.5 hover:bg-white/5 group text-[11px] leading-relaxed"
            style={{ backgroundColor: isErr ? 'rgba(239,68,68,0.08)' : isWarn ? 'rgba(234,179,8,0.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
            <span className="shrink-0 select-none tabular-nums w-[7ch]" style={{ color: '#4a5568' }}>{formatTs(line.ts)}</span>
            <span className="w-5 shrink-0 select-none text-center" style={{ color: isErr ? '#fca5a5' : isWarn ? '#fde047' : 'transparent', fontSize: 9 }}>{isErr ? '●' : isWarn ? '▲' : '·'}</span>
            <span className="flex-1 break-all whitespace-pre-wrap" style={{ color: isErr ? '#fca5a5' : isWarn ? '#fde047' : '#c9d1d9' }}>{line.message.replace(/\n$/, '')}</span>
          </div>
        );
      })}
      {isDone && lines.length > 0 && (
        <div className="px-5 py-2 text-[10px] border-t mt-1" style={{ color: '#4a5568', borderColor: 'rgba(255,255,255,0.06)' }}>
          — end of log · {lines.length} line{lines.length !== 1 ? 's' : ''} —
        </div>
      )}
      {!autoScroll && filteredLines.length > 0 && (
        <button onClick={() => { setAutoScroll(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}
          className="sticky bottom-2 mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono border shadow-lg"
          style={{ backgroundColor: '#1c2128', borderColor: 'rgba(253,181,21,0.3)', color: '#FDB515', left: '50%', transform: 'translateX(-50%)' }}>
          <ChevronDown size={11} /> Resume scroll
        </button>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b shrink-0" style={{ backgroundColor: '#161b22', borderColor: 'rgba(255,255,255,0.07)' }}>
      <div className="relative flex-1 min-w-[160px]">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#8892A4' }} />
        <input type="text" placeholder="Search logs…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-7 pr-3 py-1.5 rounded border text-xs font-mono outline-none"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#c9d1d9' }} />
        {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: '#8892A4' }}><X size={11} /></button>}
      </div>
      <div className="flex gap-1">
        {(['all','error','warn','info'] as const).map(f => (
          <button key={f} onClick={() => setLevelFilter(f)}
            className="px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider border transition-colors"
            style={{ backgroundColor: levelFilter === f ? 'rgba(253,181,21,0.15)' : 'transparent', borderColor: levelFilter === f ? 'rgba(253,181,21,0.4)' : 'rgba(255,255,255,0.08)', color: levelFilter === f ? '#FDB515' : '#8892A4' }}>
            {f === 'error' ? (errorCount > 0 ? `error (${errorCount})` : 'error') : f === 'warn' ? (warnCount > 0 ? `warn (${warnCount})` : 'warn') : f}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 ml-auto">
        {isLive && !isDone && (
          <span className="flex items-center gap-1.5 text-[10px] font-mono mr-2" style={{ color: '#FDB515' }}>
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FDB515' }} /><span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FDB515' }} /></span>
            live
          </span>
        )}
        {meta && <span className="font-mono text-[9px] mr-2 hidden md:block" style={{ color: '#4a5568' }} title={meta.logStream}>{meta.taskId.slice(-12)}</span>}
        {lines.length > 0 && (
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded mr-1 hidden md:block" style={{ color: '#8892A4', backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {lines.length.toLocaleString()} lines
          </span>
        )}
        <button onClick={loadLogs} className="p-1.5 rounded hover:bg-white/10 transition-colors" style={{ color: '#8892A4' }} title="Reload"><RefreshCw size={12} /></button>
        <button onClick={downloadLogs} disabled={lines.length === 0} className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-40" style={{ color: '#8892A4' }} title="Download"><Download size={12} /></button>
        <button onClick={() => setIsFullscreen(f => !f)} className="p-1.5 rounded hover:bg-white/10 transition-colors" style={{ color: '#8892A4' }}><Terminal size={12} /></button>
      </div>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-4 z-[60] flex flex-col rounded-xl shadow-2xl overflow-hidden border" style={{ backgroundColor: '#0d1117', borderColor: 'rgba(253,181,21,0.2)' }}>
        <div className="fixed inset-0 -z-10" style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }} onClick={() => setIsFullscreen(false)} />
        {toolbar}
        {logBody}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: '600px', minHeight: 400 }}>
      {toolbar}
      {logBody}
    </div>
  );
}

// ── Objects Tab ────────────────────────────────────────────────────────────────

function ObjectsTab({ jobId, onCountChange }: { jobId: string; onCountChange: (n: number) => void }) {
  const [objects, setObjects] = useState<TouchedObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/agent-lab/context/jobs/${jobId}/objects`)
      .then(r => r.json())
      .then(d => {
        const items = (d.data as TouchedObject[]) ?? [];
        setObjects(items);
        onCountChange(items.length);
        setIsLoading(false);
      })
      .catch(e => { setError(e.message); setIsLoading(false); });
  }, [jobId, onCountChange]);

  const filtered = search
    ? objects.filter(o => o.full_path.toLowerCase().includes(search.toLowerCase()) || (o.schema_name ?? '').toLowerCase().includes(search.toLowerCase()))
    : objects;

  if (isLoading) return (
    <div className="p-8 space-y-3">
      {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );

  if (error) return (
    <div className="p-8 text-sm font-mono text-red-400">Error loading objects: {error}</div>
  );

  if (objects.length === 0) return (
    <div className="flex flex-col items-center justify-center p-16 gap-4">
      <Database size={40} style={{ color: '#374151' }} />
      <p className="font-mono text-sm" style={{ color: '#8892A4' }}>No objects touched during this run</p>
      <p className="font-mono text-xs text-center max-w-xs" style={{ color: '#4a5568' }}>
        Objects are correlated via tier timestamps. This job may not have processed any objects or may still be running.
      </p>
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#8892A4' }} />
          <input type="text" placeholder={`Search ${objects.length} objects…`} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 rounded border text-xs font-mono outline-none"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#c9d1d9' }} />
        </div>
        <span className="font-mono text-xs shrink-0" style={{ color: '#8892A4' }}>{filtered.length} of {objects.length}</span>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '540px' }}>
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
              <th className="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: '#8892A4', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Object</th>
              <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: '#8892A4', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Schema</th>
              <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: '#8892A4', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Kind</th>
              <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: '#8892A4', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Tiers</th>
              <th className="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: '#8892A4', borderBottom: '1px solid rgba(255,255,255,0.06)' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((obj, i) => (
              <tr key={obj.id} className="group transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(253,181,21,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                <td className="px-5 py-3">
                  <span className="font-medium" style={{ color: 'var(--estate-ink,#e2e8f0)' }}>{obj.object_name ?? obj.full_path.split('.').pop()}</span>
                  <div className="text-[10px] mt-0.5 truncate max-w-[280px]" style={{ color: '#8892A4' }}>{obj.full_path}</div>
                </td>
                <td className="px-4 py-3" style={{ color: '#8892A4' }}>{obj.schema_name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="px-1.5 py-0.5 rounded border text-[10px] uppercase" style={{ color: '#93C5FD', borderColor: 'rgba(147,197,253,0.2)', backgroundColor: 'rgba(147,197,253,0.06)' }}>
                    {obj.object_kind}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {obj.tiers_touched.map(tier => {
                      const tc = TIER_COLORS[tier] ?? { color: '#8892A4', bg: 'rgba(136,146,164,0.1)' };
                      return (
                        <span key={tier} className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                          style={{ color: tc.color, backgroundColor: tc.bg }}>
                          {tier.replace('_', ' ')}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  <Link href={`/agent-lab/estate/object/${obj.id}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-mono transition-colors"
                    style={{ color: '#FDB515', borderColor: 'rgba(253,181,21,0.2)', backgroundColor: 'transparent' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(253,181,21,0.1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                    View <ExternalLink size={9} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Config Tab ─────────────────────────────────────────────────────────────────

function ConfigTab({ job }: { job: JobItem }) {
  const scope = job.scope as Record<string, unknown> | null;
  const taskId = scope?.fargate_task_id as string | undefined;
  const chain = scope?.chain as string[] | undefined;
  const excludeSchemas = scope?.excludeSchemas as string[] | undefined;
  const includePatterns = scope?.includePatterns as string[] | undefined;
  const [showAllSchemas, setShowAllSchemas] = useState(false);
  const SCHEMA_LIMIT = 20;

  return (
    <div className="p-8 space-y-8">
      {/* Infrastructure */}
      <section>
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#8892A4' }}>Infrastructure</h3>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          {[
            { label: 'Job ID', value: job.id, mono: true },
            { label: 'Fargate Task ID', value: taskId ?? '—', mono: true },
            { label: 'ECS Cluster', value: 'aloft-agents-prod', mono: true },
            { label: 'Log Group', value: '/ecs/aloft-context-harvester', mono: true },
            { label: 'Region', value: 'ap-south-1', mono: true },
            { label: 'Source ID', value: job.source_id ?? '—', mono: true },
            { label: 'Trigger', value: job.trigger ?? '—', mono: false },
          ].map(({ label, value, mono }, idx) => (
            <div key={label} className="flex gap-4 px-5 py-3 items-start"
              style={{ borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
              <span className="font-mono text-[10px] uppercase tracking-wider shrink-0 pt-0.5 min-w-[120px]" style={{ color: '#8892A4' }}>{label}</span>
              <span className={mono ? 'font-mono text-xs break-all' : 'text-sm'} style={{ color: '#c9d1d9' }}>{String(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Scope Details */}
      {(excludeSchemas || includePatterns || chain) && (
        <section>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#8892A4' }}>Scope Configuration</h3>
          <div className="space-y-4">
            {excludeSchemas && excludeSchemas.length > 0 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: '#8892A4' }}>
                  Excluded Schemas ({excludeSchemas.length})
                </p>
                <div
                  className="flex flex-wrap gap-1.5 overflow-y-auto"
                  style={{ maxHeight: showAllSchemas ? 'none' : '160px' }}
                >
                  {excludeSchemas.map((s, i) => (
                    <span key={i} className="px-2 py-1 rounded border text-[10px] font-mono"
                      style={{ color: '#93C5FD', borderColor: 'rgba(147,197,253,0.2)', backgroundColor: 'rgba(147,197,253,0.06)' }}>
                      {s}
                    </span>
                  ))}
                </div>
                {excludeSchemas.length > SCHEMA_LIMIT && (
                  <button
                    onClick={() => setShowAllSchemas(v => !v)}
                    className="mt-2 font-mono text-[10px] uppercase tracking-wider transition-colors"
                    style={{ color: '#FDB515' }}>
                    {showAllSchemas ? 'Show less ↑' : `Show all ${excludeSchemas.length} schemas ↓`}
                  </button>
                )}
              </div>
            )}
            {includePatterns && includePatterns.length > 0 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: '#8892A4' }}>
                  Include Patterns ({includePatterns.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {includePatterns.map((s, i) => (
                    <span key={i} className="px-2 py-1 rounded border text-[10px] font-mono"
                      style={{ color: '#86EFAC', borderColor: 'rgba(134,239,172,0.2)', backgroundColor: 'rgba(134,239,172,0.06)' }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {chain && chain.length > 0 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: '#8892A4' }}>
                  Chained Jobs
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {chain.map((k, i) => {
                    const s = getKindStyle(k);
                    return (
                      <React.Fragment key={k}>
                        {i > 0 && <span style={{ color: '#FDB515' }}>→</span>}
                        <span className="px-2 py-1 rounded border text-[10px] font-mono font-semibold uppercase"
                          style={{ color: s.color, borderColor: s.border, backgroundColor: s.bg }}>
                          {s.label}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Full raw scope */}
      <CollapsibleSection title="Raw Scope JSON">
        <StructuredJson data={job.scope} />
      </CollapsibleSection>

      {/* Full raw stats */}
      {job.stats && (
        <CollapsibleSection title="Raw Stats JSON">
          <StructuredJson data={job.stats} />
        </CollapsibleSection>
      )}
    </div>
  );
}

// ── Main JobRunPage ────────────────────────────────────────────────────────────

export default function JobRunPage({ job }: { job: JobItem }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [objectCount, setObjectCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [kicking, setKicking] = useState(false);
  const [jobStatus, setJobStatus] = useState(job.status);

  const mapped = mapJobStatus(jobStatus);
  const isLive = mapped === 'running' || mapped === 'queued';
  const kindStyle = getKindStyle(job.job_kind); // used for kindStyle-dependent future styling

  const startedDate = job.started_at ? new Date(job.started_at) : null;
  const finishedDate = job.finished_at ? new Date(job.finished_at) : null;
  const runMs = startedDate && finishedDate ? finishedDate.getTime() - startedDate.getTime() : null;
  const queueMs = startedDate ? startedDate.getTime() - new Date(job.created_at).getTime() : null;

  const handleCopyId = () => {
    navigator.clipboard.writeText(job.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKick = async () => {
    if (kicking) return;
    setKicking(true);
    try {
      const res = await fetch(`/api/agent-lab/context/jobs/${job.id}/kick`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.launched) {
        toast.success(
          <span>
            Fargate container launched.{' '}
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, opacity: 0.7 }}>
              {json.task_id?.slice(0, 12)}
            </span>
          </span>
        );
        setJobStatus('running');
      } else {
        toast.error(json.message ?? json.error ?? 'Failed to launch container');
      }
    } catch {
      toast.error('Network error — could not launch container');
    } finally {
      setKicking(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') router.back();
      if (e.key === 'l' || e.key === 'L') setActiveTab('logs');
      if (e.key === 'o' || e.key === 'O') setActiveTab('objects');
      if (e.key === 'c' || e.key === 'C') setActiveTab('config');
      if (e.key === 'g' || e.key === 'G') setActiveTab('overview');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  const tabs: { id: TabId; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={13} /> },
    { id: 'logs', label: 'Logs', icon: <Terminal size={13} />, badge: isLive ? 'live' : undefined },
    { id: 'objects', label: 'Objects', icon: <Database size={13} />, badge: objectCount !== null && objectCount > 0 ? objectCount : undefined },
    { id: 'config', label: 'Configuration', icon: <Settings size={13} /> },
  ];

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--background)' }}>
      {/* Page Header */}
      <div className="border-b shrink-0 z-30" style={{ backgroundColor: 'var(--card,#1c2128)', borderColor: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          {/* Top row: back + title */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <Link href="/agent-lab/estate/jobs"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono mt-0.5 shrink-0 transition-colors"
                style={{ color: '#8892A4', borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'transparent' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <ArrowLeft size={12} /> Jobs
              </Link>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="font-serif text-xl font-semibold" style={{ color: 'var(--estate-ink)', fontFamily: "'Source Serif 4', serif" }}>
                    Job Run
                  </h1>
                  <KindBadge kind={job.job_kind} />
                  <StatusChip status={jobStatus} />
                  {mapped === 'queued' && !(job.scope as any)?.fargate_task_id && (
                    <button
                      type="button"
                      onClick={handleKick}
                      disabled={kicking}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded border text-xs font-mono font-semibold uppercase tracking-wider transition-colors"
                      style={{
                        color: '#FDB515',
                        borderColor: kicking ? 'rgba(253,181,21,0.3)' : 'rgba(253,181,21,0.5)',
                        backgroundColor: kicking ? 'rgba(253,181,21,0.12)' : 'rgba(253,181,21,0.08)',
                        opacity: kicking ? 0.7 : 1,
                        cursor: kicking ? 'default' : 'pointer',
                      }}
                      title="Launch a Fargate container to execute this queued job"
                    >
                      {kicking
                        ? <><Loader2 size={11} className="animate-spin" /> Launching…</>
                        : <><Play size={11} /> Launch</>
                      }
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <button onClick={handleCopyId} className="flex items-center gap-1.5 font-mono text-xs hover:underline"
                    style={{ color: '#8892A4' }} title="Copy full ID">
                    {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                    {job.id.slice(0, 8)}…
                  </button>
                  {job.trigger && (
                    <span className="font-mono text-xs" style={{ color: '#8892A4' }}>
                      trigger: <span style={{ color: '#c9d1d9' }}>{job.trigger}</span>
                    </span>
                  )}
                  {runMs !== null && (
                    <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.08)', border: '1px solid rgba(253,181,21,0.2)' }}>
                      {formatDuration(runMs)}
                    </span>
                  )}
                  {queueMs !== null && queueMs > 0 && (
                    <span className="font-mono text-xs flex items-center gap-1" style={{ color: '#8892A4' }}>
                      <Clock size={10} /> queued {formatDuration(Math.max(0, queueMs))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex items-center gap-1 mt-4 -mb-px">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-1.5 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition-colors border-b-2"
                style={{
                  color: activeTab === tab.id ? '#FDB515' : '#8892A4',
                  borderBottomColor: activeTab === tab.id ? '#FDB515' : 'transparent',
                  backgroundColor: 'transparent',
                }}>
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                    style={{
                      backgroundColor: tab.badge === 'live' ? 'rgba(253,181,21,0.2)' : 'rgba(255,255,255,0.1)',
                      color: tab.badge === 'live' ? '#FDB515' : '#c9d1d9',
                    }}>
                    {tab.badge === 'live' ? '●' : tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content — flex-1 so it fills remaining height and scrolls */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <div className="max-w-7xl mx-auto">
          <div className="rounded-xl border mx-4 my-4" style={{ backgroundColor: 'var(--card,#1c2128)', borderColor: 'rgba(255,255,255,0.07)' }}>
          {activeTab === 'overview' && <OverviewTab job={job} onTabChange={setActiveTab} />}
          {activeTab === 'logs' && <LogsTab jobId={job.id} isLive={isLive} />}
          {activeTab === 'objects' && <ObjectsTab jobId={job.id} onCountChange={setObjectCount} />}
          {activeTab === 'config' && <ConfigTab job={job} />}
          </div>
        </div>

        {/* Keyboard hint footer */}
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <div className="flex items-center gap-4 font-mono text-[9px] uppercase tracking-wider" style={{ color: '#374151' }}>
            <span><kbd className="px-1 py-0.5 rounded border" style={{ borderColor: '#374151' }}>G</kbd> Overview</span>
            <span><kbd className="px-1 py-0.5 rounded border" style={{ borderColor: '#374151' }}>L</kbd> Logs</span>
            <span><kbd className="px-1 py-0.5 rounded border" style={{ borderColor: '#374151' }}>O</kbd> Objects</span>
            <span><kbd className="px-1 py-0.5 rounded border" style={{ borderColor: '#374151' }}>C</kbd> Config</span>
            <span><kbd className="px-1 py-0.5 rounded border" style={{ borderColor: '#374151' }}>Esc</kbd> Back</span>
          </div>
        </div>
      </div>
    </div>
  );
}
