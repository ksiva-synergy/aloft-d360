import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId, createConnection, updateConnection, listConnections } from '@/lib/databricks/connections';
import { writeCredentials } from '@/lib/databricks/secrets';
import { syncToolEntry } from '@/lib/databricks/tool-registration';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const orgId = await getOrgId();
    const connections = await listConnections(orgId);
    return NextResponse.json({ connections });
  } catch (err) {
    console.error('[databricks/connections GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'name' }, { status: 400 });
    }
    if (!body.workspace_host || typeof body.workspace_host !== 'string') {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'workspace_host' }, { status: 400 });
    }
    if (!body.default_warehouse_id || typeof body.default_warehouse_id !== 'string') {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'default_warehouse_id' }, { status: 400 });
    }
    if (!body.client_id || typeof body.client_id !== 'string') {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'client_id' }, { status: 400 });
    }
    if (!body.client_secret || typeof body.client_secret !== 'string') {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'client_secret' }, { status: 400 });
    }

    const orgId = await getOrgId();

    const conn = await createConnection(orgId, {
      name: body.name,
      workspace_host: body.workspace_host,
      default_warehouse_id: body.default_warehouse_id,
      default_warehouse_http_path: typeof body.default_warehouse_http_path === 'string'
        ? body.default_warehouse_http_path || null
        : null,
    });

    const secretRef = await writeCredentials(conn.id, {
      client_id: body.client_id,
      client_secret: body.client_secret,
    });

    const updated = await updateConnection(orgId, conn.id, { secret_ref: secretRef });

    // Register as a tool_catalog entry so agents can attach it
    await syncToolEntry(updated);

    return NextResponse.json({ connection: updated }, { status: 201 });
  } catch (err) {
    console.error('[databricks/connections POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
