import 'server-only';

import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { toContextSource } from '@/lib/context/harvest';
import { pathMatchesIncludePatterns } from '@/lib/context/job-scope';
import { classifyScopeChanges, type ScopeChangeReport } from '@/lib/context/pipeline-freshness';

export class ScopeChangeCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeChangeCheckError';
  }
}

/**
 * Metadata-only change check for a Continue-pipeline scope: one information_schema
 * listing per catalog in scope (with `last_altered`), compared per table against the
 * `source_altered_at` stored at that table's last structural scan. Reads no data and
 * writes nothing. Throws ScopeChangeCheckError when any in-scope catalog can't be listed.
 */
export async function checkScopeChanges(
  orgId: string,
  sourceId: string,
  includePatterns: string[],
): Promise<ScopeChangeReport> {
  if (includePatterns.length === 0) {
    throw new ScopeChangeCheckError('Change check needs a catalog/schema or table scope.');
  }

  const sourceRow = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId },
  });
  if (!sourceRow) throw new ScopeChangeCheckError('Source not found.');

  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: sourceRow.connection_ref },
    select: { id: true, workspace_host: true, default_warehouse_id: true },
  });

  const source = toContextSource(sourceRow);
  source.scope_include = includePatterns;
  const excludes = source.scope_exclude ?? [];

  const adapter = new DatabricksAdapter(conn);
  let listing: Awaited<ReturnType<DatabricksAdapter['listScopeWithAltered']>>;
  try {
    listing = await adapter.listScopeWithAltered(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScopeChangeCheckError(`Databricks change check failed: ${msg.slice(0, 300)}`);
  }
  const { refs, failedCatalogs } = listing;
  if (failedCatalogs.length > 0) {
    throw new ScopeChangeCheckError(
      `Could not list ${failedCatalogs.join(', ')} in Databricks — change check failed, nothing launched.`,
    );
  }

  const stored = await prisma.platformContextObject.findMany({
    where: { org_id: orgId, source_id: sourceId, lifecycle: 'active' },
    select: { full_path: true, source_altered_at: true, last_t0_at: true },
  });

  return classifyScopeChanges({
    listed: refs.map(r => ({ full_path: r.full_path, source_altered_at: r.source_altered_at })),
    stored: stored.filter(s => pathMatchesIncludePatterns(s.full_path, includePatterns)),
    includes: includePatterns,
    excludes,
  });
}
