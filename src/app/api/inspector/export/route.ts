/**
 * POST /api/inspector/export
 *
 * Stream a read-only Databricks query result as CSV (up to 100k rows).
 * Separate from chat INLINE execute_tool — uses EXTERNAL_LINKS streaming.
 *
 * Body: { sql: string, filename?: string, maxRows?: number, toolSlug?: string, sessionId?: string }
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  beginDatabricksSQLExport,
  EXPORT_MAX_ROWS,
  ReadOnlyViolationError,
  MultiStatementError,
} from '@/lib/databricks/execute';
import { csvHeaderLine, csvDataLine } from '@/lib/databricks/csv';
import { getAccessToken } from '@/lib/databricks/token-client';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { guardInspectorChat } from '@/lib/inspector/session-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_');
  const trimmed = base.replace(/^\.+/, '').slice(0, 120) || 'export';
  return trimmed.toLowerCase().endsWith('.csv') ? trimmed : `${trimmed}.csv`;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    sql?: unknown;
    filename?: unknown;
    maxRows?: unknown;
    toolSlug?: unknown;
    sessionId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'INVALID_JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sql = typeof body.sql === 'string' ? body.sql.trim() : '';
  if (!sql) {
    return new Response(JSON.stringify({ error: 'SQL_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const blocked = await guardInspectorChat(request, sessionId);
  if (blocked) return blocked;

  const maxRows =
    typeof body.maxRows === 'number' && Number.isFinite(body.maxRows)
      ? Math.min(Math.max(1, Math.floor(body.maxRows)), EXPORT_MAX_ROWS)
      : EXPORT_MAX_ROWS;

  const filename = sanitizeFilename(
    typeof body.filename === 'string' && body.filename.trim()
      ? body.filename.trim()
      : 'inspector-export.csv',
  );

  const toolSlug = typeof body.toolSlug === 'string' && body.toolSlug.trim()
    ? body.toolSlug.trim()
    : 'synergy_dwh';

  try {
    const catalogEntry = await resolveToolCatalogEntry(toolSlug);
    if (!catalogEntry || catalogEntry.type !== 'db_query') {
      return new Response(
        JSON.stringify({ error: 'TOOL_NOT_FOUND', message: `db_query tool '${toolSlug}' not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfg = catalogEntry.config as Record<string, string> | null;
    const connectionId = cfg?.connection_id;
    if (!connectionId) {
      return new Response(
        JSON.stringify({ error: 'NO_CONNECTION', message: `Tool '${toolSlug}' has no connection_id` }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const conn = await prisma.platformDatabricksConnection.findUnique({ where: { id: connectionId } });
    if (!conn) {
      return new Response(
        JSON.stringify({ error: 'CONNECTION_NOT_FOUND' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (conn.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'CONNECTION_INACTIVE', message: `Connection status: ${conn.status}` }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const token = await getAccessToken(connectionId, conn.workspace_host);
    const handle = await beginDatabricksSQLExport(
      connectionId,
      conn.workspace_host,
      conn.default_warehouse_id,
      token,
      { statement: sql, maxRows },
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(csvHeaderLine(handle.meta.columns)));
          for await (const row of handle.rows()) {
            controller.enqueue(encoder.encode(csvDataLine(row)));
          }
          controller.close();
        } catch (err: unknown) {
          try {
            controller.error(err instanceof Error ? err : new Error(String(err)));
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Export-Truncated': handle.meta.truncated ? 'true' : 'false',
        'X-Export-Row-Limit': String(handle.meta.row_limit),
        'X-Export-Total-Row-Count': String(handle.meta.total_row_count),
        'X-Export-Statement-Id': handle.meta.statement_id,
      },
    });
  } catch (err: unknown) {
    if (err instanceof ReadOnlyViolationError) {
      return new Response(
        JSON.stringify({ error: 'READ_ONLY_VIOLATION', message: err.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (err instanceof MultiStatementError) {
      return new Response(
        JSON.stringify({ error: 'MULTI_STATEMENT', message: err.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const msg = err instanceof Error ? err.message : 'Export failed';
    console.error('[inspector/export]', msg);
    return new Response(
      JSON.stringify({ error: 'EXPORT_FAILED', message: msg }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

