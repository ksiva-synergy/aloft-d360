'use client';

import React, { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pagination, JobDetailDrawer, mapJobStatus, ScannedObjectsTab } from '@/components/estate';
import { useCatalogRefresh } from '@/components/estate/useCatalogRefresh';
import { HARVEST_SCHEDULES, relativeNextRun, getNextRun } from '@/lib/context/schedules';
import { toast } from 'sonner';

// ?? Types ??????????????????????????????????????????????????????????????????????

type ViewLevel = 'l1' | 'l2' | 'l3';
type ActiveTab = 'jobs' | 'scanned';

interface JobItem {
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
  // Auto-split fields
  parent_job_id?: string | null;
  child_index?: number | null;
}

interface ChildJob {
  id: string;
  job_kind: string;
  status: string;
  child_index: number | null;
  scope: any;
  stats: any;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface ChildCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  partial: number;
}

interface SplitPlanPreview {
  needsSplit: boolean;
  totalObjects: number;
  chunks: number;
  maxObjectsPerChunk: number;
  timeBudgetMinutes: number;
  estimatedWallClockMinutes: number;
  estimatedCostUsd: number;
  maxConcurrent: number;
}

interface KindSummary {
  kind: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  last_run_at: string | null;
  last_status: string | null;
}

interface DateGroup {
  date: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  total_duration_s: number | null;
}

interface QueuedJobItem {
  id: string;
  job_kind: string;
  trigger: string | null;
  scope: any;
  source_id: string | null;
  status: string;
  created_at: string;
}

// ?? Utilities ?????????????????????????????????????????????????????????????????

function relativeTime(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 0 || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function getDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '--';
  const diff = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (isNaN(diff) || diff < 0) return '--';
  if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s`;
  return `${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`;
}

function formatDurationS(s: number | null): string {
  if (s === null || s === undefined) return '--';
  if (s < 60) return `${s.toFixed(0)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatStatsSummary(stats: any): string {
  if (!stats || typeof stats !== 'object') return '--';
  const parts: string[] = [];
  if ('objects_swept' in stats) parts.push(`${stats.objects_swept} swept`);
  else if ('objects_profiled' in stats) parts.push(`${stats.objects_profiled} profiled`);
  else if ('objects_enriched' in stats) parts.push(`${stats.objects_enriched} enriched`);
  else if ('objects_synced' in stats) {
    parts.push(`${stats.objects_synced} synced`);
    if (stats.chunks_ingested) parts.push(`${stats.chunks_ingested} chunks`);
  } else if ('objects_mapped' in stats) parts.push(`${stats.objects_mapped} mapped`);
  else if ('mappings_proposed' in stats) parts.push(`${stats.mappings_proposed} mappings`);
  else if ('scanned_count' in stats) parts.push(`${stats.scanned_count} scanned`);
  else if ('inserted' in stats) {
    parts.push(`${stats.inserted} new`);
    if (stats.updated) parts.push(`${stats.updated} upd`);
    if (stats.removed) parts.push(`${stats.removed} rm`);
    if (stats.catalogs) parts.push(`${stats.catalogs} cat`);
  }
  else if ('objectsProcessed' in stats) {
    parts.push(`${stats.objectsProcessed} processed`);
    if (stats.snapshotsWritten) parts.push(`${stats.snapshotsWritten} snapshots`);
    if (stats.narrativesApplied) parts.push(`${stats.narrativesApplied} narratives`);
  }
  else if ('objects' in stats) parts.push(`${stats.objects} objects`);
  else if ('count' in stats) parts.push(`${stats.count} items`);
  if ('errors' in stats) {
    const n = Array.isArray(stats.errors) ? stats.errors.length : Number(stats.errors);
    if (n > 0) parts.push(`${n} err`);
  } else if ('error_count' in stats && Number(stats.error_count) > 0) {
    parts.push(`${stats.error_count} err`);
  }
  if (parts.length === 0) return '--';
  return parts.join(' | ');
}

// ?? Kind metadata ??????????????????????????????????????????????????????????????

function fmtScopeDate(d: string): string {
  try {
    return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return d; }
}

function ScopeSummary({ scope }: { scope: any }) {
  if (!scope || typeof scope !== 'object') return <span>--</span>;

  // Partition scope (auto-split child)
  if (scope.partition_catalog || scope.partition_schema) {
    return (
      <span className="truncate block font-mono text-[11px]" title={JSON.stringify(scope, null, 2)}
        style={{ color: '#FDB515' }}>
        {scope.partition_catalog}.{scope.partition_schema}
        {scope.partition_objects ? ` [${(scope.partition_objects as string[]).length} objs]` : ''}
      </span>
    );
  }

  // T3 usage — show scan window + fargate ID
  if (scope.since || scope.until) {
    const since = scope.since ? fmtScopeDate(scope.since) : '--';
    const until = scope.until ? fmtScopeDate(scope.until) : 'now';
    const taskId = scope.fargate_task_id as string | undefined;
    return (
      <span className="flex flex-col gap-0.5 font-mono text-[11px]" title={JSON.stringify(scope, null, 2)}>
        <span style={{ color: '#93C5FD' }}>{since}{" -> "}{until}</span>
        {taskId && <span style={{ color: '#8892A4' }}>{taskId.slice(0, 8)}...</span>}
      </span>
    );
  }

  const parts: string[] = [];
  if (scope.excludeSchemas && Array.isArray(scope.excludeSchemas)) {
    parts.push(`${scope.excludeSchemas.length} excluded`);
  }
  if (scope.path) parts.push(scope.path);
  if (scope.catalog) parts.push(scope.catalog);
  if (scope.schema) parts.push(`${scope.catalog ? '.' : ''}${scope.schema}`);

  const otherKeys = Object.keys(scope).filter(k => !['excludeSchemas', 'path', 'catalog', 'schema'].includes(k));
  otherKeys.forEach(k => {
    const v = scope[k];
    if (typeof v === 'string') parts.push(`${k}: ${v}`);
    else if (typeof v === 'number') parts.push(`${k}: ${v}`);
    else if (Array.isArray(v)) parts.push(`${k}: [${v.length}]`);
  });

  if (parts.length === 0) return <span title={JSON.stringify(scope)}>--</span>;

  return (
    <span className="truncate block" title={JSON.stringify(scope, null, 2)}>
      {parts.join(' | ')}
    </span>
  );
}

function ChildJobsPanel({ jobId, orgId }: { jobId: string; orgId: string }) {
  const [children, setChildren] = useState<ChildJob[]>([]);
  const [counts, setCounts] = useState<ChildCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/children`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setChildren(data.children ?? []);
          setCounts(data.counts ?? null);
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [jobId]);

  async function retryFailed() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/agent-lab/context/jobs/${jobId}/retry-failed`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        // Refresh
        const r2 = await fetch(`/api/agent-lab/context/jobs/${jobId}/children`);
        if (r2.ok) {
          const d2 = await r2.json();
          setChildren(d2.children ?? []);
          setCounts(d2.counts ?? null);
        }
      }
    } catch { /* ignore */ } finally {
      setRetrying(false);
    }
  }

  const statusColor: Record<string, string> = {
    queued: '#8892A4', running: '#FDB515', succeeded: '#2DD4A0', failed: '#EF4444', partial: '#F59E0B',
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4">
        <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin shrink-0" style={{ borderColor: '#FDB515', borderTopColor: 'transparent' }} />
        <span className="text-[11px] font-mono" style={{ color: '#8892A4' }}>Loading child jobs...</span>
      </div>
    );
  }

  if (children.length === 0) {
    return <div className="text-[11px] font-mono py-3 px-4" style={{ color: '#8892A4' }}>No child jobs found.</div>;
  }

  const failedCount = counts?.failed ?? 0;

  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'rgba(253,181,21,0.2)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'rgba(253,181,21,0.15)', backgroundColor: 'rgba(253,181,21,0.04)' }}>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="font-bold" style={{ color: '#FDB515' }}>{counts?.total ?? children.length} chunks</span>
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
            onClick={retryFailed}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#EF4444', backgroundColor: 'rgba(239,68,68,0.08)' }}
          >
            {retrying ? (
              <span className="w-2.5 h-2.5 border border-t-transparent rounded-full animate-spin" style={{ borderColor: '#EF4444', borderTopColor: 'transparent' }} />
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.3"/>
              </svg>
            )}
            Retry {failedCount} failed
          </button>
        )}
      </div>

      {/* Child rows */}
      <div className="max-h-64 overflow-y-auto divide-y" style={{ '--divide-color': 'rgba(255,255,255,0.04)' } as any}>
        {children.map(child => {
          const scope = child.scope as any ?? {};
          const partition = scope.partition_schema
            ? `${scope.partition_catalog ?? ''}.${scope.partition_schema}${scope.partition_objects ? ` [${(scope.partition_objects as string[]).length}]` : ''}`
            : `chunk ${(child.child_index ?? 0) + 1}`;

          const duration = child.started_at && child.finished_at
            ? Math.round((new Date(child.finished_at).getTime() - new Date(child.started_at).getTime()) / 1000)
            : null;

          return (
            <div key={child.id} className="flex items-center gap-3 px-4 py-2 text-[11px] font-mono">
              <span className="shrink-0 font-semibold tabular-nums w-6 text-right" style={{ color: '#8892A4' }}>
                {(child.child_index ?? 0) + 1}
              </span>
              <span className="flex-1 truncate" style={{ color: statusColor[child.status] ?? '#8892A4' }}>
                {partition}
              </span>
              <span className="shrink-0 uppercase font-bold" style={{ color: statusColor[child.status] ?? '#8892A4' }}>
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

interface KindMeta {
  label: string;
  description: string;
  color: string;
  bg: string;
  border: string;
  scheduleId?: string;
}

const KIND_META: Record<string, KindMeta> = {
  t0_structural: {
    label: 'T0 Structural',
    description: 'Discovers schema, columns and row counts',
    color: '#60A5FA',
    bg: 'rgba(96,165,250,0.08)',
    border: 'rgba(96,165,250,0.25)',
    scheduleId: 'change_detect_daily',
  },
  t1_profile: {
    label: 'T1 Profile',
    description: 'Statistical profiling of all columns',
    color: '#86EFAC',
    bg: 'rgba(134,239,172,0.08)',
    border: 'rgba(134,239,172,0.25)',
    scheduleId: 't1_profile_weekly',
  },
  t2_semantic: {
    label: 'T2 Semantic',
    description: 'AI-generated summaries and PII detection',
    color: '#C084FC',
    bg: 'rgba(192,132,252,0.08)',
    border: 'rgba(192,132,252,0.25)',
  },
  embed: {
    label: 'Embed',
    description: 'Vector embeddings for semantic search',
    color: '#818CF8',
    bg: 'rgba(129,140,248,0.08)',
    border: 'rgba(129,140,248,0.25)',
  },
  mapping: {
    label: 'Mapping',
    description: 'Cross-source column mapping proposals',
    color: '#FDB515',
    bg: 'rgba(253,181,21,0.08)',
    border: 'rgba(253,181,21,0.25)',
  },
  silo_scan: {
    label: 'Silo Scan',
    description: 'Full silo structure discovery',
    color: '#2DD4B4',
    bg: 'rgba(45,212,180,0.08)',
    border: 'rgba(45,212,180,0.25)',
  },
  t3_connected: {
    label: 'T3 Connected',
    description: 'Usage analysis and cross-object connections',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
  },
  knowledge_sync: {
    label: 'Knowledge Sync',
    description: 'Syncs knowledge base from data catalog',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.25)',
  },
  estate_inventory: {
    label: 'Estate Inventory',
    description: 'Full re-inventory of all Databricks objects via information_schema',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    scheduleId: 'estate_inventory_weekly',
  },
  t3_usage: {
    label: 'T3 Usage Harvest',
    description: 'Query history + lineage scan - maps key columns, filter patterns, and co-object relationships.',
    color: '#FDB515',
    bg: 'rgba(253,181,21,0.08)',
    border: 'rgba(253,181,21,0.25)',
    scheduleId: 't3_usage_weekly',
  },
  change_detect: {
    label: 'Change Detect',
    description: 'Detects changed objects since last sweep and enqueues T0',
    color: '#60A5FA',
    bg: 'rgba(96,165,250,0.08)',
    border: 'rgba(96,165,250,0.25)',
    scheduleId: 'change_detect_daily',
  },
  recompute_entity_tags: {
    label: 'Recompute Entity Tags',
    description: 'Recalculates entity tag assignments across mapped objects',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.25)',
  },
  t4_scan: {
    label: 'T4 Entity Scan',
    description: 'Fans out per-schema entity + dimension proposals via Bedrock',
    color: '#FB923C',
    bg: 'rgba(251,146,60,0.08)',
    border: 'rgba(251,146,60,0.25)',
  },
  t4_entity_propose: {
    label: 'T4 Entity Propose',
    description: 'LLM-proposed entity clusters for a single schema',
    color: '#FB923C',
    bg: 'rgba(251,146,60,0.08)',
    border: 'rgba(251,146,60,0.25)',
  },
  t4_dim_propose: {
    label: 'T4 Dim Propose',
    description: 'Proposes dimensions and measures for a single entity cluster',
    color: '#FB923C',
    bg: 'rgba(251,146,60,0.08)',
    border: 'rgba(251,146,60,0.25)',
  },
};

interface JobKindGroup {
  id: string;
  step: string;
  label: string;
  subtitle: string;
  kinds: string[];
}

/** Pipeline order: foundation → structural → enrichment → usage → knowledge */
const JOB_KIND_GROUPS: JobKindGroup[] = [
  {
    id: 'foundation',
    step: '01',
    label: 'Estate Foundation',
    subtitle: 'Catalog discovery & re-inventory',
    kinds: ['estate_inventory'],
  },
  {
    id: 'structural',
    step: '02',
    label: 'Structural Harvest',
    subtitle: 'T0 - schema, columns & change detection',
    kinds: ['t0_structural', 'change_detect'],
  },
  {
    id: 'enrichment',
    step: '03',
    label: 'Enrichment Pipeline',
    subtitle: 'T1 -> T2 -> embeddings',
    kinds: ['t1_profile', 't2_semantic', 'embed'],
  },
  {
    id: 'usage',
    step: '04',
    label: 'Usage & Connections',
    subtitle: 'T3 - query history & lineage',
    kinds: ['t3_connected', 't3_usage'],
  },
  {
    id: 'knowledge',
    step: '05',
    label: 'Knowledge & Mapping',
    subtitle: 'Cross-source links, silos & sync',
    kinds: ['mapping', 'silo_scan', 'knowledge_sync', 'recompute_entity_tags'],
  },
  {
    id: 'entity_model',
    step: '06',
    label: 'Entity Modelling',
    subtitle: 'T4 - entity + dimension proposals across estate',
    kinds: ['t4_scan', 't4_entity_propose', 't4_dim_propose'],
  },
];

const ALL_KINDS = JOB_KIND_GROUPS.flatMap(g => g.kinds);

function getJobKindGroups(extraKinds: string[] = []): JobKindGroup[] {
  const known = new Set(ALL_KINDS);
  const extras = [...new Set(extraKinds.filter(k => !known.has(k)))].sort();
  if (extras.length === 0) return JOB_KIND_GROUPS;
  return [
    ...JOB_KIND_GROUPS,
    {
      id: 'other',
      step: '--',
      label: 'Other Jobs',
      subtitle: 'Custom or legacy job types',
      kinds: extras,
    },
  ];
}

function getKindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? {
    label: kind,
    description: 'Custom job type',
    color: '#8892A4',
    bg: 'rgba(136,146,164,0.08)',
    border: 'rgba(136,146,164,0.25)',
  };
}

function KindBadge({ kind, small }: { kind: string; small?: boolean }) {
  const m = getKindMeta(kind);
  return (
    <span
      className={`inline-flex items-center rounded border font-mono font-semibold uppercase tracking-wider ${small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}
      style={{ color: m.color, backgroundColor: m.bg, borderColor: m.border }}
    >
      {m.label}
    </span>
  );
}

// ── Run Job Button ────────────────────────────────────────────────────────────

const TRIGGERABLE_JOBS: { kind: string; label: string; description: string; scope: string; warning?: string }[] = [
  { kind: 'estate_inventory', label: 'Estate Inventory', description: 'Full re-inventory via information_schema', scope: 'Queries information_schema to discover all catalogs, schemas, and objects' },
  { kind: 't0_structural', label: 'T0 Structural', description: 'Discover schema, columns, row counts', scope: 'All active objects in the primary source' },
  { kind: 'change_detect', label: 'Change Detect', description: 'Detect changed objects since last sweep', scope: 'Compares current state to last sweep - enqueues T0 for changed objects' },
  { kind: 't1_profile', label: 'T1 Profile', description: 'Statistical profiling of all columns', scope: 'All active objects - runs DESCRIBE and sample queries on each table' },
  { kind: 't2_semantic', label: 'T2 Semantic', description: 'AI summaries and PII detection', scope: 'All active objects - calls LLM for enrichment (incurs API cost)', warning: 'This job calls an LLM and incurs token costs.' },
  { kind: 'embed', label: 'Embed', description: 'Compute vector embeddings', scope: 'All enriched objects - generates embeddings for semantic search', warning: 'Not yet implemented in the orchestrator.' },
  { kind: 't3_connected', label: 'T3 Connected', description: 'Usage analysis and cross-object connections', scope: 'All embedded objects - stamps last_t3_at' },
  { kind: 't3_usage', label: 'T3 Usage Harvest', description: 'Query history + lineage scan', scope: 'Scans up to 30 days of query history and lineage tables', warning: 'Scans up to 30 days of query history and lineage tables. Typical duration: 2-5 min.' },
  { kind: 'mapping', label: 'Mapping', description: 'Cross-source column mapping', scope: 'Cross-source analysis of all profiled columns', warning: 'Not yet implemented in the orchestrator.' },
  { kind: 'silo_scan', label: 'Silo Scan', description: 'Full silo structure discovery', scope: 'All objects - identifies data silos and relationships' },
  { kind: 'knowledge_sync', label: 'Knowledge Sync', description: 'Sync knowledge base from catalog', scope: 'Syncs all enriched metadata into the knowledge base' },
  { kind: 'recompute_entity_tags', label: 'Recompute Entity Tags', description: 'Recompute entity tag assignments', scope: 'Recalculates entity tags across all mapped objects' },
  { kind: 't4_scan', label: 'T4 Entity Scan', description: 'Fan-out entity + dimension proposals across all schemas', scope: 'All 38 schemas - spawns per-schema t4_entity_propose children, each fanning into t4_dim_propose; incremental via last_t4_at', warning: 'Calls Bedrock Sonnet for every unenriched table. ~$0.003/table - confirm scope before launching.' },
];

const TRIGGERABLE_BY_KIND = Object.fromEntries(TRIGGERABLE_JOBS.map(j => [j.kind, j]));

function getTriggerableJobGroups() {
  return JOB_KIND_GROUPS
    .map(group => ({
      group,
      jobs: group.kinds.map(k => TRIGGERABLE_BY_KIND[k]).filter((j): j is (typeof TRIGGERABLE_JOBS)[number] => Boolean(j)),
    }))
    .filter(g => g.jobs.length > 0);
}

interface ConfirmState {
  kinds: string[];
  objectCount: number | null;
  sourceName: string | null;
  loading: boolean;
  tree: CatalogTree[] | null;
  excludeSchemas: Set<string>; // "catalog.schema"
  includePatterns: string;     // comma/newline-separated glob patterns, empty = full scope
  sequential: boolean;         // chain T0→T1→T2 in order rather than launching all at once
}

interface CatalogTree {
  catalog: string;
  count: number;
  schemas: { name: string; count: number }[];
}

function RunJobConfirmModal({
  confirm,
  splitPlans,
  splitPlansLoading,
  onCancel,
  onConfirm,
  onToggleSchema,
  onChangeIncludePatterns,
  onToggleSequential,
  submitting,
}: {
  confirm: ConfirmState;
  splitPlans: Partial<Record<string, SplitPlanPreview>>;
  splitPlansLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onToggleSchema: (key: string) => void;
  onChangeIncludePatterns: (val: string) => void;
  onToggleSequential: () => void;
  submitting: boolean;
}) {
  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set());

  const warnings = confirm.kinds
    .map(k => TRIGGERABLE_JOBS.find(j => j.kind === k)?.warning)
    .filter(Boolean) as string[];

  const includedCount = confirm.tree
    ? confirm.tree.reduce((sum, cat) => {
        return sum + cat.schemas.reduce((s2, sch) => {
          const key = `${cat.catalog}.${sch.name}`;
          return confirm.excludeSchemas.has(key) ? s2 : s2 + sch.count;
        }, 0);
      }, 0)
    : confirm.objectCount;

  // Derive the dominant split plan (first splittable kind)
  const splittableKinds = ['t2_semantic', 't1_profile', 't0_structural'];
  const dominantSplitKind = confirm.kinds.find(k => splittableKinds.includes(k));
  const activePlan = dominantSplitKind ? splitPlans[dominantSplitKind] : undefined;

  function toggleCatalog(catalog: string) {
    setExpandedCatalogs(prev => {
      const next = new Set(prev);
      if (next.has(catalog)) next.delete(catalog);
      else next.add(catalog);
      return next;
    });
  }

  function toggleAllSchemas(cat: CatalogTree) {
    const allExcluded = cat.schemas.every(s => confirm.excludeSchemas.has(`${cat.catalog}.${s.name}`));
    cat.schemas.forEach(s => {
      const key = `${cat.catalog}.${s.name}`;
      if (allExcluded ? confirm.excludeSchemas.has(key) : !confirm.excludeSchemas.has(key)) {
        onToggleSchema(key);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative w-full max-w-2xl mx-4 rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--card, #131d2a)', borderColor: 'rgba(253,181,21,0.3)' }}
      >
        {/* Header */}
        <div className="px-7 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border, rgba(255,255,255,0.06))' }}>
          <div className="text-xs font-mono font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-secondary, #8892A4)' }}>
            Launching {confirm.kinds.length} job type{confirm.kinds.length !== 1 ? 's' : ''} on Fargate
          </div>
          <div className="flex flex-wrap gap-2">
            {confirm.kinds.map(k => <KindBadge key={k} kind={k} />)}
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-5 space-y-5 max-h-[60vh] overflow-y-auto">

          {/* Scope */}
          <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', backgroundColor: 'var(--muted, rgba(0,0,0,0.2))' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FDB515" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                  Scope{" - "}click schemas to exclude
                </span>
              </div>
              {confirm.excludeSchemas.size > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: '#EF4444', backgroundColor: 'rgba(239,68,68,0.1)' }}>
                  {confirm.excludeSchemas.size} excluded
                </span>
              )}
            </div>

            {confirm.loading ? (
              <div className="flex items-center gap-2.5 pt-2">
                <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#FDB515', borderTopColor: 'transparent' }} />
                <span className="text-xs font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>Loading estate structure...</span>
              </div>
            ) : (
              <>
                {/* Summary stats */}
                <div className="flex flex-wrap gap-5 pt-2 pb-3 border-b" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
                  {confirm.sourceName && (
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #8892A4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                      </svg>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>Source:</span>
                      <span className="text-[13px] font-mono font-semibold" style={{ color: 'var(--text-primary, #e8ecf0)' }}>{confirm.sourceName}</span>
                    </div>
                  )}
                  {includedCount !== null && (
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FDB515" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                      </svg>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>Objects in scope:</span>
                      <span className="text-[13px] font-mono font-bold" style={{ color: '#FDB515' }}>{includedCount.toLocaleString()}</span>
                      {confirm.excludeSchemas.size > 0 && confirm.objectCount !== null && (
                        <span className="text-[11px] font-mono" style={{ color: '#EF4444' }}>
                          ({"-"}{(confirm.objectCount - (includedCount ?? 0)).toLocaleString()} excluded)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Interactive tree */}
                {confirm.tree && confirm.tree.length > 0 && (
                  <div className="max-h-52 overflow-y-auto space-y-0.5 pt-2">
                    {confirm.tree.map(cat => {
                      const isExpanded = expandedCatalogs.has(cat.catalog);
                      const allSchemasExcluded = cat.schemas.length > 0 && cat.schemas.every(s => confirm.excludeSchemas.has(`${cat.catalog}.${s.name}`));
                      const someSchemasExcluded = cat.schemas.some(s => confirm.excludeSchemas.has(`${cat.catalog}.${s.name}`));
                      return (
                        <div key={cat.catalog}>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => toggleCatalog(cat.catalog)}
                              className="flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-left"
                              style={{ opacity: allSchemasExcluded ? 0.4 : 1 }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #8892A4)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                className={`transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                                <polyline points="9 18 15 12 9 6"/>
                              </svg>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FDB515" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                              </svg>
                              <span className={`text-[13px] font-mono font-semibold flex-1 truncate ${allSchemasExcluded ? 'line-through' : ''}`} style={{ color: 'var(--text-primary, #e8ecf0)' }}>
                                {cat.catalog}
                              </span>
                              <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.1)' }}>
                                {cat.count.toLocaleString()}
                              </span>
                              {someSchemasExcluded && !allSchemasExcluded && (
                                <span className="text-[10px] font-mono" style={{ color: '#F59E0B' }}>partial</span>
                              )}
                            </button>
                            <button
                              onClick={() => toggleAllSchemas(cat)}
                              title={allSchemasExcluded ? 'Include all schemas' : 'Exclude all schemas'}
                              className="px-2 py-1.5 rounded text-[10px] font-mono font-semibold transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                              style={{ color: allSchemasExcluded ? '#2DD4A0' : '#EF4444' }}
                            >
                              {allSchemasExcluded ? 'include all' : 'exclude all'}
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="ml-8 pl-3.5 border-l" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
                              {cat.schemas.map(sch => {
                                const key = `${cat.catalog}.${sch.name}`;
                                const excluded = confirm.excludeSchemas.has(key);
                                return (
                                  <button
                                    key={sch.name}
                                    onClick={() => onToggleSchema(key)}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-left group"
                                    style={{ opacity: excluded ? 0.45 : 1 }}
                                  >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${excluded ? 'border-red-500/60 bg-red-500/10' : 'border-gray-400 dark:border-white/20 bg-gray-100 dark:bg-white/5 group-hover:border-gray-500 dark:group-hover:border-white/40'}`}>
                                      {excluded ? (
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                        </svg>
                                      ) : (
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                      )}
                                    </div>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #8892A4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                    </svg>
                                    <span className={`text-xs font-mono flex-1 truncate ${excluded ? 'line-through' : ''}`} style={{ color: excluded ? 'var(--text-tertiary, #8892A4)' : 'var(--text-primary, #b0b8c4)' }}>
                                      {sch.name}
                                    </span>
                                    <span className="text-xs font-mono font-medium" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                                      {sch.count.toLocaleString()}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2.5 px-4 py-3 rounded-lg border"
                  style={{ borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.06)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <span className="text-xs leading-relaxed" style={{ color: '#F59E0B' }}>{w}</span>
                </div>
              ))}
            </div>
          )}

          {confirm.excludeSchemas.size > 0 && (
            <div className="text-[11px] font-mono px-1" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
              Excluded schemas are passed as job scope{" - "}the harvester filters them at runtime.
            </div>
          )}

          {/* Auto-split preview — replaces the old "Scope too large" blockers */}
          {(splitPlansLoading || activePlan) && (
            <div className="rounded-lg border p-4 space-y-3"
              style={{ borderColor: activePlan?.needsSplit ? 'rgba(253,181,21,0.4)' : 'rgba(45,212,160,0.3)', backgroundColor: activePlan?.needsSplit ? 'rgba(253,181,21,0.04)' : 'rgba(45,212,160,0.04)' }}>
              <div className="flex items-center gap-2.5">
                {splitPlansLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin shrink-0" style={{ borderColor: '#FDB515', borderTopColor: 'transparent' }} />
                ) : activePlan?.needsSplit ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FDB515" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2DD4A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest" style={{ color: splitPlansLoading ? '#FDB515' : activePlan?.needsSplit ? '#FDB515' : '#2DD4A0' }}>
                  {splitPlansLoading ? 'Calculating split plan...' : activePlan?.needsSplit ? 'Auto-split enabled' : 'Fits in a single job'}
                </span>
              </div>

              {!splitPlansLoading && activePlan?.needsSplit && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 pl-1 pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-mono font-bold" style={{ color: '#FDB515' }}>{activePlan.chunks}</span>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>chunks ({activePlan.maxObjectsPerChunk} obj each)</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-mono font-bold" style={{ color: '#e8ecf0' }}>{activePlan.timeBudgetMinutes} min</span>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>budget per chunk</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-mono font-bold" style={{ color: '#93C5FD' }}>~{activePlan.estimatedWallClockMinutes} min</span>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>wall-clock ({activePlan.maxConcurrent} concurrent)</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-mono font-bold" style={{ color: activePlan.estimatedCostUsd > 0 ? '#F59E0B' : '#2DD4A0' }}>
                      {activePlan.estimatedCostUsd > 0 ? `~$${activePlan.estimatedCostUsd.toFixed(2)}` : '$0'}
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>est. LLM cost</span>
                  </div>
                </div>
              )}

              {!splitPlansLoading && activePlan?.needsSplit && (
                <div className="text-[10px] font-mono pt-1" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  {activePlan.chunks} Fargate tasks will be queued{" | "}{activePlan.maxConcurrent}{" run simultaneously | "}remainder queued and launched as tasks complete
                </div>
              )}
            </div>
          )}

          {/* Focus / include patterns */}
          <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', backgroundColor: 'var(--muted, rgba(0,0,0,0.15))' }}>
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FDB515" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
              <span className="text-[11px] font-mono font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                Focus{" - "}limit to specific tables (optional)
              </span>
            </div>
            <textarea
              rows={2}
              placeholder={'catalog.schema.table\ncatalog.schema.*'}
              value={confirm.includePatterns}
              onChange={e => onChangeIncludePatterns(e.target.value)}
              className="w-full rounded border px-3 py-2 text-xs font-mono resize-none outline-none focus:ring-1"
              style={{
                backgroundColor: 'var(--bg, rgba(0,0,0,0.3))',
                borderColor: 'rgba(255,255,255,0.1)',
                color: 'var(--text-primary, #e8ecf0)',
                // @ts-ignore
                '--tw-ring-color': '#FDB515',
              }}
            />
            <p className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
              One pattern per line or comma-separated. Supports <code className="opacity-70">*</code> wildcards. Leave empty to use full source scope.
            </p>
          </div>

          {/* Sequential toggle — shown when multiple kinds selected */}
          {confirm.kinds.length > 1 && (
            <div className="flex items-center justify-between rounded-lg border px-4 py-3"
              style={{ borderColor: confirm.sequential ? 'rgba(253,181,21,0.4)' : 'var(--border, rgba(255,255,255,0.08))', backgroundColor: confirm.sequential ? 'rgba(253,181,21,0.05)' : 'var(--muted, rgba(0,0,0,0.15))' }}>
              <div>
                <div className="text-xs font-mono font-semibold" style={{ color: confirm.sequential ? '#FDB515' : 'var(--text-primary, #e8ecf0)' }}>
                  Run sequentially (T0{" -> "}T1{" -> "}T2)
                </div>
                <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  {confirm.sequential
                    ? 'Each stage waits for the previous to complete before launching'
                    : 'All job types launch simultaneously as independent containers'}
                </div>
              </div>
              <button
                onClick={onToggleSequential}
                className="relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200"
                style={{ backgroundColor: confirm.sequential ? '#FDB515' : 'rgba(255,255,255,0.15)' }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: confirm.sequential ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-5 flex items-center justify-between border-t" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
          <div className="text-xs font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>
            {confirm.includePatterns.trim()
              ? 'Focused scope'
              : confirm.excludeSchemas.size > 0
                ? `${confirm.excludeSchemas.size} schema${confirm.excludeSchemas.size !== 1 ? 's' : ''} excluded`
                : 'Full source scope'}
            {confirm.kinds.length > 1 && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ backgroundColor: confirm.sequential ? 'rgba(253,181,21,0.15)' : 'rgba(255,255,255,0.08)', color: confirm.sequential ? '#FDB515' : 'var(--text-tertiary, #8892A4)' }}>
                {confirm.sequential ? 'sequential' : 'parallel'}
              </span>
            )}
            {activePlan?.needsSplit && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ backgroundColor: 'rgba(253,181,21,0.15)', color: '#FDB515' }}>
                {activePlan.chunks} chunks
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onCancel} disabled={submitting}
              className="px-5 py-2.5 rounded-lg border text-sm font-mono font-semibold transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ borderColor: 'var(--border, rgba(255,255,255,0.12))', color: 'var(--text-primary, #b0b8c4)' }}>
              Cancel
            </button>
            <button onClick={onConfirm} disabled={submitting || confirm.loading}
              className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-lg border text-sm font-mono font-bold uppercase tracking-wider transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#FDB515', color: '#0D1B2A', borderColor: '#FDB515' }}>
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0D1B2A', borderTopColor: 'transparent' }} />
                  Launching...
                </>
              ) : activePlan?.needsSplit ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                  Launch {activePlan.chunks} chunks on Fargate
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Launch {confirm.kinds.length} job{confirm.kinds.length !== 1 ? 's' : ''} on Fargate
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunJobButton({ onJobQueued }: { onJobQueued: () => void }) {
  const [open, setOpen] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [splitPlans, setSplitPlans] = useState<Partial<Record<string, SplitPlanPreview>>>({});
  const [splitPlansLoading, setSplitPlansLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const splitPlanRequestRef = useRef(0);
  const activeSplitPlanScopeRef = useRef<string | null>(null);
  const splitPlanAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function toggleKind(kind: string) {
    setSelectedKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }

  const refreshSplitPlans = useCallback(async (
    scopeKey: string,
    kinds: string[],
    excludeSchemas: Set<string>,
    includePatterns: string,
    signal: AbortSignal,
  ) => {
    const splittableKinds = ['t0_structural', 't1_profile', 't2_semantic'];
    const kindsToCheck = kinds.filter(k => splittableKinds.includes(k));
    if (kindsToCheck.length === 0) {
      if (!signal.aborted) {
        setSplitPlans({});
        setSplitPlansLoading(false);
      }
      return;
    }

    const requestId = ++splitPlanRequestRef.current;
    if (!signal.aborted) setSplitPlansLoading(true);

    const excludeArr = Array.from(excludeSchemas);
    const includeArr = includePatterns
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);

    const plans = await Promise.all(
      kindsToCheck.map(async (kind) => {
        try {
          const res = await fetch('/api/agent-lab/context/jobs/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, excludeSchemas: excludeArr, includePatterns: includeArr }),
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            return { kind, plan: data as SplitPlanPreview };
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return { kind, plan: null };
        }
        return { kind, plan: null };
      }),
    );

    if (signal.aborted || requestId !== splitPlanRequestRef.current || activeSplitPlanScopeRef.current !== scopeKey) return;

    const nextPlans: Partial<Record<string, SplitPlanPreview>> = {};
    for (const { kind, plan } of plans) {
      if (plan) nextPlans[kind] = plan;
    }
    setSplitPlans(nextPlans);
    setSplitPlansLoading(false);
  }, []);

  const splitPlanScopeKey = confirm && !confirm.loading
    ? `${confirm.kinds.join(',')}|${Array.from(confirm.excludeSchemas).sort().join('|')}|${confirm.includePatterns}`
    : null;

  useEffect(() => {
    if (!splitPlanScopeKey || !confirm || confirm.loading) return;
    if (activeSplitPlanScopeRef.current === splitPlanScopeKey) return;

    const scopeKey = splitPlanScopeKey;
    const { kinds, excludeSchemas, includePatterns } = confirm;
    const debounceMs = includePatterns.trim() ? 400 : 0;

    const timer = setTimeout(() => {
      activeSplitPlanScopeRef.current = scopeKey;
      splitPlanAbortRef.current?.abort();
      const ac = new AbortController();
      splitPlanAbortRef.current = ac;
      refreshSplitPlans(scopeKey, kinds, excludeSchemas, includePatterns, ac.signal);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [splitPlanScopeKey, refreshSplitPlans]);

  function closeConfirm() {
    splitPlanRequestRef.current++;
    splitPlanAbortRef.current?.abort();
    splitPlanAbortRef.current = null;
    activeSplitPlanScopeRef.current = null;
    setSplitPlans({});
    setSplitPlansLoading(false);
    setConfirm(null);
  }

  async function openConfirmation() {
    setOpen(false);
    activeSplitPlanScopeRef.current = null;
    setSplitPlans({});
    setSplitPlansLoading(false);
    setConfirm({
      kinds: Array.from(selectedKinds),
      objectCount: null,
      sourceName: null,
      loading: true,
      tree: null,
      excludeSchemas: new Set(),
      includePatterns: '',
      sequential: Array.from(selectedKinds).length > 1,
    });
    try {
      const [sourcesRes, facetsRes] = await Promise.all([
        fetch('/api/agent-lab/context/sources'),
        fetch('/api/agent-lab/context/estate/facets'),
      ]);
      let sourceName: string | null = null;
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        const source = data.sources?.[0];
        sourceName = source?.display_name ?? source?.connection_kind ?? null;
      }
      let objectCount: number | null = null;
      let tree: CatalogTree[] | null = null;
      if (facetsRes.ok) {
        const facets = await facetsRes.json();
        const catalogs: { name: string; count: number }[] = facets.catalogs ?? [];
        const schemas: { catalog: string; name: string; count: number }[] = facets.schemas ?? [];
        objectCount = catalogs.reduce((sum, c) => sum + c.count, 0);
        tree = catalogs.map(cat => ({
          catalog: cat.name,
          count: cat.count,
          schemas: schemas.filter(s => s.catalog === cat.name).map(s => ({ name: s.name, count: s.count })),
        }));
      }
      // Auto-exclude large estate catalogs only for T0 / estate_inventory runs.
      // T1/T2 operate on already-harvested context objects — auto-excluding curated_db
      // (1200+ estate rows) would filter out all 314 harvested tables and profile nothing.
      const autoExclude = new Set<string>();
      const kindsArray = Array.from(selectedKinds);
      const needsEstateScope =
        kindsArray.includes('t0_structural') || kindsArray.includes('estate_inventory');
      if (tree && needsEstateScope) {
        // Only auto-exclude very large catalogs (landing_zone ~13k). curated_db (~1200)
        // must stay included — the old 1000 threshold excluded the entire harvest target.
        const AUTO_EXCLUDE_CATALOG_MIN = 5000;
        for (const cat of tree) {
          if (cat.count > AUTO_EXCLUDE_CATALOG_MIN) {
            for (const sch of cat.schemas) {
              autoExclude.add(`${cat.catalog}.${sch.name}`);
            }
          }
        }
      }
      setConfirm(prev => prev ? { ...prev, objectCount, sourceName, tree, excludeSchemas: autoExclude, loading: false } : null);
    } catch {
      setConfirm(prev => prev ? { ...prev, loading: false } : null);
    }
  }

  function toggleSchema(key: string) {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => {
      if (!prev) return null;
      const next = new Set(prev.excludeSchemas);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, excludeSchemas: next };
    });
  }

  function changeIncludePatterns(val: string) {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => prev ? { ...prev, includePatterns: val } : null);
  }

  function toggleSequential() {
    setConfirm(prev => prev ? { ...prev, sequential: !prev.sequential } : null);
  }

  async function triggerJob() {
    if (!confirm) return;
    setSubmitting(true);
    try {
      const includePatterns = confirm.includePatterns
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: confirm.kinds,
          excludeSchemas: Array.from(confirm.excludeSchemas),
          includePatterns,
          sequential: confirm.sequential,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const modeLabel = confirm.sequential ? 'sequential' : 'parallel';
        const hasSplit = data.split_summaries && data.split_summaries.length > 0;
        if (hasSplit) {
          const total = data.split_summaries.reduce((s: number, ss: any) => s + ss.totalChildren, 0);
          toast.success(`Auto-split: ${total} Fargate tasks launched`, {
            description: `${data.split_summaries.map((ss: any) => `${ss.kind}: ${ss.totalChildren} chunks`).join(' | ')} | ${modeLabel}`,
          });
        } else {
          toast.success(`Launched ${confirm.kinds.length} job type${confirm.kinds.length !== 1 ? 's' : ''} on Fargate`, {
            description: `${data.jobs_enqueued} job(s) enqueued | ${data.task_arns?.length ?? 0} container(s) started | ${modeLabel}`,
          });
        }
        setSelectedKinds(new Set());
        onJobQueued();
        closeConfirm();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('Failed to launch', { description: err.error ?? res.statusText });
      }
    } catch {
      toast.error('Network error', { description: 'Could not reach the server.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded border text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
          style={{ backgroundColor: '#FDB515', color: '#0D1B2A', borderColor: '#FDB515' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Run Job
          {selectedKinds.size > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: '#0D1B2A', color: '#FDB515' }}>
              {selectedKinds.size}
            </span>
          )}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-2 w-[440px] rounded-xl border shadow-xl z-50 overflow-hidden"
            style={{ backgroundColor: 'var(--card, #1a2332)', borderColor: 'rgba(253,181,21,0.3)' }}
          >
            {/* Panel header */}
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(253,181,21,0.15)' }}>
              <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: '#FDB515' }}>
                Select job types to run
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedKinds(new Set(TRIGGERABLE_JOBS.map(j => j.kind)))}
                  className="text-[10px] font-mono font-medium hover:underline" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  all
                </button>
                <span style={{ color: 'var(--text-tertiary, #8892A4)' }}>|</span>
                <button onClick={() => setSelectedKinds(new Set())}
                  className="text-[10px] font-mono font-medium hover:underline" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  none
                </button>
              </div>
            </div>

            {/* Checklist — grouped by pipeline stage */}
            <div className="max-h-[420px] overflow-y-auto py-1">
              {(() => {
                const triggerableGroups = getTriggerableJobGroups();
                return triggerableGroups.map(({ group, jobs }, groupIdx) => (
                  <div key={group.id}>
                    <div
                      className="sticky top-0 z-10 px-4 py-2 flex items-center gap-2 border-b"
                      style={{
                        borderColor: 'rgba(253,181,21,0.12)',
                        backgroundColor: 'var(--card, #1a2332)',
                      }}
                    >
                      <span
                        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[9px] font-mono font-bold"
                        style={{ color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.1)' }}
                      >
                        {group.step}
                      </span>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                        {group.label}
                      </span>
                    </div>
                    {jobs.map((job, jobIdx) => {
                      const meta = getKindMeta(job.kind);
                      const checked = selectedKinds.has(job.kind);
                      const isLastInGroup = jobIdx === jobs.length - 1;
                      const isLastGroup = groupIdx === triggerableGroups.length - 1;
                      return (
                        <button
                          key={job.kind}
                          onClick={() => toggleKind(job.kind)}
                          className="w-full text-left px-4 py-3 flex items-center gap-3.5 transition-colors border-b"
                          style={{
                            borderColor: isLastInGroup && isLastGroup ? 'transparent' : 'var(--border, rgba(255,255,255,0.05))',
                            backgroundColor: checked ? `${meta.color}10` : 'transparent',
                          }}
                          onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--muted, rgba(255,255,255,0.04))'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = checked ? `${meta.color}10` : 'transparent'; }}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all`}
                            style={{
                              borderColor: checked ? meta.color : 'var(--border, rgba(255,255,255,0.2))',
                              backgroundColor: checked ? meta.color : 'transparent',
                            }}>
                            {checked && (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0D1B2A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </div>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-mono font-semibold" style={{ color: checked ? meta.color : 'var(--text-primary, #e8ecf0)' }}>
                              {job.label}
                            </div>
                            <div className="text-xs mt-0.5 leading-relaxed truncate" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                              {job.description}
                            </div>
                          </div>
                          {job.warning && (
                            <span className="shrink-0" title={job.warning}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                              </svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>

            {/* Panel footer */}
            <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
              <span className="text-xs font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                {selectedKinds.size === 0 ? 'Select at least one job type' : `${selectedKinds.size} selected`}
              </span>
              <button
                disabled={selectedKinds.size === 0}
                onClick={openConfirmation}
                className="inline-flex items-center gap-2 px-4 py-2 rounded border text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#FDB515', color: '#0D1B2A', borderColor: '#FDB515' }}
              >
                Review {selectedKinds.size > 0 ? `${selectedKinds.size} ` : ''}job{selectedKinds.size !== 1 ? 's' : ''}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <RunJobConfirmModal
          confirm={confirm}
          splitPlans={splitPlans}
          splitPlansLoading={splitPlansLoading}
          onCancel={closeConfirm}
          onConfirm={triggerJob}
          onToggleSchema={toggleSchema}
          onChangeIncludePatterns={changeIncludePatterns}
          onToggleSequential={toggleSequential}
          submitting={submitting}
        />
      )}
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  const isOrchestrating = status === 'orchestrating';
  const mapped = isOrchestrating ? 'orchestrating' : mapJobStatus(status);
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    queued:         { color: '#8892A4', bg: 'rgba(136,146,164,0.08)', border: 'rgba(136,146,164,0.25)' },
    running:        { color: '#FDB515', bg: 'rgba(253,181,21,0.08)',  border: 'rgba(253,181,21,0.3)'   },
    done:           { color: '#2DD4A0', bg: 'rgba(45,212,160,0.08)',  border: 'rgba(45,212,160,0.25)'  },
    failed:         { color: '#EF4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)'   },
    orchestrating:  { color: '#93C5FD', bg: 'rgba(147,197,253,0.08)', border: 'rgba(147,197,253,0.3)'  },
  };
  const s = styles[mapped] ?? styles.queued;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono uppercase tracking-wider"
      style={{ color: s.color, backgroundColor: s.bg, borderColor: s.border }}
    >
      {(mapped === 'running' || mapped === 'orchestrating') && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75`} style={{ backgroundColor: s.color }} />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: s.color }} />
        </span>
      )}
      {mapped}
    </span>
  );
}

// ?? L1: Kind Summary Cards ?????????????????????????????????????????????????????

function SuccessRing({ rate, size = 36, stroke = 3, color }: { rate: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (rate / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" className="transition-all duration-700" />
    </svg>
  );
}

function AggregateStats({ summaries }: { summaries: KindSummary[] }) {
  const totalRuns = summaries.reduce((s, k) => s + k.total, 0);
  const totalSuccess = summaries.reduce((s, k) => s + k.succeeded, 0);
  const totalFailed = summaries.reduce((s, k) => s + k.failed, 0);
  const totalRunning = summaries.reduce((s, k) => s + k.running, 0);
  const totalQueued = summaries.reduce((s, k) => s + k.queued, 0);
  const overallRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0;
  const rateColor = overallRate >= 90 ? '#2DD4A0' : overallRate >= 70 ? '#FDB515' : '#EF4444';
  const activeKinds = summaries.filter(s => s.total > 0).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
      <div className="flex items-center gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'var(--estate-raised)' }}>
        <SuccessRing rate={overallRate} color={rateColor} />
        <div>
          <div className="text-lg font-mono font-bold" style={{ color: rateColor }}>{overallRate}%</div>
          <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--estate-text-muted)' }}>Success</div>
        </div>
      </div>
      <div className="flex flex-col justify-center rounded-lg border px-4 py-3"
        style={{ borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'var(--estate-raised)' }}>
        <div className="text-lg font-mono font-bold" style={{ color: 'var(--estate-ink)' }}>{totalRuns.toLocaleString()}</div>
        <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--estate-text-muted)' }}>Total Runs</div>
      </div>
      <div className="flex flex-col justify-center rounded-lg border px-4 py-3"
        style={{ borderColor: 'rgba(45,212,160,0.15)', backgroundColor: 'rgba(45,212,160,0.04)' }}>
        <div className="text-lg font-mono font-bold" style={{ color: '#2DD4A0' }}>{totalSuccess.toLocaleString()}</div>
        <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--estate-text-muted)' }}>Succeeded</div>
      </div>
      <div className="flex flex-col justify-center rounded-lg border px-4 py-3"
        style={{ borderColor: totalFailed > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)', backgroundColor: totalFailed > 0 ? 'rgba(239,68,68,0.04)' : 'var(--estate-raised)' }}>
        <div className="text-lg font-mono font-bold" style={{ color: totalFailed > 0 ? '#EF4444' : 'var(--estate-text-muted)' }}>{totalFailed}</div>
        <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--estate-text-muted)' }}>Failed</div>
      </div>
      <div className="flex flex-col justify-center rounded-lg border px-4 py-3"
        style={{ borderColor: totalRunning > 0 ? 'rgba(253,181,21,0.2)' : 'rgba(255,255,255,0.06)', backgroundColor: totalRunning > 0 ? 'rgba(253,181,21,0.04)' : 'var(--estate-raised)' }}>
        <div className="flex items-center gap-2">
          {totalRunning > 0 && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FDB515] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FDB515]" />
            </span>
          )}
          <span className="text-lg font-mono font-bold" style={{ color: totalRunning > 0 ? '#FDB515' : 'var(--estate-text-muted)' }}>{totalRunning + totalQueued}</span>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--estate-text-muted)' }}>Active</div>
      </div>
      <div className="flex flex-col justify-center rounded-lg border px-4 py-3"
        style={{ borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'var(--estate-raised)' }}>
        <div className="text-lg font-mono font-bold" style={{ color: 'var(--estate-ink)' }}>{activeKinds}/{ALL_KINDS.length}</div>
        <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--estate-text-muted)' }}>Job Types</div>
      </div>
    </div>
  );
}

function JobKindGroupHeader({ group, isFirst }: { group: JobKindGroup; isFirst?: boolean }) {
  return (
    <div className={cn('col-span-full flex items-center gap-3', isFirst ? 'mb-1' : 'mt-6 mb-1')}>
      <span
        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
        style={{ color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.1)', border: '1px solid rgba(253,181,21,0.25)' }}
      >
        {group.step}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--estate-text-secondary)' }}>
          {group.label}
        </div>
        <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--estate-text-muted)' }}>
          {group.subtitle}
        </div>
      </div>
      <div className="h-px flex-1" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
    </div>
  );
}

function JobKindCard({
  kind,
  summary,
  onSelect,
}: {
  kind: string;
  summary?: KindSummary;
  onSelect: (kind: string) => void;
}) {
  const cardBg = 'var(--estate-raised)';
  const mutedColor = 'var(--estate-text-muted)';
  const meta = getKindMeta(kind);
  const s = summary;
  const sched = meta.scheduleId ? HARVEST_SCHEDULES.find(h => h.id === meta.scheduleId) : null;
  const successRate = s && s.total > 0 ? Math.round((s.succeeded / s.total) * 100) : null;
  const hasFailures = s && s.failed > 0;
  const isActive = s && (s.running > 0 || s.queued > 0);

  return (
    <button
      onClick={() => onSelect(kind)}
      className="group text-left rounded-xl border p-5 flex flex-col gap-4 transition-all duration-200 hover:translate-y-[-2px] hover:shadow-lg"
      style={{
        borderColor: isActive ? meta.color : meta.border,
        backgroundColor: cardBg,
        cursor: 'pointer',
        boxShadow: isActive ? `0 0 20px ${meta.color}15` : undefined,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = meta.color; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 24px ${meta.color}20`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = isActive ? meta.color : meta.border; (e.currentTarget as HTMLElement).style.boxShadow = isActive ? `0 0 20px ${meta.color}15` : 'none'; }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-8 rounded-full shrink-0" style={{ backgroundColor: meta.color, opacity: s ? 1 : 0.3 }} />
          <div className="min-w-0">
            <div className="font-mono text-sm font-bold tracking-wide uppercase truncate" style={{ color: meta.color }}>
              {meta.label}
            </div>
            <div className="text-xs leading-snug mt-0.5 line-clamp-1" style={{ color: 'var(--estate-text-secondary)' }}>
              {meta.description}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isActive && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-bold uppercase"
              style={{ color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.1)' }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FDB515] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#FDB515]" />
              </span>
              {s!.running > 0 ? `${s!.running} running` : `${s!.queued} queued`}
            </span>
          )}
          {hasFailures && (
            <span className="px-2 py-1 rounded-md text-[10px] font-mono font-bold"
              style={{ color: '#EF4444', backgroundColor: 'rgba(239,68,68,0.1)' }}>
              {s!.failed} failed
            </span>
          )}
        </div>
      </div>

      {s ? (
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-1.5 w-full rounded-full overflow-hidden bg-white/[0.06] mb-2">
              <div className="h-full flex">
                <div className="h-full transition-all duration-500" style={{ width: `${(s.succeeded / s.total) * 100}%`, backgroundColor: '#2DD4A0' }} />
                {s.failed > 0 && <div className="h-full transition-all duration-500" style={{ width: `${(s.failed / s.total) * 100}%`, backgroundColor: '#EF4444' }} />}
                {s.running > 0 && <div className="h-full transition-all duration-500" style={{ width: `${(s.running / s.total) * 100}%`, backgroundColor: '#FDB515' }} />}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span style={{ color: 'var(--estate-ink)' }}>{s.total} runs</span>
              {successRate !== null && (
                <span style={{ color: successRate >= 90 ? '#2DD4A0' : successRate >= 70 ? '#FDB515' : '#EF4444' }}>
                  {successRate}% ok
                </span>
              )}
              {s.succeeded > 0 && <span style={{ color: '#2DD4A0' }}>{s.succeeded} passed</span>}
            </div>
          </div>
          {successRate !== null && (
            <SuccessRing rate={successRate} size={40} stroke={3.5}
              color={successRate >= 90 ? '#2DD4A0' : successRate >= 70 ? '#FDB515' : '#EF4444'} />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 py-2">
          <div className="h-1.5 w-full rounded-full bg-white/[0.04]" />
          <span className="text-xs font-mono shrink-0" style={{ color: mutedColor }}>no runs yet</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <span className="text-[11px] font-mono" style={{ color: 'var(--estate-text-muted)' }}>
          {s?.last_run_at ? (
            <>
              <span style={{ color: 'var(--estate-text-secondary)' }}>Last run </span>
              {relativeTime(s.last_run_at)}
            </>
          ) : (
            'Never run'
          )}
        </span>
        {sched && (
          sched.deployment === 'manual' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md"
              style={{ color: 'var(--estate-text-muted)', backgroundColor: 'rgba(136,146,164,0.1)' }}
              title="Manual / on-demand — no EventBridge rule deployed">
              manual
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md"
              style={{ color: '#FDB515', backgroundColor: 'rgba(253,181,21,0.08)' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {relativeNextRun(sched)}
            </span>
          )
        )}
      </div>
    </button>
  );
}

function L1View({
  summaries,
  queuedJobs,
  loading,
  onSelectKind,
  onCancelJob,
}: {
  summaries: KindSummary[];
  queuedJobs: QueuedJobItem[];
  loading: boolean;
  onSelectKind: (kind: string) => void;
  onCancelJob: (jobId: string, kind: string) => void;
}) {
  const mutedColor = 'var(--estate-text-muted)';
  const cardBg = 'var(--estate-raised)';

  const dbKinds = summaries.map(s => s.kind);
  const kindGroups = getJobKindGroups(dbKinds);

  const summaryByKind: Record<string, KindSummary> = {};
  summaries.forEach(s => { summaryByKind[s.kind] = s; });

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Aggregate overview */}
      {!loading && summaries.length > 0 && <AggregateStats summaries={summaries} />}

      {/* Queued badge strip */}
      {queuedJobs.length > 0 && (
        <div
          className="mb-5 px-4 py-3 rounded-lg border flex items-center gap-3 flex-wrap"
          style={{ borderColor: 'rgba(253,181,21,0.3)', backgroundColor: 'rgba(253,181,21,0.04)' }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FDB515] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FDB515]" />
          </span>
          <span className="font-mono text-xs font-bold tracking-wider uppercase text-[#FDB515]">
            {queuedJobs.length} job{queuedJobs.length !== 1 ? 's' : ''} queued
          </span>
          <div className="flex flex-wrap gap-1.5 ml-2">
            {queuedJobs.slice(0, 8).map(qj => {
              const m = getKindMeta(qj.job_kind);
              return (
                <span
                  key={qj.id}
                  className="inline-flex items-center gap-1 rounded border font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 text-[10px] group"
                  style={{ color: m.color, backgroundColor: m.bg, borderColor: m.border }}
                >
                  {m.label}
                  <button
                    onClick={(e) => { e.stopPropagation(); onCancelJob(qj.id, qj.job_kind); }}
                    className="ml-0.5 w-3.5 h-3.5 rounded-full inline-flex items-center justify-center transition-colors hover:bg-red-500/20"
                    title="Cancel this job"
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              );
            })}
            {queuedJobs.length > 8 && (
              <span className="text-[10px] font-mono" style={{ color: mutedColor }}>+{queuedJobs.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {/* Grouped cards — pipeline order */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          [...Array(9)].map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border p-5 h-44"
              style={{ borderColor: 'rgba(255,255,255,0.06)', backgroundColor: cardBg }}
            />
          ))
        ) : (
          kindGroups.map((group, groupIdx) => (
            <React.Fragment key={group.id}>
              <JobKindGroupHeader group={group} isFirst={groupIdx === 0} />
              {group.kinds.map(kind => (
                <JobKindCard
                  key={kind}
                  kind={kind}
                  summary={summaryByKind[kind]}
                  onSelect={onSelectKind}
                />
              ))}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}

// ?? L2: Date Groups ????????????????????????????????????????????????????????????

function L2View({
  kind,
  dateGroups,
  loading,
  onSelectDate,
}: {
  kind: string;
  dateGroups: DateGroup[];
  loading: boolean;
  onSelectDate: (date: string) => void;
}) {
  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';
  const thBg = 'var(--estate-th-bg)';
  const meta = getKindMeta(kind);

  const getRowBg = (idx: number) =>
    idx % 2 === 0 ? 'var(--estate-row-even)' : 'var(--estate-row-odd)';

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs text-left">
        <thead>
          <tr className="sticky top-0 z-10 border-b select-none" style={{ backgroundColor: thBg, borderColor }}>
            <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Date</th>
            <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-24 text-center" style={{ color: labelColor }}>Runs</th>
            <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Outcome</th>
            <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-32 text-right" style={{ color: labelColor }}>Total Duration</th>
            <th className="p-3 w-16" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [...Array(6)].map((_, idx) => (
              <tr key={idx} className="animate-pulse border-b" style={{ borderColor, backgroundColor: getRowBg(idx) }}>
                <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-32" /></td>
                <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-10 mx-auto" /></td>
                <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-48" /></td>
                <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-16 ml-auto" /></td>
                <td className="p-3" />
              </tr>
            ))
          ) : dateGroups.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-16 text-center">
                <div className="flex flex-col items-center gap-3">
                  <span className="text-xl opacity-40 font-mono">no runs yet</span>
                  <p className="text-xs max-w-xs text-center" style={{ color: mutedColor }}>
                    No {meta.label} jobs have been run yet.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            dateGroups.map((dg, idx) => {
              const successRate = dg.total > 0 ? Math.round((dg.succeeded / dg.total) * 100) : 0;
              const rateColor = successRate >= 90 ? '#2DD4A0' : successRate >= 70 ? '#FDB515' : '#EF4444';
              return (
                <tr
                  key={dg.date}
                  onClick={() => onSelectDate(dg.date)}
                  className="border-b hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors duration-100"
                  style={{ backgroundColor: getRowBg(idx), borderColor }}
                >
                  <td className="p-3 font-medium" style={{ color: inkColor }}>
                    {formatDate(dg.date)}
                  </td>
                  <td className="p-3 text-center font-mono" style={{ color: inkColor }}>
                    {dg.total}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 w-32">
                        <div
                          className="h-1.5 rounded-full flex-1 overflow-hidden bg-black/[0.08] dark:bg-white/[0.08]"
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${successRate}%`, backgroundColor: rateColor }}
                          />
                        </div>
                        <span className="text-[10px] font-mono w-8 shrink-0" style={{ color: rateColor }}>{successRate}%</span>
                      </div>
                      <span className="text-[10px] font-mono" style={{ color: mutedColor }}>
                        {dg.succeeded > 0 && <span style={{ color: '#2DD4A0' }}>{dg.succeeded} ok</span>}
                        {dg.failed > 0 && <span style={{ color: '#EF4444' }}> {dg.failed} fail</span>}
                        {dg.running > 0 && <span style={{ color: '#FDB515' }}> {dg.running} running</span>}
                        {dg.queued > 0 && <span style={{ color: '#8892A4' }}> {dg.queued} queued</span>}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-[11px]" style={{ color: mutedColor }}>
                    {formatDurationS(dg.total_duration_s)}
                  </td>
                  <td className="p-3 text-right">
                    <span className="text-[10px] font-mono" style={{ color: meta.color }}>View</span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ?? L3: Detailed Job Table ?????????????????????????????????????????????????????

function L3View({
  kind,
  date,
  jobs,
  total,
  page,
  pageSize,
  loading,
  activeHighlightId,
  onSelectJob,
  onPageChange,
}: {
  kind: string;
  date: string;
  jobs: JobItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  activeHighlightId: string | null;
  onSelectJob: (job: JobItem) => void;
  onPageChange: (p: number) => void;
}) {
  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';
  const thBg = 'var(--estate-th-bg)';
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  function toggleParentExpand(jobId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  }

  const getRowBg = (idx: number) =>
    idx % 2 === 0 ? 'var(--estate-row-even)' : 'var(--estate-row-odd)';

  return (
    <>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs text-left">
          <thead>
            <tr className="sticky top-0 z-10 border-b select-none" style={{ backgroundColor: thBg, borderColor }}>
              <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-28" style={{ color: labelColor }}>Status</th>
              <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-28" style={{ color: labelColor }}>Trigger</th>
              <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Scope</th>
              <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-28" style={{ color: labelColor }}>Started</th>
              <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-20 text-right" style={{ color: labelColor }}>Duration</th>
              <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-40" style={{ color: labelColor }}>Stats</th>
            </tr>
          </thead>
          <tbody>
            {loading && jobs.length === 0 ? (
              [...Array(8)].map((_, idx) => (
                <tr key={idx} className="animate-pulse border-b" style={{ borderColor, backgroundColor: getRowBg(idx) }}>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-16" /></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-20" /></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/10 rounded w-full" /></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-20" /></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-12 ml-auto" /></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/10 rounded w-3/4" /></td>
                </tr>
              ))
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: labelColor }}>No jobs on this date</span>
                    <p className="text-xs" style={{ color: mutedColor }}>No {getKindMeta(kind).label} jobs ran on {formatDate(date)}.</p>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map((job, idx) => {
                const isHighlighted = job.id === activeHighlightId;
                const isParent = job.status === 'orchestrating' || (job.scope as any)?.is_parent === true;
                const isExpanded = expandedParents.has(job.id);
                const scope = job.scope as any ?? {};
                const totalChildren = scope.total_children as number | undefined;

                return (
                  <React.Fragment key={job.id}>
                    <tr
                      id={`job-row-${job.id}`}
                      onClick={() => onSelectJob(job)}
                      className="border-b hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors duration-150"
                      style={isHighlighted
                        ? { backgroundColor: 'rgba(253,181,21,0.15)', borderLeft: '3px solid #FDB515' }
                        : { backgroundColor: getRowBg(idx), borderColor }
                      }
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <StatusChip status={job.status} />
                          {isParent && (
                            <button
                              onClick={e => toggleParentExpand(job.id, e)}
                              title={isExpanded ? 'Hide child jobs' : 'Show child jobs'}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono font-bold uppercase tracking-wider transition-colors"
                              style={{ borderColor: 'rgba(253,181,21,0.4)', color: '#FDB515', backgroundColor: isExpanded ? 'rgba(253,181,21,0.15)' : 'rgba(253,181,21,0.06)' }}
                            >
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                                <polyline points="9 18 15 12 9 6"/>
                              </svg>
                              {totalChildren ?? '?'} chunks
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-xs font-mono" style={{ color: labelColor }}>{job.trigger ?? '--'}</td>
                      <td className="p-3 font-mono text-xs max-w-[240px]" style={{ color: mutedColor }}>
                        {job.scope ? <ScopeSummary scope={job.scope} /> : '--'}
                      </td>
                      <td className="p-3 font-mono text-xs" title={job.started_at ? new Date(job.started_at).toLocaleString() : '--'} style={{ color: labelColor }}>
                        {relativeTime(job.started_at)}
                      </td>
                      <td className="p-3 text-right font-mono text-xs" style={{ color: inkColor }}>
                        {getDuration(job.started_at, job.finished_at)}
                      </td>
                      <td className="p-3 text-xs" style={{ color: labelColor }}>
                        {formatStatsSummary(job.stats)}
                      </td>
                    </tr>
                    {isParent && isExpanded && (
                      <tr style={{ backgroundColor: getRowBg(idx) }}>
                        <td colSpan={6} className="px-4 pb-4 pt-1">
                          <ChildJobsPanel jobId={job.id} orgId={job.org_id} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
    </>
  );
}

// ?? Drill-down context nav (L2/L3) ???????????????????????????????????????????????

function KindDropdown({
  kindMeta,
  summaries,
  onSelectKind,
}: {
  kindMeta: KindMeta;
  summaries: KindSummary[];
  onSelectKind: (kind: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const pillClass =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono font-semibold tracking-wide transition-all hover:opacity-90 cursor-pointer';
  const pillStyle: React.CSSProperties = {
    color: 'var(--estate-ink)',
    backgroundColor: kindMeta.bg,
    borderColor: kindMeta.border,
    borderLeftWidth: 3,
    borderLeftColor: kindMeta.color,
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={pillClass}
        style={pillStyle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {kindMeta.label}
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded border shadow-lg py-1 overflow-hidden"
          style={{ backgroundColor: 'var(--estate-surface)', borderColor: 'var(--nav-border)' }}
          role="listbox"
        >
          {summaries.map(s => {
            const meta = getKindMeta(s.kind);
            const isCurrent = meta.label === kindMeta.label;
            return (
              <button
                key={s.kind}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => { setOpen(false); if (!isCurrent) onSelectKind(s.kind); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-left transition-colors hover:bg-white/[0.06]"
                style={{ color: isCurrent ? kindMeta.color : 'var(--estate-ink)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
                {isCurrent && <span className="ml-auto text-[10px] opacity-50">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateDropdown({
  urlDate,
  dateGroups,
  onSelectDate,
}: {
  urlDate: string;
  dateGroups: DateGroup[];
  onSelectDate: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-sm font-sans font-medium text-[var(--estate-ink)] hover:opacity-80 transition-opacity cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {formatDate(urlDate)}
        <ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden />
      </button>

      {open && dateGroups.length > 0 && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded border shadow-lg py-1 overflow-hidden"
          style={{ backgroundColor: 'var(--estate-surface)', borderColor: 'var(--nav-border)' }}
          role="listbox"
        >
          {dateGroups.map(dg => {
            const isCurrent = dg.date === urlDate;
            const successRate = dg.total > 0 ? Math.round((dg.succeeded / dg.total) * 100) : 0;
            const rateColor = successRate >= 90 ? '#2DD4A0' : successRate >= 70 ? '#FDB515' : '#EF4444';
            return (
              <button
                key={dg.date}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => { setOpen(false); if (!isCurrent) onSelectDate(dg.date); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-mono text-left transition-colors hover:bg-white/[0.06]"
                style={{ color: isCurrent ? '#FDB515' : 'var(--estate-ink)' }}
              >
                <span>{formatDate(dg.date)}</span>
                <span className="shrink-0 text-[10px]" style={{ color: rateColor }}>
                  {dg.total} run{dg.total !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JobsDrilldownNav({
  level,
  kindMeta,
  urlDate,
  schedForKind,
  summaries,
  dateGroups,
  onBack,
  onSelectKind,
  onSelectDate,
}: {
  level: 'l2' | 'l3';
  kindMeta: KindMeta;
  urlDate: string | null;
  schedForKind: (typeof HARVEST_SCHEDULES)[number] | null | undefined;
  summaries: KindSummary[];
  dateGroups: DateGroup[];
  onBack: () => void;
  onSelectKind: (kind: string) => void;
  onSelectDate: (date: string) => void;
}) {
  return (
    <div className="px-6 py-2.5 border-b flex items-center justify-between gap-4 shrink-0 bg-[var(--estate-surface)] border-[var(--nav-border)]">
      <nav aria-label="Job drill-down" className="flex items-center gap-2 min-w-0 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 shrink-0 text-xs font-sans font-medium text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {level === 'l3' ? 'Dates' : 'Job types'}
        </button>

        <ChevronRight className="h-3 w-3 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />

        <KindDropdown
          kindMeta={kindMeta}
          summaries={summaries}
          onSelectKind={onSelectKind}
        />

        {urlDate && (
          <>
            <ChevronRight className="h-3 w-3 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
            <DateDropdown
              urlDate={urlDate}
              dateGroups={dateGroups}
              onSelectDate={onSelectDate}
            />
          </>
        )}
      </nav>

      {schedForKind && (
        schedForKind.deployment === 'manual' ? (
          <span
            className="shrink-0 px-2 py-0.5 rounded border text-[11px] font-mono font-medium text-[var(--estate-text-muted)] border-[var(--nav-border)]"
            title="Manual / on-demand — no EventBridge rule deployed"
          >
            Manual — not scheduled
          </span>
        ) : (
          <span
            className="shrink-0 px-2 py-0.5 rounded border text-[11px] font-mono font-medium"
            style={{
              color: 'var(--estate-status-warning-text)',
              backgroundColor: 'var(--estate-status-warning-bg)',
              borderColor: 'var(--estate-status-warning-border)',
            }}
          >
            Next {relativeNextRun(schedForKind)}
          </span>
        )
      )}
    </div>
  );
}

// ?? Main Page ?????????????????????????????????????????????????????????????????

function EstateJobsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshKey = useCatalogRefresh();

  const urlKind = searchParams.get('kind');
  const urlDate = searchParams.get('date');
  const urlHighlight = searchParams.get('highlight');
  const urlTab = searchParams.get('tab') as ActiveTab | null;

  const level: ViewLevel = urlKind && urlDate ? 'l3' : urlKind ? 'l2' : 'l1';
  const activeTab: ActiveTab = urlTab === 'scanned' ? 'scanned' : 'jobs';

  // ?? L1 state
  const [summaries, setSummaries] = useState<KindSummary[]>([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [queuedJobs, setQueuedJobs] = useState<QueuedJobItem[]>([]);

  // ?? L2 state
  const [dateGroups, setDateGroups] = useState<DateGroup[]>([]);
  const [dateGroupsLoading, setDateGroupsLoading] = useState(false);

  // ?? L3 state
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsPage, setJobsPage] = useState(1);
  const jobsPageSize = 25;
  const [selectedJob, setSelectedJob] = useState<JobItem | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const highlightedRef = useRef<string | null>(null);

  // ?? Navigation helpers
  function pushParams(updates: Record<string, string | null>) {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`?${p.toString()}`);
  }

  function selectKind(kind: string) {
    pushParams({ kind, date: null, highlight: null });
    setDateGroups([]);
    setJobs([]);
    setJobsPage(1);
  }

  function selectDate(date: string) {
    pushParams({ date });
    setJobs([]);
    setJobsPage(1);
  }

  function goBack() {
    if (level === 'l3') pushParams({ date: null });
    else if (level === 'l2') pushParams({ kind: null, date: null });
  }

  // ?? Fetch L1 summaries
  const fetchSummaries = useCallback(async () => {
    setSummariesLoading(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/summary');
      if (res.ok) {
        const json = await res.json();
        setSummaries(json.data ?? []);
      }
    } catch (err) {
      console.error('[jobs/summary]', err);
    } finally {
      setSummariesLoading(false);
    }
  }, []);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  // ?? Fetch queued jobs (poll 15s)
  const fetchQueued = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-lab/context/jobs/queued');
      if (res.ok) {
        const json = await res.json();
        setQueuedJobs(json.data ?? []);
      }
    } catch (err) {
      console.error('[jobs/queued]', err);
    }
  }, []);

  useEffect(() => {
    fetchQueued();
    const id = setInterval(fetchQueued, 15_000);
    return () => clearInterval(id);
  }, [fetchQueued]);

  // ?? Fetch L2 date groups when kind changes
  useEffect(() => {
    if (!urlKind) return;
    setDateGroupsLoading(true);
    fetch(`/api/agent-lab/context/jobs/dates?kind=${encodeURIComponent(urlKind)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => setDateGroups(json.data ?? []))
      .catch(err => console.error('[jobs/dates]', err))
      .finally(() => setDateGroupsLoading(false));
  }, [urlKind]);

  // ?? Fetch L3 jobs when kind+date changes
  useEffect(() => {
    if (!urlKind || !urlDate) return;
    setJobsLoading(true);
    const after = new Date(urlDate + 'T00:00:00Z').toISOString();
    const before = new Date(urlDate + 'T23:59:59Z').toISOString();
    const p = new URLSearchParams({
      kind: urlKind,
      after,
      before,
      page: String(jobsPage),
      pageSize: String(jobsPageSize),
    });
    fetch(`/api/agent-lab/context/jobs?${p}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => {
        setJobs(json.data?.items ?? []);
        setJobsTotal(json.data?.total ?? 0);
      })
      .catch(err => console.error('[jobs list]', err))
      .finally(() => setJobsLoading(false));
  }, [urlKind, urlDate, jobsPage]);

  // ?? Auto-refresh L3 when active jobs visible
  useEffect(() => {
    if (!urlKind || !urlDate) return;
    const hasActive = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!hasActive) return;
    const id = setInterval(async () => {
      const after = new Date(urlDate + 'T00:00:00Z').toISOString();
      const before = new Date(urlDate + 'T23:59:59Z').toISOString();
      const p = new URLSearchParams({ kind: urlKind, after, before, page: String(jobsPage), pageSize: String(jobsPageSize) });
      const res = await fetch(`/api/agent-lab/context/jobs?${p}`).catch(() => null);
      if (res?.ok) {
        const json = await res.json();
        setJobs(json.data?.items ?? []);
        setJobsTotal(json.data?.total ?? 0);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [jobs, urlKind, urlDate, jobsPage]);

  // ?? URL highlight logic for L3
  useEffect(() => {
    if (!urlHighlight || jobsLoading || jobs.length === 0) return;
    if (highlightedRef.current === urlHighlight) return;
    highlightedRef.current = urlHighlight;
    const matched = jobs.find(j => j.id === urlHighlight);
    if (matched) {
      setSelectedJob(matched);
      setActiveHighlightId(urlHighlight);
      setTimeout(() => {
        document.getElementById(`job-row-${urlHighlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      const t = setTimeout(() => setActiveHighlightId(null), 2000);
      return () => clearTimeout(t);
    }
  }, [jobs, urlHighlight, jobsLoading]);

  // ?? Breadcrumb
  const kindMeta = urlKind ? getKindMeta(urlKind) : null;
  const schedForKind = kindMeta?.scheduleId ? HARVEST_SCHEDULES.find(h => h.id === kindMeta!.scheduleId) : null;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[var(--background)]">
      {/* Top bar: scheduled sweeps (L1 only) */}
      {level === 'l1' && (
        <div className="px-6 py-3 border-b flex items-center justify-between shrink-0 bg-[var(--nav-hover)] border-[var(--nav-border)]">
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FDB515" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-[var(--text-secondary)]">
                Schedules
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {HARVEST_SCHEDULES.map(sched => {
                const isManual = sched.deployment === 'manual';
                const nextRun = getNextRun(sched);
                const relative = relativeNextRun(sched);
                const isImminent = !isManual && relative.startsWith('in') && (relative.includes('m') || relative.includes('1h'));
                return (
                  <span
                    key={sched.id}
                    title={isManual
                      ? `${sched.description}\nManual / on-demand — no EventBridge rule deployed`
                      : `${sched.description}\nCron: ${sched.cronInner}\nNext: ${nextRun?.toUTCString() ?? 'unknown'}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-mono transition-all"
                    style={{
                      backgroundColor: isImminent ? 'rgba(253,181,21,0.06)' : 'var(--card)',
                      borderColor: isImminent ? 'rgba(253,181,21,0.3)' : 'var(--nav-border)',
                      opacity: isManual ? 0.75 : 1,
                    }}
                  >
                    <span className="font-semibold text-[var(--foreground)]">{sched.label}</span>
                    <span className="text-[var(--text-tertiary)]">|</span>
                    {isManual ? (
                      <span className="font-bold uppercase tracking-wider text-[10px] text-[var(--text-tertiary)]">
                        manual · not scheduled
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">{sched.cronInner}</span>
                        <span className="text-[var(--text-tertiary)]">|</span>
                        <span className={`font-bold ${isImminent ? 'text-[#FDB515]' : 'text-[var(--text-secondary)]'}`}>
                          {relative}
                        </span>
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden xl:flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                Infrastructure active
              </span>
            </div>
            <RunJobButton onJobQueued={() => { fetchSummaries(); fetchQueued(); }} />
          </div>
        </div>
      )}

      {/* Drill-down context nav (L2/L3) */}
      {level !== 'l1' && kindMeta && urlKind && (
        <JobsDrilldownNav
          level={level as 'l2' | 'l3'}
          kindMeta={kindMeta}
          urlDate={urlDate}
          schedForKind={schedForKind}
          summaries={summaries}
          dateGroups={dateGroups}
          onBack={goBack}
          onSelectKind={selectKind}
          onSelectDate={selectDate}
        />
      )}

      {/* Tab bar (only on L1) */}
      {level === 'l1' && (
        <div className="border-b shrink-0 bg-[var(--background)] border-[var(--nav-border)]">
          <div className="flex items-center gap-0.5 px-6 pt-1.5">
            {(['jobs', 'scanned'] as ActiveTab[]).map(tab => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => pushParams({ tab: tab === 'jobs' ? null : tab })}
                  className={cn(
                    'relative px-5 py-2.5 text-[11px] font-mono font-bold uppercase tracking-widest transition-colors duration-150 rounded-t cursor-pointer border-none',
                    isActive
                      ? 'text-[#FDB515] bg-[rgba(253,181,21,0.06)]'
                      : 'text-[var(--nav-item-text)] bg-transparent hover:text-[var(--nav-text)] hover:bg-white/[0.02]',
                  )}
                >
                  {tab === 'jobs' ? 'Job Types' : 'Scanned Objects'}
                  {isActive && (
                    <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-t bg-[#FDB515]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      {level === 'l1' && activeTab === 'scanned' ? (
        <ScannedObjectsTab refreshKey={refreshKey} />
      ) : level === 'l1' ? (
        <L1View
          summaries={summaries}
          queuedJobs={queuedJobs}
          loading={summariesLoading}
          onSelectKind={selectKind}
          onCancelJob={async (jobId, kind) => {
            try {
              const res = await fetch(`/api/agent-lab/context/jobs/${jobId}`, { method: 'DELETE' });
              if (res.ok) {
                toast.success(`Cancelled: ${kind.replace(/_/g, ' ')}`, {
                  description: 'Job removed from queue.',
                });
                fetchQueued();
                fetchSummaries();
              } else {
                const err = await res.json().catch(() => ({}));
                toast.error('Cannot cancel', { description: err.message ?? err.error ?? 'Unknown error' });
              }
            } catch {
              toast.error('Network error', { description: 'Could not reach the server.' });
            }
          }}
        />
      ) : level === 'l2' && urlKind ? (
        <L2View
          kind={urlKind}
          dateGroups={dateGroups}
          loading={dateGroupsLoading}
          onSelectDate={selectDate}
        />
      ) : level === 'l3' && urlKind && urlDate ? (
        <L3View
          kind={urlKind}
          date={urlDate}
          jobs={jobs}
          total={jobsTotal}
          page={jobsPage}
          pageSize={jobsPageSize}
          loading={jobsLoading}
          activeHighlightId={activeHighlightId}
          onSelectJob={setSelectedJob}
          onPageChange={p => { setJobsPage(p); }}
        />
      ) : null}

      {/* Detail Drawer */}
      <JobDetailDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
    </div>
  );
}

export default function EstateJobsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs font-mono text-[var(--text-muted)]">Loading jobs console...</div>}>
      <EstateJobsPageContent />
    </Suspense>
  );
}
