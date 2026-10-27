import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import {
  planForKind,
  planSplit,
  TIME_BUDGET_MINUTES,
  MAX_CONCURRENT_TASKS,
  MAX_CONCURRENT_BY_KIND,
  RATE_PER_MINUTE,
  type JobKind,
} from '@/lib/context/queue';
import { usesEstateObjectPlan } from '@/lib/context/job-scope';
import { LaunchSourceNotFoundError, resolveLaunchSources } from '@/lib/context/resolve-launch-source';
import {
  resolveLaunchScopeFilters,
  stripExcludeSchemasForKind,
  t0AllowsLiveScopeWhenDiscoveryEmpty,
} from '@/lib/estate/job-ui';
import { getContextHarvesterModelId } from '@/lib/context/harvester-llm';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/context/jobs/plan
 *
 * Preview what auto-split would produce for a given scope without launching anything.
 * Used by the confirm modal to show chunk count, wall-clock estimate and cost.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const kind: JobKind = body.kind as JobKind;
  const excludeSchemas: string[] = Array.isArray(body.excludeSchemas) ? body.excludeSchemas : [];
  const includePatterns: string[] = Array.isArray(body.includePatterns) ? body.includePatterns : [];
  const requestedSourceId =
    typeof body.sourceId === 'string' ? body.sourceId : typeof body.source_id === 'string' ? body.source_id : undefined;

  if (!kind) return NextResponse.json({ error: 'MISSING_KIND' }, { status: 400 });

  try {
    const orgId = await getOrgId();
    const sources = await resolveLaunchSources(orgId, requestedSourceId);
    const source = sources[0];

    if (!source) {
      return NextResponse.json({ needsSplit: false, totalObjects: 0, chunks: 0 });
    }

    const strippedExcludes = stripExcludeSchemasForKind(kind, excludeSchemas);
    const planOpts = resolveLaunchScopeFilters(strippedExcludes, includePatterns);
    const plan = await planForKind(orgId, kind, source.id, planOpts);

    const scannedPlan = usesEstateObjectPlan(kind)
      ? await planSplit(orgId, kind, source.id, planOpts)
      : null;

    const registry = usesEstateObjectPlan(kind) ? 'estate' : 'scanned';
    const discoveryObjects = usesEstateObjectPlan(kind) ? plan.totalObjects : undefined;
    const scannedObjects = scannedPlan?.totalObjects ?? (usesEstateObjectPlan(kind) ? 0 : plan.totalObjects);

    const maxConcurrent = (MAX_CONCURRENT_BY_KIND as Record<string, number>)[kind] ?? MAX_CONCURRENT_TASKS;
    const rate = RATE_PER_MINUTE[kind] ?? 25;

    const chunks = plan.needsSplit ? plan.partitions.length : 1;

    const liveScopeLaunch = t0AllowsLiveScopeWhenDiscoveryEmpty(
      kind,
      includePatterns,
      plan.totalObjects,
      plan.discoverySchemaGroups,
    );

    let scopeWarning: string | null = null;
    if (includePatterns.length > 0 && plan.totalObjects === 0) {
      scopeWarning = liveScopeLaunch
        ? 'No tables in local discovery for this Limit. T0 will list matching tables from Databricks when the job runs.'
        : usesEstateObjectPlan(kind)
          ? 'No tables in discovery match Limit globs. Fix patterns or run Estate Inventory.'
          : 'No objects in Scanned registry match Limit. Fix globs or run T0 first.';
    } else if (
      kind === 't0_structural'
      && includePatterns.length === 0
      && strippedExcludes.length > 0
      && plan.totalObjects === 0
      && liveScopeLaunch
    ) {
      scopeWarning =
        'No tables in discovery for the schemas you kept. T0 will list non-excluded schemas from Databricks when the job runs.';
    } else if (
      kind === 't0_structural' &&
      includePatterns.length > 0 &&
      plan.totalObjects > 0 &&
      (scannedPlan?.totalObjects ?? 0) === 0
    ) {
      scopeWarning = null;
    } else if (plan.needsSplit && includePatterns.length > 0 && chunks > 10) {
      scopeWarning = `Focus still matches ${chunks} schema chunks — widen/narrow your glob if that is unexpected.`;
    }

    const humanSummary = usesEstateObjectPlan(kind)
      ? `${plan.totalObjects} table(s) in discovery will be scanned`
      : `${plan.totalObjects} scanned table(s) match this plan`;

    return NextResponse.json({
      needsSplit: plan.needsSplit,
      totalObjects: plan.totalObjects,
      chunks,
      maxObjectsPerChunk: plan.maxObjectsPerChild,
      timeBudgetMinutes: TIME_BUDGET_MINUTES,
      estimatedMinutesPerChunk: TIME_BUDGET_MINUTES,
      estimatedWallClockMinutes: plan.estimatedWallClockMinutes || Math.ceil(plan.totalObjects / rate),
      estimatedCostUsd: plan.estimatedCostUsd,
      maxConcurrent,
      scopeWarning,
      emptyScope: plan.totalObjects === 0 && !liveScopeLaunch,
      liveScopeLaunch,
      registry,
      discoveryObjects,
      scannedObjects,
      humanSummary,
      sourceId: source.id,
      ...(kind === 't2_semantic'
        ? { harvestModelId: getContextHarvesterModelId() }
        : {}),
    });
  } catch (err) {
    if (err instanceof LaunchSourceNotFoundError) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }
    console.error('[context/jobs/plan POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
