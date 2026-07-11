/**
 * src/lib/semantic/execute.ts
 *
 * Loads a SemanticModel from Prisma, validates + compiles a SemanticQuery,
 * then executes via executeDatabricksSQL (the ONLY Databricks execution path).
 *
 * All DB access is org-scoped via getDefaultOrg().
 */

import { getDefaultOrg } from '@/lib/platform/agents';
import { compileSemanticQuery } from './compiler';
import { validateSemanticQuery } from './types';
import type { SemanticQuery, SemanticModel } from './types';
import { executeDatabricksSQL } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';
import prisma from '@/lib/db';
import { SemanticModelNotGovernedError, SemanticValidationFailureError } from './errors';

// Re-export error classes so callers can import them from this module
export { SemanticModelNotGovernedError, SemanticValidationFailureError };

export interface SemanticQueryResult {
  sql: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Execute a SemanticQuery against Databricks.
 *
 * Steps:
 *  1. Resolve org via getDefaultOrg()
 *  2. Load model + entities + dimensions + measures + joins from Prisma
 *  3. Validate the query against the model
 *  4. Compile to SQL via compileSemanticQuery()
 *  5. Resolve connection credentials (getAccessToken(connectionId, workspaceHost))
 *  6. Execute via executeDatabricksSQL()
 *  7. Return { sql, columns, rows, rowCount }
 */
export async function executeSemanticQuery(
  query: SemanticQuery,
  connectionId: string,
): Promise<SemanticQueryResult> {
  // ── 1. Org scope ──────────────────────────────────────────────────────────
  const org = await getDefaultOrg();

  // ── 2. Load model from Prisma ─────────────────────────────────────────────
  const modelRow = await prisma.platform_semantic_models.findFirstOrThrow({
    where: { id: query.modelId, org_id: org.id },
  });

  // ── Governance gate ───────────────────────────────────────────────────────
  // Only 'governed' models are queryable. Candidates have not yet been
  // reviewed + promoted by a domain expert. Archived models are retired.
  if (modelRow.status !== 'governed') {
    throw new SemanticModelNotGovernedError(modelRow.id, modelRow.status);
  }

  // Only non-archived entities are queryable — archived entities are retired.
  const entityRows = await prisma.platform_sem_entities.findMany({
    where: { model_id: modelRow.id, org_id: org.id, status: { not: 'archived' } },
  });

  const entityIds = entityRows.map((e) => e.id);

  // Only non-archived definitions are compiled into queries — an archived
  // dimension or measure must not execute even if referenced by ID.
  const [dimensionRows, measureRows, joinRows] = await Promise.all([
    prisma.platform_sem_dimensions.findMany({ where: { entity_id: { in: entityIds }, org_id: org.id, status: { not: 'archived' } } }),
    prisma.platform_sem_measures.findMany({   where: { entity_id: { in: entityIds }, org_id: org.id, status: { not: 'archived' } } }),
    prisma.platform_sem_joins.findMany({      where: { model_id: modelRow.id,        org_id: org.id } }),
  ]);

  const model: SemanticModel = {
    id: modelRow.id,
    entities: entityRows.map((e) => ({
      id: e.id,
      full_path: e.full_path,
      entity_label: e.entity_label,
    })),
    dimensions: dimensionRows.map((d) => ({
      id: d.id,
      entity_id: d.entity_id,
      column_name: d.column_name,
      dimension_label: d.dimension_label,
      dimension_type: d.dimension_type,
    })),
    measures: measureRows.map((m) => ({
      id: m.id,
      entity_id: m.entity_id,
      column_name: m.column_name ?? null,
      measure_label: m.measure_label,
      aggregate: m.aggregate,
      expression: m.expression ?? null,
      metric_type: m.metric_type,
    })),
    joins: joinRows.map((j) => ({
      id: j.id,
      from_entity_id: j.from_entity_id,
      to_entity_id: j.to_entity_id,
      join_type: j.join_type,
      join_on_sql: j.join_on_sql,
    })),
  };

  // ── 3. Validate ───────────────────────────────────────────────────────────
  const validation = validateSemanticQuery(query, model);
  if (!validation.valid) {
    throw new SemanticValidationFailureError(validation.errors);
  }

  // ── 4. Compile ────────────────────────────────────────────────────────────
  const sql = compileSemanticQuery(query, model);

  // ── 5. Resolve connection ─────────────────────────────────────────────────
  // Confirmed field names from prisma/schema.prisma:
  //   PlatformDatabricksConnection.workspace_host
  //   PlatformDatabricksConnection.default_warehouse_id
  const connection = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  // getAccessToken(connectionId, workspaceHost) — two args (confirmed from token-client.ts line 40)
  const token = await getAccessToken(connectionId, connection.workspace_host);

  // ── 6. Execute ────────────────────────────────────────────────────────────
  // executeDatabricksSQL(_connectionId, workspaceHost, warehouseId, token, input)
  // confirmed signature from execute.ts line 167
  const result = await executeDatabricksSQL(
    connectionId,
    connection.workspace_host,
    connection.default_warehouse_id,
    token,
    { statement: sql },
  );

  // ── 7. Return ─────────────────────────────────────────────────────────────
  // DatabricksExecuteResult uses row_count and columns[].type_name — normalise here
  return {
    sql,
    columns: result.columns.map((c) => ({ name: c.name, type: c.type_name })),
    rows: result.rows,
    rowCount: result.row_count,
  };
}
