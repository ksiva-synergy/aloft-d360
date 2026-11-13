'use client';

import { Select } from '@/components/form/Select';
import { DatePicker } from '@/components/form/DatePicker';
import React, { useState, useEffect, useRef, Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from '@/lib/navigation';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pagination, JobDetailDrawer, ScannedObjectsTab, ActiveRunsPanel } from '@/components/estate';
import JobsLaunchWizard from '@/components/estate/JobsLaunchWizard';
import ChildJobsPanel from '@/components/estate/ChildJobsPanel';
import {
  formatJobScopeHuman,
  formatStatsSummary,
  getJobPrimaryMetric,
  launchUsesEstateExcludeTree,
  resolveDisplayJobStatus,
  resolveModalLaunchScope,
  scopeSummaryFocus,
  stripExcludeSchemasForKind,
  isJobsLaunchWizardEnabled,
} from '@/lib/estate/job-ui';
import JobsCockpitPanel, { type ScannedTier } from '@/components/estate/JobsCockpitPanel';
import { isLaunchDisabledKind } from '@/lib/estate/launch-kinds';
import { useCatalogRefresh } from '@/components/estate/useCatalogRefresh';
import { HARVEST_SCHEDULES, relativeNextRun, getNextRun, getNextRuns } from '@/lib/context/schedules';
import { describeCron } from '@/lib/estate/cron-label';
import { toast } from 'sonner';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';
import { ESTATE_STAGE, estateStageDisplayLabel } from '@/lib/estate/stages';

import { withAlpha } from '@/lib/theme/with-alpha';
import { inkOf } from '@/lib/typography/tokens';
// ?? Types ??????????????????????????????????????????????????????????????????????

type ViewLevel = 'l1' | 'kind';
type ActiveTab = 'jobs' | 'health' | 'scanned' | 'active';

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

interface SplitPlanPreview {
  needsSplit: boolean;
  totalObjects: number;
  chunks: number;
  maxObjectsPerChunk: number;
  timeBudgetMinutes: number;
  estimatedWallClockMinutes: number;
  estimatedCostUsd: number;
  maxConcurrent: number;
  scopeWarning?: string | null;
  emptyScope?: boolean;
  harvestModelId?: string;
  registry?: 'estate' | 'scanned';
  discoveryObjects?: number;
  scannedObjects?: number;
  humanSummary?: string;
  liveScopeLaunch?: boolean;
}

interface KindRecentRun {
  id: string;
  status: string;
  created_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  stats: Record<string, unknown> | null;
}

interface KindSummary {
  kind: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  last_finished_at: string | null;
  // Present when the summary API is called with detail=true
  partial?: number;
  cancelled?: number;
  other?: number;
  last_status?: string | null;
  median_duration_s?: number | null;
  prev_total?: number | null;
  prev_succeeded?: number | null;
  prev_failed?: number | null;
  recent?: KindRecentRun[];
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
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
      <span className="truncate block font-mono text-size-ui" title={JSON.stringify(scope, null, 2)}
        style={{ color: 'var(--brand-a-ink)' }}>
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
      <span className="flex flex-col gap-0.5 font-mono text-size-ui" title={JSON.stringify(scope, null, 2)}>
        <span style={{ color: inkOf('#93C5FD') }}>{since}{" -> "}{until}</span>
        {taskId && <span style={{ color: 'var(--ink-3)' }}>{taskId.slice(0, 8)}...</span>}
      </span>
    );
  }

  const parts: string[] = [];
  const focus = scopeSummaryFocus(scope);
  if (focus) parts.push(`focus: ${focus}`);
  if (scope.excludeSchemas && Array.isArray(scope.excludeSchemas) && scope.excludeSchemas.length > 0) {
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
    color: 'var(--brand-a-ink)',
    bg: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
    border: 'color-mix(in srgb, var(--brand-a) 25%, transparent)',
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
    color: 'var(--brand-a-ink)',
    bg: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
    border: 'color-mix(in srgb, var(--brand-a) 25%, transparent)',
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
    description: 'Fans out per-schema entity + dimension proposals from T2 semantic cards',
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
  pbi_inventory: {
    label: 'PBI Inventory',
    description: 'Workspaces, semantic models, reports and datasources from Power BI',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
  },
  pbi_definitions: {
    label: 'PBI Definitions',
    description: 'Fetch TMDL model and PBIR report definitions into raw store (incremental)',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
  },
  pbi_parse: {
    label: 'PBI Parse',
    description: 'Parse TMDL/PBIR into database tables, bindings, and model classification',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
  },
  pbi_catalog_link: {
    label: 'PBI Catalog Link',
    description: 'Match warehouse partitions to Data Estate catalog objects',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
  },
  pbi_domains: {
    label: 'PBI Domains',
    description: 'Score business domains per model and detect cross-model measure conflicts',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
  },
  pbi_families: {
    label: 'PBI Families',
    description: 'Group year-variant and near-duplicate semantic models',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
  },
  pbi_oracle: {
    label: 'PBI Oracle',
    description: 'Run DAX snapshots on non-RLS models (pilot measures) for parity baseline',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.28)',
  },
  pbi_translate: {
    label: 'PBI Translate',
    description: 'Rule-tier then LLM DAX → SQL drafts for catalog-bound measures',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.28)',
  },
  pbi_parity: {
    label: 'PBI Parity',
    description: 'Compare translated SQL to latest DAX oracle snapshots',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.28)',
  },
  pbi_publish: {
    label: 'PBI Publish',
    description: 'Write parity-pass translations to verified queries and embed for Inspector',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.28)',
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
    label: 'Discover',
    subtitle: 'Find every catalog, schema and table in your sources',
    kinds: ['estate_inventory'],
  },
  {
    id: 'structural',
    step: '02',
    label: 'Scan',
    subtitle: 'Read columns and types, and detect schema changes',
    kinds: ['t0_structural', 'change_detect'],
  },
  {
    id: 'enrichment',
    step: '03',
    label: 'Profile, describe & index',
    subtitle: 'Compute statistics, write descriptions, make searchable',
    kinds: ['t1_profile', 't2_semantic', 'embed'],
  },
  {
    id: 'usage',
    step: '04',
    label: 'Usage & lineage',
    subtitle: 'Learn from query history which tables are used together',
    kinds: ['t3_usage'],
  },
  {
    id: 'powerbi',
    step: 'PBI',
    label: 'Power BI',
    subtitle: 'Harvest semantic models and reports (separate from Databricks)',
    kinds: [
      'pbi_inventory',
      'pbi_definitions',
      'pbi_parse',
      'pbi_catalog_link',
      'pbi_domains',
      'pbi_families',
      'pbi_oracle',
      'pbi_translate',
      'pbi_parity',
      'pbi_publish',
    ],
  },
  {
    id: 'entity_model',
    step: '05',
    label: 'Business model',
    subtitle: 'Draft entities, dimensions and metrics from descriptions',
    kinds: ['t4_scan'],
  },
  {
    id: 'knowledge',
    step: '06',
    label: 'Publish & connect',
    subtitle: 'Publish to Knowledge and link similar data across sources',
    kinds: ['knowledge_sync'],
  },
];

function filterLaunchableKindList(kinds: string[]): string[] {
  return kinds.filter(k => !isLaunchDisabledKind(k));
}

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
    color: 'var(--ink-3)',
    bg: 'rgba(136,146,164,0.08)',
    border: 'rgba(136,146,164,0.25)',
  };
}

function KindBadge({ kind, small }: { kind: string; small?: boolean }) {
  const m = getKindMeta(kind);
  return (
    <span
   className={`inline-flex items-center rounded border ${small ? 'px-1.5 py-0.5 text-label' : 'px-2 py-0.5 text-size-ui'}`}
      style={{ color: inkOf(m.color), backgroundColor: m.bg, borderColor: m.border }}
    >
      {m.label}
    </span>
  );
}

// ── Run Job Button ────────────────────────────────────────────────────────────

const TRIGGERABLE_JOBS: { kind: string; label: string; description: string; scope: string; warning?: string }[] = [
  { kind: 'estate_inventory', label: 'Estate Inventory', description: 'Full re-inventory via information_schema', scope: 'Queries information_schema to discover all catalogs, schemas, and objects' },
  { kind: 't0_structural', label: 'T0 Structural', description: 'Discover schema, columns, row counts', scope: 'Tables in discovery (Databricks metadata) for the primary source' },
  { kind: 'change_detect', label: 'Change Detect', description: 'Detect changed objects since last sweep', scope: 'Compares current state to last sweep - enqueues T0 for changed objects' },
  { kind: 't1_profile', label: 'T1 Profile', description: 'Statistical profiling of all columns', scope: 'Already-scanned objects - runs DESCRIBE and sample queries on each table' },
  { kind: 't2_semantic', label: 'T2 Semantic', description: 'AI summaries and PII detection', scope: 'Profiled objects - calls LLM for enrichment (incurs API cost)', warning: 'This job calls an LLM and incurs token costs.' },
  { kind: 'embed', label: 'Embed', description: 'Compute vector embeddings', scope: 'Enriched objects in scope - generates embeddings for semantic search' },
  { kind: 't3_usage', label: 'T3 Usage Harvest', description: 'Query history + lineage scan', scope: 'Scans up to 30 days of query history and lineage tables', warning: 'Scans up to 30 days of query history and lineage tables. Typical duration: 2-5 min.' },
];

const TRIGGERABLE_BY_KIND = Object.fromEntries(TRIGGERABLE_JOBS.map(j => [j.kind, j]));

function getTriggerableJobGroups() {
  return JOB_KIND_GROUPS
    .map(group => {
      const kinds = filterLaunchableKindList(group.kinds);
      return {
        group: { ...group, kinds },
        jobs: kinds.map(k => TRIGGERABLE_BY_KIND[k]).filter((j): j is (typeof TRIGGERABLE_JOBS)[number] => Boolean(j)),
      };
    })
    .filter(g => g.jobs.length > 0);
}

interface LaunchSourceOption {
  id: string;
  label: string;
}

interface ConfirmState {
  kinds: string[];
  objectCount: number | null;
  sourceName: string | null;
  sourceId: string | null;
  availableSources: LaunchSourceOption[];
  scopeInclude: string[] | null;
  loading: boolean;
  tree: CatalogTree[] | null;
  excludeSchemas: Set<string>; // "catalog.schema"
  includedSchemas: Set<string>; // include-first tree (catalog.schema)
  scopeTreeMode: 'exclude' | 'include';
  includePatterns: string;     // comma/newline-separated glob patterns, empty = full scope
  sequential: boolean;         // chain T0→T1→T2 in order rather than launching all at once
  forceFullScan: boolean;
  forceReprofile: boolean;
  forceReEnrich: boolean;
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
  splitPlanError,
  onCancel,
  onConfirm,
  onToggleSchema,
  onExcludeAllSchemas,
  onClearExcludeSchemas,
  onSetScopeTreeMode,
  onChangeIncludePatterns,
  onToggleSequential,
  onToggleRunnerFlag,
  onChangeSourceId,
  submitting,
}: {
  confirm: ConfirmState;
  splitPlans: Partial<Record<string, SplitPlanPreview>>;
  splitPlansLoading: boolean;
  splitPlanError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onToggleSchema: (key: string) => void;
  onExcludeAllSchemas: () => void;
  onClearExcludeSchemas: () => void;
  onSetScopeTreeMode: (mode: 'exclude' | 'include') => void;
  onChangeIncludePatterns: (val: string) => void;
  onToggleSequential: () => void;
  onToggleRunnerFlag: (key: 'forceFullScan' | 'forceReprofile' | 'forceReEnrich') => void;
  onChangeSourceId: (sourceId: string) => void;
  submitting: boolean;
}) {
  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set());

  const warnings = confirm.kinds
    .map(k => TRIGGERABLE_JOBS.find(j => j.kind === k)?.warning)
    .filter(Boolean) as string[];

  const showExcludeTree = launchUsesEstateExcludeTree(confirm.kinds);
  const hasProfileOrEnrich = confirm.kinds.some(k => k === 't1_profile' || k === 't2_semantic');
  const totalSchemaKeys = confirm.tree
    ? confirm.tree.reduce((n, cat) => n + cat.schemas.length, 0)
    : 0;
  const allSchemasExcluded = totalSchemaKeys > 0
    && confirm.tree!.every(cat => cat.schemas.every(s => confirm.excludeSchemas.has(`${cat.catalog}.${s.name}`)));

  const includedCount = confirm.tree
    ? confirm.tree.reduce((sum, cat) => {
        return sum + cat.schemas.reduce((s2, sch) => {
          const key = `${cat.catalog}.${sch.name}`;
          if (confirm.scopeTreeMode === 'include') {
            return confirm.includedSchemas.has(key) ? s2 + sch.count : s2;
          }
          return confirm.excludeSchemas.has(key) ? s2 : s2 + sch.count;
        }, 0);
      }, 0)
    : confirm.objectCount;

  const resolvedScope = resolveModalLaunchScope({
    includePatternsText: confirm.includePatterns,
    scopeTreeMode: confirm.scopeTreeMode,
    excludeSchemas: Array.from(confirm.excludeSchemas),
    includedSchemas: Array.from(confirm.includedSchemas),
  });
  const limitPatterns = resolvedScope.includePatterns;
  const limitActive = limitPatterns.length > 0;
  const includeTreeActive = confirm.scopeTreeMode === 'include' && confirm.includedSchemas.size > 0 && !confirm.includePatterns.trim();

  // Derive the dominant split plan (first splittable kind)
  const splittableKinds = ['t2_semantic', 't1_profile', 't0_structural'];
  const dominantSplitKind = confirm.kinds.find(k => splittableKinds.includes(k));
  const scopePlanKind =
    (confirm.kinds.includes('t0_structural') ? 't0_structural' : null)
    ?? (confirm.kinds.includes('t1_profile') ? 't1_profile' : null)
    ?? (confirm.kinds.includes('t2_semantic') ? 't2_semantic' : null)
    ?? dominantSplitKind;
  const scopePlan = scopePlanKind ? splitPlans[scopePlanKind] : undefined;
  const activePlan = dominantSplitKind ? splitPlans[dominantSplitKind] : undefined;
  const includeScopeEmpty =
    confirm.scopeTreeMode === 'include'
    && !confirm.includePatterns.trim()
    && confirm.includedSchemas.size === 0
    && showExcludeTree;
  const launchBlocked = Boolean(
    includeScopeEmpty
    || (
      dominantSplitKind
      && !splitPlansLoading
      && (splitPlanError || activePlan?.emptyScope || !activePlan)
    ),
  );

  const scopeCountLabel = limitActive
    ? (scopePlan?.registry === 'estate' || scopePlanKind === 't0_structural'
      ? 'Tables matching Limit (discovery)'
      : 'Tables matching Limit (scanned)')
    : 'Discovery (estate inventory)';
  const scopeCountValue = limitActive
    ? (splitPlansLoading
      ? null
      : scopePlan?.liveScopeLaunch
        ? null
        : scopePlan?.totalObjects ?? null)
    : includedCount;
  const scopeCountLiveHint = limitActive && !splitPlansLoading && scopePlan?.liveScopeLaunch;

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
        style={{ backgroundColor: 'var(--card, #131d2a)', borderColor: 'color-mix(in srgb, var(--brand-a) 30%, transparent)' }}
      >
        {/* Header */}
        <div className="px-7 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border, rgba(255,255,255,0.06))' }}>
     <div className="text-label mb-3" style={{ color: 'var(--text-secondary, #8892A4)' }}>
            Launching {confirm.kinds.length} job type{confirm.kinds.length !== 1 ? 's' : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            {confirm.kinds.map(k => <KindBadge key={k} kind={k} />)}
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-5 space-y-5 max-h-[60vh] overflow-y-auto">

          {/* Scope */}
          <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', backgroundColor: 'var(--muted, rgba(0,0,0,0.2))' }}>
            {showExcludeTree ? (
            <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onSetScopeTreeMode('exclude')}
                className="px-3 py-1.5 rounded-md border text-size-ui font-mono font-semibold"
                style={{
                  borderColor: confirm.scopeTreeMode === 'exclude' ? 'var(--brand-a)' : 'var(--border)',
                  color: confirm.scopeTreeMode === 'exclude' ? 'var(--brand-a-ink)' : 'var(--text-secondary)',
                }}
              >
                All discovery (exclude schemas)
              </button>
              <button
                type="button"
                onClick={() => onSetScopeTreeMode('include')}
                className="px-3 py-1.5 rounded-md border text-size-ui font-mono font-semibold"
                style={{
                  borderColor: confirm.scopeTreeMode === 'include' ? 'var(--brand-a)' : 'var(--border)',
                  color: confirm.scopeTreeMode === 'include' ? 'var(--brand-a-ink)' : 'var(--text-secondary)',
                }}
              >
                Limit to selected schemas
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-a-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <span className="text-label" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                  {confirm.scopeTreeMode === 'include' ? 'Include schemas (discovery tree)' : 'Exclude schemas (discovery tree)'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!limitActive && !confirm.loading && confirm.tree && confirm.tree.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={onExcludeAllSchemas}
                      disabled={allSchemasExcluded}
                      title="Exclude every catalog.schema in the tree"
                      className="px-3 py-1.5 rounded border text-size-ui font-mono font-semibold transition-colors disabled:opacity-40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                      style={{ color: inkOf('#EF4444'), borderColor: 'rgba(239,68,68,0.45)', backgroundColor: 'rgba(239,68,68,0.08)' }}
                    >
                      Exclude all
                    </button>
                    <button
                      type="button"
                      onClick={onClearExcludeSchemas}
                      disabled={confirm.excludeSchemas.size === 0}
                      title="Remove all schema excludes"
                      className="px-3 py-1.5 rounded border text-size-ui font-mono font-semibold transition-colors disabled:opacity-40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                      style={{ color: '#2DD4A0', borderColor: 'rgba(45,212,160,0.45)', backgroundColor: 'rgba(45,212,160,0.08)' }}
                    >
                      Clear excludes
                    </button>
                  </>
                )}
                {confirm.excludeSchemas.size > 0 && !limitActive && (
                  <span className="text-size-ui font-mono px-2 py-0.5 rounded" style={{ color: inkOf('#EF4444'), backgroundColor: 'rgba(239,68,68,0.1)' }}>
                    {confirm.excludeSchemas.size} excluded
                  </span>
                )}
                {limitActive && (
                  <span className="text-size-ui font-mono px-2 py-0.5 rounded" style={{ color: 'var(--brand-a-ink)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 12%, transparent)' }}>
                    Limit defines scope
                  </span>
                )}
              </div>
            </div>

            {limitActive && (
              <p className="text-[length:var(--type-caption-size)] font-sans leading-relaxed" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                Exclude tree is ignored while Limit globs are set. Use Limit only, or clear Limit to use excludes again.
              </p>
            )}

            {hasProfileOrEnrich && !limitActive && (
              <p className="text-[length:var(--type-caption-size)] font-sans leading-relaxed" style={{ color: inkOf('#FDB515') }}>
                T1/T2 honor the exclude tree and <strong>Limit (Focus)</strong> on scanned tables. Limit overrides excludes when both are set.
                For one schema only, set e.g. <span className="font-mono">catalog.schema.*</span> under Limit — or run T0 with excludes, then a separate T1 with Limit.
              </p>
            )}

            {confirm.availableSources.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>Context source</span>
                <Select
                  value={confirm.sourceId ?? ''}
                  onChange={e => onChangeSourceId(e.target.value)}
                  className="rounded border px-3 py-2 text-size-ui font-mono"
                  style={{ borderColor: 'var(--border, rgba(255,255,255,0.12))', backgroundColor: 'var(--muted, rgba(0,0,0,0.2))', color: 'var(--text-primary, #e8ecf0)' }}
                >
                  {confirm.availableSources.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </Select>
              </div>
            )}

            {confirm.kinds.length === 1 && confirm.kinds[0] === 'estate_inventory' && (
              <p className="text-[length:var(--type-caption-size)] font-mono leading-relaxed" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                Estate Inventory honors the exclude tree and Limit globs (same as T0). Source default scope still applies when Limit is empty.
              </p>
            )}

            {confirm.loading ? (
              <div className="flex items-center gap-2.5 pt-2">
                <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-a-ink)', borderTopColor: 'transparent' }} />
                <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>Loading estate structure...</span>
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
                      <span className="text-size-ui font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>Source:</span>
                      <span className="text-size-ui font-mono font-semibold" style={{ color: 'var(--text-primary, #e8ecf0)' }}>{confirm.sourceName}</span>
                    </div>
                  )}
                  {confirm.scopeInclude && confirm.scopeInclude.length > 0 && (
                    <div className="flex items-center gap-2 w-full">
                      <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>Source scope:</span>
                      <span className="text-[length:var(--type-caption-size)] font-mono truncate" style={{ color: inkOf('#FDB515') }} title={confirm.scopeInclude.join(', ')}>
                        {confirm.scopeInclude.join(', ')}
                      </span>
                    </div>
                  )}
                  {confirm.tree && confirm.tree.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>Catalogs in discovery:</span>
                      <span className="text-[length:var(--type-ui-regular-size)] font-mono font-semibold" style={{ color: 'var(--text-primary, #e8ecf0)' }}>{confirm.tree.length}</span>
                    </div>
                  )}
                  {(scopeCountValue !== null || limitActive) && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-a-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                      </svg>
                      <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>{scopeCountLabel}:</span>
                      <span className="text-size-ui font-mono font-semibold" style={{ color: 'var(--brand-a-ink)' }}>
                        {scopeCountLiveHint
                          ? 'Databricks at run'
                          : scopeCountValue === null
                            ? '…'
                            : scopeCountValue.toLocaleString()}
                      </span>
                      {!limitActive && confirm.excludeSchemas.size > 0 && confirm.objectCount !== null && (
                        <span className="text-size-ui font-mono" style={{ color: inkOf('#EF4444') }}>
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
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-a-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                              </svg>
                              <span className={`text-size-ui font-mono font-semibold flex-1 truncate ${allSchemasExcluded ? 'line-through' : ''}`} style={{ color: 'var(--text-primary, #e8ecf0)' }}>
                                {cat.catalog}
                              </span>
                              <span className="text-size-ui font-mono px-2 py-0.5 rounded" style={{ color: 'var(--brand-a-ink)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 10%, transparent)' }}>
                                {cat.count.toLocaleString()}
                              </span>
                              {someSchemasExcluded && !allSchemasExcluded && (
                                <span className="text-size-ui font-mono" style={{ color: inkOf('#F59E0B') }}>partial</span>
                              )}
                            </button>
                            <button
                              onClick={() => toggleAllSchemas(cat)}
                              title={allSchemasExcluded ? 'Include all schemas' : 'Exclude all schemas'}
                              className="px-2 py-1.5 rounded text-size-ui font-mono font-semibold transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                              style={{ color: allSchemasExcluded ? '#2DD4A0' : '#EF4444' }}
                            >
                              {allSchemasExcluded ? 'include all' : 'exclude all'}
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="ml-8 pl-3.5 border-l" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
                              {cat.schemas.map(sch => {
                                const key = `${cat.catalog}.${sch.name}`;
                                const inIncludeMode = confirm.scopeTreeMode === 'include';
                                const excluded = inIncludeMode
                                  ? !confirm.includedSchemas.has(key)
                                  : confirm.excludeSchemas.has(key);
                                return (
                                  <button
                                    key={sch.name}
                                    onClick={() => onToggleSchema(key)}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-left group"
                                    style={{ opacity: excluded ? 0.45 : 1 }}
                                  >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${excluded ? (inIncludeMode ? 'border-[color:var(--line-2)] dark:border-white/20 bg-transparent' : 'border-red-500/60 bg-red-500/10') : 'border-[color:var(--line-2)] dark:border-white/20 bg-[color:var(--surface-2)] dark:bg-white/5 group-hover:border-[color:var(--line-2)] dark:group-hover:border-white/40'}`}>
                                      {!excluded ? (
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                      ) : !inIncludeMode ? (
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                        </svg>
                                      ) : null}
                                    </div>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #8892A4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                    </svg>
                                    <span className={`text-size-ui font-mono flex-1 truncate ${excluded ? 'line-through' : ''}`} style={{ color: excluded ? 'var(--text-tertiary, #8892A4)' : 'var(--text-primary, #b0b8c4)' }}>
                                      {sch.name}
                                    </span>
                                    <span className="text-size-ui font-mono font-medium" style={{ color: 'var(--text-secondary, #8892A4)' }}>
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
            </>
            ) : (
              <p className="text-[length:var(--type-caption-size)] font-sans leading-relaxed" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                These job types run on <span style={{ color: inkOf('#FDB515') }}>Scanned &amp; beyond</span> objects (T0 registry).
                For profile/enrich-only runs, use the exclude tree or <span style={{ color: inkOf('#FDB515') }}>Limit (Focus)</span> below.
              </p>
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
                  <span className="text-size-ui leading-relaxed" style={{ color: inkOf('#F59E0B') }}>{w}</span>
                </div>
              ))}
            </div>
          )}

          {showExcludeTree && !limitActive && confirm.excludeSchemas.size > 0 && (
            <div className="text-size-ui font-sans px-1 space-y-1" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
              <p>Excluded schemas are passed as job scope — T0 lists and harvests tables in the <span style={{ color: 'var(--ink-1)' }}>non-excluded</span> schemas (not delta-only).</p>
              <p>For &quot;only these schemas&quot;, Limit globs (e.g. <span className="font-mono">catalog.schema.*</span>) are clearer than excluding the rest of the estate.</p>
            </div>
          )}

          {/* Auto-split preview — replaces the old "Scope too large" blockers */}
          {(splitPlansLoading || activePlan || splitPlanError) && (
            <div className="rounded-lg border p-4 space-y-3"
              style={{ borderColor: activePlan?.needsSplit ? 'color-mix(in srgb, var(--brand-a) 40%, transparent)' : 'rgba(45,212,160,0.3)', backgroundColor: activePlan?.needsSplit ? 'color-mix(in srgb, var(--brand-a) 4%, transparent)' : 'rgba(45,212,160,0.04)' }}>
              <div className="flex items-center gap-2.5">
                {splitPlansLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin shrink-0" style={{ borderColor: 'var(--brand-a-ink)', borderTopColor: 'transparent' }} />
                ) : activePlan?.needsSplit ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-a-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2DD4A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
        <span className="text-label " style={{ color: splitPlansLoading ? 'var(--brand-a-ink)' : activePlan?.emptyScope ? '#EF4444' : activePlan?.needsSplit ? 'var(--brand-a-ink)' : '#2DD4A0' }}>
                  {splitPlansLoading ? 'Calculating split plan...' : activePlan?.emptyScope ? 'Nothing to run at this stage' : activePlan?.needsSplit ? 'Auto-split enabled' : 'Fits in a single job'}
                </span>
              </div>

              {!splitPlansLoading && activePlan && (
                <div className="text-[length:var(--type-caption-size)] font-sans pl-1 space-y-1" style={{ color: activePlan.emptyScope ? '#FCA5A5' : '#93C5FD' }}>
                  <div>
                    {activePlan.humanSummary ?? (
                      activePlan.registry === 'estate'
                        ? `${activePlan.totalObjects.toLocaleString()} table(s) in discovery match this plan`
                        : `${activePlan.totalObjects.toLocaleString()} scanned table(s) match this plan`
                    )}
                    {confirm.includePatterns.trim() ? ' (Limit applied)' : ''}
                  </div>
                  {activePlan.registry === 'estate' && typeof activePlan.scannedObjects === 'number' && (
                    <div style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                      Already scanned: {activePlan.scannedObjects.toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {!splitPlansLoading && splitPlanError && (
                <div className="text-[length:var(--type-caption-size)] font-mono px-3 py-2 rounded border" style={{ color: inkOf('#EF4444'), borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.08)' }}>
                  Could not load job plan: {splitPlanError}
                </div>
              )}

              {!splitPlansLoading && activePlan?.scopeWarning && (
                <div className="text-[length:var(--type-caption-size)] font-mono px-3 py-2 rounded border" style={{ color: inkOf('#EF4444'), borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.08)' }}>
                  {activePlan.scopeWarning}
                </div>
              )}

              {!splitPlansLoading && activePlan?.harvestModelId && confirm.kinds.includes('t2_semantic') && (
                <div className="text-[length:var(--type-caption-size)] font-sans pl-1" style={{ color: inkOf('#8892A4') }}>
                  Description model: <span style={{ color: 'var(--ink-1)' }}>{activePlan.harvestModelId}</span>
                </div>
              )}

              {!splitPlansLoading && activePlan?.needsSplit && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 pl-1 pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-size-title-section font-mono font-semibold" style={{ color: 'var(--brand-a-ink)' }}>{activePlan.chunks}</span>
                    <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>chunks ({activePlan.maxObjectsPerChunk} obj each)</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-size-title-section font-mono font-semibold" style={{ color: 'var(--ink-1)' }}>{activePlan.timeBudgetMinutes} min</span>
                    <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>budget per chunk</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-size-title-section font-mono font-semibold" style={{ color: inkOf('#93C5FD') }}>~{activePlan.estimatedWallClockMinutes} min</span>
                    <span className="text-size-ui font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>wall-clock ({activePlan.maxConcurrent} concurrent)</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-size-title-section font-mono font-semibold" style={{ color: activePlan.estimatedCostUsd > 0 ? '#F59E0B' : '#2DD4A0' }}>
                      {activePlan.estimatedCostUsd > 0 ? `~$${activePlan.estimatedCostUsd.toFixed(2)}` : '$0'}
                    </span>
                    <span className="text-size-ui font-sans" style={{ color: 'var(--text-secondary, #8892A4)' }}>est. LLM cost</span>
                  </div>
                </div>
              )}

              {!splitPlansLoading && activePlan?.needsSplit && (
                <div className="text-size-ui font-sans pt-1" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  Split into {activePlan.chunks} batches. {activePlan.maxConcurrent} run at once; the rest start as earlier batches finish.
                </div>
              )}
            </div>
          )}

          {/* Focus / include patterns */}
          <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', backgroundColor: 'var(--muted, rgba(0,0,0,0.15))' }}>
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--brand-a-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
       <span className="text-label " style={{ color: 'var(--text-secondary, #8892A4)' }}>
                Limit to schemas or tables (optional)
              </span>
            </div>
            <textarea
              rows={2}
              placeholder={'catalog.schema.table\ncatalog.schema.*'}
              value={confirm.includePatterns}
              onChange={e => onChangeIncludePatterns(e.target.value)}
              className="w-full rounded border px-3 py-2 text-size-ui font-mono resize-none outline-none focus:ring-1"
              style={{
                backgroundColor: 'var(--bg, rgba(0,0,0,0.3))',
                borderColor: 'var(--line-1)',
                color: 'var(--text-primary, #e8ecf0)',
                // @ts-ignore
                '--tw-ring-color': 'var(--brand-a-ink)',
              }}
            />
            <p className="text-size-ui font-sans" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
              One pattern per line or comma-separated, e.g. <code className="opacity-70">catalog.schema.*</code>. Supports <code className="opacity-70">*</code> wildcards. Leave empty to use full source scope.
            </p>
          </div>

          {/* Sequential toggle — shown when multiple kinds selected */}
          {confirm.kinds.length > 1 && (
            <div className="flex items-center justify-between rounded-lg border px-4 py-3"
              style={{ borderColor: confirm.sequential ? 'color-mix(in srgb, var(--brand-a) 40%, transparent)' : 'var(--border, rgba(255,255,255,0.08))', backgroundColor: confirm.sequential ? 'color-mix(in srgb, var(--brand-a) 5%, transparent)' : 'var(--muted, rgba(0,0,0,0.15))' }}>
              <div>
                <div className="text-size-ui font-mono font-semibold" style={{ color: confirm.sequential ? 'var(--brand-a-ink)' : 'var(--text-primary, #e8ecf0)' }}>
                  Run pipeline in order ({confirm.kinds.join(' → ')})
                </div>
                <div className="text-caption mt-0.5" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  {confirm.sequential
                    ? 'Each stage waits for the previous to complete before launching'
                    : 'All job types launch simultaneously as independent containers'}
                </div>
              </div>
              <button
                onClick={onToggleSequential}
                className="relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200"
                style={{ backgroundColor: confirm.sequential ? 'var(--brand-a-ink)' : 'rgba(255,255,255,0.15)' }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: confirm.sequential ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          )}
        </div>

        {(confirm.kinds.includes('t0_structural')
          || confirm.kinds.includes('t1_profile')
          || confirm.kinds.includes('t2_semantic')) && (
          <div className="px-7 py-3 border-t space-y-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
            <div className="text-size-ui font-mono font-semibold" style={{ color: 'var(--text-secondary, #8892A4)' }}>
              Run all in scope (new versions, ignore stale skip)
            </div>
            <div className="flex flex-wrap gap-4 text-size-ui" style={{ color: 'var(--ink-1)' }}>
              {confirm.kinds.includes('t0_structural') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirm.forceFullScan} onChange={() => onToggleRunnerFlag('forceFullScan')} />
                  Full T0 listing
                </label>
              )}
              {confirm.kinds.includes('t1_profile') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirm.forceReprofile} onChange={() => onToggleRunnerFlag('forceReprofile')} />
                  Re-profile all
                </label>
              )}
              {confirm.kinds.includes('t2_semantic') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirm.forceReEnrich} onChange={() => onToggleRunnerFlag('forceReEnrich')} />
                  Re-enrich all
                </label>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-7 py-5 flex items-center justify-between border-t" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
          <div className="text-size-ui font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>
            {confirm.includePatterns.trim()
              ? `Limit: ${limitPatterns.length} pattern${limitPatterns.length !== 1 ? 's' : ''}`
              : confirm.excludeSchemas.size > 0
                ? `${confirm.excludeSchemas.size} schema${confirm.excludeSchemas.size !== 1 ? 's' : ''} excluded`
                : 'Full source scope'}
            {confirm.kinds.length > 1 && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-size-ui font-semibold uppercase" style={{ backgroundColor: confirm.sequential ? 'color-mix(in srgb, var(--brand-a) 15%, transparent)' : 'color-mix(in srgb, var(--ink-1) 8%, transparent)', color: confirm.sequential ? 'var(--brand-a-ink)' : 'var(--text-tertiary, #8892A4)' }}>
                {confirm.sequential ? 'sequential' : 'parallel'}
              </span>
            )}
            {activePlan?.needsSplit && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-size-ui font-semibold uppercase" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-a) 15%, transparent)', color: 'var(--brand-a-ink)' }}>
                {activePlan.chunks} chunks
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onCancel} disabled={submitting}
              className="px-5 py-2.5 rounded-lg border text-size-body font-mono font-semibold transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ borderColor: 'var(--border, rgba(255,255,255,0.12))', color: 'var(--text-primary, #b0b8c4)' }}>
              Cancel
            </button>
            <button onClick={onConfirm} disabled={submitting || confirm.loading || launchBlocked}
       className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-lg border text-ui transition duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--brand-a)', color: '#FFFFFF', borderColor: 'var(--brand-a)' }}>
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#111322', borderTopColor: 'transparent' }} />
                  Launching...
                </>
              ) : activePlan?.needsSplit ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                  Start {activePlan.chunks} batches
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Start {confirm.kinds.length} job{confirm.kinds.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunJobButton({
  onJobQueued,
  launchRequest,
  hideTrigger = false,
}: {
  onJobQueued: () => void;
  /** Mount only the confirm modal (driven by launchRequest), without the dropdown button. */
  hideTrigger?: boolean;
  /** Open the confirm modal for one kind (nonce makes repeat clicks re-trigger). */
  launchRequest?: { kind: string; nonce: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [splitPlans, setSplitPlans] = useState<Partial<Record<string, SplitPlanPreview>>>({});
  const [splitPlansLoading, setSplitPlansLoading] = useState(false);
  const [splitPlanError, setSplitPlanError] = useState<string | null>(null);
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
    scope: {
      excludeSchemas: Set<string>;
      includedSchemas: Set<string>;
      scopeTreeMode: 'exclude' | 'include';
      includePatterns: string;
    },
    sourceId: string | null,
    signal: AbortSignal,
  ) => {
    const splittableKinds = ['t0_structural', 't1_profile', 't2_semantic'];
    const kindsToCheck = kinds.filter(k => splittableKinds.includes(k));
    if (kindsToCheck.length === 0) {
      if (!signal.aborted) {
        setSplitPlans({});
        setSplitPlanError(null);
        setSplitPlansLoading(false);
      }
      return;
    }

    const requestId = ++splitPlanRequestRef.current;
    if (!signal.aborted) {
      setSplitPlansLoading(true);
      setSplitPlanError(null);
    }

    const scopeFilters = resolveModalLaunchScope({
      includePatternsText: scope.includePatterns,
      scopeTreeMode: scope.scopeTreeMode,
      excludeSchemas: Array.from(scope.excludeSchemas),
      includedSchemas: Array.from(scope.includedSchemas),
    });

    const plans = await Promise.all(
      kindsToCheck.map(async (kind) => {
        try {
          const res = await fetch('/api/agent-lab/context/jobs/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind,
              excludeSchemas: stripExcludeSchemasForKind(kind, scopeFilters.excludeSchemas),
              includePatterns: scopeFilters.includePatterns,
              ...(sourceId ? { sourceId } : {}),
            }),
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            return { kind, plan: data as SplitPlanPreview, error: null as string | null };
          }
          let errMsg = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (typeof body?.error === 'string') {
              errMsg = body.message ? `${body.error}: ${body.message}` : body.error;
            }
          } catch {
            // ignore
          }
          return { kind, plan: null, error: errMsg };
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return { kind, plan: null, error: null };
          const msg = err instanceof Error ? err.message : String(err);
          return { kind, plan: null, error: msg };
        }
      }),
    );

    if (signal.aborted || requestId !== splitPlanRequestRef.current || activeSplitPlanScopeRef.current !== scopeKey) return;

    const nextPlans: Partial<Record<string, SplitPlanPreview>> = {};
    const errors: string[] = [];
    for (const { kind, plan, error } of plans) {
      if (plan) nextPlans[kind] = plan;
      if (error) errors.push(`${kind}: ${error}`);
    }
    setSplitPlans(nextPlans);
    if (errors.length > 0) {
      const message = errors.join(' · ');
      setSplitPlanError(message);
      toast.error('Could not load job plan', { description: message });
    } else {
      setSplitPlanError(null);
    }
    setSplitPlansLoading(false);
  }, []);

  const splitPlanScopeKey = confirm && !confirm.loading
    ? `${confirm.sourceId ?? ''}|${confirm.kinds.join(',')}|${confirm.scopeTreeMode}|${Array.from(confirm.excludeSchemas).sort().join('|')}|${Array.from(confirm.includedSchemas).sort().join('|')}|${confirm.includePatterns}`
    : null;

  useEffect(() => {
    if (!splitPlanScopeKey || !confirm || confirm.loading) return;

    const scopeKey = splitPlanScopeKey;
    const { kinds, sourceId } = confirm;
    const debounceMs = confirm.includePatterns.trim() ? 400 : 0;

    const timer = setTimeout(() => {
      activeSplitPlanScopeRef.current = scopeKey;
      splitPlanAbortRef.current?.abort();
      const ac = new AbortController();
      splitPlanAbortRef.current = ac;
      refreshSplitPlans(scopeKey, kinds, {
        excludeSchemas: confirm.excludeSchemas,
        includedSchemas: confirm.includedSchemas,
        scopeTreeMode: confirm.scopeTreeMode,
        includePatterns: confirm.includePatterns,
      }, sourceId, ac.signal);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [splitPlanScopeKey, refreshSplitPlans]);

  // Seeded with the request present at mount so a remount (e.g. switching page level) does not replay it.
  const lastLaunchNonceRef = useRef<number | null>(launchRequest?.nonce ?? null);
  useEffect(() => {
    if (!launchRequest || lastLaunchNonceRef.current === launchRequest.nonce) return;
    lastLaunchNonceRef.current = launchRequest.nonce;
    void openConfirmation([launchRequest.kind]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest]);

  function closeConfirm() {
    splitPlanRequestRef.current++;
    splitPlanAbortRef.current?.abort();
    splitPlanAbortRef.current = null;
    activeSplitPlanScopeRef.current = null;
    setSplitPlans({});
    setSplitPlanError(null);
    setSplitPlansLoading(false);
    setConfirm(null);
  }

  async function openConfirmation(kindsOverride?: string[]) {
    const launchKinds = kindsOverride ?? Array.from(selectedKinds);
    if (kindsOverride) setSelectedKinds(new Set(kindsOverride));
    setOpen(false);
    activeSplitPlanScopeRef.current = null;
    setSplitPlans({});
    setSplitPlanError(null);
    setSplitPlansLoading(false);
    setConfirm({
      kinds: launchKinds,
      objectCount: null,
      sourceName: null,
      sourceId: null,
      availableSources: [],
      scopeInclude: null,
      loading: true,
      tree: null,
      excludeSchemas: new Set(),
      includedSchemas: new Set(),
      scopeTreeMode: 'exclude',
      includePatterns: '',
      sequential: launchKinds.length > 1,
      forceFullScan: false,
      forceReprofile: false,
      forceReEnrich: false,
    });
    try {
      const sourcesRes = await fetch('/api/agent-lab/context/sources');
      let sourceName: string | null = null;
      let sourceId: string | null = null;
      let scopeInclude: string[] | null = null;
      let availableSources: LaunchSourceOption[] = [];
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        const list = Array.isArray(data.sources) ? data.sources : [];
        availableSources = list.map((s: { id: string; display_name?: string; connection_kind?: string }) => ({
          id: s.id,
          label: s.display_name ?? s.connection_kind ?? s.id,
        }));
        const source = list[0];
        sourceName = source?.display_name ?? source?.connection_kind ?? null;
        sourceId = source?.id ?? null;
        scopeInclude = Array.isArray(source?.scope_include) ? source.scope_include : null;
      }
      const facetsUrl = sourceId
        ? `/api/agent-lab/context/estate/facets?sourceId=${encodeURIComponent(sourceId)}`
        : '/api/agent-lab/context/estate/facets';
      const facetsRes = await fetch(facetsUrl);
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
      const kindsArray = launchKinds;
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
      setConfirm(prev => prev ? {
        ...prev,
        objectCount,
        sourceName,
        sourceId,
        availableSources,
        scopeInclude,
        tree,
        excludeSchemas: autoExclude,
        loading: false,
      } : null);
    } catch {
      setConfirm(prev => prev ? { ...prev, loading: false } : null);
    }
  }

  function toggleSchema(key: string) {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => {
      if (!prev) return null;
      if (prev.scopeTreeMode === 'include') {
        const next = new Set(prev.includedSchemas);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...prev, includedSchemas: next };
      }
      const next = new Set(prev.excludeSchemas);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, excludeSchemas: next };
    });
  }

  function excludeAllSchemas() {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => {
      if (!prev?.tree) return prev;
      if (prev.scopeTreeMode === 'include') {
        const next = new Set(prev.includedSchemas);
        for (const cat of prev.tree) {
          for (const sch of cat.schemas) {
            next.add(`${cat.catalog}.${sch.name}`);
          }
        }
        return { ...prev, includedSchemas: next };
      }
      const next = new Set(prev.excludeSchemas);
      for (const cat of prev.tree) {
        for (const sch of cat.schemas) {
          next.add(`${cat.catalog}.${sch.name}`);
        }
      }
      return { ...prev, excludeSchemas: next };
    });
  }

  function clearExcludeSchemas() {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => {
      if (!prev) return null;
      if (prev.scopeTreeMode === 'include') {
        return { ...prev, includedSchemas: new Set() };
      }
      return { ...prev, excludeSchemas: new Set() };
    });
  }

  function setScopeTreeMode(mode: 'exclude' | 'include') {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => (prev ? { ...prev, scopeTreeMode: mode } : null));
  }

  function changeIncludePatterns(val: string) {
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => prev ? { ...prev, includePatterns: val } : null);
  }

  function toggleSequential() {
    setConfirm(prev => prev ? { ...prev, sequential: !prev.sequential } : null);
  }

  function toggleRunnerFlag(key: 'forceFullScan' | 'forceReprofile' | 'forceReEnrich') {
    setConfirm(prev => (prev ? { ...prev, [key]: !prev[key] } : null));
  }

  async function changeLaunchSource(sourceId: string) {
    if (!confirm) return;
    activeSplitPlanScopeRef.current = null;
    setConfirm(prev => prev ? { ...prev, sourceId, loading: true } : null);
    try {
      const selected = confirm.availableSources.find(s => s.id === sourceId);
      const sourcesRes = await fetch('/api/agent-lab/context/sources');
      let scopeInclude: string[] | null = null;
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        const source = (data.sources ?? []).find((s: { id: string }) => s.id === sourceId);
        scopeInclude = Array.isArray(source?.scope_include) ? source.scope_include : null;
      }
      const facetsRes = await fetch(
        `/api/agent-lab/context/estate/facets?sourceId=${encodeURIComponent(sourceId)}`,
      );
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
      setConfirm(prev => prev ? {
        ...prev,
        sourceId,
        sourceName: selected?.label ?? prev.sourceName,
        scopeInclude,
        objectCount,
        tree,
        loading: false,
      } : null);
    } catch {
      setConfirm(prev => prev ? { ...prev, loading: false } : null);
    }
  }

  async function triggerJob() {
    if (!confirm) return;
    setSubmitting(true);
    try {
      const { includePatterns, excludeSchemas } = resolveModalLaunchScope({
        includePatternsText: confirm.includePatterns,
        scopeTreeMode: confirm.scopeTreeMode,
        excludeSchemas: Array.from(confirm.excludeSchemas),
        includedSchemas: Array.from(confirm.includedSchemas),
      });
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: confirm.kinds,
          excludeSchemas: launchUsesEstateExcludeTree(confirm.kinds) ? excludeSchemas : [],
          includePatterns,
          sequential: confirm.sequential,
          ...(confirm.forceFullScan ? { forceFullScan: true } : {}),
          ...(confirm.forceReprofile ? { forceReprofile: true } : {}),
          ...(confirm.forceReEnrich ? { forceReEnrich: true } : {}),
          ...(confirm.sourceId ? { sourceId: confirm.sourceId } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const modeLabel = confirm.sequential ? 'sequential' : 'parallel';
        const hasSplit = data.split_summaries && data.split_summaries.length > 0;
        if (hasSplit) {
          const total = data.split_summaries.reduce((s: number, ss: any) => s + ss.totalChildren, 0);
          toast.success(`Started ${total} batches`, {
            description: `${data.split_summaries.map((ss: any) => `${ss.kind}: ${ss.totalChildren} chunks`).join(' | ')} | ${modeLabel}`,
          });
        } else {
          toast.success(`Started ${confirm.kinds.length} job type${confirm.kinds.length !== 1 ? 's' : ''}`, {
            description: `${data.jobs_enqueued} job(s) enqueued | ${data.task_arns?.length ?? 0} container(s) started | ${modeLabel}`,
          });
        }
        setSelectedKinds(new Set());
        onJobQueued();
        closeConfirm();
      } else {
        const err = await res.json().catch(() => ({})) as {
          error?: string;
          message?: string;
          failures?: { reason?: string; arn?: string }[];
          jobs_enqueued?: number;
        };
        const failureReasons = (err.failures ?? [])
          .map(f => f.reason)
          .filter(Boolean)
          .join(' | ');
        const description = err.message
          || failureReasons
          || err.error
          || res.statusText;
        console.error(
          '[jobs/launch] failed',
          res.status,
          failureReasons || err.error || err.message,
          err,
        );
        toast.error('Could not start the job', {
          description: failureReasons
            ? `${description}${err.jobs_enqueued ? ` (${err.jobs_enqueued} job(s) left queued)` : ''}`
            : description,
          duration: 12000,
        });
      }
    } catch {
      toast.error('Network error', { description: 'Could not reach the server.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!hideTrigger && (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-ctl border text-label transition-[transform,background-color] duration-hover ease-out-strong active:scale-[0.97] hover:bg-[color-mix(in_srgb,var(--brand-a)_8%,transparent)]"
          style={{ backgroundColor: 'var(--card)', color: 'var(--brand-a-ink)', borderColor: 'color-mix(in srgb, var(--brand-a) 45%, transparent)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Run a job
          {selectedKinds.size > 0 && (
            <span className="px-1.5 py-0.5 rounded text-size-ui font-semibold" style={{ backgroundColor: 'var(--brand-a)', color: 'var(--on-brand)' }}>
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
            style={{ backgroundColor: 'var(--card, #1a2332)', borderColor: 'color-mix(in srgb, var(--brand-a) 30%, transparent)' }}
          >
            {/* Panel header */}
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 15%, transparent)' }}>
       <span className="text-label " style={{ color: 'var(--brand-a-ink)' }}>
                Select job types to run
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedKinds(new Set(TRIGGERABLE_JOBS.map(j => j.kind)))}
                  className="text-size-ui font-mono font-medium hover:underline" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
                  all
                </button>
                <span style={{ color: 'var(--text-tertiary, #8892A4)' }}>|</span>
                <button onClick={() => setSelectedKinds(new Set())}
                  className="text-size-ui font-mono font-medium hover:underline" style={{ color: 'var(--text-tertiary, #8892A4)' }}>
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
                        borderColor: 'color-mix(in srgb, var(--brand-a) 12%, transparent)',
                        backgroundColor: 'var(--card, #1a2332)',
                      }}
                    >
                      <span
                        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-size-ui font-mono font-semibold"
                        style={{ color: 'var(--brand-a-ink)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 10%, transparent)' }}
                      >
                        {group.step}
                      </span>
           <span className="text-label " style={{ color: 'var(--text-secondary, #8892A4)' }}>
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
                            backgroundColor: checked ? `${withAlpha(meta.color, '10')}` : 'transparent',
                          }}
                          onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--muted, rgba(255,255,255,0.04))'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = checked ? `${withAlpha(meta.color, '10')}` : 'transparent'; }}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition`}
                            style={{
                              borderColor: checked ? meta.color : 'var(--border, rgba(255,255,255,0.2))',
                              backgroundColor: checked ? meta.color : 'transparent',
                            }}>
                            {checked && (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#111322" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </div>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-size-body font-mono font-semibold" style={{ color: checked ? inkOf(meta.color) : 'var(--ink-1)' }}>
                              {job.label}
                            </div>
                            <div className="text-size-ui mt-0.5 leading-relaxed truncate" style={{ color: 'var(--text-secondary, #8892A4)' }}>
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
              <span className="text-size-ui font-mono" style={{ color: 'var(--text-secondary, #8892A4)' }}>
                {selectedKinds.size === 0 ? 'Select at least one job type' : `${selectedKinds.size} selected`}
              </span>
              <button
                disabled={selectedKinds.size === 0}
                onClick={() => openConfirmation()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded border text-label transition duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--brand-a)', color: 'var(--on-brand)', borderColor: 'var(--brand-a)' }}
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
      )}

      {confirm && (
        <RunJobConfirmModal
          confirm={confirm}
          splitPlans={splitPlans}
          splitPlansLoading={splitPlansLoading}
          splitPlanError={splitPlanError}
          onCancel={closeConfirm}
          onConfirm={triggerJob}
          onToggleSchema={toggleSchema}
          onExcludeAllSchemas={excludeAllSchemas}
          onClearExcludeSchemas={clearExcludeSchemas}
          onSetScopeTreeMode={setScopeTreeMode}
          onChangeIncludePatterns={changeIncludePatterns}
          onToggleSequential={toggleSequential}
          onToggleRunnerFlag={toggleRunnerFlag}
          onChangeSourceId={changeLaunchSource}
          submitting={submitting}
        />
      )}
    </>
  );
}

function StatusChip({ status, stats, jobKind }: { status: string; stats?: unknown; jobKind?: string }) {
  const mapped = resolveDisplayJobStatus(status, stats, jobKind);
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    queued:         { color: 'var(--ink-3)', bg: 'rgba(136,146,164,0.08)', border: 'rgba(136,146,164,0.25)' },
    running:        { color: 'var(--brand-a-ink)', bg: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',  border: 'color-mix(in srgb, var(--brand-a) 30%, transparent)'   },
    done:           { color: '#2DD4A0', bg: 'rgba(45,212,160,0.08)',  border: 'rgba(45,212,160,0.25)'  },
    failed:         { color: '#EF4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)'   },
    orchestrating:  { color: '#93C5FD', bg: 'rgba(147,197,253,0.08)', border: 'rgba(147,197,253,0.3)'  },
    empty:          { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)' },
  };
  const s = styles[mapped] ?? styles.queued;
  return (
    <span
   className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-label "
      style={{ color: inkOf(s.color), backgroundColor: s.bg, borderColor: s.border }}
      title={mapped === 'empty' ? 'Succeeded but processed 0 objects — check logs / Focus' : undefined}
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

// ── L1: overview — stats, attention, stage table ─────────────────────────────

type StatsWindow = '1' | '7' | '30' | 'all';

const STATS_WINDOWS: { value: StatsWindow; label: string; long: string }[] = [
  { value: '1', label: '24h', long: 'last 24 hours' },
  { value: '7', label: '7d', long: 'last 7 days' },
  { value: '30', label: '30d', long: 'last 30 days' },
  { value: 'all', label: 'All', long: 'all time' },
];

function parseStatsWindow(raw: string | null): StatsWindow {
  return raw === '1' || raw === '30' || raw === 'all' ? raw : '7';
}

const OK_COLOR = '#2DD4A0';
const WARN_COLOR = '#F59E0B';
const FAIL_COLOR = '#EF4444';
const RECENT_SLOTS = 14;

function rateTone(rate: number): string {
  return rate >= 90 ? OK_COLOR : rate >= 70 ? WARN_COLOR : FAIL_COLOR;
}

function finishedSuccessRate(ok: number, failed: number): number | null {
  const finished = ok + failed;
  return finished > 0 ? Math.round((ok / finished) * 100) : null;
}

type RunDotStatus = 'done' | 'failed' | 'empty' | 'running' | 'orchestrating' | 'queued' | 'cancelled';

function runDotStatus(run: KindRecentRun, kind: string): RunDotStatus {
  const s = run.status.toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return resolveDisplayJobStatus(run.status, run.stats, kind);
}

const RUN_DOT_STYLE: Record<RunDotStatus, { color: string; label: string }> = {
  done: { color: OK_COLOR, label: 'succeeded' },
  failed: { color: FAIL_COLOR, label: 'failed' },
  empty: { color: WARN_COLOR, label: 'succeeded with 0 objects' },
  running: { color: 'var(--brand-a)', label: 'running' },
  orchestrating: { color: '#93C5FD', label: 'orchestrating' },
  queued: { color: 'color-mix(in srgb, var(--ink-1) 30%, transparent)', label: 'queued' },
  cancelled: { color: 'color-mix(in srgb, var(--ink-1) 35%, transparent)', label: 'cancelled' },
};

/** Run-strip bar paint; cancelled runs are hollow so they never read as an empty slot. */
function runBarStyle(st: RunDotStatus): React.CSSProperties {
  const color = RUN_DOT_STYLE[st].color;
  return st === 'cancelled'
    ? { backgroundColor: 'transparent', boxShadow: `inset 0 0 0 1px ${color}` }
    : { backgroundColor: color };
}

function RunDots({ runs, kind }: { runs: KindRecentRun[]; kind: string }) {
  const ordered = [...runs].slice(0, RECENT_SLOTS).reverse();
  const pad = RECENT_SLOTS - ordered.length;
  const counts = ordered.reduce<Record<string, number>>((acc, r) => {
    const st = runDotStatus(r, kind);
    acc[st] = (acc[st] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${RUN_DOT_STYLE[k as RunDotStatus].label}`).join(', ');
  return (
    <div
      className="flex items-center gap-[3px]"
      role="img"
      aria-label={ordered.length ? `Last ${ordered.length} runs, oldest first: ${summary}` : 'No runs yet'}
    >
      {Array.from({ length: pad }).map((_, i) => (
        <span key={`pad-${i}`} className="h-3 w-1.5 rounded-[2px] bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)]" />
      ))}
      {ordered.map(run => {
        const st = runDotStatus(run, kind);
        const style = RUN_DOT_STYLE[st];
        const when = relativeTime(run.finished_at ?? run.created_at);
        const dur = run.duration_s != null ? ` · ${formatDurationS(Math.round(run.duration_s))}` : '';
        return (
          <span
            key={run.id}
            title={`${style.label} · ${when}${dur}`}
            className={cn('w-1.5 rounded-[2px]', st === 'failed' ? 'h-3.5' : 'h-3', (st === 'running' || st === 'orchestrating') && 'animate-pulse')}
            style={runBarStyle(st)}
          />
        );
      })}
    </div>
  );
}

function InlineStat({
  label,
  value,
  valueColor,
  delta,
  sub,
  title,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  delta?: React.ReactNode;
  sub?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5" title={title}>
      <span className="font-mono text-ui font-semibold tabular-nums" style={{ color: valueColor ?? 'var(--estate-ink)' }}>
        {value}
      </span>
      <span className="text-caption text-[var(--estate-text-secondary)]">{label}</span>
      {delta}
      {sub && <span className="truncate text-caption text-[var(--estate-text-muted)]">{sub}</span>}
    </div>
  );
}

/** Short, consistent "how long ago" for attention rows (avoids mixing dates and relative times). */
function agoText(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Window-level run stats + attention list shared by the Health tab card and the Job types strip. */
function computeRunHealth(summaries: KindSummary[]) {
  const sum = (pick: (s: KindSummary) => number | null | undefined) =>
    summaries.reduce((acc, s) => acc + (pick(s) ?? 0), 0);
  const total = sum(s => s.total);
  const failed = sum(s => s.failed);
  const rate = finishedSuccessRate(sum(s => s.succeeded) + sum(s => s.partial), failed);
  const items = buildAttentionItems(summaries);
  const kinds = [...new Set(items.map(i => i.kind))];
  const tone = items.length === 0 ? OK_COLOR : items.some(i => i.severity === 'fail') ? FAIL_COLOR : WARN_COLOR;
  return {
    sum, total, failed, rate, items, kinds, tone,
    runningNow: sum(s => s.running),
    queuedNow: sum(s => s.queued),
    headline: items.length === 0
      ? 'All job types healthy'
      : `${kinds.length} job type${kinds.length === 1 ? ' needs' : 's need'} attention`,
  };
}

function StatsWindowSelect({ value, onChange }: { value: StatsWindow; onChange: (w: StatsWindow) => void }) {
  return (
    <Select
      aria-label="Time window for run statistics"
      value={value}
      onChange={e => onChange(e.target.value as StatsWindow)}
      className="h-7 shrink-0 rounded-ctl border border-[var(--line-1)] bg-[var(--card)] px-2 text-caption text-[var(--estate-ink)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      {STATS_WINDOWS.map(w => (
        <option key={w.value} value={w.value}>{w.value === 'all' ? 'All time' : w.long.replace(/^last/, 'Last')}</option>
      ))}
    </Select>
  );
}

/** One-line health summary above the Job types table; the full analysis lives on the Health tab. */
function HealthStrip({
  summaries,
  window,
  onWindowChange,
  onOpenHealth,
  onSelectKind,
}: {
  summaries: KindSummary[];
  window: StatsWindow;
  onWindowChange: (w: StatsWindow) => void;
  onOpenHealth: () => void;
  onSelectKind: (kind: string) => void;
}) {
  const h = computeRunHealth(summaries);
  const shownKinds = h.kinds.slice(0, 3);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)] px-4 py-2 text-size-ui">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: h.tone }} />
      <span className="font-medium" style={{ color: h.items.length ? inkOf(h.tone) : 'var(--estate-ink)' }}>{h.headline}</span>
      {shownKinds.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {shownKinds.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => onSelectKind(k)}
              className="rounded-ctl px-1.5 py-0.5 text-caption text-[var(--estate-text-secondary)] underline-offset-2 hover:bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)] hover:text-[var(--estate-ink)] hover:underline"
            >
              {getKindMeta(k).label}
            </button>
          ))}
          {h.kinds.length > shownKinds.length && (
            <span className="text-caption text-[var(--estate-text-muted)]">+{h.kinds.length - shownKinds.length}</span>
          )}
        </span>
      )}
      <span className="text-caption text-[var(--estate-text-muted)] tabular-nums">
        {h.total === 0
          ? 'No runs'
          : `${h.rate === null ? '\u2014' : `${h.rate}%`} success \u00b7 ${h.total.toLocaleString()} run${h.total === 1 ? '' : 's'}${h.failed > 0 ? ` \u00b7 ${h.failed.toLocaleString()} failed` : ''}`}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <StatsWindowSelect value={window} onChange={onWindowChange} />
        <button
          type="button"
          onClick={onOpenHealth}
          className="group inline-flex items-center gap-0.5 whitespace-nowrap text-caption font-medium text-[var(--brand-a-ink)] hover:underline underline-offset-2"
        >
          View health
          <ChevronRight className="size-3.5 transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
        </button>
      </span>
    </div>
  );
}

// ── Health tab ───────────────────────────────────────────────────────────────

type HealthSegKey = 'done' | 'empty' | 'failed' | 'cancelled' | 'active';

const HEALTH_SEGMENTS: { key: HealthSegKey; label: string; color: string }[] = [
  { key: 'done', label: 'Succeeded', color: OK_COLOR },
  { key: 'empty', label: '0 objects', color: WARN_COLOR },
  { key: 'failed', label: 'Failed', color: FAIL_COLOR },
  { key: 'cancelled', label: 'Cancelled', color: 'color-mix(in srgb, var(--ink-1) 22%, transparent)' },
  { key: 'active', label: 'Running / queued', color: 'var(--brand-a)' },
];

function healthSeg(job: JobItem): HealthSegKey {
  const st = runDotStatus(
    { id: job.id, status: job.status, created_at: job.created_at, finished_at: job.finished_at, duration_s: null, stats: job.stats },
    job.job_kind,
  );
  return st === 'done' || st === 'empty' || st === 'failed' || st === 'cancelled' ? st : 'active';
}

interface HealthBucket {
  key: string;
  label: string;
  tip: string;
  counts: Record<HealthSegKey, number>;
}

/** Hourly buckets for the last 24h, otherwise one bucket per local day. */
function buildRunBuckets(runs: JobItem[], hourly: boolean, n: number): HealthBucket[] {
  const now = new Date();
  const keyOf = (d: Date) => (hourly ? `${d.toDateString()} ${d.getHours()}` : d.toDateString());
  const buckets: HealthBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = hourly
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - i)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.push({
      key: keyOf(d),
      label: hourly
        ? d.toLocaleTimeString(undefined, { hour: 'numeric' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      tip: hourly
        ? d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      counts: { done: 0, empty: 0, failed: 0, cancelled: 0, active: 0 },
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of runs) {
    const i = index.get(keyOf(new Date(r.created_at)));
    if (i !== undefined) buckets[i].counts[healthSeg(r)]++;
  }
  return buckets;
}

function bucketTotal(b: HealthBucket): number {
  return HEALTH_SEGMENTS.reduce((n, s) => n + b.counts[s.key], 0);
}

function formatSpan(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const mins = Math.round(s / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatCount(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString();
}

function RunsPerPeriodChart({ buckets, emptyText }: { buckets: HealthBucket[]; emptyText: string }) {
  const peak = Math.max(0, ...buckets.map(bucketTotal));
  const max = Math.max(1, peak);
  const labelEvery = Math.ceil(buckets.length / 8);
  return (
    <div className="px-4 pb-3">
      <div className="relative">
        {peak > 0 ? (
          <>
            <span className="absolute -top-0.5 left-0 font-mono text-caption tabular-nums text-[var(--estate-text-dim)]">{max}</span>
            <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-[var(--line-1)]" />
          </>
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-caption text-[var(--estate-text-muted)]">{emptyText}</p>
        )}
        <div className="flex h-32 items-end gap-[3px] border-b border-[var(--line-1)] pl-6">
          {buckets.map(b => {
            const total = bucketTotal(b);
            const parts = HEALTH_SEGMENTS.filter(s => b.counts[s.key] > 0);
            const tip = total
              ? `${b.tip}: ${parts.map(s => `${b.counts[s.key]} ${s.label.toLowerCase()}`).join(', ')}`
              : `${b.tip}: no runs`;
            return (
              <div key={b.key} title={tip} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                {total === 0 ? (
                  <div className="h-[2px] w-full max-w-[40px] rounded-sm bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]" />
                ) : (
                  <div className="flex w-full max-w-[40px] flex-col-reverse overflow-hidden rounded-t-[3px]" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
                    {parts.map(s => (
                      <div key={s.key} style={{ flex: `${b.counts[s.key]} 1 0`, backgroundColor: s.color }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[3px] pl-6">
        {buckets.map((b, i) => (
          <div key={b.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-caption text-[var(--estate-text-muted)]">
            {i % labelEvery === 0 ? b.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)]">
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h3 className="text-ui font-medium text-[var(--estate-ink)]">{title}</h3>
          {hint && <p className="mt-0.5 text-caption text-[var(--estate-text-muted)]">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function KpiTile({
  label,
  value,
  valueColor,
  sub,
  title,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  sub?: React.ReactNode;
  title?: string;
}) {
  return (
    <div title={title} className="min-w-0 rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)] px-4 py-3">
      <div className="text-caption text-[var(--estate-text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-kpi-md font-semibold leading-tight tabular-nums" style={{ color: valueColor ?? 'var(--estate-ink)' }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-caption text-[var(--estate-text-secondary)]">{sub}</div>}
    </div>
  );
}

function WindowSwitch({ value, onChange }: { value: StatsWindow; onChange: (w: StatsWindow) => void }) {
  return (
    <div role="radiogroup" aria-label="Time window" className="inline-flex shrink-0 rounded-ctl border border-[var(--line-1)] bg-[var(--card)] p-0.5">
      {STATS_WINDOWS.map(w => {
        const on = w.value === value;
        return (
          <button
            key={w.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={w.long.replace(/^last/, 'Last').replace(/^all/, 'All')}
            onClick={() => onChange(w.value)}
            className={cn(
              'h-7 rounded-[5px] px-3 text-caption transition-colors duration-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
              on
                ? 'bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] font-medium text-[var(--brand-a-ink)]'
                : 'text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)]',
            )}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

const ROW_BUTTON =
  'group w-full text-left transition-colors duration-hover hover:bg-[color-mix(in_srgb,var(--ink-1)_3%,transparent)] focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--brand-a)_6%,transparent)]';

/** Health tab: overall status, KPIs, run volume, per-job reliability, failures, attention, schedule and coverage. */
function HealthView({
  summaries,
  loading,
  canRunPipeline,
  statsWindow,
  reloadKey,
  onStatsWindowChange,
  onSelectKind,
  onSelectJob,
  onOpenActiveRuns,
  onCockpitLaunched,
  onOpenWizard,
  onStageClick,
}: {
  summaries: KindSummary[];
  loading: boolean;
  canRunPipeline: boolean;
  statsWindow: StatsWindow;
  reloadKey: number;
  onStatsWindowChange: (w: StatsWindow) => void;
  onSelectKind: (kind: string) => void;
  onSelectJob: (job: JobItem) => void;
  onOpenActiveRuns: () => void;
  onCockpitLaunched?: () => void;
  onOpenWizard?: () => void;
  onStageClick?: (tier: ScannedTier) => void;
}) {
  const hourly = statsWindow === '1';
  const runDays = statsWindow === 'all' ? 30 : Number(statsWindow);
  const [runs, setRuns] = useState<{ days: number; items: JobItem[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const after = new Date(Date.now() - runDays * 86_400_000).toISOString();
    fetchJson(`/api/agent-lab/context/jobs?after=${encodeURIComponent(after)}&pageSize=1000`).then(json => {
      if (!cancelled) setRuns({ days: runDays, items: json?.ok ? (json.data?.data?.items ?? []) : [] });
    });
    return () => { cancelled = true; };
  }, [runDays, reloadKey]);

  const runsReady = runs !== null && runs.days === runDays;
  const items = runsReady ? runs.items : [];

  const h = computeRunHealth(summaries);
  const windowLong = STATS_WINDOWS.find(w => w.value === statsWindow)?.long ?? '';
  const period = windowLong.replace('last ', '');
  const runsScope = statsWindow === 'all' ? 'last 30 days' : windowLong;
  const prevRate = statsWindow !== 'all' && summaries.some(s => s.prev_total != null)
    ? finishedSuccessRate(h.sum(s => s.prev_succeeded), h.sum(s => s.prev_failed))
    : null;

  const finished = items.filter(r => { const k = healthSeg(r); return k === 'done' || k === 'empty' || k === 'failed'; });
  const emptyRuns = items.filter(r => healthSeg(r) === 'empty').length;
  const objects = finished.reduce((n, r) => {
    const v = healthSeg(r) === 'failed' ? null : getJobPrimaryMetric(r.stats, r.job_kind)?.value;
    return n + (typeof v === 'number' ? v : 0);
  }, 0);
  const durations = finished.map(r => ({ r, s: jobDurationS(r) })).filter((x): x is { r: JobItem; s: number } => x.s !== null);
  const totalTime = durations.reduce((n, x) => n + x.s, 0);
  const longest = durations.reduce<{ r: JobItem; s: number } | null>((m, x) => (!m || x.s > m.s ? x : m), null);
  const failures = items
    .filter(r => healthSeg(r) === 'failed')
    .sort((a, b) => (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at))
    .slice(0, 6);
  const buckets = buildRunBuckets(items, hourly, hourly ? 24 : runDays);

  const reliability = summaries
    .filter(s => KIND_META[s.kind] && s.total > 0)
    .map(s => ({ s, rate: finishedSuccessRate((s.succeeded ?? 0) + (s.partial ?? 0), s.failed ?? 0) }))
    .sort((a, b) => {
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
      return a.rate - b.rate || b.s.failed - a.s.failed || b.s.total - a.s.total;
    });

  const upcoming = HARVEST_SCHEDULES
    .filter(s => s.deployment === 'live')
    .map(s => ({ sched: s, next: getNextRun(s), kind: s.id.replace(/_(daily|weekly)$/, '') }))
    .filter((x): x is { sched: (typeof HARVEST_SCHEDULES)[number]; next: Date; kind: string } => x.next !== null)
    .sort((a, b) => a.next.getTime() - b.next.getTime());
  const manualSchedules = HARVEST_SCHEDULES.filter(s => s.deployment === 'manual');

  let rateSub: string;
  if (h.rate === null) rateSub = 'No finished runs';
  else if (prevRate === null) rateSub = `${(h.total - h.runningNow - h.queuedNow).toLocaleString()} finished runs`;
  else if (h.rate > prevRate) rateSub = `Up from ${prevRate}% the previous ${period}`;
  else if (h.rate < prevRate) rateSub = `Down from ${prevRate}% the previous ${period}`;
  else rateSub = `Same as the previous ${period}`;

  const loadingSummaries = loading && summaries.length === 0;
  const skeleton = (cls: string) => <div aria-hidden className={cn('animate-pulse rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)]', cls)} />;

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Status headline */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: loadingSummaries ? 'var(--line-1)' : h.tone }} />
            <h2 className="text-title-section" style={{ color: h.items.length ? inkOf(h.tone) : 'var(--estate-ink)' }}>
              {loadingSummaries ? 'Checking job health\u2026' : h.items.length ? h.headline : 'Everything is running normally'}
            </h2>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-[var(--estate-text-secondary)]">
            <span>{h.total === 0 ? `No runs in the ${windowLong}` : `Based on ${h.total.toLocaleString()} run${h.total === 1 ? '' : 's'} in the ${windowLong}`}</span>
            {(h.runningNow > 0 || h.queuedNow > 0) && (
              <button type="button" onClick={onOpenActiveRuns} className="inline-flex items-center gap-1 text-[var(--brand-a-ink)] hover:underline underline-offset-2">
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-[var(--brand-a)]" />
                {[h.runningNow > 0 && `${h.runningNow} running now`, h.queuedNow > 0 && `${h.queuedNow} queued`].filter(Boolean).join(', ')}
                <ChevronRight className="size-3" aria-hidden />
              </button>
            )}
          </p>
        </div>
        <WindowSwitch value={statsWindow} onChange={onStatsWindowChange} />
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loadingSummaries ? (
          [0, 1, 2, 3].map(i => <React.Fragment key={i}>{skeleton('h-[86px]')}</React.Fragment>)
        ) : (
          <>
            <KpiTile
              label="Success rate"
              value={h.rate === null ? '\u2014' : `${h.rate}%`}
              valueColor={h.rate === null ? undefined : inkOf(rateTone(h.rate))}
              sub={rateSub}
              title="Finished runs that succeeded (incl. partial), excluding running and cancelled runs"
            />
            <KpiTile
              label="Runs"
              value={h.total.toLocaleString()}
              sub={
                h.failed || emptyRuns
                  ? [h.failed && `${h.failed} failed`, emptyRuns && `${emptyRuns} with 0 objects`].filter(Boolean).join(' \u00b7 ')
                  : 'None failed'
              }
            />
            <KpiTile
              label="Objects processed"
              value={runsReady ? formatCount(objects) : '\u2026'}
              sub={statsWindow === 'all' ? 'In the last 30 days' : 'Tables scanned, profiled, described or indexed'}
            />
            <KpiTile
              label="Time spent running"
              value={runsReady ? (totalTime ? formatSpan(totalTime) : '\u2014') : '\u2026'}
              sub={longest ? `Longest: ${getKindMeta(longest.r.job_kind).label}, ${longest.s >= 3600 ? formatSpan(longest.s) : formatDurationS(Math.round(longest.s))}` : statsWindow === 'all' ? 'In the last 30 days' : undefined}
            />
          </>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-4">
          <HealthCard
            title={hourly ? 'Runs per hour' : 'Runs per day'}
            hint={statsWindow === 'all' ? 'Last 30 days' : windowLong.replace(/^last/, 'Last')}
            action={
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-caption text-[var(--estate-text-muted)]">
                {HEALTH_SEGMENTS.filter(s => s.key !== 'cancelled').map(s => (
                  <span key={s.key} className="inline-flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            }
          >
            {runsReady ? <RunsPerPeriodChart buckets={buckets} emptyText={`No runs in the ${runsScope}`} /> : <div className="mx-4 mb-3 h-[150px] animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]" />}
          </HealthCard>

          <HealthCard
            title="Reliability by job type"
            hint={`Share of finished runs that succeeded, ${statsWindow === 'all' ? 'all time' : `${windowLong}`}. Least reliable first.`}
          >
            {reliability.length === 0 ? (
              <p className="px-4 pb-4 text-caption text-[var(--estate-text-muted)]">No runs in the {windowLong}.</p>
            ) : (
              <div role="table" aria-label="Reliability by job type">
                <div role="row" className="grid grid-cols-[minmax(110px,1.1fr)_minmax(120px,2fr)_48px_52px_76px] gap-3 border-y border-[var(--line-1)] px-4 py-1.5 text-caption text-[var(--estate-text-muted)]">
                  <span role="columnheader">Job type</span>
                  <span role="columnheader">Success</span>
                  <span role="columnheader" className="text-right">Runs</span>
                  <span role="columnheader" className="text-right">Failed</span>
                  <span role="columnheader" className="text-right">Typical</span>
                </div>
                {reliability.map(({ s, rate }) => (
                  <button
                    key={s.kind}
                    type="button"
                    role="row"
                    onClick={() => onSelectKind(s.kind)}
                    className={cn(ROW_BUTTON, 'grid grid-cols-[minmax(110px,1.1fr)_minmax(120px,2fr)_48px_52px_76px] items-center gap-3 border-b border-[var(--line-1)] px-4 py-2 text-size-ui last:border-0')}
                  >
                    <span role="cell" className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-full" style={{ backgroundColor: getKindMeta(s.kind).color }} />
                      <span className="truncate font-medium text-[var(--estate-ink)]">{getKindMeta(s.kind).label}</span>
                    </span>
                    <span role="cell" className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-1)_7%,transparent)]">
                        {rate !== null && <span className="block h-full rounded-full" style={{ width: `${Math.max(2, rate)}%`, backgroundColor: rateTone(rate) }} />}
                      </span>
                      <span className="w-9 text-right font-mono text-caption tabular-nums" style={{ color: rate === null ? 'var(--estate-text-dim)' : inkOf(rateTone(rate)) }}>
                        {rate === null ? '\u2014' : `${rate}%`}
                      </span>
                    </span>
                    <span role="cell" className="text-right font-mono tabular-nums text-[var(--estate-text-secondary)]">{s.total}</span>
                    <span role="cell" className="text-right font-mono tabular-nums" style={{ color: s.failed ? inkOf(FAIL_COLOR) : 'var(--estate-text-dim)' }}>{s.failed || '\u2014'}</span>
                    <span role="cell" className="text-right font-mono tabular-nums text-[var(--estate-text-secondary)]">
                      {s.median_duration_s != null ? formatDurationS(Math.round(s.median_duration_s)) : '\u2014'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </HealthCard>

          <HealthCard title="Recent failures" hint={`Newest first, ${runsScope}. Click a run to see its logs.`}>
            {!runsReady ? (
              <div className="mx-4 mb-3 h-16 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]" />
            ) : failures.length === 0 ? (
              <p className="px-4 pb-4 text-caption text-[var(--estate-text-muted)]">No failed runs in the {runsScope}.</p>
            ) : (
              <ul className="border-t border-[var(--line-1)]">
                {failures.map(job => (
                  <li key={job.id} className="border-b border-[var(--line-1)] last:border-0">
                    <button type="button" onClick={() => onSelectJob(job)} className={cn(ROW_BUTTON, 'flex flex-col gap-0.5 px-4 py-2')}>
                      <span className="flex w-full items-center gap-2 text-size-ui">
                        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: FAIL_COLOR }} />
                        <span className="font-medium text-[var(--estate-ink)]">{getKindMeta(job.job_kind).label}</span>
                        <span className="truncate text-caption text-[var(--estate-text-muted)]">{formatJobScopeHuman(job.scope)}</span>
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-caption text-[var(--estate-text-muted)]">
                          {agoText(job.finished_at ?? job.created_at)}
                          <ChevronRight className="size-3.5 text-[var(--estate-text-dim)] transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
                        </span>
                      </span>
                      <span className="line-clamp-2 break-words pl-4 font-mono text-caption" style={{ color: inkOf(FAIL_COLOR) }} title={job.error ?? undefined}>
                        {job.error ? job.error.split('\n')[0] : 'Failed without an error message'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </HealthCard>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-4">
          <HealthCard
            title="Needs attention"
            hint={h.items.length ? 'Based on each job type\u2019s latest runs and schedule.' : undefined}
          >
            {h.items.length === 0 ? (
              <div className="flex items-start gap-2 px-4 pb-4">
                <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: OK_COLOR }} />
                <p className="text-caption text-[var(--estate-text-secondary)]">
                  Nothing to fix. Every job type&rsquo;s last run succeeded and scheduled jobs are on time.
                </p>
              </div>
            ) : (
              <ul className="border-t border-[var(--line-1)]">
                {h.items.map(item => (
                  <li key={item.key} className="border-b border-[var(--line-1)] last:border-0">
                    <button type="button" onClick={() => onSelectKind(item.kind)} className={cn(ROW_BUTTON, 'flex items-start gap-2.5 px-4 py-2')}>
                      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: item.severity === 'fail' ? FAIL_COLOR : WARN_COLOR }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{getKindMeta(item.kind).label}</span>
                        <span className="block text-caption text-[var(--estate-text-secondary)]">{item.issue}</span>
                      </span>
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-caption text-[var(--estate-text-muted)]">
                        {agoText(item.when)}
                        <ChevronRight className="size-3.5 text-[var(--estate-text-dim)] transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </HealthCard>

          <HealthCard title="Coming up" hint="Next automatic runs (times in your local time zone).">
            <ul className="border-t border-[var(--line-1)]">
              {upcoming.map(({ sched, next, kind }) => {
                const meta = KIND_META[kind];
                const last = summaries.find(s => s.kind === kind)?.recent?.find(r => !['queued', 'running', 'orchestrating'].includes(r.status.toLowerCase()));
                const lastSt = last ? runDotStatus(last, kind) : null;
                return (
                  <li key={sched.id} className="border-b border-[var(--line-1)] last:border-0">
                    <button
                      type="button"
                      disabled={!meta}
                      onClick={() => meta && onSelectKind(kind)}
                      title={`${sched.description}\nScope: ${sched.scopeNote}`}
                      className={cn(ROW_BUTTON, 'flex items-center gap-3 px-4 py-2 disabled:cursor-default')}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-size-ui font-medium text-[var(--estate-ink)]">
                          {meta ? meta.label : sched.label}
                          {lastSt && (
                            <span
                              aria-label={`Last run ${RUN_DOT_STYLE[lastSt].label}`}
                              title={`Last run ${RUN_DOT_STYLE[lastSt].label}`}
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: RUN_DOT_STYLE[lastSt].color }}
                            />
                          )}
                        </span>
                        <span className="block truncate text-caption text-[var(--estate-text-muted)]">{describeCron(sched.cronStandard)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-size-ui tabular-nums text-[var(--estate-ink)]">{relativeNextRun(sched)}</span>
                        <span className="block text-caption tabular-nums text-[var(--estate-text-muted)]">
                          {next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {manualSchedules.length > 0 && (
              <p className="border-t border-[var(--line-1)] px-4 py-2 text-caption text-[var(--estate-text-muted)]">
                Not scheduled, run by hand: {manualSchedules.map(s => s.label).join(', ')}.
              </p>
            )}
          </HealthCard>

          <JobsCockpitPanel
            canRunPipeline={canRunPipeline}
            onLaunched={onCockpitLaunched}
            onOpenWizard={canRunPipeline ? onOpenWizard : undefined}
            onStageClick={onStageClick}
            defaultExpanded
          />
        </div>
      </div>
    </div>
  );
}

interface AttentionItem {
  key: string;
  kind: string;
  severity: 'fail' | 'warn';
  /** Full sentence incl. job label (tooltips). */
  text: string;
  /** Short issue without the job label. */
  issue: string;
  /** When the issue happened (last relevant run), if known. */
  when?: string | null;
}

/** Expected gap between scheduled runs, from the cron (null for manual). */
function scheduleCadenceMs(sched: (typeof HARVEST_SCHEDULES)[number]): number | null {
  const runs = getNextRuns(sched, 2);
  return runs.length === 2 ? runs[1].getTime() - runs[0].getTime() : null;
}

function buildAttentionItems(summaries: KindSummary[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const now = Date.now();
  const push = (kind: string, key: string, severity: AttentionItem['severity'], issue: string, when?: string | null) =>
    items.push({ key, kind, severity, issue, when, text: `${getKindMeta(kind).label}: ${issue}${when ? ` (${agoText(when)})` : ''}` });
  for (const s of summaries) {
    if (!KIND_META[s.kind]) continue;
    const recent = s.recent ?? [];
    const finishedRuns = recent.filter(r => !['queued', 'running', 'orchestrating'].includes(r.status.toLowerCase()));
    const lastFinished = finishedRuns[0];
    const lastStatus = lastFinished ? runDotStatus(lastFinished, s.kind) : null;
    const lastAt = lastFinished ? lastFinished.finished_at ?? lastFinished.created_at : null;
    if (lastStatus === 'failed') {
      const streak = finishedRuns.findIndex(r => runDotStatus(r, s.kind) !== 'failed');
      const n = streak === -1 ? finishedRuns.length : streak;
      push(s.kind, `${s.kind}-failed`, 'fail', n > 1 ? `Last ${n} runs failed` : 'Last run failed', lastAt);
    } else if (lastStatus === 'empty') {
      push(s.kind, `${s.kind}-empty`, 'warn', 'Last run processed 0 objects', lastAt);
    }

    const scheduleId = KIND_META[s.kind]?.scheduleId;
    const sched = scheduleId ? HARVEST_SCHEDULES.find(h => h.id === scheduleId) : null;
    if (sched && sched.deployment !== 'manual' && s.kind === sched.id.replace(/_(daily|weekly)$/, '')) {
      const cadence = scheduleCadenceMs(sched);
      const last = s.last_finished_at ? new Date(s.last_finished_at).getTime() : null;
      if (cadence && (last === null || now - last > cadence * 1.5)) {
        const expected = describeCron(sched.cronStandard);
        push(
          s.kind,
          `${s.kind}-stale`,
          'warn',
          last === null
            ? `Scheduled (${expected}) but never finished`
            : `Missed its schedule (${expected.charAt(0).toLowerCase()}${expected.slice(1)})`,
          s.last_finished_at,
        );
      }
    }
  }
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fail' ? -1 : 1));
}

function ScheduleCell({ kind }: { kind: string }) {
  const scheduleId = KIND_META[kind]?.scheduleId;
  const sched = scheduleId ? HARVEST_SCHEDULES.find(h => h.id === scheduleId) : null;
  if (!sched) return <span title="No schedule. Runs only when started by hand." className="text-[var(--estate-text-muted)]">On demand</span>;
  if (sched.deployment === 'manual') {
    return (
      <span title={`${sched.description}\nA schedule exists but is not switched on, so it runs only when started by hand.`} className="text-[var(--estate-text-muted)]">
        On demand
      </span>
    );
  }
  const relative = relativeNextRun(sched);
  const next = getNextRun(sched);
  const imminent = relative.startsWith('in') && (relative.endsWith('m') || relative === 'in 1h');
  const via = sched.id.replace(/_(daily|weekly)$/, '') === kind ? '' : ` (via ${sched.label})`;
  return (
    <span
      title={`${sched.label}${via}: ${describeCron(sched.cronStandard)}\nScope: ${sched.scopeNote}\nNext: ${next?.toUTCString() ?? 'unknown'}`}
      className="inline-flex flex-col leading-tight"
    >
      <span className={cn('tabular-nums', imminent ? 'font-medium text-[var(--brand-a-ink)]' : 'text-[var(--estate-ink)]')}>
        {relative.startsWith('in ') ? `Next ${relative}` : relative}
      </span>
      <span className="truncate text-caption text-[var(--estate-text-muted)]">{describeCron(sched.cronStandard)}{via ? ' · via change check' : ''}</span>
    </span>
  );
}

function JobStagesTable({
  summaries,
  loading,
  canRunPipeline,
  statsWindow,
  onSelectKind,
  onRunKind,
}: {
  summaries: KindSummary[];
  loading: boolean;
  canRunPipeline: boolean;
  statsWindow: StatsWindow;
  onSelectKind: (kind: string) => void;
  onRunKind?: (kind: string) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const summaryByKind: Record<string, KindSummary> = {};
  summaries.forEach(s => { summaryByKind[s.kind] = s; });
  const attention = useMemo(() => buildAttentionItems(summaries), [summaries]);
  const attentionKinds = new Set(attention.map(i => i.kind));
  const overdueKinds = new Set(attention.filter(i => i.key.endsWith('-stale')).map(i => i.kind));
  const kindGroups = getJobKindGroups(summaries.map(s => s.kind));
  const isAdvanced = (g: JobKindGroup) => g.id === 'entity_model' || g.id === 'knowledge' || g.id === 'other';
  // Advanced job types that need attention stay visible even when the section is collapsed.
  const visibleGroups = kindGroups
    .map(g => (showAdvanced || !isAdvanced(g) ? g : { ...g, kinds: g.kinds.filter(k => attentionKinds.has(k)) }))
    .filter(g => g.kinds.length > 0);
  const advancedCount = kindGroups.filter(isAdvanced).reduce((n, g) => n + g.kinds.length, 0);
  const hiddenCount = showAdvanced ? advancedCount : kindGroups.filter(isAdvanced).reduce((n, g) => n + g.kinds.filter(k => !attentionKinds.has(k)).length, 0);
  const windowLabel = statsWindow === 'all' ? 'all time' : STATS_WINDOWS.find(w => w.value === statsWindow)?.label ?? '';
  const windowLong = STATS_WINDOWS.find(w => w.value === statsWindow)?.long ?? '';
  const launchable = new Set(TRIGGERABLE_JOBS.map(j => j.kind).filter(k => !isLaunchDisabledKind(k)));
  const th = 'px-3 py-2 text-left text-caption font-medium text-[var(--estate-text-muted)]';

  return (
    <section aria-label="Job types" className="overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line-1)] px-4 py-2.5">
        <h2 className="text-title-card text-[var(--estate-ink)]">Job types</h2>
        <div className="hidden items-center gap-3 text-caption text-[var(--estate-text-muted)] md:flex" aria-hidden>
          {(['done', 'failed', 'empty', 'running', 'cancelled'] as RunDotStatus[]).map(st => (
            <span key={st} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-1.5 rounded-[2px]" style={runBarStyle(st)} />
              {st === 'done' ? 'ok' : st === 'empty' ? '0 objects' : RUN_DOT_STYLE[st].label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-size-ui">
          <thead>
            <tr className="border-b border-[var(--line-1)]">
              <th scope="col" className={cn(th, 'pl-4')}>Job type</th>
              <th scope="col" className={th}>Last {RECENT_SLOTS} runs</th>
              <th scope="col" className={cn(th, 'text-right')} title={`Share of finished runs that succeeded, ${windowLong}`}>
                Success <span className="font-normal text-[var(--estate-text-dim)]">· {windowLabel}</span>
              </th>
              <th scope="col" className={cn(th, 'hidden text-right lg:table-cell')}>Typical time</th>
              <th scope="col" className={th}>Last finished</th>
              <th scope="col" className={cn(th, 'hidden xl:table-cell')}>Schedule</th>
              <th scope="col" className={cn(th, 'w-px pr-4')}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && summaries.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--line-1)] last:border-0">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-6 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)]" />
                    </td>
                  </tr>
                ))
              : visibleGroups.map(group => (
                  <React.Fragment key={group.id}>
                    <tr className="bg-[color-mix(in_srgb,var(--ink-1)_2.5%,transparent)]">
                      <th scope="colgroup" colSpan={7} className="px-4 py-1.5 text-left font-normal">
                        <span className="inline-flex items-baseline gap-2">
                          <span className="font-mono text-caption text-[var(--brand-a-ink)]">{group.step}</span>
                          <span className="text-label text-[var(--estate-text-secondary)]" title={group.subtitle}>{group.label}</span>
                        </span>
                      </th>
                    </tr>
                    {group.kinds.map(kind => {
                      const meta = getKindMeta(kind);
                      const s = summaryByKind[kind];
                      const ok = (s?.succeeded ?? 0) + (s?.partial ?? 0);
                      const rate = s ? finishedSuccessRate(ok, s.failed) : null;
                      const lastRun = s?.recent?.find(r => !['queued', 'running', 'orchestrating'].includes(r.status.toLowerCase()));
                      const lastStatus = lastRun ? runDotStatus(lastRun, kind) : null;
                      const active = (s?.running ?? 0) + (s?.queued ?? 0);
                      const canRun = canRunPipeline && onRunKind && launchable.has(kind);
                      return (
                        <tr
                          key={kind}
                          tabIndex={0}
                          onClick={() => onSelectKind(kind)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectKind(kind); } }}
                          aria-label={`${meta.label} — open run history`}
                          className="group cursor-pointer border-b border-[var(--line-1)] transition-colors duration-hover last:border-0 hover:bg-[color-mix(in_srgb,var(--ink-1)_3%,transparent)] focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--brand-a)_6%,transparent)]"
                        >
                          <td className="py-2 pl-4 pr-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={cn('truncate font-medium', s ? 'text-[var(--estate-ink)]' : 'text-[var(--estate-text-muted)]')} title={meta.description}>{meta.label}</span>
                              {active > 0 && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-caption"
                                  style={{ color: 'var(--brand-a-ink)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 10%, transparent)' }}>
                                  <span className="size-1.5 animate-pulse rounded-full bg-[var(--brand-a)]" />
                                  {s!.running > 0 ? `${s!.running} running` : `${s!.queued} queued`}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {s?.recent?.length ? <RunDots runs={s.recent} kind={kind} /> : <span className="text-caption text-[var(--estate-text-dim)]">No runs yet</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {rate === null ? (
                              <span className="text-[var(--estate-text-dim)]" title="No finished runs in this window">—</span>
                            ) : (
                              <span title={`${ok} ok · ${s!.failed} failed, ${windowLong}`} className="whitespace-nowrap">
                                <span className="font-medium" style={{ color: inkOf(rateTone(rate)) }}>{rate}%</span>
                                <span className="ml-1.5 text-caption text-[var(--estate-text-muted)]">{(ok + s!.failed).toLocaleString()} run{ok + s!.failed === 1 ? '' : 's'}</span>
                              </span>
                            )}
                          </td>
                          <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums text-[var(--estate-text-secondary)] lg:table-cell">
                            {s?.median_duration_s != null ? formatDurationS(Math.round(s.median_duration_s)) : <span className="text-[var(--estate-text-dim)]">—</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            {lastRun ? (() => {
                              const at = lastRun.finished_at ?? lastRun.created_at;
                              const overdue = overdueKinds.has(kind);
                              const issue = attention.find(i => i.kind === kind && i.key.endsWith('-stale'))?.issue;
                              const statusLabel = RUN_DOT_STYLE[lastStatus!].label === 'succeeded' ? '' : RUN_DOT_STYLE[lastStatus!].label;
                              return (
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${at ? new Date(at).toLocaleString() : ''}${overdue && issue ? `\n${issue}` : ''}`}>
                                  <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: overdue && lastStatus === 'done' ? WARN_COLOR : RUN_DOT_STYLE[lastStatus!].color }} />
                                  <span className="text-[var(--estate-ink)]">{relativeTime(at)}</span>
                                  {statusLabel && <span className="text-caption text-[var(--estate-text-muted)]">{statusLabel}</span>}
                                  {overdue && <span className="text-caption font-medium" style={{ color: inkOf(WARN_COLOR) }}>overdue</span>}
                                </span>
                              );
                            })() : (
                              <span className={overdueKinds.has(kind) ? 'font-medium' : 'text-[var(--estate-text-dim)]'} style={overdueKinds.has(kind) ? { color: inkOf(WARN_COLOR) } : undefined}>Never</span>
                            )}
                          </td>
                          <td className="hidden max-w-[180px] px-3 py-2.5 xl:table-cell">
                            <ScheduleCell kind={kind} />
                          </td>
                          <td className="py-2.5 pl-3 pr-4">
                            <div className="flex items-center justify-end gap-1">
                              {canRun && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); onRunKind!(kind); }}
                                  onKeyDown={e => e.stopPropagation()}
                                  title={`Run ${meta.label}…`}
                                  aria-label={`Run ${meta.label}`}
                                  className="inline-flex h-7 items-center gap-1 rounded-ctl border border-transparent px-2 text-caption text-[var(--brand-a-ink)] opacity-0 transition duration-hover hover:border-[color-mix(in_srgb,var(--brand-a)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--brand-a)_8%,transparent)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>
                                  Run
                                </button>
                              )}
                              <ChevronRight className="size-4 text-[var(--estate-text-dim)] transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
          </tbody>
        </table>
      </div>

      {advancedCount > 0 && (showAdvanced || hiddenCount > 0) && (
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          aria-expanded={showAdvanced}
          className="flex w-full items-center gap-1.5 border-t border-[var(--line-1)] px-4 py-2.5 text-left text-size-ui text-[var(--estate-text-secondary)] transition-colors duration-hover hover:text-[var(--estate-ink)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <ChevronDown className={cn('size-3.5 transition-transform duration-hover', showAdvanced && 'rotate-180')} aria-hidden />
          {showAdvanced ? 'Hide advanced job types' : `Show ${hiddenCount} more advanced job type${hiddenCount === 1 ? '' : 's'}`} — business model, knowledge sync
        </button>
      )}
    </section>
  );
}

function L1View({
  summaries,
  queuedJobs,
  loading,
  canRunPipeline,
  statsWindow,
  onStatsWindowChange,
  onSelectKind,
  onRunKind,
  onCancelJob,
  onOpenActiveRuns,
  onOpenHealth,
}: {
  summaries: KindSummary[];
  queuedJobs: QueuedJobItem[];
  loading: boolean;
  canRunPipeline: boolean;
  statsWindow: StatsWindow;
  onStatsWindowChange: (w: StatsWindow) => void;
  onSelectKind: (kind: string) => void;
  onRunKind?: (kind: string) => void;
  onCancelJob: (jobId: string, kind: string) => void;
  onOpenActiveRuns?: () => void;
  onOpenHealth: () => void;
}) {
  const mutedColor = 'var(--estate-text-muted)';

  return (
    <div className="flex-1 overflow-auto p-6">
      {!loading || summaries.length > 0 ? (
        <HealthStrip
          summaries={summaries}
          window={statsWindow}
          onWindowChange={onStatsWindowChange}
          onOpenHealth={onOpenHealth}
          onSelectKind={onSelectKind}
        />
      ) : (
        <div className="mb-3 h-[42px] animate-pulse rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)]" aria-hidden />
      )}

      {/* Queued badge strip */}
      {queuedJobs.length > 0 && (
        <div
          className="mb-5 px-4 py-3 rounded-lg border flex items-center gap-3 flex-wrap"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--brand-a) 4%, transparent)' }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--brand-a)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--brand-a)]" />
          </span>
          <span className="text-label text-[var(--brand-a-ink)]">
            {queuedJobs.length} job{queuedJobs.length !== 1 ? 's' : ''} queued
          </span>
          <div className="flex flex-wrap gap-1.5 ml-2">
            {queuedJobs.slice(0, 8).map(qj => {
              const m = getKindMeta(qj.job_kind);
              return (
                <span
                  key={qj.id}
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-label group"
                  style={{ color: inkOf(m.color), backgroundColor: m.bg, borderColor: m.border }}
                >
                  {m.label}
                  {canRunPipeline && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancelJob(qj.id, qj.job_kind); }}
                      className="ml-0.5 w-3.5 h-3.5 rounded-full relative after:absolute after:-inset-1.5 after:content-[''] inline-flex items-center justify-center transition-colors hover:bg-red-500/20"
                      title="Cancel this job"
                      aria-label={`Cancel queued ${m.label}`}
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </span>
              );
            })}
            {queuedJobs.length > 8 && (
              <span className="text-size-ui font-mono" style={{ color: mutedColor }}>+{queuedJobs.length - 8} more</span>
            )}
          </div>
          {onOpenActiveRuns && (
            <button
              type="button"
              onClick={onOpenActiveRuns}
              className="ml-auto text-label underline-offset-2 hover:underline relative after:absolute after:-inset-1.5 after:content-['']"
              style={{ color: 'var(--brand-a-ink)' }}
            >
              View in Active Runs
            </button>
          )}
        </div>
      )}

      <JobStagesTable
        summaries={summaries}
        loading={loading}
        canRunPipeline={canRunPipeline}
        statsWindow={statsWindow}
        onSelectKind={onSelectKind}
        onRunKind={onRunKind}
      />
    </div>
  );
}

// ── Job type page (?kind=): status, last run, trends, pipeline context, all runs ──

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'orchestrating']);
const TREND_RUNS = 60;
const RUNS_PAGE_SIZE = 25;

function isActiveJob(status: string): boolean {
  return ACTIVE_JOB_STATUSES.has(status.toLowerCase());
}

type RunStatusFilter = 'all' | 'failed' | 'succeeded' | 'partial' | 'running' | 'queued' | 'cancelled';
const RUN_STATUS_FILTERS: { value: RunStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: 'Failed' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'partial', label: 'Partial' },
  { value: 'running', label: 'Running' },
  { value: 'queued', label: 'Queued' },
  { value: 'cancelled', label: 'Cancelled' },
];

function parseRunStatusFilter(raw: string | null): RunStatusFilter {
  return RUN_STATUS_FILTERS.some(f => f.value === raw) ? (raw as RunStatusFilter) : 'all';
}

type RunSince = 'any' | '1' | '7' | '30';
const RUN_SINCE_OPTIONS: { value: RunSince; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

function parseRunSince(raw: string | null): RunSince {
  return raw === '1' || raw === '7' || raw === '30' ? raw : 'any';
}

function jobDurationS(job: { started_at: string | null; finished_at: string | null }): number | null {
  if (!job.started_at || !job.finished_at) return null;
  const ms = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function jobDotStatus(job: JobItem): RunDotStatus {
  return runDotStatus(
    { id: job.id, status: job.status, created_at: job.created_at, finished_at: job.finished_at, duration_s: null, stats: job.stats },
    job.job_kind,
  );
}

function isParentJob(job: JobItem): boolean {
  return job.status === 'orchestrating' || (job.scope as any)?.is_parent === true;
}

/** Which pipeline jobs feed this one and which it feeds (best-effort, matches the stage order). */
const KIND_FLOW: Record<string, { up: string[]; down: string[] }> = {
  estate_inventory: { up: [], down: ['t0_structural'] },
  change_detect: { up: ['estate_inventory'], down: ['t0_structural'] },
  t0_structural: { up: ['estate_inventory', 'change_detect'], down: ['t1_profile', 't3_usage'] },
  t1_profile: { up: ['t0_structural'], down: ['t2_semantic'] },
  t2_semantic: { up: ['t1_profile'], down: ['embed', 't4_scan'] },
  embed: { up: ['t2_semantic'], down: ['knowledge_sync'] },
  t3_usage: { up: ['t0_structural'], down: [] },
  t4_scan: { up: ['t2_semantic'], down: ['knowledge_sync'] },
  knowledge_sync: { up: ['embed', 't4_scan'], down: [] },
};

type CockpitHealth = Record<string, number>;

/** Coverage this job type produces: numerator / denominator keys of the cockpit health. */
const KIND_COVERAGE: Record<string, { tier: ScannedTier; label: string; num: string; den: string; denLabel: string }> = {
  t0_structural: { tier: 't0', label: estateStageDisplayLabel(ESTATE_STAGE.scanned), num: 'scanned_objects', den: 'discovery_objects', denLabel: 'discovered' },
  t1_profile: { tier: 't1', label: estateStageDisplayLabel(ESTATE_STAGE.profiled), num: 'profiled_objects', den: 'scanned_objects', denLabel: 'scanned' },
  t2_semantic: { tier: 't2', label: estateStageDisplayLabel(ESTATE_STAGE.enriched), num: 'enriched_objects', den: 'scanned_objects', denLabel: 'scanned' },
  embed: { tier: 'embed', label: estateStageDisplayLabel(ESTATE_STAGE.searchable), num: 'embedded_objects', den: 'scanned_objects', denLabel: 'scanned' },
};

const cardClass = 'rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)]';

function KindHealthBadge({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium"
      style={{ color: inkOf(tone), borderColor: withAlpha(tone, '59'), backgroundColor: withAlpha(tone, '1A') }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
      {label}
    </span>
  );
}

function RunBars({ runs, onSelect }: { runs: JobItem[]; onSelect: (job: JobItem) => void }) {
  const ordered = [...runs].reverse();
  const durations = ordered.map(jobDurationS).filter((d): d is number => d !== null).sort((a, b) => a - b);
  // Scale to the 90th percentile so one slow outlier does not flatten every other bar.
  const cap = durations.length ? Math.max(1, durations[Math.floor((durations.length - 1) * 0.9)]) : 1;
  return (
    <div className="flex min-h-[80px] flex-1 items-end gap-[2px]" role="list" aria-label="Recent runs, oldest first">
      {ordered.map(job => {
        const st = jobDotStatus(job);
        const dur = jobDurationS(job);
        const pct = dur === null ? 35 : Math.min(100, Math.max(6, (dur / cap) * 100));
        const when = job.started_at ?? job.created_at;
        return (
          <button
            key={job.id}
            type="button"
            role="listitem"
            onClick={() => onSelect(job)}
            title={`${RUN_DOT_STYLE[st].label} · ${new Date(when).toLocaleString()}${dur !== null ? ` · ${formatDurationS(Math.round(dur))}` : ''}\n${formatStatsSummary(job.stats, job.job_kind)}`}
            aria-label={`${RUN_DOT_STYLE[st].label} run ${relativeTime(when)}`}
            className={cn(
              'min-w-[3px] max-w-[14px] flex-1 rounded-t-[2px] transition-opacity duration-hover hover:opacity-70 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
              (st === 'running' || st === 'orchestrating' || st === 'queued') && 'animate-pulse',
            )}
            style={{ height: `${pct}%`, ...runBarStyle(st) }}
          />
        );
      })}
    </div>
  );
}

function FlowChip({ kind, summary, onSelect }: { kind: string; summary?: KindSummary; onSelect: (kind: string) => void }) {
  const meta = getKindMeta(kind);
  const last = summary?.recent?.[0];
  const st = last ? runDotStatus(last, kind) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(kind)}
      title={last ? `${meta.label}: last run ${st ? RUN_DOT_STYLE[st].label : ''} ${relativeTime(last.finished_at ?? last.created_at)}` : `${meta.label}: no runs yet`}
      className="inline-flex items-center gap-1.5 rounded-ctl border border-[var(--line-1)] px-2 py-1 text-caption text-[var(--estate-ink)] transition-colors duration-hover hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: st ? RUN_DOT_STYLE[st].color : 'var(--estate-text-dim)' }} />
      {meta.label}
      <span className="text-[var(--estate-text-muted)]">{last ? relativeTime(last.finished_at ?? last.created_at) : 'never'}</span>
    </button>
  );
}

function JobKindPage({
  kind,
  summaries,
  canRunPipeline,
  reloadKey,
  statusFilter,
  since,
  day,
  highlightId,
  onFilterChange,
  onSelectKind,
  onBack,
  onRun,
  onSelectJob,
  onOpenTier,
}: {
  kind: string;
  summaries: KindSummary[];
  canRunPipeline: boolean;
  reloadKey: number;
  statusFilter: RunStatusFilter;
  since: RunSince;
  day: string | null;
  highlightId: string | null;
  onFilterChange: (updates: Record<string, string | null>) => void;
  onSelectKind: (kind: string) => void;
  onBack: () => void;
  onRun: (kind: string) => void;
  onSelectJob: (job: JobItem) => void;
  onOpenTier: (tier: ScannedTier) => void;
}) {
  const meta = getKindMeta(kind);
  const summary = summaries.find(s => s.kind === kind);
  const group = getJobKindGroups([kind]).find(g => g.kinds.includes(kind));
  const sched = meta.scheduleId ? HARVEST_SCHEDULES.find(h => h.id === meta.scheduleId) : null;
  const schedVia = sched && sched.id.replace(/_(daily|weekly)$/, '') !== kind ? sched.label : null;
  const launchable = !isLaunchDisabledKind(kind) && TRIGGERABLE_JOBS.some(j => j.kind === kind);
  const canRun = canRunPipeline && launchable;

  const [recent, setRecent] = useState<JobItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [runs, setRuns] = useState<JobItem[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [health, setHealth] = useState<CockpitHealth | null>(null);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const coverage = KIND_COVERAGE[kind];

  useEffect(() => { setPage(1); }, [kind, statusFilter, since, day]);

  const loadRecent = useCallback(async () => {
    const p = new URLSearchParams({ kind, page: '1', pageSize: String(TREND_RUNS) });
    const json = await fetchJson(`/api/agent-lab/context/jobs?${p}`);
    if (json?.ok) setRecent(json.data?.data?.items ?? []);
    setRecentLoading(false);
  }, [kind]);

  const loadRuns = useCallback(async () => {
    const p = new URLSearchParams({ kind, page: String(page), pageSize: String(RUNS_PAGE_SIZE) });
    if (statusFilter !== 'all') p.set('status', statusFilter);
    if (day) {
      p.set('after', new Date(`${day}T00:00:00Z`).toISOString());
      p.set('before', new Date(`${day}T23:59:59Z`).toISOString());
    } else if (since !== 'any') {
      p.set('after', new Date(Date.now() - Number(since) * 86_400_000).toISOString());
    }
    const json = await fetchJson(`/api/agent-lab/context/jobs?${p}`);
    if (json?.ok) {
      setRuns(json.data?.data?.items ?? []);
      setRunsTotal(json.data?.data?.total ?? 0);
    }
    setRunsLoading(false);
  }, [kind, page, statusFilter, since, day]);

  useEffect(() => { setRecentLoading(true); setRecent([]); }, [kind]);
  useEffect(() => { loadRecent(); }, [loadRecent, reloadKey]);
  useEffect(() => { setRunsLoading(true); loadRuns(); }, [loadRuns, reloadKey]);

  useEffect(() => {
    if (!coverage) { setHealth(null); return; }
    let cancelled = false;
    fetchJson('/api/agent-lab/context/jobs/cockpit').then(json => {
      if (!cancelled && json?.ok) setHealth(json.data?.health ?? null);
    });
    return () => { cancelled = true; };
  }, [coverage, reloadKey]);

  // Poll while anything for this job type is in flight.
  const hasActive = recent.some(j => isActiveJob(j.status)) || runs.some(j => isActiveJob(j.status));
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => { loadRecent(); loadRuns(); }, 10_000);
    return () => clearInterval(id);
  }, [hasActive, loadRecent, loadRuns]);

  useEffect(() => {
    if (!highlightId || runsLoading) return;
    const t = setTimeout(() => {
      document.getElementById(`job-row-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(t);
  }, [highlightId, runsLoading]);

  // ── Derived status
  const latest = recent[0] ?? null;
  const finished = recent.filter(j => !isActiveJob(j.status));
  const lastFinished = finished[0] ?? null;
  const lastFinishedStatus = lastFinished ? jobDotStatus(lastFinished) : null;
  const lastSuccess = finished.find(j => { const s = jobDotStatus(j); return s === 'done'; }) ?? null;
  const attention = summary ? buildAttentionItems([summary]) : [];
  const activeCount = (summary?.running ?? 0) + (summary?.queued ?? 0) || recent.filter(j => isActiveJob(j.status)).length;

  const badge = activeCount > 0
    ? { tone: 'var(--brand-a)', label: recent.some(j => j.status === 'running' || j.status === 'orchestrating') ? 'Running' : 'Queued' }
    : attention.some(a => a.severity === 'fail')
      ? { tone: FAIL_COLOR, label: 'Failing' }
      : attention.length > 0
        ? { tone: WARN_COLOR, label: 'Needs attention' }
        : recent.length === 0 && !recentLoading
          ? { tone: 'var(--estate-text-dim)', label: 'Never run' }
          : { tone: OK_COLOR, label: 'Healthy' };

  // ── Trend stats over the sampled runs
  const okCount = finished.filter(j => ['done', 'empty'].includes(jobDotStatus(j)) || j.status === 'partial').length;
  const failCount = finished.filter(j => jobDotStatus(j) === 'failed').length;
  const rate = finishedSuccessRate(okCount, failCount);
  const medDur = median(finished.map(jobDurationS).filter((d): d is number => d !== null));
  const medObjects = median(
    finished.map(j => getJobPrimaryMetric(j.stats, j.job_kind)?.value).filter((v): v is number => typeof v === 'number'),
  );
  const runs7d = recent.filter(j => Date.now() - new Date(j.created_at).getTime() < 7 * 86_400_000).length;
  const emptyCount = finished.filter(j => jobDotStatus(j) === 'empty').length;

  async function retryFailed(job: JobItem) {
    setRetrying(true);
    try {
      const res = await fetch(`/api/agent-lab/context/jobs/${job.id}/retry-failed`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(body.retried ? `Re-queued ${body.retried} failed chunk(s)` : 'No failed chunks to retry');
        loadRecent();
        loadRuns();
      } else {
        toast.error('Retry failed', { description: body.message ?? body.error ?? 'Unknown error' });
      }
    } catch {
      toast.error('Network error', { description: 'Could not reach the server.' });
    } finally {
      setRetrying(false);
    }
  }

  function toggleParent(jobId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  }

  const flow = KIND_FLOW[kind];
  const summaryByKind = Object.fromEntries(summaries.map(s => [s.kind, s]));
  const filtersActive = statusFilter !== 'all' || since !== 'any' || !!day;
  const th = 'px-3 py-2 text-left text-caption font-medium text-[var(--estate-text-muted)]';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Breadcrumb */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--nav-border)] bg-[var(--estate-surface)] px-6 py-2">
        <nav aria-label="Job breadcrumb" className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 text-size-ui font-medium text-[var(--estate-text-secondary)] transition-colors hover:text-[var(--estate-ink)]"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Job types
          </button>
          <ChevronRight className="size-3 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
          <KindDropdown currentKind={kind} kindMeta={meta} summaries={summaries} onSelectKind={onSelectKind} />
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-5">
          {/* A. Header */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {group && (
                <div className="flex items-center gap-1.5 text-caption text-[var(--estate-text-muted)]">
                  <span className="font-mono text-[var(--brand-a-ink)]">{group.step}</span>
                  <span>{group.label}</span>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-size-title-section font-semibold text-[var(--estate-ink)]">{meta.label}</h1>
                <KindHealthBadge tone={badge.tone} label={badge.label} />
              </div>
              <p className="mt-1 text-size-ui text-[var(--estate-text-secondary)]">{meta.description}</p>
              {attention.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {attention.map(a => (
                    <li key={a.key} className="text-caption" style={{ color: inkOf(a.severity === 'fail' ? FAIL_COLOR : WARN_COLOR) }}>
                      {a.issue}{a.when ? ` · ${agoText(a.when)}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-right">
                <div className="text-caption text-[var(--estate-text-muted)]">Schedule</div>
                {sched && sched.deployment !== 'manual' ? (
                  <div className="text-size-ui text-[var(--estate-ink)]" title={`${sched.label}: ${sched.scopeNote}`}>
                    {describeCron(sched.cronStandard)}
                    <span className="ml-1.5 text-[var(--estate-text-muted)]">· next {relativeNextRun(sched)}</span>
                    {schedVia && <div className="text-caption text-[var(--estate-text-muted)]">via {schedVia}</div>}
                  </div>
                ) : (
                  <div className="text-size-ui text-[var(--estate-text-secondary)]">Manual · on demand</div>
                )}
              </div>
              {canRun && (
                <button
                  type="button"
                  onClick={() => onRun(kind)}
                  className="inline-flex h-9 items-center gap-2 rounded-ctl px-3.5 text-label transition-transform duration-hover active:scale-[0.97]"
                  style={{ backgroundColor: 'var(--brand-a)', color: 'var(--on-brand)' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>
                  Run {meta.label}
                </button>
              )}
            </div>
          </header>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* B. Last run */}
            <section aria-label="Last run" className={cn(cardClass, 'flex flex-col p-4')}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-label text-[var(--estate-text-secondary)]">Last run</h2>
                {latest && (
                  <button type="button" onClick={() => onSelectJob(latest)} className="text-caption text-[var(--brand-a-ink)] hover:underline">
                    Details &amp; logs →
                  </button>
                )}
              </div>
              {recentLoading && !latest ? (
                <div className="mt-3 h-28 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)]" />
              ) : !latest ? (
                <p className="mt-3 text-size-ui text-[var(--estate-text-muted)]">This job type has not run yet.</p>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip status={latest.status} stats={latest.stats} jobKind={latest.job_kind} />
                    <span className="text-ui text-[var(--estate-ink)]" title={new Date(latest.started_at ?? latest.created_at).toLocaleString()}>
                      {isActiveJob(latest.status) ? 'started ' : ''}{relativeTime(latest.started_at ?? latest.created_at)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-size-ui">
                    <dt className="text-[var(--estate-text-muted)]">Duration</dt>
                    <dd className="font-mono tabular-nums text-[var(--estate-ink)]">
                      {isActiveJob(latest.status)
                        ? latest.started_at ? `${getDuration(latest.started_at, new Date().toISOString())} so far` : 'waiting to start'
                        : getDuration(latest.started_at, latest.finished_at)}
                    </dd>
                    <dt className="text-[var(--estate-text-muted)]">Results</dt>
                    <dd className="text-[var(--estate-ink)]">{formatStatsSummary(latest.stats, latest.job_kind)}</dd>
                    <dt className="text-[var(--estate-text-muted)]">Trigger</dt>
                    <dd className="text-[var(--estate-ink)]">{latest.trigger ?? '--'}</dd>
                    <dt className="text-[var(--estate-text-muted)]">Scope</dt>
                    <dd className="truncate text-[var(--estate-ink)]" title={formatJobScopeHuman(latest.scope)}>{formatJobScopeHuman(latest.scope)}</dd>
                  </dl>
                  {latest.status === 'failed' && latest.error && (
                    <pre
                      className="mt-3 max-h-20 overflow-hidden whitespace-pre-wrap break-words rounded-ctl border px-2.5 py-2 font-mono text-caption"
                      style={{ color: inkOf(FAIL_COLOR), borderColor: withAlpha(FAIL_COLOR, '4D'), backgroundColor: withAlpha(FAIL_COLOR, '0F') }}
                      title={latest.error}
                    >
                      {latest.error.split('\n').slice(0, 3).join('\n')}
                    </pre>
                  )}
                  {jobDotStatus(latest) === 'empty' && (
                    <p className="mt-3 text-caption" style={{ color: inkOf(WARN_COLOR) }}>
                      Finished but processed 0 objects — check the scope or upstream jobs.
                    </p>
                  )}
                  {(latest.status === 'failed' || latest.status === 'partial') && canRunPipeline && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isParentJob(latest) ? (
                        <button
                          type="button"
                          disabled={retrying}
                          onClick={() => retryFailed(latest)}
                          className="inline-flex h-8 items-center rounded-ctl border px-3 text-caption font-medium text-[var(--brand-a-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--brand-a)_8%,transparent)] disabled:opacity-50"
                          style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 40%, transparent)' }}
                        >
                          {retrying ? 'Retrying…' : 'Retry failed chunks'}
                        </button>
                      ) : canRun ? (
                        <button
                          type="button"
                          onClick={() => onRun(kind)}
                          className="inline-flex h-8 items-center rounded-ctl border px-3 text-caption font-medium text-[var(--brand-a-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--brand-a)_8%,transparent)]"
                          style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 40%, transparent)' }}
                        >
                          Run again…
                        </button>
                      ) : null}
                    </div>
                  )}
                  {lastSuccess && lastSuccess.id !== latest.id && (
                    <p className="mt-auto pt-3 text-caption text-[var(--estate-text-muted)]">
                      Last successful run {relativeTime(lastSuccess.finished_at ?? lastSuccess.created_at)} ·{' '}
                      <button type="button" onClick={() => onSelectJob(lastSuccess)} className="text-[var(--brand-a-ink)] hover:underline">open</button>
                    </p>
                  )}
                  {!lastSuccess && lastFinishedStatus === 'failed' && finished.length > 1 && (
                    <p className="mt-auto pt-3 text-caption text-[var(--estate-text-muted)]">No successful run in the last {finished.length} runs.</p>
                  )}
                </>
              )}
            </section>

            {/* C. Trends */}
            <section aria-label="Recent runs" className={cn(cardClass, 'flex flex-col p-4 lg:col-span-2')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-label text-[var(--estate-text-secondary)]">Recent runs</h2>
                <span className="text-caption text-[var(--estate-text-muted)]">
                  {recent.length > 0 ? `Last ${recent.length} runs · bar height = duration · click a bar for details` : ''}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                <InlineStat
                  label="success"
                  value={rate === null ? '—' : `${rate}%`}
                  valueColor={rate === null ? undefined : inkOf(rateTone(rate))}
                  sub={rate === null ? undefined : `${okCount} ok · ${failCount} failed`}
                  title="Succeeded or partial vs failed, over the runs shown"
                />
                <InlineStat label="typical time" value={medDur === null ? '—' : formatDurationS(Math.round(medDur))} title="Median duration of finished runs" />
                <InlineStat label="objects / run" value={medObjects === null ? '—' : Math.round(medObjects).toLocaleString()} title="Median objects processed per finished run" />
                <InlineStat label="runs in 7 days" value={runs7d} />
                {emptyCount > 0 && <InlineStat label="with 0 objects" value={emptyCount} valueColor={inkOf(WARN_COLOR)} />}
              </div>
              <div className="mt-4 flex flex-1 flex-col">
                {recentLoading && recent.length === 0 ? (
                  <div className="h-20 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)]" />
                ) : recent.length === 0 ? (
                  <div className="flex h-20 items-center justify-center text-size-ui text-[var(--estate-text-muted)]">No runs yet</div>
                ) : (
                  <>
                    <RunBars runs={recent} onSelect={onSelectJob} />
                    <div className="mt-1 flex justify-between border-t border-[var(--line-1)] pt-1 text-caption text-[var(--estate-text-muted)]">
                      <span>{new Date(recent[recent.length - 1].created_at).toLocaleDateString()}</span>
                      <span className="hidden items-center gap-3 sm:inline-flex" aria-hidden>
                        {(['done', 'failed', 'empty', 'running', 'cancelled'] as RunDotStatus[]).map(st => (
                          <span key={st} className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-[2px]" style={runBarStyle(st)} />
                            {st === 'done' ? 'ok' : st === 'empty' ? '0 objects' : RUN_DOT_STYLE[st].label}
                          </span>
                        ))}
                      </span>
                      <span>{new Date(recent[0].created_at).toLocaleDateString()}</span>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>

          {/* Pipeline context + coverage */}
          {(flow || coverage) && (
            <section aria-label="Pipeline context" className={cn(cardClass, 'flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5')}>
              {flow && flow.up.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-caption text-[var(--estate-text-muted)]">Runs after</span>
                  {flow.up.map(k => <FlowChip key={k} kind={k} summary={summaryByKind[k]} onSelect={onSelectKind} />)}
                </div>
              )}
              {flow && flow.down.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-caption text-[var(--estate-text-muted)]">Feeds</span>
                  {flow.down.map(k => <FlowChip key={k} kind={k} summary={summaryByKind[k]} onSelect={onSelectKind} />)}
                </div>
              )}
              {coverage && health && (
                <button
                  type="button"
                  onClick={() => onOpenTier(coverage.tier)}
                  title="Open the scanned objects for this stage"
                  className="ml-auto inline-flex items-center gap-2 rounded-ctl px-2 py-1 text-caption transition-colors hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]"
                >
                  {(() => {
                    const num = health[coverage.num] ?? 0;
                    const den = health[coverage.den] ?? 0;
                    const pct = den > 0 ? Math.round((num / den) * 100) : null;
                    return (
                      <>
                        <span className="text-[var(--estate-text-muted)]">Coverage</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-1)_8%,transparent)]">
                          <span className="block h-full rounded-full" style={{ width: `${pct ?? 0}%`, backgroundColor: meta.color }} />
                        </span>
                        <span className="font-mono tabular-nums text-[var(--estate-ink)]">{pct === null ? '—' : `${pct}%`}</span>
                        <span className="text-[var(--estate-text-muted)]">
                          {coverage.label} {num.toLocaleString()} of {den.toLocaleString()} {coverage.denLabel}
                        </span>
                        <ChevronRight className="size-3.5 text-[var(--estate-text-dim)]" aria-hidden />
                      </>
                    );
                  })()}
                </button>
              )}
            </section>
          )}

          {/* D. All runs */}
          <section aria-label="All runs" className={cn(cardClass, 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-1)] px-4 py-2.5">
              <h2 className="text-title-card text-[var(--estate-ink)]">
                All runs
                <span className="ml-2 font-mono text-caption font-normal text-[var(--estate-text-muted)]">{runsLoading && runs.length === 0 ? '' : runsTotal.toLocaleString()}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="Filter by status" className="inline-flex flex-wrap rounded-ctl border border-[var(--line-1)] p-0.5">
                  {RUN_STATUS_FILTERS.map(f => (
                    <button
                      key={f.value}
                      type="button"
                      role="radio"
                      aria-checked={statusFilter === f.value}
                      onClick={() => onFilterChange({ status: f.value === 'all' ? null : f.value })}
                      className={cn(
                        'rounded-[5px] px-2 py-0.5 text-caption transition-colors duration-hover',
                        statusFilter === f.value
                          ? 'bg-[color-mix(in_srgb,var(--brand-a)_14%,transparent)] text-[var(--brand-a-ink)]'
                          : 'text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)]',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <Select
                  aria-label="Time range"
                  value={day ? 'any' : since}
                  disabled={!!day}
                  onChange={e => onFilterChange({ since: e.target.value === 'any' ? null : e.target.value })}
                  className="h-7 rounded-ctl border border-[var(--line-1)] bg-[var(--estate-raised)] px-2 text-caption text-[var(--estate-ink)] disabled:opacity-50"
                >
                  {RUN_SINCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <DatePicker
                  aria-label="On a specific day"
                  placeholder="Any day"
                  value={day ?? ''}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={v => onFilterChange({ date: v || null, since: null })}
                  className="h-7 rounded-ctl border border-[var(--line-1)] bg-[var(--estate-raised)] px-2 text-caption text-[var(--estate-ink)]"
                />
                {filtersActive && (
                  <button
                    type="button"
                    onClick={() => onFilterChange({ status: null, since: null, date: null })}
                    className="text-caption text-[var(--brand-a-ink)] hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-size-ui">
                <thead>
                  <tr className="border-b border-[var(--line-1)]">
                    <th scope="col" className={cn(th, 'pl-4')}>Status</th>
                    <th scope="col" className={th}>Started</th>
                    <th scope="col" className={cn(th, 'text-right')}>Duration</th>
                    <th scope="col" className={th}>Results</th>
                    <th scope="col" className={th}>Trigger</th>
                    <th scope="col" className={cn(th, 'pr-4')}>Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {runsLoading && runs.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--line-1)] last:border-0">
                        <td colSpan={6} className="px-4 py-2.5">
                          <div className="h-5 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)]" />
                        </td>
                      </tr>
                    ))
                  ) : runs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-size-ui text-[var(--estate-text-muted)]">
                        {filtersActive ? 'No runs match these filters.' : `No ${meta.label} runs yet.`}
                      </td>
                    </tr>
                  ) : (
                    runs.map(job => {
                      const parent = isParentJob(job);
                      const expanded = expandedParents.has(job.id);
                      const totalChildren = (job.scope as any)?.total_children as number | undefined;
                      const highlighted = job.id === highlightId;
                      const when = job.started_at ?? job.created_at;
                      const recentRun = Date.now() - new Date(when).getTime() < 7 * 86_400_000;
                      return (
                        <React.Fragment key={job.id}>
                          <tr
                            id={`job-row-${job.id}`}
                            tabIndex={0}
                            onClick={() => onSelectJob(job)}
                            onKeyDown={e => { if (e.key === 'Enter') onSelectJob(job); }}
                            className={cn(
                              'cursor-pointer border-b border-[var(--line-1)] transition-colors duration-hover last:border-0 hover:bg-[color-mix(in_srgb,var(--ink-1)_3%,transparent)] focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--brand-a)_6%,transparent)]',
                              highlighted && 'bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)]',
                            )}
                          >
                            <td className="py-2 pl-4 pr-3">
                              <div className="flex items-center gap-2">
                                <StatusChip status={job.status} stats={job.stats} jobKind={job.job_kind} />
                                {parent && (
                                  <button
                                    type="button"
                                    onClick={e => toggleParent(job.id, e)}
                                    aria-expanded={expanded}
                                    title={expanded ? 'Hide chunks' : 'Show chunks'}
                                    className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-caption text-[var(--brand-a-ink)]"
                                    style={{ borderColor: 'color-mix(in srgb, var(--brand-a) 35%, transparent)' }}
                                  >
                                    <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} aria-hidden />
                                    {totalChildren ?? '?'} chunks
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-[var(--estate-ink)]" title={new Date(when).toLocaleString()}>
                              {recentRun ? relativeTime(when) : null}
                              <span className={cn('text-caption text-[var(--estate-text-muted)]', recentRun && 'ml-1.5')}>
                                {new Date(when).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--estate-ink)]">{getDuration(job.started_at, job.finished_at)}</td>
                            <td className="px-3 py-2 text-[var(--estate-text-secondary)]">
                              {job.status === 'failed' && job.error ? (
                                <span className="block max-w-[320px] truncate" style={{ color: inkOf(FAIL_COLOR) }} title={job.error}>{job.error.split('\n')[0]}</span>
                              ) : (
                                formatStatsSummary(job.stats, job.job_kind)
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-caption text-[var(--estate-text-secondary)]">{job.trigger ?? '--'}</td>
                            <td className="max-w-[240px] py-2 pl-3 pr-4 font-mono text-caption text-[var(--estate-text-muted)]">
                              {job.scope ? <ScopeSummary scope={job.scope} /> : '--'}
                            </td>
                          </tr>
                          {parent && expanded && (
                            <tr>
                              <td colSpan={6} className="px-4 pb-4 pt-1">
                                <ChildJobsPanel jobId={job.id} />
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
            {runsTotal > RUNS_PAGE_SIZE && (
              <Pagination page={page} pageSize={RUNS_PAGE_SIZE} total={runsTotal} onPageChange={setPage} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Kind switcher ──

type KindHealth = { tone: string; label: string; pulse?: boolean };

/** One-glance status for a job type, used by the job switcher. */
function kindHealthOf(s: KindSummary | undefined): KindHealth {
  if (!s) return { tone: 'var(--estate-text-dim)', label: 'Never run' };
  if (s.running > 0) return { tone: 'var(--brand-a)', label: 'Running', pulse: true };
  if (s.queued > 0) return { tone: 'var(--brand-a)', label: 'Queued', pulse: true };
  const items = buildAttentionItems([s]);
  if (items.some(i => i.severity === 'fail')) return { tone: FAIL_COLOR, label: 'Failing' };
  if (items.some(i => i.key.endsWith('-stale'))) return { tone: WARN_COLOR, label: 'Overdue' };
  if (items.length) return { tone: WARN_COLOR, label: 'Needs attention' };
  if (!s.last_finished_at && !(s.recent?.length)) return { tone: 'var(--estate-text-dim)', label: 'Never run' };
  return { tone: OK_COLOR, label: s.last_finished_at ? relativeTime(s.last_finished_at) : 'Healthy' };
}

function KindDropdown({
  currentKind,
  kindMeta,
  summaries,
  onSelectKind,
}: {
  currentKind: string;
  kindMeta: KindMeta;
  summaries: KindSummary[];
  onSelectKind: (kind: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const summaryByKind = useMemo(() => Object.fromEntries(summaries.map(s => [s.kind, s])) as Record<string, KindSummary>, [summaries]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return getJobKindGroups(summaries.map(s => s.kind))
      .map(g => ({ ...g, kinds: g.kinds.filter(k => !q || getKindMeta(k).label.toLowerCase().includes(q) || k.toLowerCase().includes(q)) }))
      .filter(g => g.kinds.length > 0);
  }, [summaries, query]);
  const flat = useMemo(() => groups.flatMap(g => g.kinds), [groups]);
  const current = kindHealthOf(summaryByKind[currentKind]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function openMenu() {
    setQuery('');
    setActive(Math.max(0, getJobKindGroups(summaries.map(s => s.kind)).flatMap(g => g.kinds).indexOf(currentKind)));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(k: string) {
    close(false);
    if (k !== currentKind) onSelectKind(k);
  }

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) pick(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  let idx = -1;
  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        className="inline-flex h-7 items-center gap-2 rounded-ctl px-2 text-size-ui font-medium text-[var(--estate-ink)] transition-colors duration-hover hover:bg-[color-mix(in_srgb,var(--ink-1)_5%,transparent)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] aria-expanded:bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${kindMeta.label}: ${current.label}. Switch job type`}
      >
        <span aria-hidden className={cn('size-2 rounded-full', current.pulse && 'animate-pulse')} style={{ backgroundColor: current.tone }} />
        {kindMeta.label}
        <ChevronDown className={cn('size-3.5 text-[var(--estate-text-muted)] transition-transform duration-hover', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 w-[320px] overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--estate-raised)] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
          onKeyDown={onKeyDown}
        >
          <div className="border-b border-[var(--line-1)] p-2">
            <input
              autoFocus
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0); }}
              placeholder={'Find a job type\u2026'}
              aria-label="Find a job type"
              aria-controls="kind-switcher-list"
              aria-activedescendant={flat[active] ? `kind-opt-${flat[active]}` : undefined}
              className="h-8 w-full rounded-ctl border border-[var(--line-1)] bg-[var(--card)] px-2.5 text-size-ui text-[var(--estate-ink)] placeholder:text-[var(--estate-text-dim)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            />
          </div>
          <div ref={listRef} id="kind-switcher-list" role="listbox" aria-label="Job types" className="max-h-[360px] overflow-y-auto py-1">
            {flat.length === 0 && (
              <div className="px-3 py-6 text-center text-caption text-[var(--estate-text-muted)]">No job types match</div>
            )}
            {groups.map(g => (
              <div key={g.id} role="group" aria-label={g.label}>
                <div className="flex items-baseline gap-2 px-3 pb-1 pt-2 text-caption text-[var(--estate-text-muted)]">
                  <span className="font-mono text-[var(--brand-a-ink)]">{g.step}</span>
                  {g.label}
                </div>
                {g.kinds.map(k => {
                  idx += 1;
                  const i = idx;
                  const isCurrent = k === currentKind;
                  const h = kindHealthOf(summaryByKind[k]);
                  const muted = h.tone === OK_COLOR || h.tone === 'var(--estate-text-dim)';
                  return (
                    <div
                      key={k}
                      id={`kind-opt-${k}`}
                      data-idx={i}
                      role="option"
                      aria-selected={isCurrent}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => pick(k)}
                      className={cn(
                        'mx-1 flex cursor-pointer items-center gap-2.5 rounded-ctl px-2 py-1.5 text-size-ui',
                        i === active && 'bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]',
                      )}
                    >
                      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', h.pulse && 'animate-pulse')} style={{ backgroundColor: h.tone }} />
                      <span className={cn('min-w-0 flex-1 truncate', isCurrent ? 'font-medium text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]')}>
                        {getKindMeta(k).label}
                      </span>
                      <span
                        className="shrink-0 text-caption tabular-nums"
                        style={{ color: muted ? 'var(--estate-text-muted)' : inkOf(h.tone) }}
                      >
                        {h.label}
                      </span>
                      <span aria-hidden className="w-3.5 shrink-0 text-[var(--brand-a-ink)]">
                        {isCurrent && (
                          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--line-1)] px-3 py-1.5 text-caption text-[var(--estate-text-dim)]">
            <span>{'\u2191\u2193'} to move · Enter to open</span>
            <span>Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ?? Main Page ?????????????????????????????????????????????????????????????????

/** Read an API response. A non-JSON body (the HTML login page) is ignored instead of thrown. */
async function fetchJson(url: string): Promise<{ ok: boolean; data: any } | null> {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { ok: false, data: null };
    return { ok: res.ok, data: await res.json() };
  } catch {
    return null;
  }
}

function EstateJobsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshKey = useCatalogRefresh();
  const canRunPipeline = useCanRunEstatePipeline();

  const urlKind = searchParams.get('kind');
  const urlDate = searchParams.get('date');
  const urlHighlight = searchParams.get('highlight');
  const urlTab = searchParams.get('tab') as ActiveTab | null;
  const urlActiveFilter = searchParams.get('activeFilter');
  const urlTier = searchParams.get('tier');
  const scannedInitialTier: ScannedTier | null =
    urlTier === 't0' || urlTier === 't1' || urlTier === 't2' || urlTier === 'embed' ? urlTier : null;
  const statsWindow = parseStatsWindow(searchParams.get('range'));

  const level: ViewLevel = urlKind ? 'kind' : 'l1';
  const activeTab: ActiveTab =
    urlTab === 'scanned' ? 'scanned' : urlTab === 'active' ? 'active' : urlTab === 'health' ? 'health' : 'jobs';

  // ?? L1 state
  const [summaries, setSummaries] = useState<KindSummary[]>([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [queuedJobs, setQueuedJobs] = useState<QueuedJobItem[]>([]);

  const [selectedJob, setSelectedJob] = useState<JobItem | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const highlightedRef = useRef<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [launchRequest, setLaunchRequest] = useState<{ kind: string; nonce: number } | null>(null);
  const [kindReloadKey, setKindReloadKey] = useState(0);

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
    pushParams({ kind, date: null, status: null, since: null, highlight: null });
  }

  function goBack() {
    pushParams({ kind: null, date: null, status: null, since: null, highlight: null });
  }

  function onJobQueued() {
    fetchSummaries();
    fetchQueued();
    setKindReloadKey(k => k + 1);
  }

  // ?? Fetch L1 summaries (windowed + run history on L1; all-time counts for drill-down nav)
  const summaryDays = level === 'l1' && statsWindow !== 'all' ? statsWindow : null;
  const fetchSummaries = useCallback(async () => {
    setSummariesLoading(true);
    try {
      const p = new URLSearchParams({ coverage: 'false', detail: 'true' });
      if (summaryDays) p.set('days', summaryDays);
      const json = await fetchJson(`/api/agent-lab/context/jobs/summary?${p}`);
      if (json?.ok) setSummaries(json.data?.data ?? []);
    } finally {
      setSummariesLoading(false);
    }
  }, [summaryDays]);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  // Keep run dots / active counts fresh while jobs are in flight
  const summariesHaveActive = summaries.some(s => s.running > 0 || s.queued > 0);
  useEffect(() => {
    if (!summariesHaveActive || level !== 'l1') return;
    const id = setInterval(fetchSummaries, 15_000);
    return () => clearInterval(id);
  }, [summariesHaveActive, level, fetchSummaries]);

  // ?? Fetch queued jobs (poll 15s)
  const fetchQueued = useCallback(async () => {
    const json = await fetchJson('/api/agent-lab/context/jobs/queued');
    if (json?.ok) setQueuedJobs(json.data?.data ?? []);
  }, []);

  useEffect(() => {
    fetchQueued();
    const id = setInterval(fetchQueued, 15_000);
    return () => clearInterval(id);
  }, [fetchQueued]);

  // ?? Deep link: ?highlight=<jobId> opens that run (and its job type page) from anywhere
  useEffect(() => {
    if (!urlHighlight || highlightedRef.current === urlHighlight) return;
    highlightedRef.current = urlHighlight;
    // No cancel-on-cleanup: the ref guard already dedupes, and StrictMode's re-run would otherwise drop the result.
    fetchJson(`/api/agent-lab/context/jobs/${encodeURIComponent(urlHighlight)}`).then(json => {
      if (!json?.ok || !json.data?.data) return;
      const job = json.data.data as JobItem;
      setSelectedJob(job);
      setActiveHighlightId(job.id);
      if (searchParams.get('kind') !== job.job_kind) {
        const p = new URLSearchParams(searchParams.toString());
        p.set('kind', job.job_kind);
        p.delete('tab');
        router.replace(`?${p.toString()}`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHighlight]);

  useEffect(() => {
    if (!activeHighlightId) return;
    const t = setTimeout(() => setActiveHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [activeHighlightId]);

  const activeRunCount = summaries.reduce((n, s) => n + s.running + s.queued, 0);
  const healthTone = summaries.length > 0 ? computeRunHealth(summaries) : null;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[var(--background)]">
      {/* Tab bar + primary actions (L1 only) */}
      {level === 'l1' && (
        <div className="border-b shrink-0 bg-[var(--background)] border-[var(--nav-border)]">
          <div className="flex items-center justify-between gap-4 px-6 pt-1.5">
            <div role="tablist" aria-label="Jobs views" className="flex items-center gap-0.5">
              {(['jobs', 'health', 'scanned', 'active'] as ActiveTab[]).map(tab => {
                const isActive = activeTab === tab;
                const label =
                  tab === 'jobs' ? 'Job types' : tab === 'health' ? 'Health' : tab === 'scanned' ? 'Scanned objects' : 'Active runs';
                const badge = tab === 'active' && activeRunCount > 0 ? activeRunCount : null;
                const alertDot = tab === 'health' && healthTone && healthTone.items.length > 0 ? healthTone : null;
                return (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => pushParams({ tab: tab === 'jobs' ? null : tab, tier: null })}
                    className={cn(
                      'relative inline-flex h-10 items-center gap-1.5 px-4 text-ui transition-colors duration-hover cursor-pointer border-none bg-transparent',
                      'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] rounded-t-ctl',
                      isActive
                        ? 'text-[var(--brand-a-ink)]'
                        : 'text-[var(--nav-item-text)] hover:text-[var(--nav-text)]',
                    )}
                  >
                    {label}
                    {alertDot && (
                      <span
                        aria-label={alertDot.headline}
                        title={alertDot.headline}
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: alertDot.tone }}
                      />
                    )}
                    {badge !== null && (
                      <span
                        aria-label={`${badge} active`}
                        className="inline-flex min-w-[18px] items-center justify-center gap-1 rounded-full px-1.5 py-px font-mono text-caption tabular-nums"
                        style={{ color: 'var(--on-brand)', backgroundColor: 'var(--brand-a)' }}
                      >
                        {badge}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-[var(--brand-a)]" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-3 pb-1.5">
              {canRunPipeline ? (
                <RunJobButton launchRequest={launchRequest} onJobQueued={onJobQueued} />
              ) : (
                <span className="text-size-ui text-[var(--text-tertiary)] font-sans">
                  View only — a platform admin runs pipelines
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {level === 'l1' && activeTab === 'scanned' ? (
        <ScannedObjectsTab
          key={scannedInitialTier ?? 'all'}
          refreshKey={refreshKey}
          canRunPipeline={canRunPipeline}
          initialTier={scannedInitialTier}
        />
      ) : level === 'l1' && activeTab === 'active' ? (
        <ActiveRunsPanel
          refreshKey={refreshKey}
          queuedOnly={urlActiveFilter === 'queued'}
          canRunPipeline={canRunPipeline}
          onSelectJob={job => setSelectedJob(job as JobItem)}
        />
      ) : level === 'l1' && activeTab === 'health' ? (
        <HealthView
          summaries={summaries}
          loading={summariesLoading}
          canRunPipeline={canRunPipeline}
          statsWindow={statsWindow}
          reloadKey={refreshKey + kindReloadKey}
          onStatsWindowChange={w => pushParams({ range: w === '7' ? null : w })}
          onSelectKind={selectKind}
          onSelectJob={setSelectedJob}
          onOpenActiveRuns={() => pushParams({ tab: 'active' })}
          onStageClick={tier => pushParams({ tab: 'scanned', tier })}
          onCockpitLaunched={() => { fetchSummaries(); fetchQueued(); }}
          onOpenWizard={() => setWizardOpen(true)}
        />
      ) : level === 'l1' ? (
        <L1View
          summaries={summaries}
          queuedJobs={queuedJobs}
          loading={summariesLoading}
          canRunPipeline={canRunPipeline}
          statsWindow={statsWindow}
          onStatsWindowChange={w => pushParams({ range: w === '7' ? null : w })}
          onSelectKind={selectKind}
          onRunKind={kind => setLaunchRequest({ kind, nonce: Date.now() })}
          onOpenActiveRuns={() => pushParams({ tab: 'active', activeFilter: 'queued' })}
          onOpenHealth={() => pushParams({ tab: 'health' })}
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
      ) : urlKind ? (
        <JobKindPage
          kind={urlKind}
          summaries={summaries}
          canRunPipeline={canRunPipeline}
          reloadKey={kindReloadKey + refreshKey}
          statusFilter={parseRunStatusFilter(searchParams.get('status'))}
          since={parseRunSince(searchParams.get('since'))}
          day={urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : null}
          highlightId={activeHighlightId}
          onFilterChange={pushParams}
          onSelectKind={selectKind}
          onBack={goBack}
          onRun={kind => setLaunchRequest({ kind, nonce: Date.now() })}
          onSelectJob={setSelectedJob}
          onOpenTier={tier => pushParams({ kind: null, date: null, status: null, since: null, highlight: null, tab: 'scanned', tier })}
        />
      ) : null}

      {/* Confirm modal for Run buttons on the job type page */}
      {level === 'kind' && canRunPipeline && (
        <RunJobButton hideTrigger launchRequest={launchRequest} onJobQueued={onJobQueued} />
      )}

      {/* Detail Drawer */}
      <JobDetailDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      {canRunPipeline && isJobsLaunchWizardEnabled() && (
        <JobsLaunchWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onLaunched={() => {
            fetchSummaries();
            fetchQueued();
          }}
        />
      )}
    </div>
  );
}

export default function EstateJobsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-size-ui font-sans text-[var(--text-muted)]">Loading jobs console...</div>}>
      <EstateJobsPageContent />
    </Suspense>
  );
}
