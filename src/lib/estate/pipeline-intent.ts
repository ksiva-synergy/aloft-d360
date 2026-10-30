import 'server-only';

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import type { JobKind } from '@/lib/context/queue';
import { SQL_OBJECT_HAS_EMBEDDING } from '@/lib/context/embedding-presence';
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
  has_embedding: boolean;
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
} {
  let scanned = 0;
  let profiled = 0;
  let enriched = 0;
  let embedded = 0;
  let needsProfile = 0;
  let needsEnrich = 0;

  for (const o of rows) {
    if (!o.last_t0_at) continue;
    scanned++;
    if (o.last_t1_at) profiled++;
    if (o.last_t2_at) enriched++;
    if (o.has_embedding) embedded++;
    if (!o.last_t1_at || !o.last_t0_at || o.last_t1_at < o.last_t0_at) needsProfile++;
    if (!o.last_t2_at || !o.last_t1_at || o.last_t2_at < o.last_t1_at) needsEnrich++;
  }

  const needsEmbed = Math.max(0, scanned - embedded);

  return {
    scanned_objects: scanned,
    profiled_objects: profiled,
    enriched_objects: enriched,
    embedded_objects: embedded,
    needs_profile: needsProfile,
    needs_enrich: needsEnrich,
    needs_embed: needsEmbed,
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
    return { ...health, scoped: false };
  }

  const objectRows = await prisma.$queryRaw<ObjectRow[]>(Prisma.sql`
    SELECT
      o.full_path,
      o.catalog_name,
      o.schema_name,
      o.last_t0_at,
      o.last_t1_at,
      o.last_t2_at,
      ${SQL_OBJECT_HAS_EMBEDDING} AS has_embedding
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
  opts?: { through?: 't1_profile' | 't2_semantic' | 'embed' },
): Promise<PipelineIntent> {
  const { includePatterns, excludeSchemas } = normalizePipelineScope(input);
  const health = await getScopedPipelineHealth(orgId, { ...input, includePatterns, excludeSchemas });

  const blockers: PipelineIntentBlocker[] = [];
  const { recommendation, kinds, through, staleEstimate } = buildRecommendation(health, includePatterns);

  let recommendedKinds = [...kinds] as JobKind[];
  let sequential = false;

  if (opts?.through && recommendedKinds.length === 0 && health.scanned_objects > 0) {
    blockers.push({
      code: 'IDLE',
      message: 'All tiers through embed are current for this scope.',
    });
  }

  if (health.scanned_objects === 0 && health.discovery_not_scanned === 0 && includePatterns.length > 0) {
    blockers.push({
      code: 'NO_SCOPED_OBJECTS',
      message: 'No discovery or scanned tables match this scope.',
    });
  }

  // Build continue chain when asked to run through embed
  if (opts?.through && health.scanned_objects > 0) {
    const chain: JobKind[] = [];
    if (health.needs_profile > 0) chain.push('t1_profile');
    if (health.needs_enrich > 0 && (opts.through === 't2_semantic' || opts.through === 'embed')) {
      chain.push('t2_semantic');
    }
    if (health.needs_embed > 0 && opts.through === 'embed') chain.push('embed');
    if (chain.length > 0) {
      recommendedKinds = chain;
      sequential = chain.length > 1;
    }
  }

  const humanSummary =
    staleEstimate > 0
      ? `Up to ${staleEstimate.toLocaleString()} table(s) in scope need ${through.replace(/_/g, ' ')}`
      : health.scanned_objects > 0
        ? 'Nothing stale to run in this scope for the selected tiers'
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
  };
}

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
