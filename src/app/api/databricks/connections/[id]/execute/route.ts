/**
 * HTTP adapter for Databricks SQL execution.
 *
 * This route is a thin shell. All safety enforcement lives in
 * src/lib/databricks/execute.ts (executeDatabricksSQL). Do not add
 * enforcement logic here — it belongs at the shared chokepoint.
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { getAccessToken } from '@/lib/databricks/token-client';
import {
  executeDatabricksSQL,
  ReadOnlyViolationError,
  MultiStatementError,
  ExternalLinksError,
} from '@/lib/databricks/execute';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

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

    const token = await getAccessToken(id, conn.workspace_host);

    const result = await executeDatabricksSQL(
      id,
      conn.workspace_host,
      conn.default_warehouse_id,
      token,
      { statement, waitTimeoutSecs },
    );

    return NextResponse.json(result);
  } catch (err) {
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
      { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
