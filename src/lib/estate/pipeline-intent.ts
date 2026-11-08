import 'server-only';

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import type { JobKind } from '@/lib/context/queue';
import { SQL_OBJECT_EMBEDDING_CURRENT } from '@/lib/context/embedding-presence';
import {
  buildContinueChain,
  buildContinueKindsFromTierSelection,
  scopeNeedsRescan,
  type ContinueThrough,
  type ContinueTierId,
  type ScopeChangeReport,
} from '@/lib/context/pipeline-freshness';
import {
  catalogSchemaMatchesIncludePatterns,
  isSchemaExcluded,
  pathMatchesIncludePatterns,
} from '@/lib/context/job-scope';
import { schemaIncludePattern } from '@/lib/estate/catalog-pipeline';
import type { JobRecommendation, PipelineHealth, RecommendationAction } from '@/lib/estate/cockpit';
import { getPipelineHealth } from '@/lib/estate/cockpit';
import { findScopedLaunchConflict } from '@/lib/context/enqueue-and-launch';
import { reapOrphanActiveJobs } from '@/lib/context/orphan-jobs';

export interface PipelineScopeInput {
  sourceId: string;
  includePatterns?: string[];
  excludeSchemas?: string[];
  catalog?: string;
  schema?: string;
}

export interface ScopedPipelineHealth extends PipelineHealth {
  scoped: boolean;
  /** Described tables whose business-model proposal is missing or older than T2. */
  not_in_model: number;
}

export interface PipelineIntentBlocker {
  code: 'NO_SOURCE' | 'NO_SCOPED_OBJECTS' | 'ACTIVE_JOB_OVERLAP' | 'IDLE';
  message: string;
  jobId?: string;
}

export interface PipelineIntent {
  health: ScopedPipelineHealth;
  includePatterns: string[];
  recommendedKinds: JobKind[];
  sequential: boolean;
  through: RecommendationAction;
  staleEstimate: number;
  humanSummary: string;
  recommendation: JobRecommendation | null;
  blockers: PipelineIntentBlocker[];
  /** Present when Continue ran the scoped source change check first. */
  changeCheck?: ScopeChangeReport | null;
  /** Upper-bound table count per stage in the Continue chain (each stage re-selects at run time). */
  stagePlan?: Array<{ kind: JobKind; upTo: number }>;
}

const STALE_RUNNING_MINUTES = 30;

/** Normalize catalog/schema + patterns into includePatterns for workers. */
export function normalizePipelineScope(input: PipelineScopeInput): {
  includePatterns: string[];
  excludeSchemas: string[];
} {
  const excludeSchemas = input.excludeSchemas ?? [];
  let includePatterns = [...(input.includePatterns ?? [])];
  if (input.catalog && input.schema) {
    includePatterns = [schemaIncludePattern(input.catalog, input.schema)];
  } else if (input.catalog && includePatterns.length === 0) {
    includePatterns = [`${input.catalog}.*`];
  }
  return { includePatterns, excludeSchemas };
}

function srcPco(sourceId: string): Prisma.Sql {
  return Prisma.sql`AND o.source_id = ${sourceId}::uuid`;
}

function srcEstate(sourceId: string): Prisma.Sql {
  return Prisma.sql`AND peo.source_id = ${sourceId}`;
}

type ObjectRow = {
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  last_t0_at: Date | null;
  last_t1_at: Date | null;
  last_t2_at: Date | null;
  last_t4_at: Date | null;
  embedding_current: boolean;
};

function rowInScope(
  row: ObjectRow,
  includePatterns: string[],
  excludeSchemas: string[],
): boolean {
  const cat = row.catalog_name ?? '';
  const sch = row.schema_name ?? '';
  if (isSchemaExcluded(cat, sch, excludeSchemas)) return false;
  if (includePatterns.length === 0) return true;
  return pathMatchesIncludePatterns(row.full_path, includePatterns);
}

function aggregateHealthFromRows(rows: ObjectRow[]): Omit<
  ScopedPipelineHealth,
  keyof PipelineHealth | 'scoped'
> & {
  scanned_objects: number;
  profiled_objects: number;
  enriched_objects: number;
  embedded_objects: number;
  needs_profile: number;
  needs_enrich: number;
  needs_embed: number;
  not_in_model: number;
} {
  let scanned = 0;
  let profiled = 0;
  let enriched = 0;
  let embedded = 0;
  let needsProfile = 0;
  let needsEnrich = 0;
  let needsEmbed = 0;
  let notInModel = 0;

  for (const o of rows) {
    if (!o.last_t0_at) continue;
    scanned++;
    if (o.last_t1_at) profiled++;
    if (o.last_t2_at) enriched++;
    if (o.embedding_current) embedded++;
    if (!o.last_t1_at || !o.last_t0_at || o.last_t1_at < o.last_t0_at) needsProfile++;
    if (!o.last_t2_at || !o.last_t1_at || o.last_t2_at < o.last_t1_at) needsEnrich++;
    // Missing, or older than the latest semantic card.
    if (!o.embedding_current) needsEmbed++;
    if (o.last_t2_at && (!o.last_t4_at || o.last_t4_at < o.last_t2_at)) notInModel++;
  }

  return {
    scanned_objects: scanned,
    profiled_objects: profiled,
    enriched_objects: enriched,
    embedded_objects: embedded,
    needs_profile: needsProfile,
    needs_enrich: needsEnrich,
    needs_embed: needsEmbed,
    not_in_model: notInModel,
  };
}

/** Pipeline health for a source, optionally filtered by includePatterns / catalog.schema. */
export async function getScopedPipelineHealth(
  orgId: string,
  input: PipelineScopeInput,
): Promise<ScopedPipelineHealth> {
  const { includePatterns, excludeSchemas } = normalizePipelineScope(input);
  const scoped = includePatterns.length > 0 || Boolean(input.catalog);

  if (!scoped) {
    const health = await getPipelineHealth(orgId, input.sourceId);
    return { ...health, scoped: false, not_in_model: 0 };
  }

  const objectRows = await prisma.$queryRaw<ObjectRow[]>(Prisma.sql`
    SELECT
      o.full_path,
      o.catalog_name,
      o.schema_name,
      o.last_t0_at,
      o.last_t1_at,
      o.last_t2_at,
      o.last_t4_at,
      ${SQL_OBJECT_EMBEDDING_CURRENT} AS embedding_current
    FROM platform_context_objects o
    WHERE o.org_id = ${orgId}
      AND o.lifecycle = 'active'
      ${srcPco(input.sourceId)}
  `);

  const inScope = objectRows.filter(r => rowInScope(r, includePatterns, excludeSchemas));
  const agg = aggregateHealthFromRows(inScope);

  const discoveryRows = await prisma.$queryRaw<Array<{ full_path: string; catalog_name: string; schema_name: string }>>(
    Prisma.sql`
      SELECT peo.full_path, peo.catalog_name, peo.schema_name
      FROM platform_estate_objects peo
      LEFT JOIN platform_context_objects pco
        ON pco.org_id = peo.org_id
        AND pco.full_path = peo.full_path
        AND pco.lifecycle = 'active'
      WHERE peo.org_id = ${orgId}
        AND peo.lifecycle = 'active'
        ${srcEstate(input.sourceId)}
        AND pco.id IS NULL
    `,
  );

  let discoveryNotScanned = 0;
  for (const peo of discoveryRows) {
    if (isSchemaExcluded(peo.catalog_name, peo.schema_name, excludeSchemas)) continue;
    if (includePatterns.length === 0) {
      discoveryNotScanned++;
      continue;
    }
    if (
      catalogSchemaMatchesIncludePatterns(peo.catalog_name, peo.schema_name, includePatterns)
      || pathMatchesIncludePatterns(peo.full_path, includePatterns)
    ) {
      discoveryNotScanned++;
    }
  }

  const discoveryTotal = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS n FROM platform_estate_objects peo
    WHERE peo.org_id = ${orgId} AND peo.lifecycle = 'active' ${srcEstate(input.sourceId)}
  `);

  return {
    source_id: input.sourceId,
    discovery_objects: discoveryTotal[0]?.n ?? 0,
    discovery_not_scanned: discoveryNotScanned,
    scoped: true,
    ...agg,
  };
}

function buildRecommendation(
  health: ScopedPipelineHealth,
  includePatterns: string[],
): { recommendation: JobRecommendation | null; kinds: JobKind[]; through: RecommendationAction; staleEstimate: number } {
  if (health.discovery_not_scanned > 0 && health.scanned_objects === 0 && includePatterns.length > 0) {
    return {
      through: 't0_structural',
      kinds: ['t0_structural'],
      staleEstimate: health.discovery_not_scanned,
      recommendation: {
        action: 't0_structural',
        title: `Structural scan (${health.discovery_not_scanned} table(s) in scope)`,
        detail: 'Discovery rows exist; run T0 on this scope before profile/enrich.',
        kinds: ['t0_structural'],
        sequential: false,
        includePatterns,
        estimatedTables: health.discovery_not_scanned,
        sampleSchemas: [],
      },
    };
  }

  if (health.needs_profile > 0) {
    return {
      through: 't1_profile',
      kinds: ['t1_profile'],
      staleEstimate: health.needs_profile,
      recommendation: {
        action: 't1_profile',
        title: `Profile ${health.needs_profile.toLocaleString()} table(s)`,
        detail: 'Stale or never profiled after the last structural scan in this scope.',
        kinds: ['t1_profile'],
        sequential: false,
        includePatterns,
        estimatedTables: health.needs_profile,
        sampleSchemas: [],
      },
    };
  }

  if (health.needs_enrich > 0) {
    return {
      through: 't2_semantic',
      kinds: ['t2_semantic'],
      staleEstimate: health.needs_enrich,
      recommendation: {
        action: 't2_semantic',
        title: `Enrich ${health.needs_enrich.toLocaleString()} table(s)`,
        detail: 'Semantic cards missing or older than latest profile in this scope.',
        kinds: ['t2_semantic'],
        sequential: false,
        includePatterns,
        estimatedTables: health.needs_enrich,
        sampleSchemas: [],
      },
    };
  }

  if (health.needs_embed > 0) {
    return {
      through: 'embed',
      kinds: ['embed'],
      staleEstimate: health.needs_embed,
      recommendation: {
        action: 'embed',
        title: `Embed ${health.needs_embed.toLocaleString()} table(s)`,
        detail: 'Vector embeddings missing for tables in this scope.',
        kinds: ['embed'],
        sequential: false,
        includePatterns,
        estimatedTables: health.needs_embed,
        sampleSchemas: [],
      },
    };
  }

  return {
    through: 't3_usage',
    kinds: [],
    staleEstimate: 0,
    recommendation: null,
  };
}

/** Continue-pipeline intent: minimum tiers from current scoped health. */
export async function computePipelineIntent(
  orgId: string,
  input: PipelineScopeInput,
  opts?: { through?: ContinueThrough; selectedTiers?: ContinueTierId[]; changeCheck?: ScopeChangeReport | null },
): Promise<PipelineIntent> {
  const { includePatterns, excludeSchemas } = normalizePipelineScope(input);
  const health = await getScopedPipelineHealth(orgId, { ...input, includePatterns, excludeSchemas });

  const blockers: PipelineIntentBlocker[] = [];
  const { recommendation, kinds, through, staleEstimate } = buildRecommendation(health, includePatterns);

  let recommendedKinds = [...kinds] as JobKind[];
  let sequential = false;
  let stagePlan: Array<{ kind: JobKind; upTo: number }> | undefined;
  const changeCheck = opts?.changeCheck ?? null;

  if (health.scanned_objects === 0 && health.discovery_not_scanned === 0 && includePatterns.length > 0) {
    blockers.push({
      code: 'NO_SCOPED_OBJECTS',
      message: 'No discovery or scanned tables match this scope.',
    });
  }

  // Continue chain: tier selection and/or legacy `through` (embed-only cascade).
  const canPlanContinue =
    health.scanned_objects > 0 || (changeCheck !== null && scopeNeedsRescan(changeCheck));
  if ((opts?.selectedTiers?.length || opts?.through) && canPlanContinue) {
    const rescan = changeCheck ? scopeNeedsRescan(changeCheck) : false;
    const needs = {
      rescan,
      needsProfile: health.needs_profile,
      needsEnrich: health.needs_enrich,
      needsEmbed: health.needs_embed,
    };

    let chain: JobKind[];
    if (opts.selectedTiers && opts.selectedTiers.length > 0) {
      chain = buildContinueKindsFromTierSelection({
        selectedTiers: opts.selectedTiers,
        needs,
        scannedObjects: health.scanned_objects,
        notInModel: health.not_in_model,
      });
    } else if (opts.through) {
      chain = buildContinueChain(needs, opts.through) as JobKind[];
    } else {
      chain = [];
    }

    if (chain.length > 0) {
      recommendedKinds = chain;
      sequential = chain.length > 1;
      const rescanCount = changeCheck
        ? changeCheck.changed.length + changeCheck.added.length + changeCheck.unknown.length
        : 0;
      const scopeSize = health.scanned_objects + (changeCheck?.added.length ?? 0);
      const cap = (n: number) => Math.min(scopeSize, n);
      const t1 = cap(health.needs_profile + rescanCount);
      const t2 = cap(Math.max(health.needs_enrich, t1));
      const embed = cap(Math.max(health.needs_embed, t2));
      const upTo: Record<string, number> = {
        t0_structural: rescanCount + (changeCheck?.dropped.length ?? 0),
        t1_profile: t1,
        t2_semantic: t2,
        embed,
        t3_usage: scopeSize,
        t4_scan: Math.min(scopeSize, health.not_in_model || scopeSize),
      };
      stagePlan = chain.map(kind => ({ kind, upTo: upTo[kind] ?? 0 }));
    } else {
      recommendedKinds = [];
      blockers.push({
        code: 'IDLE',
        message: describeIdleContinueBlocker(health.not_in_model, Boolean(changeCheck), opts.selectedTiers),
      });
    }
  }

  const humanSummary = stagePlan
    ? stagePlan.map(s => `${STAGE_LABEL[s.kind] ?? s.kind} ≤${s.upTo.toLocaleString()}`).join(' → ')
    : staleEstimate > 0
      ? `Up to ${staleEstimate.toLocaleString()} table(s) in scope need ${through.replace(/_/g, ' ')}`
      : health.scanned_objects > 0
        ? describeIdleContinueScope(health.not_in_model)
        : health.discovery_not_scanned > 0
          ? `${health.discovery_not_scanned} table(s) need structural scan (T0) first`
          : 'No work in this scope';

  if (recommendedKinds.length > 0) {
    await reapOrphanActiveJobs(orgId);
    const conflict = await findScopedLaunchConflict(
      input.sourceId,
      recommendedKinds,
      includePatterns,
    );
    if (conflict) {
      blockers.push({
        code: 'ACTIVE_JOB_OVERLAP',
        message: `Active ${conflict.job_kind} job overlaps this scope.`,
        jobId: conflict.id,
      });
    }
  }

  return {
    health,
    includePatterns,
    recommendedKinds,
    sequential,
    through,
    staleEstimate,
    humanSummary,
    recommendation,
    blockers,
    changeCheck,
    ...(stagePlan ? { stagePlan } : {}),
  };
}

/** Bar copy when Continue has no T0–Embed work left. */
export function describeIdleContinueScope(notInModel: number): string {
  if (notInModel > 0) {
    const tables = notInModel === 1 ? '1 table is' : `${notInModel.toLocaleString()} tables are`;
    return `Search is current. ${tables} not in the business model. Open Continue and select Usage and/or Business model.`;
  }
  return 'Nothing stale to run in this scope for the selected tiers';
}

export function describeIdleContinueBlocker(
  notInModel: number,
  checkedSource: boolean,
  selectedTiers?: ContinueTierId[],
): string {
  if (selectedTiers?.includes('t3') || selectedTiers?.includes('t4')) {
    return 'No T0–Embed work for this scope with the current source check. Adjust tier selection or run fewer stages.';
  }
  if (notInModel > 0) return describeIdleContinueScope(notInModel);
  return checkedSource
    ? 'No source changes and all tiers through embed are current for this scope.'
    : 'All tiers through embed are current for this scope.';
}

const STAGE_LABEL: Record<string, string> = {
  t0_structural: 'Scan',
  t1_profile: 'Profile',
  t2_semantic: 'Describe',
  embed: 'Embed',
  t3_usage: 'Usage & lineage',
  t4_scan: 'Business model',
};

/** Stale object count for plan preview (T1/T2 only). */
export async function countStaleObjectsForKind(
  orgId: string,
  sourceId: string,
  kind: JobKind,
  includePatterns: string[],
  excludeSchemas: string[],
): Promise<number> {
  if (kind !== 't1_profile' && kind !== 't2_semantic') return 0;

  const rows = await prisma.platformContextObject.findMany({
    where: { org_id: orgId, source_id: sourceId, lifecycle: 'active' },
    select: {
      full_path: true,
      catalog_name: true,
      schema_name: true,
      last_t0_at: true,
      last_t1_at: true,
      last_t2_at: true,
    },
  });

  let n = 0;
  for (const o of rows) {
    const cat = o.catalog_name ?? '';
    const sch = o.schema_name ?? '';
    if (isSchemaExcluded(cat, sch, excludeSchemas)) continue;
    if (includePatterns.length > 0 && !pathMatchesIncludePatterns(o.full_path, includePatterns)) continue;
    if (!o.last_t0_at) continue;

    if (kind === 't1_profile') {
      if (!o.last_t1_at || o.last_t1_at < o.last_t0_at) n++;
    } else if (kind === 't2_semantic') {
      if (!o.last_t1_at) continue;
      if (!o.last_t2_at || o.last_t2_at < o.last_t1_at) n++;
    }
  }
  return n;
}

export function isJobRowStale(updatedAt: Date | null, status: string): boolean {
  if (status !== 'running') return false;
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_RUNNING_MINUTES * 60 * 1000;
}

export function summarizeJobScope(scope: unknown): string {
  if (!scope || typeof scope !== 'object') return 'Full source';
  const s = scope as Record<string, unknown>;
  const patterns = Array.isArray(s.includePatterns) ? (s.includePatterns as string[]) : [];
  if (patterns.length === 0) return 'Full source';
  if (patterns.length === 1) return `Limit: ${patterns[0]}`;
  return `Limit: ${patterns.length} patterns`;
}

export function readScopeChain(scope: unknown): string[] {
  if (!scope || typeof scope !== 'object') return [];
  const chain = (scope as Record<string, unknown>).chain;
  return Array.isArray(chain) ? chain.map(String) : [];
}
