import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId, getConnection, updateConnection, deleteConnection } from '@/lib/databricks/connections';
import { writeCredentials } from '@/lib/databricks/secrets';
import { evictToken as evictCachedToken } from '@/lib/databricks/token-client';
import { syncToolEntry, deleteToolEntry } from '@/lib/databricks/tool-registration';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ connection: conn });
  } catch (err) {
    console.error('[databricks/connections/:id GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const body = await request.json() as Record<string, unknown>;

    const patch: Parameters<typeof updateConnection>[2] = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.workspace_host === 'string') patch.workspace_host = body.workspace_host;
    if (typeof body.default_warehouse_id === 'string') patch.default_warehouse_id = body.default_warehouse_id;
    if (body.default_warehouse_http_path !== undefined) {
      patch.default_warehouse_http_path = typeof body.default_warehouse_http_path === 'string'
        ? body.default_warehouse_http_path || null
        : null;
    }

    // If credentials are being updated, re-write to Secrets Manager
    if (
      typeof body.client_id === 'string' &&
      typeof body.client_secret === 'string'
    ) {
      const secretRef = await writeCredentials(id, {
        client_id: body.client_id,
        client_secret: body.client_secret,
      });
      patch.secret_ref = secretRef;
      evictCachedToken(id);
    }

    const updated = await updateConnection(orgId, id, patch);

    // Keep tool catalog entry in sync
    await syncToolEntry(updated);

    return NextResponse.json({ connection: updated });
  } catch (err) {
    console.error('[databricks/connections/:id PATCH]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    await deleteConnection(orgId, id);
    await deleteToolEntry(id);
    evictCachedToken(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[databricks/connections/:id DELETE]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
