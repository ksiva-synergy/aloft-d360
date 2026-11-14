import 'server-only';

import prisma from '@/lib/db';
import { executeDatabricksSQL, DATABRICKS_API_MAX_WAIT_SECS } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';
import { executeDatasetQueries } from '@/lib/powerbi/client';
import { resolveModelConnectionId } from '@/lib/powerbi/expand-validate';
import type { RuleSet } from '@/lib/powerbi/rule-registry';
import {
  buildDiffTestPlan,
  compareDiffTest,
  compileDiffTestSql,
  type DiffTestResult,
  type FunctionTestSpec,
} from '@/lib/powerbi/rule-difftest';

/**
 * Where differential tests run. Literal-only DAX queries don't read model data, so any dataset
 * the service principal can query works; override with PBI_DIFFTEST_MODEL (pbi_model_id).
 */
export type DiffTestTarget = {
  workspaceId: string;
  datasetId: string;
  connection: { id: string; workspace_host: string; default_warehouse_id: string };
};

export async function resolveDiffTestTarget(orgId: string): Promise<DiffTestTarget> {
  const preferred = process.env.PBI_DIFFTEST_MODEL?.trim();
  // models that actually have a Databricks-bound table (most of the estate is not parsed yet)
  const bound = await prisma.pbiSourceBinding.findMany({
    where: {
      org_id: orgId,
      bind_status: 'matched',
      databricks_source_id: { not: null },
      table: {
        is: {
          model: {
            is: {
              lifecycle: 'active',
              rls_required: false,
              ...(preferred ? { pbi_model_id: preferred } : {}),
            },
          },
        },
      },
    },
    select: { model_id: true },
    distinct: ['model_id'],
    take: 20,
  });
  const models = await prisma.pbiModel.findMany({
    where: { id: { in: bound.map((b) => b.model_id) } },
    select: { id: true, pbi_model_id: true, workspace: { select: { pbi_workspace_id: true } } },
  });
  for (const m of models) {
    const connectionId = await resolveModelConnectionId(orgId, m.id);
    if (!connectionId) continue;
    const connection = await prisma.platformDatabricksConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { id: true, workspace_host: true, default_warehouse_id: true },
    });
    return { workspaceId: m.workspace.pbi_workspace_id, datasetId: m.pbi_model_id, connection };
  }
  throw new Error('No Power BI model with a Databricks binding available for differential tests');
}

export async function runDifferentialTest(input: {
  target: DiffTestTarget;
  spec: FunctionTestSpec;
  rules?: RuleSet;
}): Promise<DiffTestResult & { sql?: string; powerBiQuery: string }> {
  const plan = buildDiffTestPlan(input.spec);
  const compiled = compileDiffTestSql(plan, input.rules);
  if (!compiled.ok) {
    return {
      name: input.spec.name,
      pass: false,
      compared: 0,
      mismatches: [],
      error: `compile: ${compiled.reason}`,
      powerBiQuery: plan.powerBiQuery,
    };
  }
  let powerBiRows: Record<string, unknown>[];
  try {
    const res = await executeDatasetQueries(input.target.workspaceId, input.target.datasetId, [plan.powerBiQuery]);
    const block = res.results?.[0];
    if (block?.error) throw new Error(JSON.stringify(block.error).slice(0, 400));
    powerBiRows = (block?.tables?.[0]?.rows ?? []) as Record<string, unknown>[];
  } catch (e) {
    return {
      name: input.spec.name,
      pass: false,
      compared: 0,
      mismatches: [],
      error: `power_bi: ${(e as Error).message.slice(0, 400)}`,
      sql: compiled.sql,
      powerBiQuery: plan.powerBiQuery,
    };
  }
  let sqlRows: Record<string, unknown>[];
  try {
    const c = input.target.connection;
    const token = await getAccessToken(c.id, c.workspace_host, 'metadata');
    const res = await executeDatabricksSQL(c.id, c.workspace_host, c.default_warehouse_id, token, {
      statement: compiled.sql,
      rowLimit: 1000,
      waitTimeoutSecs: DATABRICKS_API_MAX_WAIT_SECS,
      asyncPolling: true,
    });
    sqlRows = res.rows;
  } catch (e) {
    return {
      name: input.spec.name,
      pass: false,
      compared: 0,
      mismatches: [],
      error: `databricks: ${(e as Error).message.slice(0, 400)}`,
      sql: compiled.sql,
      powerBiQuery: plan.powerBiQuery,
    };
  }
  return { ...compareDiffTest(plan, powerBiRows, sqlRows), sql: compiled.sql, powerBiQuery: plan.powerBiQuery };
}
