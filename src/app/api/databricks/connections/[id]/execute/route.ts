/**
 * HTTP adapter for Databricks SQL execution.
 *
 * This route is a thin shell. All safety enforcement lives in
 * src/lib/databricks/execute.ts (executeDatabricksSQL). Do not add
 * enforcement logic here — it belongs at the shared chokepoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { denyUnless, requirePermission, resolveAuth } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { principalForUser } from '@/lib/access/principal';
import { runWarehouseQuery } from '@/lib/access/warehouse';
import {
  ReadOnlyViolationError,
  MultiStatementError,
  ExternalLinksError,
} from '@/lib/databricks/execute';
import { AccessDeniedError } from '@/lib/access/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await denyUnless(request, (auth) => requirePermission(auth, PERMISSIONS.ACCESS_ADMIN));
  if (denied) return denied;

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    if (conn.status !== 'active') {
      return NextResponse.json(
        { error: 'CONNECTION_NOT_ACTIVE', status: conn.status },
        { status: 422 },
      );
    }

    const body = await request.json() as { statement?: string; wait_timeout?: string };

    const statement =
      typeof body.statement === 'string' ? body.statement
      : typeof (body as { sql?: string }).sql === 'string' ? (body as { sql: string }).sql
      : typeof (body as { query?: string }).query === 'string' ? (body as { query: string }).query
      : undefined;
    if (!statement) {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'statement' }, { status: 400 });
    }

    const waitTimeoutSecs = body.wait_timeout
      ? parseInt(body.wait_timeout.replace(/[^0-9]/g, ''), 10)
      : undefined;

    const auth = await resolveAuth(request);
    const principal = await principalForUser(auth.userId);

    const result = await runWarehouseQuery({
      connectionId: id,
      principal,
      statement,
      purpose: 'connection_console',
      level: 'query',
      surface: 'sql',
      waitTimeoutSecs,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: 'ACCESS_DENIED', message: err.message }, { status: 403 });
    }
    if (err instanceof ReadOnlyViolationError) {
      return NextResponse.json(
        { error: 'READ_ONLY_VIOLATION', message: err.message, verb: err.verb },
        { status: 403 },
      );
    }
    if (err instanceof MultiStatementError) {
      return NextResponse.json(
        { error: 'MULTI_STATEMENT', message: err.message },
        { status: 403 },
      );
    }
    if (err instanceof ExternalLinksError) {
      return NextResponse.json(
        { error: 'RESULT_TOO_LARGE', message: err.message },
        { status: 422 },
      );
    }
    console.error('[databricks/connections/:id/execute POST]', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Query execution failed' },
      { status: 500 },
    );
  }
}
