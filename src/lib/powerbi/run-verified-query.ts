import 'server-only';

import prisma from '@/lib/db';
import type { AccessPrincipal } from '@/lib/access/types';
import { runWarehouseQuery } from '@/lib/access/warehouse';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifiedQueryRunResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  sql: string;
  verified_query_id: string;
  question: string;
  provenance: Record<string, unknown>;
}

export async function runVerifiedQueryForPrincipal(opts: {
  orgId: string;
  verifiedQueryId: string;
  connectionId: string;
  principal: AccessPrincipal;
  sessionId?: string | null;
}): Promise<VerifiedQueryRunResult> {
  const id = opts.verifiedQueryId.trim();
  if (!UUID_RE.test(id)) {
    throw new Error('verified_query_id must be a UUID');
  }

  const row = await prisma.kbVerifiedQuery.findFirst({
    where: { id, org_id: opts.orgId, status: 'verified', origin: 'powerbi' },
  });
  if (!row) {
    throw new Error('Verified query not found or not published for this org');
  }

  const sqlResult = await runWarehouseQuery({
    connectionId: opts.connectionId,
    principal: opts.principal,
    statement: row.sql,
    purpose: 'inspector_verified_query',
    level: 'query',
    surface: 'sql',
    sessionId: opts.sessionId ?? null,
  });

  const props = (row.props && typeof row.props === 'object' ? row.props : {}) as Record<
    string,
    unknown
  >;

  return {
    columns: sqlResult.columns,
    rows: sqlResult.rows,
    row_count: sqlResult.row_count,
    truncated: sqlResult.truncated,
    sql: row.sql,
    verified_query_id: row.id,
    question: row.question,
    provenance: {
      origin: row.origin,
      model_name: props.model_name,
      measure_name: props.measure_name,
      pbi_model_id: props.pbi_model_id,
      parity_verdict: props.parity_verdict,
    },
  };
}
