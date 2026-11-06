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

  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: input.connectionId },
  });
  const session = await openDatabricksSession(conn, queryRoleForTier(tier));

  return executeDatabricksSQL(
    input.connectionId,
    session.workspaceHost,
    session.warehouseId,
    session.token,
    { statement: input.statement, waitTimeoutSecs: input.waitTimeoutSecs },
  );
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
