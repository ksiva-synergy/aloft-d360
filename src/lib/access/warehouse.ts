import prisma from '@/lib/db';
import {
  beginDatabricksSQLExport,
  executeDatabricksSQL,
  type DatabricksExecuteResult,
  type DatabricksExportHandle,
} from '@/lib/databricks/execute';
import { openDatabricksSession } from '@/lib/databricks/token-client';
import { queryRoleForTier } from '@/lib/databricks/sp-roles';
import { authorizeSql } from './authorize';
import { extractTablesForAuthorization } from './sql-tables';
import { applyMask, logColumnDecision, planColumnGuard } from './column-guard';
import { AccessDeniedError } from './errors';
import type { AccessLevel, AccessPrincipal } from './types';

export type { AccessDeniedError };

export interface RunWarehouseQueryInput {
  connectionId: string;
  principal: AccessPrincipal;
  statement: string;
  purpose: string;
  level: AccessLevel;
  surface: import('./types').AccessSurface;
  sessionId?: string | null;
  waitTimeoutSecs?: number;
}

export async function runWarehouseQuery(input: RunWarehouseQueryInput): Promise<DatabricksExecuteResult> {
  const { tier } = await authorizeSql(input.principal, input.statement, input.level, {
    surface: input.surface,
    purpose: input.purpose,
    sessionId: input.sessionId ?? undefined,
  });

  // Column protections (COLUMN_ACCESS_MODE): shadow records only; enforce masks, refuses, limits.
  const tables = extractTablesForAuthorization(input.statement);
  const plan = await planColumnGuard(input.principal, input.statement, tables.ok ? tables.paths : []);
  logColumnDecision(input.principal, input.surface, tables.ok ? tables.paths : [], plan, input.sessionId);
  const enforce = plan.applies && plan.mode === 'enforce';
  if (enforce && plan.stop) {
    throw new AccessDeniedError(plan.stop, {
      reason: plan.parserOk ? 'column_refused' : 'column_unresolved',
      surface: input.surface,
      level: input.level,
      paths: tables.ok ? tables.paths : [],
    });
  }

  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: input.connectionId },
  });
  const session = await openDatabricksSession(conn, queryRoleForTier(tier));

  const result = await executeDatabricksSQL(
    input.connectionId,
    session.workspaceHost,
    session.warehouseId,
    session.token,
    { statement: enforce ? plan.statement : input.statement, waitTimeoutSecs: input.waitTimeoutSecs },
  );
  return enforce ? applyMask(result, plan) : result;
}

export interface RunWarehouseExportInput extends RunWarehouseQueryInput {
  maxRows: number;
}

export async function runWarehouseExport(input: RunWarehouseExportInput): Promise<DatabricksExportHandle> {
  const { tier } = await authorizeSql(input.principal, input.statement, input.level, {
    surface: 'export',
    purpose: input.purpose,
    sessionId: input.sessionId ?? undefined,
  });

  // Exports are files we cannot mask row by row: refuse if they would include protected columns.
  const tables = extractTablesForAuthorization(input.statement);
  const plan = await planColumnGuard(input.principal, input.statement, tables.ok ? tables.paths : []);
  logColumnDecision(input.principal, 'export', tables.ok ? tables.paths : [], plan, input.sessionId);
  if (plan.applies && plan.mode === 'enforce' && (plan.stop || plan.maskIndexes.length || plan.totalsOnly)) {
    throw new AccessDeniedError(plan.stop ?? `This export includes protected columns (${plan.masked.map((m) => m.friendly).join(', ') || 'totals only'}). Remove them from the query to export.`, {
      reason: plan.parserOk ? 'column_refused' : 'column_unresolved',
      surface: 'export',
      level: input.level,
      paths: tables.ok ? tables.paths : [],
    });
  }

  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: input.connectionId },
  });
  const session = await openDatabricksSession(conn, queryRoleForTier(tier));

  return beginDatabricksSQLExport(
    input.connectionId,
    session.workspaceHost,
    session.warehouseId,
    session.token,
    { statement: input.statement, maxRows: input.maxRows },
  );
}
