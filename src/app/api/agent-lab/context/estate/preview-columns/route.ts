import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { executeDatabricksSQL } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';

export const dynamic = 'force-dynamic';

function safeId(id: string, label: string): string {
  if (/[`\\]/.test(id)) throw new Error(`Unsafe identifier in ${label}: "${id}"`);
  return id;
}

function safeSqlStr(val: string, label: string): string {
  if (/[\\;]/.test(val)) throw new Error(`Unsafe value in ${label}: "${val}"`);
  return val.replace(/'/g, "''");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'MISSING_PATH' }, { status: 400 });

  const parts = path.split('.');
  if (parts.length !== 3) return NextResponse.json({ error: 'INVALID_PATH_FORMAT' }, { status: 400 });

  const [catalog, schema, table] = parts;

  try {
    const orgId = await getOrgId();

    const conn = await prisma.platformDatabricksConnection.findFirst({
      where: { org_id: orgId },
      select: { id: true, workspace_host: true, default_warehouse_id: true },
    });
    if (!conn) return NextResponse.json({ error: 'NO_CONNECTION' }, { status: 404 });

    const token = await getAccessToken(conn.id, conn.workspace_host);

    const sql = `SELECT column_name, data_type, is_nullable, comment, ordinal_position
      FROM \`${safeId(catalog, 'catalog')}\`.information_schema.columns
      WHERE table_schema = '${safeSqlStr(schema, 'schema')}'
        AND table_name = '${safeSqlStr(table, 'table')}'
      ORDER BY ordinal_position`;

    const result = await executeDatabricksSQL(
      conn.id,
      conn.workspace_host,
      conn.default_warehouse_id,
      token,
      { statement: sql },
    );

    const columns = result.rows.map((row: any) => ({
      column_name: String(row['column_name'] ?? ''),
      data_type: String(row['data_type'] ?? ''),
      is_nullable: String(row['is_nullable'] ?? 'YES'),
      comment: row['comment'] ? String(row['comment']) : null,
      ordinal_position: Number(row['ordinal_position'] ?? 0),
    }));

    return NextResponse.json({ columns });
  } catch (err) {
    console.error('[context/estate/preview-columns GET]', err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('INSUFFICIENT_PERMISSIONS') || msg.includes('Insufficient privileges')) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_PERMISSIONS', catalog },
        { status: 403 },
      );
    }
    if (
      msg.includes('TCP/IP connection') ||
      msg.includes('Connect timed out') ||
      msg.includes('connection to the host') ||
      msg.includes('port 1433')
    ) {
      // Federated / external catalog — Databricks could not reach the remote source
      const hostMatch = msg.match(/host\s+([\d.]+),\s*port\s+(\d+)/i);
      const remote = hostMatch ? `${hostMatch[1]}:${hostMatch[2]}` : null;
      return NextResponse.json(
        { error: 'EXTERNAL_SOURCE_UNREACHABLE', catalog, remote },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
