/**
 * src/lib/dashboards/execute-raw-sql.ts
 *
 * Phase 3.5C — the thin, guarded execution path for raw-SQL escape-hatch
 * widgets. It runs a frozen SQL string through the SAME chokepoint
 * (executeDatabricksSQL) as every other query, so raw SQL gets identical
 * safety: read-only enforcement, multi-statement rejection, row/byte caps, and
 * EXTERNAL_LINKS rejection.
 *
 * It does NOT touch compileSemanticQuery / executeSemanticQuery / any
 * platform_sem_* loading — a raw-SQL widget has no semantic model and must
 * never enter the semantic path (which would wrongly throw
 * SemanticModelNotGovernedError).
 */

import prisma from '@/lib/db';
import { executeDatabricksSQL, enforceReadOnly } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';

export interface RawSqlExecuteResult {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
}

/**
 * Execute a raw SQL string against the given Databricks connection.
 *
 * enforceReadOnly runs here as defense-in-depth (the third checkpoint after
 * save and pin) before any connection is resolved — a mutating statement never
 * reaches the warehouse.
 */
export async function executeRawSql(
  sql: string,
  connectionId: string,
): Promise<RawSqlExecuteResult> {
  // Render-time read-only guard (defense in depth — save + pin already checked).
  enforceReadOnly(sql);

  const connection = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  const token = await getAccessToken(connectionId, connection.workspace_host);

  // Same guarded chokepoint as executeSemanticQuery — enforceReadOnly runs again
  // inside executeDatabricksSQL, plus the row/byte/external-link safety layers.
  const result = await executeDatabricksSQL(
    connectionId,
    connection.workspace_host,
    connection.default_warehouse_id,
    token,
    { statement: sql },
  );

  return {
    rows: result.rows,
    columns: result.columns.map((c) => ({ name: c.name, type: c.type_name })),
  };
}
