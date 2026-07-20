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
import {
  SemanticModelNotGovernedError,
  SemanticValidationFailureError,
  SemanticDraftAccessError,
} from './errors';
import {
  decideDefinitionAccess,
  deriveIsDraft,
  isAuthoringExecution,
  type AuthoringOpts,
  type SemTableKind,
} from './authoring-access';

// Re-export error classes so callers can import them from this module
export { SemanticModelNotGovernedError, SemanticValidationFailureError, SemanticDraftAccessError };
export type { AuthoringOpts };

export interface SemanticQueryResult {
  sql: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /**
   * 3.5A — true when this was an authoring-mode execution that referenced at
   * least one non-governed (draft) definition, so the UI can stamp
   * "Draft — not governed". Always false on the default (governed) path.
   */
  isDraft: boolean;
}

/** Rows carry status + created_by after the 3.5A schema change. */
type AccessibleRow = { id: string; status: string; created_by: string | null };

/**
 * Partition loaded rows into the compilable set. A referenced row that is
 * another user's draft throws SemanticDraftAccessError (the owner-only
 * boundary); an excluded referenced row is simply dropped so ordinary
 * reference validation rejects it (the clean forbid for the default path).
 */
function filterAccessible<T extends AccessibleRow>(
  rows: T[],
  referenced: Set<string>,
  tableKind: SemTableKind,
  opts: AuthoringOpts | undefined,
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const decision = decideDefinitionAccess(
      { status: row.status, createdBy: row.created_by },
      opts,
    );
    if (decision === 'allow') {
      out.push(row);
    } else if (decision === 'forbid-draft' && referenced.has(row.id)) {
      throw new SemanticDraftAccessError(tableKind, row.id);
    }
    // 'exclude', or 'forbid-draft' on an unreferenced row → drop silently
  }
  return out;
}

function referencedStatuses(rows: AccessibleRow[], referenced: Set<string>): string[] {
  return rows.filter((r) => referenced.has(r.id)).map((r) => r.status);
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
  opts?: AuthoringOpts,
): Promise<SemanticQueryResult> {
  // ── 1. Org scope ──────────────────────────────────────────────────────────
  const org = await getDefaultOrg();
  const authoring = isAuthoringExecution(opts);

  // ── 2. Load model from Prisma ─────────────────────────────────────────────
  const modelRow = await prisma.platform_semantic_models.findFirstOrThrow({
    where: { id: query.modelId, org_id: org.id },
  });

  // ── Governance gate ───────────────────────────────────────────────────────
  // DEFAULT PATH (no opts — the LLM tool, dashboards, materialization): only
  // 'governed' models are queryable. Candidates have not yet been reviewed +
  // promoted; archived models are retired. This is UNCHANGED from pre-3.5A.
  //
  // AUTHORING PATH (3.5A — an owner previewing their own drafts): the
  // model-level gate is bypassed. Access is instead enforced per referenced
  // definition below (decideDefinitionAccess), so an owner can execute against
  // a candidate/draft model while non-owners and shared consumption cannot.
  if (!authoring && modelRow.status !== 'governed') {
    throw new SemanticModelNotGovernedError(modelRow.id, modelRow.status);
  }

  // Load every entity/dim/measure for the model (ALL statuses). Access is then
  // decided per-row: the default path drops 'draft' + 'archived' (so drafts are
  // invisible), while authoring mode additionally admits the requesting user's
  // OWN drafts and hard-forbids another user's referenced draft.
  const allEntities = await prisma.platform_sem_entities.findMany({
    where: { model_id: modelRow.id, org_id: org.id },
  });
  const allEntityIds = allEntities.map((e) => e.id);

  const [allDimensions, allMeasures, joinRows] = await Promise.all([
    prisma.platform_sem_dimensions.findMany({ where: { entity_id: { in: allEntityIds }, org_id: org.id } }),
    prisma.platform_sem_measures.findMany({   where: { entity_id: { in: allEntityIds }, org_id: org.id } }),
    prisma.platform_sem_joins.findMany({      where: { model_id: modelRow.id,           org_id: org.id } }),
  ]);

  // Referenced definitions: primary entity + each dimension + each measure.
  const refEntityIds = new Set<string>([query.entityId]);
  const refDimIds = new Set(query.dimensions.map((d) => d.dimensionId));
  const refMeasureIds = new Set(query.measures.map((m) => m.measureId));

  const entityRows = filterAccessible(allEntities, refEntityIds, 'entity', opts);
  const dimensionRows = filterAccessible(allDimensions, refDimIds, 'dimension', opts);
  const measureRows = filterAccessible(allMeasures, refMeasureIds, 'measure', opts);

  // isDraft is meaningful only for authoring executions; the default path is
  // governed consumption and must never be labelled a draft.
  const isDraft = deriveIsDraft(
    [
      ...referencedStatuses(entityRows, refEntityIds),
      ...referencedStatuses(dimensionRows, refDimIds),
      ...referencedStatuses(measureRows, refMeasureIds),
    ],
    authoring,
  );

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
    isDraft,
  };
}
