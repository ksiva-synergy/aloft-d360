/**
 * Phase 3.5C — the thin, guarded execution path for raw-SQL escape-hatch
 * widgets. It runs a frozen SQL string through runWarehouseQuery (same
 * authorization + read-only stack as every other user query).
 */

import { enforceReadOnly } from '@/lib/databricks/execute';
import type { AccessPrincipal } from '@/lib/access/types';
import { viewerPrincipalRequired } from '@/lib/access/column-guard';
import { systemPrincipal } from '@/lib/access/principal';
import { runWarehouseQuery } from '@/lib/access/warehouse';
import { AccessDeniedError } from '@/lib/access/errors';

export interface RawSqlExecuteResult {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
}

export async function executeRawSql(
  sql: string,
  connectionId: string,
  dataPrincipal?: AccessPrincipal | null,
): Promise<RawSqlExecuteResult> {
  enforceReadOnly(sql);

  const principal =
    dataPrincipal ?? (viewerPrincipalRequired() ? null : systemPrincipal('health'));
  if (viewerPrincipalRequired() && !principal) {
    throw new AccessDeniedError('Data access principal is required for dashboard SQL.');
  }

  const result = await runWarehouseQuery({
    connectionId,
    principal: principal ?? systemPrincipal('health'),
    statement: sql,
    purpose: 'dashboard_raw_sql',
    level: 'query',
    surface: 'dashboard',
  });

  return {
    rows: result.rows,
    columns: result.columns.map((c) => ({ name: c.name, type: c.type_name })),
  };
}
