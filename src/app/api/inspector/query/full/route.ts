/**
 * POST /api/inspector/query/full
 *
 * Re-runs a chat query with a higher row ceiling so **All rows** is not stuck on
 * the model's default LIMIT 100 sample.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ReadOnlyViolationError, MultiStatementError } from '@/lib/databricks/execute';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { principalForUser } from '@/lib/access/principal';
import { runWarehouseQuery } from '@/lib/access/warehouse';
import { AccessDeniedError } from '@/lib/access/errors';
import {
  CHAT_QUERY_RESULT_MAX_ROWS,
} from '@/lib/inspector/result-display';
import { expandSqlForFullTable } from '@/lib/inspector/sql-full-fetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: { sessionId?: unknown; resultId?: unknown; sql?: unknown; toolSlug?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const blocked = await guardInspectorChat(request, sessionId);
  if (blocked) return blocked;

  const resultId = typeof body.resultId === 'string' ? body.resultId.trim() : '';
  let sql = typeof body.sql === 'string' ? body.sql.trim() : '';

  if (resultId) {
    const row = await prisma.studio_query_results.findUnique({
      where: { id: resultId },
      select: { sql: true, session_id: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'RESULT_NOT_FOUND' }, { status: 404 });
    }
    const ownerCheck = await guardInspectorChat(request, row.session_id);
    if (ownerCheck) return ownerCheck;
    sql = row.sql?.trim() ?? '';
  }

  if (!sql) {
    return NextResponse.json({ error: 'SQL_REQUIRED' }, { status: 400 });
  }

  const toolSlug =
    typeof body.toolSlug === 'string' && body.toolSlug.trim()
      ? body.toolSlug.trim()
      : 'synergy_dwh';

  const dataPrincipal = await principalForUser(session.user.id);
  const statement = expandSqlForFullTable(sql, CHAT_QUERY_RESULT_MAX_ROWS);

  try {
    const catalogEntry = await resolveToolCatalogEntry(toolSlug);
    if (!catalogEntry || catalogEntry.type !== 'db_query') {
      return NextResponse.json(
        { error: 'TOOL_NOT_FOUND', message: `db_query tool '${toolSlug}' not found` },
        { status: 404 },
      );
    }

    const cfg = catalogEntry.config as Record<string, string> | null;
    const connectionId = cfg?.connection_id;
    if (!connectionId) {
      return NextResponse.json(
        { error: 'NO_CONNECTION', message: `Tool '${toolSlug}' has no connection_id` },
        { status: 422 },
      );
    }

    const conn = await prisma.platformDatabricksConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.status !== 'active') {
      return NextResponse.json({ error: 'CONNECTION_INACTIVE' }, { status: 422 });
    }

    const sqlResult = await runWarehouseQuery({
      connectionId,
      principal: dataPrincipal,
      statement,
      purpose: 'inspector_query_full',
      level: 'query',
      surface: 'sql',
      sessionId: sessionId ?? null,
      rowLimit: CHAT_QUERY_RESULT_MAX_ROWS,
    });

    const rows = sqlResult.rows.slice(0, CHAT_QUERY_RESULT_MAX_ROWS);

    return NextResponse.json({
      columns: sqlResult.columns,
      rows,
      rowCount: sqlResult.row_count,
      truncated: sqlResult.truncated || sqlResult.rows.length > CHAT_QUERY_RESULT_MAX_ROWS,
      sql: statement,
    });
  } catch (err: unknown) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: 'ACCESS_DENIED', message: err.message }, { status: 403 });
    }
    if (err instanceof ReadOnlyViolationError || err instanceof MultiStatementError) {
      return NextResponse.json({ error: err.name, message: err.message }, { status: 400 });
    }
    console.error('[inspector/query/full]', err);
    return NextResponse.json({ error: 'QUERY_FAILED', message: 'Could not load full table' }, { status: 502 });
  }
}
