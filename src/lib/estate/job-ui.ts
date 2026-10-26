/**
 * Shared job status + launch helpers for Estate Jobs UI and APIs.
 */

export type MappedJobStatus = 'queued' | 'running' | 'orchestrating' | 'done' | 'failed' | 'empty';

const SPLITTABLE_KINDS = new Set(['t0_structural', 't1_profile', 't2_semantic']);

export function mapJobStatus(status: string): MappedJobStatus {
  const s = status.toLowerCase();
  if (s === 'orchestrating') return 'orchestrating';
  if (s === 'running') return 'running';
  if (['succeeded', 'partial', 'completed', 'success', 'done'].includes(s)) return 'done';
  if (['failed', 'error'].includes(s)) return 'failed';
  return 'queued';
}

export function isOrchestratingParent(job: { status: string; scope?: unknown }): boolean {
  if (job.status === 'orchestrating') return true;
  const scope = job.scope as Record<string, unknown> | null | undefined;
  return scope?.is_parent === true;
}

export function isKickableJob(job: { status: string; scope?: unknown }): boolean {
  if (isOrchestratingParent(job)) return false;
  return job.status === 'queued';
}

export function kindUsesEstateExcludeTree(kind: string): boolean {
  return kind === 't0_structural' || kind === 'estate_inventory';
}

export function launchUsesEstateExcludeTree(kinds: string[]): boolean {
  return kinds.some(
    k => kindUsesEstateExcludeTree(k) || k === 't1_profile' || k === 't2_semantic',
  );
}

/** Pass modal exclude tree through to plan/launch for all tiers that honor it in runners. */
export function stripExcludeSchemasForKind(_kind: string, excludeSchemas: string[]): string[] {
  return excludeSchemas;
}

/**
 * When Limit (includePatterns) is set, it defines the positive scope.
 * Exclude-tree entries must not zero out a deliberate Limit (P1-20 / modal UX).
 */
export function resolveLaunchScopeFilters(
  excludeSchemas: string[],
  includePatterns: string[],
): { excludeSchemas: string[]; includePatterns: string[] } {
  if (includePatterns.length > 0) {
    return { excludeSchemas: [], includePatterns };
  }
  return { excludeSchemas, includePatterns };
}

/**
 * T0 with Limit can resolve matching tables live from Databricks (resolveScope)
 * even when `platform_estate_objects` has no rows for that catalog yet.
 */
export type T0LiveScopeSchemaGroups = { total: number; excluded: number };

/**
 * Allow T0 launch when discovery counts are 0 but Databricks listing will still run
 * (Limit globs, or exclude-only with at least one non-excluded schema group).
 */
export function t0AllowsLiveScopeWhenDiscoveryEmpty(
  kind: string,
  includePatterns: string[],
  discoveryObjectCount: number,
  discoverySchemaGroups?: T0LiveScopeSchemaGroups,
): boolean {
  if (kind !== 't0_structural' || discoveryObjectCount > 0) return false;
  if (includePatterns.length > 0) return true;
  if (
    discoverySchemaGroups
    && discoverySchemaGroups.excluded > 0
    && discoverySchemaGroups.excluded < discoverySchemaGroups.total
  ) {
    return true;
  }
  return false;
}

export function isSplittableKind(kind: string): boolean {
  return SPLITTABLE_KINDS.has(kind);
}

/** Primary work count for harvest tiers (for empty-success detection). */
export function getJobPrimaryMetric(
  stats: unknown,
  jobKind?: string,
): { key: string; value: number } | null {
  if (!stats || typeof stats !== 'object') return null;
  const s = stats as Record<string, unknown>;
  const kind = jobKind ?? '';

  if (kind === 't0_structural' && typeof s.objects_swept === 'number') {
    return { key: 'objects_swept', value: s.objects_swept };
  }
  if (kind === 't1_profile' && typeof s.objects_profiled === 'number') {
    return { key: 'objects_profiled', value: s.objects_profiled };
  }
  if (kind === 't2_semantic' && typeof s.objects_enriched === 'number') {
    return { key: 'objects_enriched', value: s.objects_enriched };
  }

  if (typeof s.objects_swept === 'number') return { key: 'objects_swept', value: s.objects_swept };
  if (typeof s.objects_profiled === 'number') return { key: 'objects_profiled', value: s.objects_profiled };
  if (typeof s.objects_enriched === 'number') return { key: 'objects_enriched', value: s.objects_enriched };
  if (typeof s.inserted === 'number') return { key: 'inserted', value: s.inserted };
  return null;
}

/** Succeeded/partial job that processed zero objects (misleading green DONE row). */
export function isEmptySuccessJob(status: string, stats: unknown, jobKind?: string): boolean {
  const s = status.toLowerCase();
  if (s !== 'succeeded' && s !== 'partial') return false;
  if (!jobKind || !isSplittableKind(jobKind)) return false;
  const metric = getJobPrimaryMetric(stats, jobKind);
  if (!metric) return false;
  return metric.value === 0;
}

export function resolveDisplayJobStatus(
  status: string,
  stats?: unknown,
  jobKind?: string,
): MappedJobStatus {
  if (status === 'orchestrating') return 'orchestrating';
  if (isEmptySuccessJob(status, stats, jobKind)) return 'empty';
  return mapJobStatus(status);
}

export function formatStatsSummary(stats: unknown, jobKind?: string): string {
  if (!stats || typeof stats !== 'object') return '--';
  const s = stats as Record<string, unknown>;
  const parts: string[] = [];

  if ('objects_swept' in s) parts.push(`${s.objects_swept} swept`);
  else if ('objects_profiled' in s) parts.push(`${s.objects_profiled} profiled`);
  else if ('objects_enriched' in s) parts.push(`${s.objects_enriched} enriched`);
  else if ('objects_synced' in s) {
    parts.push(`${s.objects_synced} synced`);
    if (s.chunks_ingested) parts.push(`${s.chunks_ingested} chunks`);
  } else if ('objects_mapped' in s) parts.push(`${s.objects_mapped} mapped`);
  else if ('mappings_proposed' in s) parts.push(`${s.mappings_proposed} mappings`);
  else if ('scanned_count' in s) parts.push(`${s.scanned_count} scanned`);
  else if ('inserted' in s) {
    parts.push(`${s.inserted} new`);
    if (s.updated) parts.push(`${s.updated} upd`);
    if (s.removed) parts.push(`${s.removed} rm`);
    if (s.catalogs) parts.push(`${s.catalogs} cat`);
  } else if ('objectsProcessed' in s) {
    parts.push(`${s.objectsProcessed} processed`);
    if (s.snapshotsWritten) parts.push(`${s.snapshotsWritten} snapshots`);
    if (s.narrativesApplied) parts.push(`${s.narrativesApplied} narratives`);
  } else if ('objects' in s) parts.push(`${s.objects} objects`);
  else if ('count' in s) parts.push(`${s.count} items`);

  if ('errors' in s) {
    const n = Array.isArray(s.errors) ? s.errors.length : Number(s.errors);
    if (n > 0) parts.push(`${n} err`);
  } else if ('error_count' in s && Number(s.error_count) > 0) {
    parts.push(`${s.error_count} err`);
  }

  if (parts.length === 0) return '--';

  if (isEmptySuccessJob('succeeded', stats, jobKind)) {
    return `${parts.join(' | ')} (no work)`;
  }
  return parts.join(' | ');
}

export function scopeSummaryFocus(scope: unknown): string | null {
  if (!scope || typeof scope !== 'object') return null;
  const patterns = (scope as Record<string, unknown>).includePatterns;
  if (!Array.isArray(patterns) || patterns.length === 0) return null;
  const lines = patterns.map(String);
  if (lines.length === 1) return lines[0];
  return `${lines[0]} (+${lines.length - 1} more)`;
}
