import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { summarizeSnapshot, type SnapshotSummary } from '@/lib/powerbi/report-lineage-snapshot-summary';

const ARRAY = (expr: Prisma.Sql) => Prisma.sql`CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END`;

/**
 * Per-report snapshot facts for active reports (optionally only `reportIds`). Only the systems,
 * partition kind and UC presence of each source table leave the database, not the full payload.
 */
export async function loadSnapshotSummaries(orgId: string, reportIds?: string[]): Promise<Map<string, SnapshotSummary>> {
  if (reportIds && reportIds.length === 0) return new Map();
  const idFilter = reportIds ? Prisma.sql`AND l.report_id = ANY(${reportIds}::uuid[])` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ report_id: string; status: string; generated_at: Date; warning_count: number; tables: unknown }[]>`
    SELECT l.report_id::text AS report_id,
           l.status,
           l.generated_at,
           CASE WHEN jsonb_typeof(l.warnings) = 'array' THEN jsonb_array_length(l.warnings) ELSE 0 END AS warning_count,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'systems', COALESCE((SELECT jsonb_agg(o->>'system') FROM jsonb_array_elements(${ARRAY(Prisma.sql`s->'origins'`)}) o), '[]'::jsonb),
               'kind', s->>'partition_kind',
               'uc', NULLIF(btrim(COALESCE(s->>'uc_full_path', '')), '') IS NOT NULL))
             FROM jsonb_array_elements(${ARRAY(Prisma.sql`l.lineage->'sources'`)}) s
           ), '[]'::jsonb) AS tables
    FROM pbi_report_lineage l
    JOIN pbi_reports r ON r.id = l.report_id AND r.org_id = l.org_id
    WHERE l.org_id = ${orgId} AND r.lifecycle = 'active' ${idFilter}`;
  return new Map(rows.map((row) => [row.report_id, summarizeSnapshot(row)]));
}
