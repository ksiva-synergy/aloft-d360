import 'server-only';

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import {
  isJobRowStale,
  readScopeChain,
  summarizeJobScope,
} from '@/lib/estate/pipeline-intent';

export interface ActiveJobChildCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  partial: number;
  cancelled: number;
}

export interface ActiveJobRow {
  id: string;
  job_kind: string;
  status: string;
  source_id: string | null;
  source_name: string | null;
  parent_job_id: string | null;
  scope: unknown;
  scope_summary: string;
  chain: string[];
  created_at: string;
  updated_at: string | null;
  started_at: string | null;
  is_stale: boolean;
  child_counts: ActiveJobChildCounts | null;
  error: string | null;
}

export async function listActiveJobs(
  orgId: string,
  opts: { sourceId?: string; kind?: string; limit?: number } = {},
): Promise<ActiveJobRow[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));

  const conditions: Prisma.Sql[] = [
    Prisma.sql`j.org_id = ${orgId}`,
    Prisma.sql`j.status IN ('queued', 'running', 'orchestrating')`,
  ];
  if (opts.sourceId) {
    conditions.push(Prisma.sql`j.source_id = ${opts.sourceId}::uuid`);
  }
  if (opts.kind) {
    conditions.push(Prisma.sql`j.job_kind = ${opts.kind}`);
  }

  const whereClause = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      job_kind: string;
      status: string;
      source_id: string | null;
      source_name: string | null;
      parent_job_id: string | null;
      scope: unknown;
      created_at: Date;
      updated_at: Date | null;
      started_at: Date | null;
      error: string | null;
    }>
  >(Prisma.sql`
    SELECT
      j.id,
      j.job_kind,
      j.status,
      j.source_id,
      s.display_name AS source_name,
      j.parent_job_id,
      j.scope,
      j.created_at,
      j.updated_at,
      j.started_at,
      j.error
    FROM platform_context_jobs j
    LEFT JOIN platform_context_sources s ON s.id = j.source_id
    WHERE ${whereClause}
    ORDER BY COALESCE(j.updated_at, j.created_at) DESC
    LIMIT ${limit}
  `);

  const parentIds = rows.filter(r => r.status === 'orchestrating').map(r => r.id);
  const countsByParent = new Map<string, ActiveJobChildCounts>();

  if (parentIds.length > 0) {
    const countRows = await prisma.$queryRaw<
      Array<{
        parent_job_id: string;
        total: number;
        queued: number;
        running: number;
        succeeded: number;
        failed: number;
        partial: number;
        cancelled: number;
      }>
    >(Prisma.sql`
      SELECT
        parent_job_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running,
        COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'partial')::int AS partial,
        COUNT(*) FILTER (WHERE status IN ('cancelled', 'canceled'))::int AS cancelled
      FROM platform_context_jobs
      WHERE org_id = ${orgId}
        AND parent_job_id = ANY(${parentIds}::uuid[])
      GROUP BY parent_job_id
    `);
    for (const c of countRows) {
      countsByParent.set(c.parent_job_id, {
        total: c.total,
        queued: c.queued,
        running: c.running,
        succeeded: c.succeeded,
        failed: c.failed,
        partial: c.partial,
        cancelled: c.cancelled,
      });
    }
  }

  return rows.map(r => ({
    id: r.id,
    job_kind: r.job_kind,
    status: r.status,
    source_id: r.source_id,
    source_name: r.source_name,
    parent_job_id: r.parent_job_id,
    scope: r.scope,
    scope_summary: summarizeJobScope(r.scope),
    chain: readScopeChain(r.scope),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at?.toISOString() ?? null,
    started_at: r.started_at?.toISOString() ?? null,
    is_stale: isJobRowStale(r.updated_at, r.status),
    child_counts: r.status === 'orchestrating' ? countsByParent.get(r.id) ?? null : null,
    error: r.error,
  }));
}
